const NUMERIC_PATTERN = /^[0-9]+$/;
const BARCODE_LENGTH = 44;
const COBRANCA_DIGITABLE_LINE_LENGTH = 47;
const ARRECADACAO_DIGITABLE_LINE_LENGTH = 48;
const COBRANCA_GENERAL_CHECK_DIGIT_INDEX = 4;
const ARRECADACAO_GENERAL_CHECK_DIGIT_INDEX = 3;
const ISPB_INSTITUTION_CODE = "988";
const ISPB_CURRENCY_CODE = "0";
const REAL_CURRENCY_CODE = "9";

export const BOLETO_ISSUE_CODES = {
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_PRODUCT: "INVALID_PRODUCT",
  INVALID_INSTITUTION_CODE: "INVALID_INSTITUTION_CODE",
  INVALID_CURRENCY_CODE: "INVALID_CURRENCY_CODE",
  INVALID_ISPB_CONFIGURATION: "INVALID_ISPB_CONFIGURATION",
  INVALID_ISPB: "INVALID_ISPB",
  INVALID_SEGMENT: "INVALID_SEGMENT",
  INVALID_VALUE_IDENTIFIER: "INVALID_VALUE_IDENTIFIER",
  INVALID_FIELD_CHECK_DIGIT: "INVALID_FIELD_CHECK_DIGIT",
  INVALID_GENERAL_CHECK_DIGIT: "INVALID_GENERAL_CHECK_DIGIT",
} as const;

export type BoletoIssueCode = (typeof BOLETO_ISSUE_CODES)[keyof typeof BOLETO_ISSUE_CODES];

export type BoletoLayout = "cobranca" | "arrecadacao";

export type BoletoRepresentation = "barcode" | "digitable-line";

export type CobrancaVariant = "bank-code" | "ispb";

export type CobrancaDueDateAssumption = "2025-reset-cycle";

export type ArrecadacaoCheckDigitAlgorithm = "modulo10" | "modulo11";

export type ArrecadacaoValueType = "amount" | "reference";

export type ArrecadacaoSegmentCode = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "9";

export type ArrecadacaoSegmentName = "city-government" | "sanitation" | "energy-and-gas" | "telecommunications" | "government-agencies" | "payment-slips-and-similar" | "traffic-fines" | "bank-exclusive";

export type ArrecadacaoOrganizationIdentifierType = "febraban-code" | "cnpj-root" | "bank-code";

export type CobrancaFieldCheckDigits = readonly [number, number, number];

export type ArrecadacaoFieldCheckDigits = readonly [number, number, number, number];

export type BoletoFieldCheckDigits = CobrancaFieldCheckDigits | ArrecadacaoFieldCheckDigits;

export type BoletoCheckDigitField = "general" | "field-1" | "field-2" | "field-3" | "field-4";

export interface BoletoIssue {
  code: BoletoIssueCode;
  message: string;
  field?: BoletoCheckDigitField;
  actual?: string | number;
  expected?: string | number;
}

interface BoletoComponentsBase {
  normalizedValue: string;
  layout: BoletoLayout;
  representation: BoletoRepresentation;
  barcode: string;
  digitableLine: string | null;
  formattedDigitableLine: string | null;
  generalCheckDigit: number;
  expectedGeneralCheckDigit: number | null;
  fieldCheckDigits: BoletoFieldCheckDigits | null;
  expectedFieldCheckDigits: BoletoFieldCheckDigits | null;
}

export interface CobrancaBoletoComponents extends BoletoComponentsBase {
  layout: "cobranca";
  digitableLine: string;
  formattedDigitableLine: string;
  fieldCheckDigits: CobrancaFieldCheckDigits | null;
  expectedFieldCheckDigits: CobrancaFieldCheckDigits;
  expectedGeneralCheckDigit: number;
  variant: CobrancaVariant;
  institutionCode: string;
  currencyCode: string;
  ispb: string | null;
  ispbField: string | null;
  dueDateFactor: string | null;
  dueDate: string | null;
  dueDateCandidates: readonly string[];
  dueDateAssumption: CobrancaDueDateAssumption | null;
  amountField: string | null;
  amountCents: string | null;
  freeField: string;
}

