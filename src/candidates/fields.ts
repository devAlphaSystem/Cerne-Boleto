import type { CandidateTextLine, FieldCandidate, FieldKind, NormalizedBounds, PartyRole } from "./types";

interface LabelRule {
  kind: Exclude<FieldKind, "taxId">;
  label: RegExp;
  partyRole?: PartyRole;
  normalize(value: string): string | null;
}

const PARTY_LABEL_PATTERN = /(?<!(?:RESPONSABILIDADE|CODIGO)\s+D[OEA]\s)(?<!\p{L})(?:BENEFICIARIO\s+FINAL|BENEFICIARIO|CEDENTE|PAGADOR|SACADO)(?!\p{L})/u;
const ANY_LABEL_PATTERN = /(?<!\p{L})(?:INSTITUICAO(?:\s+FINANCEIRA)?|BANCO|BENEFICIARIO\s+FINAL|BENEFICIARIO|CEDENTE|PAGADOR|SACADO|CPF\s*\/\s*CNPJ|CNPJ\s*\/\s*CPF|CPF|CNPJ|(?:DATA\s+DE\s+)?VENCIMENTO|VALOR\s+(?:DO\s+)?(?:DOCUMENTO|COBRADO)|VALOR\s+A\s+PAGAR|VALOR\s+NOMINAL|NOSSO\s+NUMERO|(?:NUMERO|N[O.]?)\s+D[AO]\s+(?:DOCUMENTO|FATURA)|DATA\s+DO\s+DOCUMENTO|DATA\s+DE\s+EMISSAO)(?!\p{L})/u;
const TAX_ID_LABEL_PATTERN = /(?<!\p{L})(?:CPF\s*\/\s*CNPJ|CNPJ\s*\/\s*CPF|CPF|CNPJ)(?!\p{L})/gu;
const DATE_PATTERN = /\b([0-3][0-9])\/([01][0-9])\/([0-9]{4})\b/u;
const AMOUNT_PATTERN = /(?:R\$\s*)?((?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),[0-9]{2})(?![0-9])/u;
const CPF_PATTERN = /(?<![A-Z0-9])(?:[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})(?![A-Z0-9])/gu;
const CNPJ_PATTERN = /(?<![A-Z0-9])(?:[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?[0-9]{2})(?![A-Z0-9])/gu;

function comparable(value: string): string {
  return value.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").replace(/\u00a0/gu, " ").toUpperCase();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizedConfidence(value: number): number {
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function unionBounds(left: NormalizedBounds | null, right: NormalizedBounds | null): NormalizedBounds | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }

  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const farX = Math.max(left.x + left.width, right.x + right.width);
  const farY = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: farX - x,
    height: farY - y,
  };
}

function isPlausibleFollowingLine(current: CandidateTextLine, next: CandidateTextLine | undefined): next is CandidateTextLine {
  if (next === undefined || next.page !== current.page || next.source !== current.source || next.pass !== current.pass || next.text.trim().length === 0) {
    return false;
  }
  if (ANY_LABEL_PATTERN.test(comparable(next.text))) {
    return false;
  }
  if (current.bounds === null || next.bounds === null) {
    return true;
  }

  const verticalGap = next.bounds.y - (current.bounds.y + current.bounds.height);
  const horizontalReach = Math.min(current.bounds.x + current.bounds.width, next.bounds.x + next.bounds.width) - Math.max(current.bounds.x, next.bounds.x);
  return verticalGap >= -0.01 && verticalGap <= Math.max(0.04, current.bounds.height * 3) && horizontalReach >= -0.08;
}

interface ExtractedLabelValue {
  rawValue: string;
  confidence: number;
  bounds: NormalizedBounds | null;
}

interface PositionedToken {
  text: string;
  start: number;
  end: number;
  bounds: NormalizedBounds | null;
}

const COLUMN_START_TOLERANCE = 0.015;

function lineTokens(line: CandidateTextLine): PositionedToken[] {
  const tokens: PositionedToken[] = [];
  for (const match of line.text.matchAll(/\S+/gu)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length, bounds: null });
  }
  if (line.words !== undefined && line.words.length === tokens.length) {
    for (let index = 0; index < tokens.length; index += 1) {
      tokens[index]!.bounds = line.words[index]!.bounds;
    }
  }
  return tokens;
}

function columnGapLimit(line: CandidateTextLine): number {
  return Math.max(0.012, (line.bounds?.height ?? 0) * 1.2);
}

