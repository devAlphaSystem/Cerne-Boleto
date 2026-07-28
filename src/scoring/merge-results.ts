import type { BoletoLayout, CandidateEvidence, FieldCandidate, NormalizedBounds, PartyRole } from "../candidates/types";
import type { BoletoFieldSource, BoletoGeneralInfo, BoletoPartyInfo, ExtractedBoleto, ExtractedBoletoField, ExtractionSource } from "../types";
import { validateBoletoCode, type BoletoComponents } from "../validation/boleto";
import { institutionNameForBankCode } from "./institution-names";

const SOURCE_BASE_SCORE: Record<ExtractionSource, number> = {
  itf: 0.995,
  "pdf-text": 0.985,
  "pdf-text-reconstructed": 0.97,
  ocr: 0.82,
};

const SOURCE_ORDER: ExtractionSource[] = ["itf", "pdf-text", "pdf-text-reconstructed", "ocr"];
const FIELD_SOURCE_ORDER: BoletoFieldSource[] = ["encoded", "pdf-text", "ocr"];

interface EvidenceGroup {
  barcode: string;
  items: CandidateEvidence[];
}

interface VisibleResolution {
  field: ExtractedBoletoField | null;
  conflict: boolean;
  /** True when a strict majority resolved the field over minority values. */
  discardedMinority: boolean;
}

export interface MergeEvidenceResult {
  results: ExtractedBoleto[];
  warnings: string[];
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function evidenceScore(evidence: CandidateEvidence): number {
  let score = SOURCE_BASE_SCORE[evidence.source];
  if (evidence.source === "ocr") {
    const ocrConfidence = Math.max(0, Math.min(100, evidence.ocrConfidence ?? 0));
    score = Math.max(0.75, 0.72 + (ocrConfidence / 100) * 0.2);
    if (evidence.nearLabel) {
      score += 0.04;
    }
    score -= (evidence.corrections ?? 0) * 0.1;
  }
  if (evidence.nearLabel && evidence.source.startsWith("pdf-text")) {
    score += 0.005;
  }
  return Math.max(0, Math.min(0.995, score));
}

function independentFamilies(sources: Set<ExtractionSource>): number {
  let families = 0;
  if ([...sources].some((source) => source.startsWith("pdf-text"))) {
    families += 1;
  }
  if (sources.has("itf")) {
    families += 1;
  }
  if (sources.has("ocr")) {
    families += 1;
  }
  return families;
}

function centerDistance(left: NormalizedBounds, right: NormalizedBounds): number {
  const leftX = left.x + left.width / 2;
  const leftY = left.y + left.height / 2;
  const rightX = right.x + right.width / 2;
  const rightY = right.y + right.height / 2;
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function pageBounds(group: EvidenceGroup, field: FieldCandidate): NormalizedBounds[] {
  const positioned = group.items.filter((item) => item.page === field.page && item.bounds !== undefined);
  const samePass = positioned.filter((item) => item.pass === field.pass);
  if (samePass.length > 0) {
    return samePass.map((item) => item.bounds!);
  }

  const fallbackPass = Math.min(...positioned.map((item) => item.pass));
  return positioned.filter((item) => item.pass === fallbackPass).map((item) => item.bounds!);
}

function nearestGroup(field: FieldCandidate, pageGroups: EvidenceGroup[]): EvidenceGroup | null {
  if (field.bounds === null) {
    return null;
  }

  const positioned = pageGroups.map((group) => {
    const bounds = pageBounds(group, field);
    return {
      group,
      distance: bounds.length === 0 ? null : Math.min(...bounds.map((item) => centerDistance(field.bounds!, item))),
    };
  });

  if (positioned.some((item) => item.distance === null)) {
    return null;
  }

  const ordered = positioned.filter((item): item is { group: EvidenceGroup; distance: number } => item.distance !== null).sort((left, right) => left.distance - right.distance);
  const nearest = ordered[0];
  if (nearest === undefined) {
    return null;
  }
  const runnerUp = ordered[1];
  if (nearest.distance > 0.35) {
    return null;
  }
  if (runnerUp !== undefined && runnerUp.distance - nearest.distance <= Math.max(0.015, nearest.distance * 0.2)) {
    return null;
  }
  return nearest.group;
}

function associateFields(
  groups: EvidenceGroup[],
  fields: FieldCandidate[],
): {
  assigned: Map<string, FieldCandidate[]>;
  hadAmbiguousFields: boolean;
} {
  const assigned = new Map(groups.map((group) => [group.barcode, [] as FieldCandidate[]]));
  let hadAmbiguousFields = false;

  for (const field of fields) {
    const pageGroups = groups.filter((group) => group.items.some((item) => item.page === field.page));
    if (pageGroups.length === 0) {
      continue;
    }

    const selected = pageGroups.length === 1 ? pageGroups[0]! : nearestGroup(field, pageGroups);
    if (selected === null) {
      hadAmbiguousFields = true;
      continue;
    }
    assigned.get(selected.barcode)?.push(field);
  }

  return { assigned, hadAmbiguousFields };
}

function fieldSource(source: FieldCandidate["source"]): BoletoFieldSource {
  return source === "ocr" ? "ocr" : "pdf-text";
}

function comparableValue(value: string): string {
  return value.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/gu, " ").trim().toUpperCase();
}

/**
 * OCR passes are deterministic derivatives of the same visual page. They may
 * improve the selected value or confidence, but they must not create extra
 * majority votes merely because the same pixels were rotated or filtered.
 */
function collapseDerivedFieldCandidates(candidates: readonly FieldCandidate[]): FieldCandidate[] {
  const output: FieldCandidate[] = [];
  const ocrByValue = new Map<string, FieldCandidate>();
  for (const candidate of candidates) {
    if (candidate.source !== "ocr") {
      output.push(candidate);
      continue;
    }
    const key = `${candidate.page}:${candidate.kind}:${candidate.partyRole ?? ""}:${comparableValue(candidate.value)}`;
    const current = ocrByValue.get(key);
    if (current === undefined || candidate.confidence > current.confidence) {
      ocrByValue.set(key, candidate);
    }
  }
  output.push(...ocrByValue.values());
  return output;
}

function orderByReliability(candidates: readonly FieldCandidate[]): FieldCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.source === right.source) {
      return 0;
    }
    return left.source === "ocr" ? 1 : -1;
  });
}