export interface ArrecadacaoBoletoComponents extends BoletoComponentsBase {
  layout: "arrecadacao";
  fieldCheckDigits: ArrecadacaoFieldCheckDigits | null;
  expectedFieldCheckDigits: ArrecadacaoFieldCheckDigits | null;
  productCode: string;
  segmentCode: string;
  segmentName: ArrecadacaoSegmentName | null;
  valueIdentifier: string;
  valueType: ArrecadacaoValueType | null;
  checkDigitAlgorithm: ArrecadacaoCheckDigitAlgorithm | null;
  valueField: string;
  amountCents: string | null;
  referenceValue: string | null;
  organizationIdentifier: string;
  organizationIdentifierType: ArrecadacaoOrganizationIdentifierType | null;
  freeField: string;
  dueDate: string | null;
}

export type BoletoComponents = CobrancaBoletoComponents | ArrecadacaoBoletoComponents;

export interface BoletoValidation {
  isValid: boolean;
  normalizedValue: string;
  layout: BoletoLayout | null;
  representation: BoletoRepresentation | null;
  barcode: string | null;
  digitableLine: string | null;
  formattedDigitableLine: string | null;
  components: BoletoComponents | null;
  expectedGeneralCheckDigit: number | null;
  expectedFieldCheckDigits: BoletoFieldCheckDigits | null;
  issues: BoletoIssue[];
}

interface CodeShape {
  layout: BoletoLayout;
  representation: BoletoRepresentation;
}

interface CobrancaDueDateInfo {
  dueDate: string | null;
  dueDateCandidates: readonly string[];
  dueDateAssumption: CobrancaDueDateAssumption | null;
}

interface ArrecadacaoValueInfo {
  checkDigitAlgorithm: ArrecadacaoCheckDigitAlgorithm;
  valueType: ArrecadacaoValueType;
}

function normalizeBoletoCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/[.\-\s]/gu, "");
}

function getCodeShape(value: string): CodeShape | null {
  if (!NUMERIC_PATTERN.test(value)) {
    return null;
  }

  if (value.length === COBRANCA_DIGITABLE_LINE_LENGTH) {
    return {
      layout: "cobranca",
      representation: "digitable-line",
    };
  }

  if (value.length === ARRECADACAO_DIGITABLE_LINE_LENGTH) {
    return {
      layout: "arrecadacao",
      representation: "digitable-line",
    };
  }

  if (value.length === BARCODE_LENGTH) {
    return {
      layout: value.startsWith("8") ? "arrecadacao" : "cobranca",
      representation: "barcode",
    };
  }

  return null;
}

function assertNumericBody(body: string, expectedLength?: number): void {
  if (typeof body !== "string" || !NUMERIC_PATTERN.test(body) || body.length === 0 || (expectedLength !== undefined && body.length !== expectedLength)) {
    const message = expectedLength === undefined ? "Check digit body must contain one or more numeric characters." : `Check digit body must contain exactly ${expectedLength} numeric characters.`;
    throw new TypeError(message);
  }
}

function digitAt(value: string, index: number): number {
  return value.charCodeAt(index) - 48;
}

function normalizeIntegerField(value: string): string {
  const withoutLeadingZeroes = value.replace(/^0+/u, "");
  return withoutLeadingZeroes === "" ? "0" : withoutLeadingZeroes;
}

