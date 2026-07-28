const NUMERIC_PATTERN = /^[0-9]+$/;
const BARCODE_LENGTH = 44;
const COBRANCA_DIGITABLE_LINE_LENGTH = 47;
const ARRECADACAO_DIGITABLE_LINE_LENGTH = 48;
const COBRANCA_GENERAL_CHECK_DIGIT_INDEX = 4;
const ARRECADACAO_GENERAL_CHECK_DIGIT_INDEX = 3;
const ISPB_INSTITUTION_CODE = "988";
const ISPB_CURRENCY_CODE = "0";
const REAL_CURRENCY_CODE = "9";

/**
 * Defines the stable issue codes returned when boleto validation fails.
 *
 * @enum {string}
 * @readonly
 * @since 0.1.0
 */
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

/**
 * Identifies a stable boleto validation issue.
 *
 * @since 0.1.0
 */
export type BoletoIssueCode = (typeof BOLETO_ISSUE_CODES)[keyof typeof BOLETO_ISSUE_CODES];

/**
 * Identifies the cobrança or arrecadação layout of a boleto representation.
 *
 * @since 0.1.0
 */
export type BoletoLayout = "cobranca" | "arrecadacao";

/**
 * Identifies whether a boleto value is a barcode or a digitable line.
 *
 * @since 0.1.0
 */
export type BoletoRepresentation = "barcode" | "digitable-line";

/**
 * Identifies whether a cobrança boleto uses a bank code or an ISPB identifier.
 *
 * @since 0.1.0
 */
export type CobrancaVariant = "bank-code" | "ispb";

/**
 * Identifies the assumption used to resolve an ambiguous cobrança due-date factor.
 *
 * @since 0.1.0
 */
export type CobrancaDueDateAssumption = "2025-reset-cycle";

/**
 * Identifies the check-digit algorithm selected by an arrecadação value identifier.
 *
 * @since 0.1.0
 */
export type ArrecadacaoCheckDigitAlgorithm = "modulo10" | "modulo11";

/**
 * Identifies whether an arrecadação value field contains an amount or a reference.
 *
 * @since 0.1.0
 */
export type ArrecadacaoValueType = "amount" | "reference";

/**
 * Identifies a supported FEBRABAN arrecadação segment digit.
 *
 * @since 0.1.0
 */
export type ArrecadacaoSegmentCode = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "9";

/**
 * Identifies the normalized service category of an arrecadação segment.
 *
 * @since 0.1.0
 */
export type ArrecadacaoSegmentName = "city-government" | "sanitation" | "energy-and-gas" | "telecommunications" | "government-agencies" | "payment-slips-and-similar" | "traffic-fines" | "bank-exclusive";

/**
 * Identifies how an arrecadação organization field should be interpreted.
 *
 * @since 0.1.0
 */
export type ArrecadacaoOrganizationIdentifierType = "febraban-code" | "cnpj-root" | "bank-code";

/**
 * Represents the three field check digits carried by a cobrança digitable line.
 *
 * @since 0.1.0
 */
export type CobrancaFieldCheckDigits = readonly [number, number, number];

/**
 * Represents the four field check digits carried by an arrecadação digitable line.
 *
 * @since 0.1.0
 */
export type ArrecadacaoFieldCheckDigits = readonly [number, number, number, number];

/**
 * Represents the field check digits for either supported boleto layout.
 *
 * @since 0.1.0
 */
export type BoletoFieldCheckDigits = CobrancaFieldCheckDigits | ArrecadacaoFieldCheckDigits;

/**
 * Identifies the general or field-level check digit associated with an issue.
 *
 * @since 0.1.0
 */
export type BoletoCheckDigitField = "general" | "field-1" | "field-2" | "field-3" | "field-4";

/**
 * Describes one structural, semantic, or check-digit problem found during validation.
 *
 * @since 0.1.0
 */
export interface BoletoIssue {
  /** Identifies the stable category of the validation problem. */
  code: BoletoIssueCode;
  /** Explains the problem in caller-readable terms. */
  message: string;
  /** Identifies the affected check-digit field when the issue concerns a check digit. */
  field?: BoletoCheckDigitField;
  /** Reports the value present in the supplied boleto representation when applicable. */
  actual?: string | number;
  /** Reports the value required by the applicable rule when it can be calculated. */
  expected?: string | number;
}

interface BoletoComponentsBase {
  /** Contains the input after supported presentation separators are removed. */
  normalizedValue: string;
  /** Identifies the boleto layout inferred from the normalized length and prefix. */
  layout: BoletoLayout;
  /** Identifies the representation supplied by the caller. */
  representation: BoletoRepresentation;
  /** Contains the canonical 44-digit barcode representation. */
  barcode: string;
  /** Contains the canonical unformatted line when the layout supplies enough information to derive it. */
  digitableLine: string | null;
  /** Contains the canonical human-readable line when a digitable line can be derived. */
  formattedDigitableLine: string | null;
  /** Reports the general check digit carried by the barcode. */
  generalCheckDigit: number;
  /** Reports the calculated general check digit when the selected layout rules support it. */
  expectedGeneralCheckDigit: number | null;
  /** Reports field check digits carried by a supplied digitable line. */
  fieldCheckDigits: BoletoFieldCheckDigits | null;
  /** Reports field check digits calculated from the canonical barcode when possible. */
  expectedFieldCheckDigits: BoletoFieldCheckDigits | null;
}