const PREFIX_MERGE_KINDS = new Set<FieldCandidate["kind"]>(["institution", "beneficiary", "finalBeneficiary", "payer"]);

/**
 * A name repeated across sections may be truncated by a line wrap in one of
 * them. When every shorter value is a word-boundary prefix of the longest
 * one, all evidence describes the same entity and the longest value wins.
 */
function prefixConsolidation(byValue: ReadonlyMap<string, FieldCandidate[]>, kind: FieldCandidate["kind"]): { matching: FieldCandidate[]; representative: FieldCandidate } | null {
  if (!PREFIX_MERGE_KINDS.has(kind)) {
    return null;
  }
  const keys = [...byValue.keys()].sort((left, right) => right.length - left.length);
  const longest = keys[0]!;
  for (const key of keys.slice(1)) {
    if (!longest.startsWith(key) || longest[key.length] !== " ") {
      return null;
    }
  }
  return {
    matching: [...byValue.values()].flat(),
    representative: orderByReliability(byValue.get(longest)!)[0]!,
  };
}

function visibleResolution(candidates: FieldCandidate[]): VisibleResolution {
  candidates = collapseDerivedFieldCandidates(candidates);
  if (candidates.length === 0) {
    return { field: null, conflict: false, discardedMinority: false };
  }

  const byValue = new Map<string, FieldCandidate[]>();
  for (const candidate of candidates) {
    const key = comparableValue(candidate.value);
    const group = byValue.get(key) ?? [];
    group.push(candidate);
    byValue.set(key, group);
  }

  let matching: FieldCandidate[];
  let representative: FieldCandidate;
  let discardedMinority = false;
  if (byValue.size === 1) {
    matching = [...byValue.values()][0]!;
    representative = orderByReliability(matching)[0]!;
  } else {
    const consolidated = prefixConsolidation(byValue, candidates[0]!.kind);
    if (consolidated !== null) {
      matching = consolidated.matching;
      representative = consolidated.representative;
    } else {
      const groups = [...byValue.values()].sort((left, right) => right.length - left.length);
      const leader = groups[0]!;
      if (leader.length > groups[1]!.length && leader.length * 2 > candidates.length) {
        matching = leader;
        representative = orderByReliability(leader)[0]!;
        discardedMinority = true;
      } else {
        return { field: null, conflict: true, discardedMinority: false };
      }
    }
  }

  const sources = new Set(matching.map((candidate) => fieldSource(candidate.source)));
  let precisionScore = Math.max(...matching.map((candidate) => clampConfidence(candidate.confidence)));
  if (sources.size > 1) {
    precisionScore = Math.min(0.999, precisionScore + 0.004);
  }
  if (discardedMinority) {
    precisionScore = Math.min(precisionScore, 0.95);
  }

  return {
    field: {
      value: representative.value,
      rawValue: representative.rawValue,
      precisionScore: Number(precisionScore.toFixed(3)),
      pages: [...new Set(matching.map((candidate) => candidate.page))].sort((left, right) => left - right),
      sources: FIELD_SOURCE_ORDER.filter((source) => sources.has(source)),
    },
    conflict: false,
    discardedMinority,
  };
}