function addUtcDays(year: number, month: number, day: number, days: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getCobrancaDueDateInfo(factor: string): CobrancaDueDateInfo {
  if (factor === "0000") {
    return {
      dueDate: null,
      dueDateCandidates: [],
      dueDateAssumption: null,
    };
  }

  const numericFactor = Number(factor);
  const historicalDate = addUtcDays(1997, 10, 7, numericFactor);

  if (numericFactor < 1000) {
    return {
      dueDate: historicalDate,
      dueDateCandidates: [historicalDate],
      dueDateAssumption: null,
    };
  }

  const resetCycleDate = addUtcDays(2025, 2, 22, numericFactor - 1000);

  return {
    dueDate: resetCycleDate,
    dueDateCandidates: [historicalDate, resetCycleDate],
    dueDateAssumption: "2025-reset-cycle",
  };
}

function parseCalendarDate(value: string): string | null {
  if (!/^[0-9]{8}$/u.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function getArrecadacaoValueInfo(valueIdentifier: string): ArrecadacaoValueInfo | null {
  switch (valueIdentifier) {
    case "6":
      return {
        checkDigitAlgorithm: "modulo10",
        valueType: "amount",
      };
    case "7":
      return {
        checkDigitAlgorithm: "modulo10",
        valueType: "reference",
      };
    case "8":
      return {
        checkDigitAlgorithm: "modulo11",
        valueType: "amount",
      };
    case "9":
      return {
        checkDigitAlgorithm: "modulo11",
        valueType: "reference",
      };
    default:
      return null;
  }
}

function getArrecadacaoSegmentName(segmentCode: string): ArrecadacaoSegmentName | null {
  switch (segmentCode) {
    case "1":
      return "city-government";
    case "2":
      return "sanitation";
    case "3":
      return "energy-and-gas";
    case "4":
      return "telecommunications";
    case "5":
      return "government-agencies";
    case "6":
      return "payment-slips-and-similar";
    case "7":
      return "traffic-fines";
    case "9":
      return "bank-exclusive";
    default:
      return null;
  }
}

function getArrecadacaoOrganizationFields(
  barcode: string,
  segmentCode: string,
): {
  organizationIdentifier: string;
  organizationIdentifierType: ArrecadacaoOrganizationIdentifierType | null;
  freeField: string;
} {
  if (segmentCode === "6") {
    return {
      organizationIdentifier: barcode.slice(15, 23),
      organizationIdentifierType: "cnpj-root",
      freeField: barcode.slice(23),
    };
  }

  if (segmentCode === "9") {
    return {
      organizationIdentifier: barcode.slice(15, 19),
      organizationIdentifierType: "bank-code",
      freeField: barcode.slice(19),
    };
  }

  return {
    organizationIdentifier: barcode.slice(15, 19),
    organizationIdentifierType: getArrecadacaoSegmentName(segmentCode) === null ? null : "febraban-code",
    freeField: barcode.slice(19),
  };
}

/**
 * Calculates a FEBRABAN modulo-10 check digit. Multipliers alternate between
 * 2 and 1 from right to left and two-digit products have their digits summed.
 */
export function calculateModulo10CheckDigit(body: string): number {
  assertNumericBody(body);

  let sum = 0;
  let multiplier = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    const product = digitAt(body, index) * multiplier;
    sum += product > 9 ? Math.floor(product / 10) + (product % 10) : product;
    multiplier = multiplier === 2 ? 1 : 2;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Calculates the general check digit for a cobrança barcode. The input is the
 * 43-digit barcode body with position 5 (the general check digit) removed.
 */
export function calculateCobrancaBarcodeCheckDigit(body: string): number {
  assertNumericBody(body, 43);

  let sum = 0;
  let weight = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += digitAt(body, index) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const candidate = 11 - (sum % 11);
  return candidate < 2 || candidate > 9 ? 1 : candidate;
}

/**
 * Calculates a FEBRABAN arrecadação modulo-11 check digit. It is valid for
 * both 11-digit representation fields and the 43-digit general-DV body.
 */
export function calculateArrecadacaoModulo11CheckDigit(body: string): number {
  assertNumericBody(body);

  let sum = 0;
  let weight = 2;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += digitAt(body, index) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const remainder = sum % 11;

  if (remainder === 0 || remainder === 1) {
    return 0;
  }

  if (remainder === 10) {
    return 1;
  }

  return 11 - remainder;
}

function calculateArrecadacaoCheckDigit(body: string, algorithm: ArrecadacaoCheckDigitAlgorithm): number {
  return algorithm === "modulo10" ? calculateModulo10CheckDigit(body) : calculateArrecadacaoModulo11CheckDigit(body);
}

function getCobrancaExpectedFieldCheckDigits(barcode: string): CobrancaFieldCheckDigits {
  const freeField = barcode.slice(19);
  const firstField = `${barcode.slice(0, 4)}${freeField.slice(0, 5)}`;
  const secondField = freeField.slice(5, 15);
  const thirdField = freeField.slice(15, 25);

  return [calculateModulo10CheckDigit(firstField), calculateModulo10CheckDigit(secondField), calculateModulo10CheckDigit(thirdField)];
}

function getArrecadacaoExpectedFieldCheckDigits(barcode: string, algorithm: ArrecadacaoCheckDigitAlgorithm): ArrecadacaoFieldCheckDigits {
  return [calculateArrecadacaoCheckDigit(barcode.slice(0, 11), algorithm), calculateArrecadacaoCheckDigit(barcode.slice(11, 22), algorithm), calculateArrecadacaoCheckDigit(barcode.slice(22, 33), algorithm), calculateArrecadacaoCheckDigit(barcode.slice(33, 44), algorithm)];
}

function cobrancaLineToBarcode(line: string): string {
  return `${line.slice(0, 4)}${line.slice(32, 33)}${line.slice(33, 47)}${line.slice(4, 9)}${line.slice(10, 20)}${line.slice(21, 31)}`;
}

function arrecadacaoLineToBarcode(line: string): string {
  return `${line.slice(0, 11)}${line.slice(12, 23)}${line.slice(24, 35)}${line.slice(36, 47)}`;
}

function cobrancaBarcodeToLine(barcode: string): string {
  const freeField = barcode.slice(19);
  const fieldCheckDigits = getCobrancaExpectedFieldCheckDigits(barcode);

  return `${barcode.slice(0, 4)}${freeField.slice(0, 5)}${fieldCheckDigits[0]}${freeField.slice(5, 15)}${fieldCheckDigits[1]}${freeField.slice(15, 25)}${fieldCheckDigits[2]}${barcode.slice(4, 5)}${barcode.slice(5, 19)}`;
}

function arrecadacaoBarcodeToLine(barcode: string, algorithm: ArrecadacaoCheckDigitAlgorithm): string {
  const fieldCheckDigits = getArrecadacaoExpectedFieldCheckDigits(barcode, algorithm);

  return `${barcode.slice(0, 11)}${fieldCheckDigits[0]}${barcode.slice(11, 22)}${fieldCheckDigits[1]}${barcode.slice(22, 33)}${fieldCheckDigits[2]}${barcode.slice(33, 44)}${fieldCheckDigits[3]}`;
}

function formatNormalizedDigitableLine(line: string): string {
  if (line.length === COBRANCA_DIGITABLE_LINE_LENGTH) {
    return `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line.slice(32, 33)} ${line.slice(33, 47)}`;
  }

  if (line.length === ARRECADACAO_DIGITABLE_LINE_LENGTH) {
    return `${line.slice(0, 12)} ${line.slice(12, 24)} ${line.slice(24, 36)} ${line.slice(36, 48)}`;
  }

  throw new TypeError("Digitable line must contain 47 or 48 numeric characters.");
}

/**
 * Converts a supported barcode or digitable line to its canonical 44-digit
 * barcode. Formatting whitespace, dots, and hyphens are accepted.
 */
export function toBarcode(value: string): string {
  const normalizedValue = normalizeBoletoCode(value);
  const shape = getCodeShape(normalizedValue);

  if (shape === null) {
    throw new TypeError("Boleto code must be numeric and contain 44, 47, or 48 digits.");
  }

  if (shape.representation === "barcode") {
    return normalizedValue;
  }

  return shape.layout === "cobranca" ? cobrancaLineToBarcode(normalizedValue) : arrecadacaoLineToBarcode(normalizedValue);
}

/**
 * Converts a supported code to a canonical, unformatted digitable line. Field
 * check digits are calculated when the input is a 44-digit barcode.
 */
export function toDigitableLine(value: string): string {
  const normalizedValue = normalizeBoletoCode(value);
  const shape = getCodeShape(normalizedValue);

  if (shape === null) {
    throw new TypeError("Boleto code must be numeric and contain 44, 47, or 48 digits.");
  }

  if (shape.representation === "digitable-line") {
    return normalizedValue;
  }

  if (shape.layout === "cobranca") {
    return cobrancaBarcodeToLine(normalizedValue);
  }

  const valueInfo = getArrecadacaoValueInfo(normalizedValue.slice(2, 3));

  if (valueInfo === null) {
    throw new TypeError("Arrecadação value identifier must be 6, 7, 8, or 9 before a digitable line can be calculated.");
  }

  return arrecadacaoBarcodeToLine(normalizedValue, valueInfo.checkDigitAlgorithm);
}

/**
 * Formats a supported code as its canonical human-readable digitable line.
 */
export function formatDigitableLine(value: string): string {
  return formatNormalizedDigitableLine(toDigitableLine(value));
}

function parseCobrancaCode(normalizedValue: string, representation: BoletoRepresentation, barcode: string): CobrancaBoletoComponents {
  const institutionCode = barcode.slice(0, 3);
  const currencyCode = barcode.slice(3, 4);
  const variant: CobrancaVariant = institutionCode === ISPB_INSTITUTION_CODE ? "ispb" : "bank-code";
  const expectedFieldCheckDigits = getCobrancaExpectedFieldCheckDigits(barcode);
  const fieldCheckDigits: CobrancaFieldCheckDigits | null = representation === "digitable-line" ? [digitAt(normalizedValue, 9), digitAt(normalizedValue, 20), digitAt(normalizedValue, 31)] : null;
  const expectedGeneralCheckDigit = calculateCobrancaBarcodeCheckDigit(`${barcode.slice(0, COBRANCA_GENERAL_CHECK_DIGIT_INDEX)}${barcode.slice(COBRANCA_GENERAL_CHECK_DIGIT_INDEX + 1)}`);
  const digitableLine = representation === "digitable-line" ? normalizedValue : cobrancaBarcodeToLine(barcode);
  const freeField = barcode.slice(19);

  if (variant === "ispb") {
    const ispbField = barcode.slice(5, 19);

    return {
      normalizedValue,
      layout: "cobranca",
      representation,
      barcode,
      digitableLine,
      formattedDigitableLine: formatNormalizedDigitableLine(digitableLine),
      generalCheckDigit: digitAt(barcode, COBRANCA_GENERAL_CHECK_DIGIT_INDEX),
      expectedGeneralCheckDigit,
      fieldCheckDigits,
      expectedFieldCheckDigits,
      variant,
      institutionCode,
      currencyCode,
      ispb: ispbField.slice(6),
      ispbField,
      dueDateFactor: null,
      dueDate: null,
      dueDateCandidates: [],
      dueDateAssumption: null,
      amountField: null,
      amountCents: null,
      freeField,
    };
  }

  const dueDateFactor = barcode.slice(5, 9);
  const amountField = barcode.slice(9, 19);
  const dueDateInfo = getCobrancaDueDateInfo(dueDateFactor);

  return {
    normalizedValue,
    layout: "cobranca",
    representation,
    barcode,
    digitableLine,
    formattedDigitableLine: formatNormalizedDigitableLine(digitableLine),
    generalCheckDigit: digitAt(barcode, COBRANCA_GENERAL_CHECK_DIGIT_INDEX),
    expectedGeneralCheckDigit,
    fieldCheckDigits,
    expectedFieldCheckDigits,
    variant,
    institutionCode,
    currencyCode,
    ispb: null,
    ispbField: null,
    dueDateFactor,
    dueDate: dueDateInfo.dueDate,
    dueDateCandidates: dueDateInfo.dueDateCandidates,
    dueDateAssumption: dueDateInfo.dueDateAssumption,
    amountField,
    amountCents: normalizeIntegerField(amountField),
    freeField,
  };
}

function parseArrecadacaoCode(normalizedValue: string, representation: BoletoRepresentation, barcode: string): ArrecadacaoBoletoComponents {
  const segmentCode = barcode.slice(1, 2);
  const valueIdentifier = barcode.slice(2, 3);
  const valueInfo = getArrecadacaoValueInfo(valueIdentifier);
  const fieldCheckDigits: ArrecadacaoFieldCheckDigits | null = representation === "digitable-line" ? [digitAt(normalizedValue, 11), digitAt(normalizedValue, 23), digitAt(normalizedValue, 35), digitAt(normalizedValue, 47)] : null;
  const expectedFieldCheckDigits = valueInfo === null ? null : getArrecadacaoExpectedFieldCheckDigits(barcode, valueInfo.checkDigitAlgorithm);
  const expectedGeneralCheckDigit = valueInfo === null ? null : calculateArrecadacaoCheckDigit(`${barcode.slice(0, ARRECADACAO_GENERAL_CHECK_DIGIT_INDEX)}${barcode.slice(ARRECADACAO_GENERAL_CHECK_DIGIT_INDEX + 1)}`, valueInfo.checkDigitAlgorithm);
  const digitableLine = representation === "digitable-line" ? normalizedValue : valueInfo === null ? null : arrecadacaoBarcodeToLine(barcode, valueInfo.checkDigitAlgorithm);
  const organizationFields = getArrecadacaoOrganizationFields(barcode, segmentCode);
  const valueField = barcode.slice(4, 15);

  return {
    normalizedValue,
    layout: "arrecadacao",
    representation,
    barcode,
    digitableLine,
    formattedDigitableLine: digitableLine === null ? null : formatNormalizedDigitableLine(digitableLine),
    generalCheckDigit: digitAt(barcode, ARRECADACAO_GENERAL_CHECK_DIGIT_INDEX),
    expectedGeneralCheckDigit,
    fieldCheckDigits,
    expectedFieldCheckDigits,
    productCode: barcode.slice(0, 1),
    segmentCode,
    segmentName: getArrecadacaoSegmentName(segmentCode),
    valueIdentifier,
    valueType: valueInfo?.valueType ?? null,
    checkDigitAlgorithm: valueInfo?.checkDigitAlgorithm ?? null,
    valueField,
    amountCents: valueInfo?.valueType === "amount" ? normalizeIntegerField(valueField) : null,
    referenceValue: valueInfo?.valueType === "reference" ? valueField : null,
    organizationIdentifier: organizationFields.organizationIdentifier,
    organizationIdentifierType: organizationFields.organizationIdentifierType,
    freeField: organizationFields.freeField,
    dueDate: parseCalendarDate(organizationFields.freeField.slice(0, 8)),
  };
}

/**
 * Parses the positional components of a structurally supported boleto code.
 * Semantic and check-digit issues are reported by validateBoletoCode.
 */
export function parseBoletoCode(value: string): BoletoComponents {
  const normalizedValue = normalizeBoletoCode(value);
  const shape = getCodeShape(normalizedValue);

  if (shape === null) {
    throw new TypeError("Boleto code must be numeric and contain 44, 47, or 48 digits.");
  }

  const barcode = shape.representation === "barcode" ? normalizedValue : shape.layout === "cobranca" ? cobrancaLineToBarcode(normalizedValue) : arrecadacaoLineToBarcode(normalizedValue);

  return shape.layout === "cobranca" ? parseCobrancaCode(normalizedValue, shape.representation, barcode) : parseArrecadacaoCode(normalizedValue, shape.representation, barcode);
}

function appendFieldCheckDigitIssues(issues: BoletoIssue[], actualDigits: BoletoFieldCheckDigits | null, expectedDigits: BoletoFieldCheckDigits | null): void {
  if (actualDigits === null || expectedDigits === null) {
    return;
  }

  for (let index = 0; index < actualDigits.length; index += 1) {
    const actual = actualDigits[index];
    const expected = expectedDigits[index];

    if (actual !== expected && actual !== undefined && expected !== undefined) {
      const fieldNumber = index + 1;
      issues.push({
        code: BOLETO_ISSUE_CODES.INVALID_FIELD_CHECK_DIGIT,
        message: `Field ${fieldNumber} check digit ${actual} does not match expected digit ${expected}.`,
        field: `field-${fieldNumber}` as Exclude<BoletoCheckDigitField, "general">,
        actual,
        expected,
      });
    }
  }
}

function appendCobrancaSemanticIssues(components: CobrancaBoletoComponents, issues: BoletoIssue[]): void {
  if (components.institutionCode === "000") {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_INSTITUTION_CODE,
      message: "Institution code 000 is not valid for a cobrança boleto.",
      actual: components.institutionCode,
    });
  }

  if (components.variant === "ispb") {
    if (components.currencyCode !== ISPB_CURRENCY_CODE) {
      issues.push({
        code: BOLETO_ISSUE_CODES.INVALID_ISPB_CONFIGURATION,
        message: `Institution 988 must use code ${ISPB_CURRENCY_CODE} in position 4.`,
        actual: components.currencyCode,
        expected: ISPB_CURRENCY_CODE,
      });
    }

    const ispbField = components.ispbField;
    const ispb = components.ispb;

    if (ispbField === null || ispb === null || !ispbField.startsWith("000000") || ispb === "00000000") {
      issues.push({
        code: BOLETO_ISSUE_CODES.INVALID_ISPB,
        message: "The ISPB variant must contain six leading zeroes followed by a non-zero eight-digit ISPB.",
        actual: ispbField ?? "",
      });
    }
  } else if (components.currencyCode !== REAL_CURRENCY_CODE) {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_CURRENCY_CODE,
      message: `Cobrança boletos identified by a bank code must use currency code ${REAL_CURRENCY_CODE} (Real).`,
      actual: components.currencyCode,
      expected: REAL_CURRENCY_CODE,
    });
  }
}