/**
 * Represents the structured fields parsed from a cobrança barcode or digitable line.
 *
 * @since 0.1.0
 */
export interface CobrancaBoletoComponents extends BoletoComponentsBase {
  /** Fixes the discriminated layout to cobrança. */
  layout: "cobranca";
  /** Contains the canonical unformatted 47-digit cobrança line. */
  digitableLine: string;
  /** Contains the canonical human-readable cobrança line. */
  formattedDigitableLine: string;
  /** Reports the three field check digits when the supplied representation is a digitable line. */
  fieldCheckDigits: CobrancaFieldCheckDigits | null;
  /** Reports the three field check digits calculated from the barcode. */
  expectedFieldCheckDigits: CobrancaFieldCheckDigits;
  /** Reports the general check digit calculated from the 43-digit barcode body. */
  expectedGeneralCheckDigit: number;
  /** Identifies whether the leading fields represent a bank code or an ISPB. */
  variant: CobrancaVariant;
  /** Contains the three-digit institution code. */
  institutionCode: string;
  /** Contains the one-digit currency or ISPB configuration code. */
  currencyCode: string;
  /** Contains the eight-digit ISPB for the ISPB variant, otherwise `null`. */
  ispb: string | null;
  /** Contains the complete 14-digit ISPB field for the ISPB variant, otherwise `null`. */
  ispbField: string | null;
  /** Contains the four-digit due-date factor for the bank-code variant, otherwise `null`. */
  dueDateFactor: string | null;
  /** Contains the selected due date in `YYYY-MM-DD` form, or `null` when no date is encoded. */
  dueDate: string | null;
  /** Lists every calendar date compatible with the encoded due-date factor. */
  dueDateCandidates: readonly string[];
  /** Identifies the assumption used when the due-date factor spans more than one valid cycle. */
  dueDateAssumption: CobrancaDueDateAssumption | null;
  /** Contains the ten-digit encoded amount field for the bank-code variant, otherwise `null`. */
  amountField: string | null;
  /** Contains the encoded amount in cents without insignificant leading zeroes, otherwise `null`. */
  amountCents: string | null;
  /** Contains the 25-digit cobrança free field. */
  freeField: string;
}

/**
 * Represents the structured fields parsed from an arrecadação barcode or digitable line.
 *
 * @since 0.1.0
 */
export interface ArrecadacaoBoletoComponents extends BoletoComponentsBase {
  /** Fixes the discriminated layout to arrecadação. */
  layout: "arrecadacao";
  /** Reports the four field check digits when the supplied representation is a digitable line. */
  fieldCheckDigits: ArrecadacaoFieldCheckDigits | null;
  /** Reports the four calculated field check digits when the value identifier is supported. */
  expectedFieldCheckDigits: ArrecadacaoFieldCheckDigits | null;
  /** Contains the one-digit product identifier, which must be `8` for a valid arrecadação boleto. */
  productCode: string;
  /** Contains the one-digit service segment identifier. */
  segmentCode: string;
  /** Identifies the normalized service category, or `null` for an unsupported segment. */
  segmentName: ArrecadacaoSegmentName | null;
  /** Contains the digit that selects value semantics and the check-digit algorithm. */
  valueIdentifier: string;
  /** Identifies whether the value field is an amount or a reference, or `null` when unsupported. */
  valueType: ArrecadacaoValueType | null;
  /** Identifies the selected check-digit algorithm, or `null` when unsupported. */
  checkDigitAlgorithm: ArrecadacaoCheckDigitAlgorithm | null;
  /** Contains the 11-digit encoded amount or reference field. */
  valueField: string;
  /** Contains the encoded amount in cents without insignificant leading zeroes when applicable. */
  amountCents: string | null;
  /** Contains the encoded reference value when the value field is not monetary. */
  referenceValue: string | null;
  /** Contains the organization identifier extracted according to the segment rules. */
  organizationIdentifier: string;
  /** Identifies how to interpret `organizationIdentifier`, or `null` for an unsupported segment. */
  organizationIdentifierType: ArrecadacaoOrganizationIdentifierType | null;
  /** Contains the remaining segment-dependent free field after the organization identifier. */
  freeField: string;
  /** Contains a leading free-field date in `YYYY-MM-DD` form when it is a valid calendar date. */
  dueDate: string | null;
}

/**
 * Represents parsed components for either supported boleto layout.
 *
 * @since 0.1.0
 */
export type BoletoComponents = CobrancaBoletoComponents | ArrecadacaoBoletoComponents;

/**
 * Reports normalization, parsed components, expected digits, and every detected validation issue.
 *
 * @since 0.1.0
 */