function horizontalGap(previous: NormalizedBounds, current: NormalizedBounds): number {
  return current.x - (previous.x + previous.width);
}

function unionAllBounds(bounds: ReadonlyArray<NormalizedBounds | null>): NormalizedBounds | null {
  return bounds.every((item): item is NormalizedBounds => item !== null) ? bounds.reduce<NormalizedBounds | null>(unionBounds, null) : null;
}

function inlineLabelValue(line: CandidateTextLine, match: RegExpExecArray): ExtractedLabelValue | null {
  const matchEnd = match.index + match[0].length;
  const tokens = lineTokens(line).filter((token) => token.end > matchEnd);
  if (tokens.length === 0) {
    return null;
  }

  let kept = 1;
  while (kept < tokens.length) {
    const previous = tokens[kept - 1]!.bounds;
    const current = tokens[kept]!.bounds;
    if (previous !== null && current !== null && horizontalGap(previous, current) > columnGapLimit(line)) {
      break;
    }
    kept += 1;
  }

  const selected = tokens.slice(0, kept);
  const rawValue = collapseWhitespace(line.text.slice(Math.max(selected[0]!.start, matchEnd), selected[selected.length - 1]!.end).replace(/^[\s:|\-–—]+/u, ""));
  if (rawValue.length === 0) {
    return null;
  }
  const followingLabel = ANY_LABEL_PATTERN.exec(comparable(rawValue));
  if (followingLabel !== null && followingLabel.index === 0) {
    return null;
  }

  return { rawValue, confidence: normalizedConfidence(line.confidence), bounds: unionAllBounds(selected.map((token) => token.bounds)) ?? line.bounds };
}

function fullRemainderLabelValue(line: CandidateTextLine, match: RegExpExecArray): ExtractedLabelValue | null {
  const rawValue = collapseWhitespace(line.text.slice(match.index + match[0].length).replace(/^[\s:|\-–—]+/u, ""));
  if (rawValue.length === 0) {
    return null;
  }
  const followingLabel = ANY_LABEL_PATTERN.exec(comparable(rawValue));
  if (followingLabel !== null && followingLabel.index === 0) {
    return null;
  }
  return { rawValue, confidence: normalizedConfidence(line.confidence), bounds: line.bounds };
}

function labelColumnBounds(line: CandidateTextLine, match: RegExpExecArray): NormalizedBounds | null {
  const matchEnd = match.index + match[0].length;
  const labelTokens = lineTokens(line).filter((token) => token.start < matchEnd && token.end > match.index);
  if (labelTokens.length === 0) {
    return null;
  }
  return unionAllBounds(labelTokens.map((token) => token.bounds));
}

function columnLabelValue(
  labelLine: CandidateTextLine,
  labelBounds: NormalizedBounds | null,
  valueLine: CandidateTextLine,
): {
  value: ExtractedLabelValue | null;
  columnEmpty: boolean;
} {
  const confidence = Math.min(normalizedConfidence(labelLine.confidence), normalizedConfidence(valueLine.confidence));
  const tokens = lineTokens(valueLine);
  if (labelBounds === null || tokens.length === 0 || tokens.some((token) => token.bounds === null)) {
    const rawValue = collapseWhitespace(valueLine.text);
    return {
      value: rawValue.length === 0 ? null : { rawValue, confidence, bounds: unionBounds(labelLine.bounds, valueLine.bounds) },
      columnEmpty: false,
    };
  }

  const columnStart = labelBounds.x - COLUMN_START_TOLERANCE;
  const first = tokens.findIndex((token) => token.bounds!.x + token.bounds!.width / 2 >= columnStart);
  if (first === -1) {
    return { value: null, columnEmpty: true };
  }

  let last = first;
  const gapLimit = columnGapLimit(valueLine);
  while (last + 1 < tokens.length && horizontalGap(tokens[last]!.bounds!, tokens[last + 1]!.bounds!) <= gapLimit) {
    last += 1;
  }

  const selected = tokens.slice(first, last + 1);
  const rawValue = collapseWhitespace(valueLine.text.slice(selected[0]!.start, selected[selected.length - 1]!.end));
  if (rawValue.length === 0) {
    return { value: null, columnEmpty: true };
  }
  return { value: { rawValue, confidence, bounds: unionAllBounds(selected.map((token) => token.bounds)) }, columnEmpty: false };
}