function appendArrecadacaoSemanticIssues(components: ArrecadacaoBoletoComponents, issues: BoletoIssue[]): void {
  if (components.productCode !== "8") {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_PRODUCT,
      message: "Arrecadação barcodes must use product identifier 8.",
      actual: components.productCode,
      expected: "8",
    });
  }

  if (components.segmentName === null) {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_SEGMENT,
      message: `Arrecadação segment ${components.segmentCode} is not supported; expected 1, 2, 3, 4, 5, 6, 7, or 9.`,
      actual: components.segmentCode,
    });
  }

  if (components.checkDigitAlgorithm === null || components.valueType === null) {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_VALUE_IDENTIFIER,
      message: `Arrecadação value identifier ${components.valueIdentifier} is invalid; expected 6, 7, 8, or 9.`,
      actual: components.valueIdentifier,
    });
  }
}

/**
 * Validates format, FEBRABAN semantic identifiers, field check digits, and
 * the general check digit for cobrança and arrecadação codes.
 */
export function validateBoletoCode(value: string): BoletoValidation {
  const normalizedValue = normalizeBoletoCode(value);
  const shape = getCodeShape(normalizedValue);

  if (shape === null) {
    return {
      isValid: false,
      normalizedValue,
      layout: null,
      representation: null,
      barcode: null,
      digitableLine: null,
      formattedDigitableLine: null,
      components: null,
      expectedGeneralCheckDigit: null,
      expectedFieldCheckDigits: null,
      issues: [
        {
          code: BOLETO_ISSUE_CODES.INVALID_FORMAT,
          message: "Boleto code must be numeric and contain 44, 47, or 48 digits; only whitespace, dots, and hyphens may format it.",
        },
      ],
    };
  }

  const components = parseBoletoCode(normalizedValue);
  const issues: BoletoIssue[] = [];

  if (components.layout === "cobranca") {
    appendCobrancaSemanticIssues(components, issues);
  } else {
    appendArrecadacaoSemanticIssues(components, issues);
  }

  appendFieldCheckDigitIssues(issues, components.fieldCheckDigits, components.expectedFieldCheckDigits);

  if (components.expectedGeneralCheckDigit !== null && components.generalCheckDigit !== components.expectedGeneralCheckDigit) {
    issues.push({
      code: BOLETO_ISSUE_CODES.INVALID_GENERAL_CHECK_DIGIT,
      message: `General check digit ${components.generalCheckDigit} does not match expected digit ${components.expectedGeneralCheckDigit}.`,
      field: "general",
      actual: components.generalCheckDigit,
      expected: components.expectedGeneralCheckDigit,
    });
  }

  return {
    isValid: issues.length === 0,
    normalizedValue,
    layout: components.layout,
    representation: components.representation,
    barcode: components.barcode,
    digitableLine: components.digitableLine,
    formattedDigitableLine: components.formattedDigitableLine,
    components,
    expectedGeneralCheckDigit: components.expectedGeneralCheckDigit,
    expectedFieldCheckDigits: components.expectedFieldCheckDigits,
    issues,
  };
}