export interface BoletoValidation {
  /** Indicates whether the representation passed every supported structural, semantic, and check-digit rule. */
  isValid: boolean;
  /** Contains the input after supported presentation separators are removed. */
  normalizedValue: string;
  /** Identifies the inferred layout, or `null` when the input shape is unsupported. */
  layout: BoletoLayout | null;
  /** Identifies the supplied representation, or `null` when the input shape is unsupported. */
  representation: BoletoRepresentation | null;
  /** Contains the canonical 44-digit barcode, or `null` when the input shape is unsupported. */
  barcode: string | null;
  /** Contains the canonical unformatted line when it can be derived. */
  digitableLine: string | null;
  /** Contains the canonical human-readable line when it can be derived. */
  formattedDigitableLine: string | null;
  /** Contains parsed layout fields, or `null` when the input shape is unsupported. */
  components: BoletoComponents | null;
  /** Reports the calculated general check digit when the selected layout rules support it. */
  expectedGeneralCheckDigit: number | null;
  /** Reports calculated field check digits when the selected layout rules support them. */
  expectedFieldCheckDigits: BoletoFieldCheckDigits | null;
  /** Lists every structural, semantic, and check-digit issue found in the representation. */
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
 * Calculates the FEBRABAN modulo-10 check digit for a non-empty numeric body.
 *
 * @param {string} body - Contains the numeric characters that precede the check digit.
 * @returns {number} Returns the calculated digit from zero through nine.
 * @throws {TypeError} If `body` is not a non-empty numeric string.
 * @since 0.1.0
 *
 * @example
 * const digit = calculateModulo10CheckDigit("001905009");
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
 * Calculates the general modulo-11 check digit for a 43-digit cobrança barcode body.
 *
 * @param {string} body - Contains the numeric barcode with the general check-digit position removed.
 * @returns {number} Returns the calculated general check digit from one through nine.
 * @throws {TypeError} If `body` does not contain exactly 43 numeric characters.
 * @since 0.1.0
 *
 * @example
 * const digit = calculateCobrancaBarcodeCheckDigit("0019373700000001000500940144816060680935031");
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
 * Calculates the FEBRABAN arrecadação modulo-11 check digit for a numeric field or general-DV body.
 *
 * @param {string} body - Contains the non-empty numeric body used for the check-digit calculation.
 * @returns {number} Returns the calculated digit from zero through nine.
 * @throws {TypeError} If `body` is not a non-empty numeric string.
 * @since 0.1.0
 *
 * @example
 * const digit = calculateArrecadacaoModulo11CheckDigit("12345678901");
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
 * Converts a supported boleto representation to its canonical 44-digit barcode.
 *
 * @param {string} value - Contains a 44-, 47-, or 48-digit boleto with optional whitespace, dots, or hyphens.
 * @returns {string} Returns the canonical unformatted 44-digit barcode.
 * @throws {TypeError} If `value` is not a supported numeric boleto representation.
 * @since 0.1.0
 *
 * @example
 * const barcode = toBarcode("00190.50095 40144.816069 06809.350314 3 37370000000100");
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
 * Converts a supported boleto representation to its canonical unformatted digitable line.
 *
 * @param {string} value - Contains a 44-, 47-, or 48-digit boleto with optional whitespace, dots, or hyphens.
 * @returns {string} Returns a 47-digit cobrança line or a 48-digit arrecadação line.
 * @throws {TypeError} If `value` is not a supported numeric boleto representation or an arrecadação barcode uses an unsupported value identifier.
 * @since 0.1.0
 *
 * @example
 * const line = toDigitableLine("00193373700000001000500940144816060680935031");
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
 * Formats a supported boleto representation as its canonical human-readable digitable line.
 *
 * @param {string} value - Contains a 44-, 47-, or 48-digit boleto with optional whitespace, dots, or hyphens.
 * @returns {string} Returns the canonical spaced and punctuated digitable line.
 * @throws {TypeError} If `value` is not a supported numeric boleto representation or an arrecadação barcode uses an unsupported value identifier.
 * @since 0.1.0
 *
 * @example
 * const formatted = formatDigitableLine("00193373700000001000500940144816060680935031");
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
 * Parses a structurally supported boleto representation without deciding whether its check digits are valid.
 *
 * @param {string} value - Contains a 44-, 47-, or 48-digit boleto with optional whitespace, dots, or hyphens.
 * @returns {BoletoComponents} Returns layout-specific encoded fields and calculated check-digit expectations.
 * @throws {TypeError} If `value` is not a supported numeric boleto representation.
 * @since 0.1.0
 *
 * @example
 * const components = parseBoletoCode("00193373700000001000500940144816060680935031");
 * console.log(components.layout);
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
 * Validates a boleto representation and reports normalized values, parsed components, and every detected issue.
 *
 * @param {string} value - Contains a boleto barcode or digitable line with optional whitespace, dots, or hyphens.
 * @returns {BoletoValidation} Returns a structured result instead of throwing for invalid boleto content.
 * @since 0.1.0
 *
 * @example
 * const validation = validateBoletoCode("00190.50095 40144.816069 06809.350314 3 37370000000100");
 * if (validation.isValid) {
 *   console.log(validation.barcode);
 * }
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