function labelValueAttempts(lines: readonly CandidateTextLine[], lineIndex: number, match: RegExpExecArray, includeFullRemainder: boolean): ExtractedLabelValue[] {
  const line = lines[lineIndex]!;
  const attempts: ExtractedLabelValue[] = [];
  const inline = inlineLabelValue(line, match);
  if (inline !== null) {
    attempts.push(inline);
  }
  if (includeFullRemainder) {
    const remainder = fullRemainderLabelValue(line, match);
    if (remainder !== null && remainder.rawValue !== inline?.rawValue) {
      attempts.push(remainder);
    }
  }

  const next = lines[lineIndex + 1];
  if (!isPlausibleFollowingLine(line, next)) {
    return attempts;
  }
  const labelBounds = labelColumnBounds(line, match);
  const nextColumn = columnLabelValue(line, labelBounds, next);
  if (nextColumn.value !== null) {
    attempts.push(nextColumn.value);
  } else if (nextColumn.columnEmpty) {
    const afterNext = lines[lineIndex + 2];
    if (isPlausibleFollowingLine(line, afterNext)) {
      const secondColumn = columnLabelValue(line, labelBounds, afterNext);
      if (secondColumn.value !== null) {
        attempts.push(secondColumn.value);
      }
    }
  }
  return attempts;
}