function horizontalOverlap(left: NormalizedBounds, right: NormalizedBounds): number {
  const intersection = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return intersection / Math.max(0.000_001, Math.min(left.width, right.width));
}

function samePhysicalEvidence(left: NormalizedBounds, right: NormalizedBounds): boolean {
  const leftCenterY = left.y + left.height / 2;
  const rightCenterY = right.y + right.height / 2;
  return horizontalOverlap(left, right) >= 0.5 && Math.abs(leftCenterY - rightCenterY) <= Math.max(0.12, left.height, right.height);
}

/**
 * Counts independent physical occurrences while collapsing repeated render
 * passes of the same page/source. Distinct recognition families remain
 * independent, as do spatially separate copies of the same code.
 */
function occurrenceCount(items: readonly CandidateEvidence[]): number {
  const byPageAndSource = new Map<string, CandidateEvidence[]>();
  for (const item of items) {
    const key = `${item.page}:${item.source}`;
    const current = byPageAndSource.get(key) ?? [];
    current.push(item);
    byPageAndSource.set(key, current);
  }

  let total = 0;
  for (const group of byPageAndSource.values()) {
    const physical: NormalizedBounds[] = [];
    for (const item of group) {
      if (item.bounds !== undefined && !physical.some((bounds) => samePhysicalEvidence(bounds, item.bounds!))) {
        physical.push(item.bounds);
      }
    }
    total += Math.max(1, physical.length);
  }
  return total;
}

function candidatesFor(fields: FieldCandidate[], kind: FieldCandidate["kind"], partyRole?: PartyRole): FieldCandidate[] {
  return fields.filter((field) => field.kind === kind && (partyRole === undefined || field.partyRole === partyRole));
}

/**
 * Heuristic candidates never reach cobrança results, whose labeled sections
 * are authoritative. In arrecadação, a labeled candidate for the same field
 * still silences its heuristic counterparts.
 */
function fieldsForLayout(fields: FieldCandidate[], layout: BoletoLayout): FieldCandidate[] {
  if (layout === "cobranca") {
    return fields.filter((field) => field.heuristic !== true);
  }
  const labeled = new Set(fields.filter((field) => field.heuristic !== true).map((field) => `${field.kind}:${field.partyRole ?? ""}`));
  return fields.filter((field) => field.heuristic !== true || !labeled.has(`${field.kind}:${field.partyRole ?? ""}`));
}

function encodedField(value: string, rawValue: string, pages: number[]): ExtractedBoletoField {
  return {
    value,
    rawValue,
    precisionScore: 0.999,
    pages,
    sources: ["encoded"],
  };
}

function mergeAuthoritativeField(
  encoded: ExtractedBoletoField,
  visible: VisibleResolution,
): {
  field: ExtractedBoletoField;
  conflict: boolean;
} {
  if (visible.field === null) {
    return {
      field: encoded,
      conflict: visible.conflict,
    };
  }
  if (visible.field.value !== encoded.value) {
    return {
      field: encoded,
      conflict: true,
    };
  }

  const sources = new Set<BoletoFieldSource>([...encoded.sources, ...visible.field.sources]);
  return {
    field: {
      value: encoded.value,
      rawValue: visible.field.rawValue,
      precisionScore: Math.max(encoded.precisionScore, visible.field.precisionScore),
      pages: [...new Set([...encoded.pages, ...visible.field.pages])].sort((left, right) => left - right),
      sources: FIELD_SOURCE_ORDER.filter((source) => sources.has(source)),
    },
    conflict: false,
  };
}