function validCalendarDate(dayText: string, monthText: string, yearText: string): string | null {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${yearText}-${monthText}-${dayText}`;
}

function normalizeDate(value: string): string | null {
  const match = DATE_PATTERN.exec(value);
  return match === null ? null : validCalendarDate(match[1]!, match[2]!, match[3]!);
}

function normalizeAmount(value: string): string | null {
  const match = AMOUNT_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const [integerPartRaw, fractionPart] = match[1]!.replace(/\./gu, "").split(",");
  const integerPart = integerPartRaw!.replace(/^0+(?=[0-9])/u, "");
  return `${integerPart}.${fractionPart}`;
}

function trimAtAnotherLabel(value: string): string {
  const normalized = comparable(value);
  TAX_ID_LABEL_PATTERN.lastIndex = 0;
  const matches = [TAX_ID_LABEL_PATTERN.exec(normalized), /(?:VENCIMENTO|NOSSO\s+NUMERO|VALOR\s+(?:DO\s+)?DOCUMENTO)/u.exec(normalized)].filter((match): match is RegExpExecArray => match !== null);
  TAX_ID_LABEL_PATTERN.lastIndex = 0;
  const firstIndex = matches.length === 0 ? value.length : Math.min(...matches.map((match) => match.index));
  return collapseWhitespace(value.slice(0, firstIndex).replace(/[\s|:;,.\-–—]+$/u, ""));
}

function normalizeName(value: string): string | null {
  const normalized = trimAtAnotherLabel(value);
  if (normalized.length < 2 || !/\p{L}/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeInstitution(value: string): string | null {
  const normalized = trimAtAnotherLabel(value);
  return normalized.length >= 2 && /[\p{L}0-9]/u.test(normalized) ? normalized : null;
}

function normalizeIdentifier(value: string): string | null {
  const match = comparable(value).match(/[A-Z0-9][A-Z0-9./-]{0,63}/u);
  if (match === null) {
    return null;
  }
  const normalized = match[0].replace(/^[.\-/]+|[.\-/]+$/gu, "");
  return /[0-9]/u.test(normalized) && normalized.length <= 30 ? normalized : null;
}

function isMachinePatternLine(text: string): boolean {
  const compact = text.replace(/\s/gu, "");
  if (compact.length < 30) {
    return false;
  }
  const binaryCount = compact.match(/[01]/gu)?.length ?? 0;
  return binaryCount / compact.length >= 0.95;
}

function rawValueForKind(kind: Exclude<FieldKind, "taxId">, value: string): string | null {
  switch (kind) {
    case "dueDate":
    case "documentDate":
      return DATE_PATTERN.exec(value)?.[0] ?? null;
    case "amount":
      return AMOUNT_PATTERN.exec(value)?.[0] ?? null;
    case "ourNumber":
    case "documentNumber": {
      const match = /[A-Z0-9][A-Z0-9./-]{0,63}/u.exec(comparable(value));
      return match === null ? null : value.slice(match.index, match.index + match[0].length);
    }
    case "institution":
    case "beneficiary":
    case "finalBeneficiary":
    case "payer": {
      const trimmed = trimAtAnotherLabel(value);
      return trimmed.length === 0 ? null : trimmed;
    }
  }
}

function cpfCheckDigit(body: string, initialWeight: number): number {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (initialWeight - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function isValidCpf(value: string): boolean {
  if (!/^[0-9]{11}$/u.test(value) || /^([0-9])\1{10}$/u.test(value)) {
    return false;
  }
  const first = cpfCheckDigit(value.slice(0, 9), 10);
  const second = cpfCheckDigit(`${value.slice(0, 9)}${first}`, 11);
  return value.endsWith(`${first}${second}`);
}

function cnpjCharacterValue(character: string): number {
  return character.charCodeAt(0) - 48;
}

function cnpjCheckDigit(body: string, weights: readonly number[]): number {
  const sum = [...body].reduce((total, character, index) => total + cnpjCharacterValue(character) * weights[index]!, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(value: string): boolean {
  if (!/^[A-Z0-9]{12}[0-9]{2}$/u.test(value) || /^([0-9])\1{13}$/u.test(value)) {
    return false;
  }
  const base = value.slice(0, 12);
  const first = cnpjCheckDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjCheckDigit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
}

function taxIdFromValue(value: string): { value: string; rawValue: string } | null {
  const normalized = comparable(value);
  for (const pattern of [CPF_PATTERN, CNPJ_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const candidate = match[0].replace(/[./-]/gu, "");
      if ((candidate.length === 11 && isValidCpf(candidate)) || (candidate.length === 14 && isValidCnpj(candidate))) {
        return {
          value: candidate,
          rawValue: value.slice(match.index, match.index + match[0].length),
        };
      }
    }
  }
  return null;
}

const LABEL_RULES: readonly LabelRule[] = [
  {
    kind: "finalBeneficiary",
    label: /(?<!(?:RESPONSABILIDADE|CODIGO)\s+D[OEA]\s)(?<!\p{L})BENEFICIARIO\s+FINAL(?!\p{L})/u,
    partyRole: "final-beneficiary",
    normalize: normalizeName,
  },
  {
    kind: "beneficiary",
    label: /(?<!(?:RESPONSABILIDADE|CODIGO)\s+D[OEA]\s)(?<!\p{L})(?:BENEFICIARIO(?!\s+FINAL)|CEDENTE)(?!\p{L})/u,
    partyRole: "beneficiary",
    normalize: normalizeName,
  },
  {
    kind: "payer",
    label: /(?<!(?:RESPONSABILIDADE|CODIGO)\s+D[OEA]\s)(?<!\p{L})(?:PAGADOR|SACADO)(?!\p{L})/u,
    partyRole: "payer",
    normalize: normalizeName,
  },
  {
    kind: "institution",
    label: /(?<!\p{L})(?:INSTITUICAO(?:\s+FINANCEIRA)?|(?<!USO\s+DO\s)BANCO)(?!\p{L})/u,
    normalize: normalizeInstitution,
  },
  {
    kind: "dueDate",
    label: /(?<!\p{L})(?:DATA\s+DE\s+)?VENCIMENTO(?!\p{L})/u,
    normalize: normalizeDate,
  },
  {
    kind: "amount",
    label: /(?<!\p{L})(?:VALOR\s+(?:DO\s+)?(?:DOCUMENTO|COBRADO)|VALOR\s+A\s+PAGAR|VALOR\s+NOMINAL)(?!\p{L})/u,
    normalize: normalizeAmount,
  },
  {
    kind: "ourNumber",
    label: /(?<!\p{L})NOSSO\s+NUMERO(?!\p{L})/u,
    normalize: normalizeIdentifier,
  },
  {
    kind: "documentNumber",
    label: /(?<!\p{L})(?:NUMERO|N[O.]?)\s+D[AO]\s+(?:DOCUMENTO|FATURA)(?!\p{L})/u,
    normalize: normalizeIdentifier,
  },
  {
    kind: "documentDate",
    label: /(?<!\p{L})(?:DATA\s+DO\s+DOCUMENTO|DATA\s+DE\s+EMISSAO)(?!\p{L})/u,
    normalize: normalizeDate,
  },
] as const;

function partyNameAndTaxId(value: string): {
  name: string | null;
  taxId: { value: string; rawValue: string } | null;
} {
  const taxId = taxIdFromValue(value);
  if (taxId === null) {
    return { name: value, taxId: null };
  }
  const stripped = collapseWhitespace(value.replace(taxId.rawValue, " ")).replace(/^[\s|:;,/\-–—]+|[\s|:;,/\-–—]+$/gu, "");
  return {
    name: stripped.length >= 2 && /\p{L}/u.test(stripped) ? stripped : null,
    taxId,
  };
}

const CEP_PATTERN = /(?<![0-9-])[0-9]{5}-[0-9]{3}(?![0-9-])/u;
const CORPORATE_SUFFIX_PATTERN = /(?<!\p{L})(?:S\.A\.?|S\/A|LTDA\.?|EIRELI|EPP)(?!\p{L})/u;

function isBlockNeighbor(upper: CandidateTextLine, lower: CandidateTextLine): boolean {
  if (upper.page !== lower.page || upper.source !== lower.source || upper.pass !== lower.pass || upper.bounds === null || lower.bounds === null) {
    return false;
  }
  const verticalGap = lower.bounds.y - (upper.bounds.y + upper.bounds.height);
  return Math.abs(upper.bounds.x - lower.bounds.x) <= 0.03 && verticalGap >= -0.01 && verticalGap <= Math.max(0.03, upper.bounds.height * 2.5);
}

function blockColumnText(line: CandidateTextLine): string {
  const tokens = lineTokens(line);
  if (tokens.length === 0 || tokens.some((token) => token.bounds === null)) {
    return collapseWhitespace(line.text);
  }
  let last = 0;
  const gapLimit = columnGapLimit(line);
  while (last + 1 < tokens.length && horizontalGap(tokens[last]!.bounds!, tokens[last + 1]!.bounds!) <= gapLimit) {
    last += 1;
  }
  return collapseWhitespace(line.text.slice(tokens[0]!.start, tokens[last]!.end));
}

function addressBlockHeadName(line: CandidateTextLine): string | null {
  const head = blockColumnText(line);
  const normalized = comparable(head);
  if (CEP_PATTERN.test(normalized) || ANY_LABEL_PATTERN.test(normalized) || /[0-9]/u.test(normalized)) {
    return null;
  }
  if (head.length < 5 || head.split(" ").length < 2 || !/\p{L}/u.test(head)) {
    return null;
  }
  return head;
}

function extractAddressBlockCandidates(lines: readonly CandidateTextLine[]): FieldCandidate[] {
  const output: FieldCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!CEP_PATTERN.test(comparable(lines[index]!.text))) {
      continue;
    }

    let headIndex = index;
    while (index - headIndex < 3 && headIndex > 0 && isBlockNeighbor(lines[headIndex - 1]!, lines[headIndex]!)) {
      headIndex -= 1;
    }
    if (headIndex === index) {
      continue;
    }

    let tailIndex = index;
    while (tailIndex - index < 2 && tailIndex + 1 < lines.length && isBlockNeighbor(lines[tailIndex]!, lines[tailIndex + 1]!)) {
      tailIndex += 1;
    }

    const blockLines = lines.slice(headIndex, tailIndex + 1);
    if (blockLines.some((line) => PARTY_LABEL_PATTERN.test(comparable(line.text)))) {
      continue;
    }
    const head = blockLines[0]!;
    const name = addressBlockHeadName(head);
    if (name === null) {
      continue;
    }

    const taxId = taxIdFromValue(blockLines.map((line) => line.text).join(" "));
    const isIssuer = CORPORATE_SUFFIX_PATTERN.test(comparable(name)) || (taxId !== null && taxId.value.length === 14);
    const partyRole = isIssuer ? ("beneficiary" as const) : ("payer" as const);
    const confidence = 0.9 * normalizedConfidence(head.confidence);

    output.push({
      kind: partyRole,
      value: name,
      rawValue: name,
      page: head.page,
      source: head.source,
      pass: head.pass,
      confidence,
      bounds: head.bounds,
      partyRole,
      heuristic: true,
    });
    if (taxId !== null) {
      output.push({
        kind: "taxId",
        value: taxId.value,
        rawValue: taxId.rawValue,
        page: head.page,
        source: head.source,
        pass: head.pass,
        confidence,
        bounds: head.bounds,
        partyRole,
        heuristic: true,
      });
    }
  }

  return output;
}

function roleFromContext(lines: readonly CandidateTextLine[], lineIndex: number, labelIndex: number): PartyRole | undefined {
  const sameLinePrefix = comparable(lines[lineIndex]!.text.slice(0, labelIndex));
  const sameLineParty = PARTY_LABEL_PATTERN.exec(sameLinePrefix)?.[0];
  if (sameLineParty?.includes("FINAL")) {
    return "final-beneficiary";
  }
  if (sameLineParty === "BENEFICIARIO" || sameLineParty === "CEDENTE") {
    return "beneficiary";
  }
  if (sameLineParty === "PAGADOR" || sameLineParty === "SACADO") {
    return "payer";
  }

  for (let index = lineIndex - 1; index >= Math.max(0, lineIndex - 2); index -= 1) {
    const priorParty = PARTY_LABEL_PATTERN.exec(comparable(lines[index]!.text))?.[0];
    if (priorParty?.includes("FINAL")) {
      return "final-beneficiary";
    }
    if (priorParty === "BENEFICIARIO" || priorParty === "CEDENTE") {
      return "beneficiary";
    }
    if (priorParty === "PAGADOR" || priorParty === "SACADO") {
      return "payer";
    }
  }
  return undefined;
}

function fieldSignature(candidate: FieldCandidate): string {
  const role = candidate.partyRole ?? "";
  const bounds = candidate.bounds === null ? "" : `${candidate.bounds.x.toFixed(4)}:${candidate.bounds.y.toFixed(4)}:${candidate.bounds.width.toFixed(4)}:${candidate.bounds.height.toFixed(4)}`;
  return `${candidate.kind}:${role}:${candidate.value}:${candidate.page}:${candidate.source}:${candidate.pass}:${bounds}`;
}

/**
 * Extracts normalized boleto fields from positioned text while deduplicating
 * repeated label and layout matches.
 *
 * @param {ReadonlyArray<CandidateTextLine>} allLines - The positioned text lines from all extraction channels and passes.
 * @returns {Array<FieldCandidate>} The unique normalized field candidates in rule-discovery order.
 */
export function extractFieldCandidates(allLines: readonly CandidateTextLine[]): FieldCandidate[] {
  const lines = allLines.filter((line) => !isMachinePatternLine(line.text));
  const output: FieldCandidate[] = [];
  const seen = new Set<string>();

  function add(candidate: FieldCandidate): void {
    const signature = fieldSignature(candidate);
    if (!seen.has(signature)) {
      seen.add(signature);
      output.push(candidate);
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const normalizedLine = comparable(line.text);

    for (const rule of LABEL_RULES) {
      const match = rule.label.exec(normalizedLine);
      if (match === null) {
        continue;
      }
      const includeFullRemainder = rule.partyRole === undefined && rule.kind !== "institution";
      for (const extracted of labelValueAttempts(lines, lineIndex, match, includeFullRemainder)) {
        const rawValue = rawValueForKind(rule.kind, extracted.rawValue);
        if (rawValue === null) {
          continue;
        }
        let value = rule.normalize(rawValue);
        if (value === null) {
          continue;
        }
        if (rule.partyRole !== undefined) {
          const party = partyNameAndTaxId(value);
          if (party.taxId !== null) {
            add({
              kind: "taxId",
              value: party.taxId.value,
              rawValue: party.taxId.rawValue,
              page: line.page,
              source: line.source,
              pass: line.pass,
              confidence: extracted.confidence,
              bounds: extracted.bounds,
              partyRole: rule.partyRole,
            });
          }
          if (party.name === null) {
            break;
          }
          value = party.name;
        }
        add({
          kind: rule.kind,
          value,
          rawValue,
          page: line.page,
          source: line.source,
          pass: line.pass,
          confidence: extracted.confidence,
          bounds: extracted.bounds,
          ...(rule.partyRole === undefined ? {} : { partyRole: rule.partyRole }),
        });
        break;
      }
    }

    TAX_ID_LABEL_PATTERN.lastIndex = 0;
    for (const match of normalizedLine.matchAll(TAX_ID_LABEL_PATTERN)) {
      for (const extracted of labelValueAttempts(lines, lineIndex, match, true)) {
        const taxId = taxIdFromValue(extracted.rawValue);
        if (taxId === null) {
          continue;
        }
        const partyRole = roleFromContext(lines, lineIndex, match.index);
        add({
          kind: "taxId",
          value: taxId.value,
          rawValue: taxId.rawValue,
          page: line.page,
          source: line.source,
          pass: line.pass,
          confidence: extracted.confidence,
          bounds: extracted.bounds,
          ...(partyRole === undefined ? {} : { partyRole }),
        });
        break;
      }
    }
  }

  for (const candidate of extractAddressBlockCandidates(lines)) {
    add(candidate);
  }

  return output;
}