function centsToDecimal(cents: string): string {
  const normalized = cents.replace(/^0+/u, "") || "0";
  const padded = normalized.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

function partyInfo(
  fields: FieldCandidate[],
  kind: "beneficiary" | "finalBeneficiary" | "payer",
  role: PartyRole,
): {
  party: BoletoPartyInfo | null;
  conflict: boolean;
  discardedMinority: boolean;
} {
  const name = visibleResolution(candidatesFor(fields, kind));
  const taxId = visibleResolution(candidatesFor(fields, "taxId", role));
  const party = name.field === null && taxId.field === null ? null : { name: name.field, taxId: taxId.field };
  return {
    party,
    conflict: name.conflict || taxId.conflict,
    discardedMinority: name.discardedMinority || taxId.discardedMinority,
  };
}

function generalInfo(
  originalComponents: BoletoComponents,
  fields: FieldCandidate[],
  pages: number[],
  barcode: string,
): {
  components: BoletoComponents;
  info: BoletoGeneralInfo;
  warnings: string[];
} {
  const warnings: string[] = [];
  let components = originalComponents;
  const usableFields = fieldsForLayout(fields, components.layout);
  const visibleInstitution = visibleResolution(candidatesFor(usableFields, "institution"));
  const beneficiary = partyInfo(usableFields, "beneficiary", "beneficiary");
  const finalBeneficiary = partyInfo(usableFields, "finalBeneficiary", "final-beneficiary");
  const payer = partyInfo(usableFields, "payer", "payer");
  const ourNumber = visibleResolution(candidatesFor(usableFields, "ourNumber"));
  const documentNumber = visibleResolution(candidatesFor(usableFields, "documentNumber"));
  const documentDate = visibleResolution(candidatesFor(usableFields, "documentDate"));
  const visibleAmount = visibleResolution(candidatesFor(usableFields, "amount"));
  const visibleDueDate = visibleResolution(candidatesFor(usableFields, "dueDate"));

  const encodedInstitution = components.layout === "cobranca" && components.variant === "bank-code" ? { name: institutionNameForBankCode(components.institutionCode), code: components.institutionCode } : null;
  const institution: VisibleResolution = encodedInstitution === null || encodedInstitution.name === null ? visibleInstitution : { field: encodedField(encodedInstitution.name, encodedInstitution.code, pages), conflict: false, discardedMinority: false };

  const ordinaryConflicts = [institution.conflict, beneficiary.conflict, finalBeneficiary.conflict, payer.conflict, ourNumber.conflict, documentNumber.conflict, documentDate.conflict];
  if (ordinaryConflicts.some(Boolean)) {
    warnings.push(`Conflicting visible fields for boleto ending in ${barcode.slice(-6)} were left null.`);
  }

  const minorityDiscards = [institution.discardedMinority, beneficiary.discardedMinority, finalBeneficiary.discardedMinority, payer.discardedMinority, ourNumber.discardedMinority, documentNumber.discardedMinority, documentDate.discardedMinority, visibleAmount.discardedMinority, visibleDueDate.discardedMinority];
  if (minorityDiscards.some(Boolean)) {
    warnings.push(`Minority conflicting visible values for boleto ending in ${barcode.slice(-6)} were ignored.`);
  }

  let amount: ExtractedBoletoField | null;
  const amountCents = components.amountCents;
  const hasEncodedAmount = amountCents !== null && !(components.layout === "cobranca" && components.amountField === "0000000000");
  if (!hasEncodedAmount) {
    amount = visibleAmount.field;
    if (visibleAmount.conflict) {
      warnings.push(`Conflicting visible amounts for boleto ending in ${barcode.slice(-6)} were left null.`);
    }
  } else {
    const mergedAmount = mergeAuthoritativeField(encodedField(centsToDecimal(amountCents), components.layout === "cobranca" ? (components.amountField ?? amountCents) : components.valueField, pages), visibleAmount);
    amount = mergedAmount.field;
    if (mergedAmount.conflict) {
      warnings.push(`A visible amount conflicts with the encoded amount for boleto ending in ${barcode.slice(-6)}; the encoded amount was preserved.`);
    }
  }

  let dueDate: ExtractedBoletoField | null;
  if (components.layout === "cobranca") {
    const visibleDate = visibleDueDate.field?.value ?? null;
    const matchingDate = visibleDate !== null && components.dueDateCandidates.includes(visibleDate) ? visibleDate : null;
    const selectedDate = matchingDate ?? components.dueDate;

    if (selectedDate !== null) {
      const encoded = encodedField(selectedDate, components.dueDateFactor ?? selectedDate, pages);
      const selectedVisible: VisibleResolution = matchingDate === null ? { field: null, conflict: visibleDueDate.conflict || visibleDueDate.field !== null, discardedMinority: false } : visibleDueDate;
      const merged = mergeAuthoritativeField(encoded, selectedVisible);
      dueDate = merged.field;
      components = {
        ...components,
        dueDate: selectedDate,
        dueDateAssumption: matchingDate === null ? components.dueDateAssumption : null,
      };

      if (visibleDueDate.field !== null && matchingDate === null) {
        warnings.push(`A visible due date conflicts with the encoded factor for boleto ending in ${barcode.slice(-6)}; the encoded date was preserved.`);
      } else if (visibleDueDate.conflict) {
        warnings.push(`Conflicting visible due dates for boleto ending in ${barcode.slice(-6)} did not replace the encoded date.`);
      }
      if (matchingDate === null && components.dueDateAssumption === "2025-reset-cycle") {
        warnings.push(`The due-date factor for boleto ending in ${barcode.slice(-6)} was interpreted using the cycle reset on 2025-02-22 because no matching printed date disambiguated it.`);
      }
    } else {
      dueDate = visibleDueDate.field;
      if (visibleDueDate.conflict) {
        warnings.push(`Conflicting visible due dates for boleto ending in ${barcode.slice(-6)} were left null.`);
      }
    }
  } else if (components.dueDate === null) {
    dueDate = visibleDueDate.field;
    if (visibleDueDate.field !== null) {
      components = { ...components, dueDate: visibleDueDate.field.value };
    }
    if (visibleDueDate.conflict) {
      warnings.push(`Conflicting visible due dates for boleto ending in ${barcode.slice(-6)} were left null.`);
    }
  } else {
    const merged = mergeAuthoritativeField(encodedField(components.dueDate, components.dueDate, pages), visibleDueDate);
    dueDate = merged.field;
    if (merged.conflict) {
      warnings.push(`A visible due date conflicts with the encoded arrecadação date for boleto ending in ${barcode.slice(-6)}; the encoded date was preserved.`);
    }
  }

  return {
    components,
    info: {
      institution: institution.field,
      beneficiary: beneficiary.party,
      finalBeneficiary: finalBeneficiary.party,
      payer: payer.party,
      dueDate,
      amount,
      ourNumber: ourNumber.field,
      documentNumber: documentNumber.field,
      documentDate: documentDate.field,
    },
    warnings,
  };
}

export function mergeEvidence(evidence: CandidateEvidence[], fieldCandidates: FieldCandidate[]): MergeEvidenceResult {
  const grouped = new Map<string, CandidateEvidence[]>();
  for (const item of evidence) {
    const validation = validateBoletoCode(item.digitableLine);
    if (!validation.isValid || validation.barcode !== item.barcode) {
      continue;
    }
    const current = grouped.get(item.barcode) ?? [];
    current.push(item);
    grouped.set(item.barcode, current);
  }

  const groups = [...grouped.entries()].map(([barcode, items]) => ({ barcode, items }));
  const association = associateFields(groups, fieldCandidates);
  const warnings: string[] = [];
  if (association.hadAmbiguousFields) {
    warnings.push("Some page-wide or equidistant visible fields were not associated because the page contained multiple boletos.");
  }

  const results: ExtractedBoleto[] = [];
  for (const group of groups) {
    const representative = group.items[0];
    if (representative === undefined) {
      continue;
    }
    const validation = validateBoletoCode(representative.digitableLine);
    const components = validation.components;
    if (!validation.isValid || components === null || validation.digitableLine === null || validation.formattedDigitableLine === null) {
      continue;
    }

    const sources = new Set(group.items.map((item) => item.source));
    const pages = [...new Set(group.items.map((item) => item.page))].sort((left, right) => left - right);
    let precisionScore = Math.max(...group.items.map(evidenceScore));
    if (independentFamilies(sources) > 1) {
      precisionScore = Math.min(0.999, precisionScore + 0.004);
    }
    const resolved = generalInfo(components, association.assigned.get(group.barcode) ?? [], pages, group.barcode);
    warnings.push(...resolved.warnings);

    results.push({
      barcode: group.barcode,
      digitableLine: validation.digitableLine,
      formattedDigitableLine: validation.formattedDigitableLine,
      layout: components.layout,
      isValid: true,
      precisionScore: Number(precisionScore.toFixed(3)),
      pages,
      sources: SOURCE_ORDER.filter((source) => sources.has(source)),
      occurrences: occurrenceCount(group.items),
      components: resolved.components,
      generalInfo: resolved.info,
    });
  }

  results.sort((left, right) => {
    if (right.precisionScore !== left.precisionScore) {
      return right.precisionScore - left.precisionScore;
    }
    const pageOrder = (left.pages[0] ?? Number.MAX_SAFE_INTEGER) - (right.pages[0] ?? Number.MAX_SAFE_INTEGER);
    return pageOrder === 0 ? left.barcode.localeCompare(right.barcode) : pageOrder;
  });

  return {
    results,
    warnings: [...new Set(warnings)],
  };
}
