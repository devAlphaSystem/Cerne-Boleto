import type { NormalizedBounds } from "../candidates/types";
import type { ExtractedPageText, ExtractedTextLine, ExtractedTextWord } from "../document/types";
import { ExtractionFailure } from "../errors";
import type { PdfPageLike, PdfTextItemLike, PdfViewportLike } from "./types";

const MAX_TEXT_ITEMS_PER_PAGE = 50_000;
const MAX_TEXT_CHARACTERS_PER_PAGE = 250_000;

interface ConvertibleViewport extends PdfViewportLike {
  convertToViewportPoint?(x: number, y: number): [number, number];
}

interface PositionedTextItem {
  str: string;
  bounds: NormalizedBounds;
  hasEOL: boolean;
}

interface MutableTextLine {
  y: number;
  height: number;
  items: PositionedTextItem[];
}

export type { ExtractedPageText, ExtractedTextLine, ExtractedTextWord } from "../document/types";

function isTextItem(value: unknown): value is PdfTextItemLike {
  return typeof value === "object" && value !== null && "str" in value && typeof value.str === "string";
}

/**
 * QR codes and barcodes drawn as rows of 0/1 glyphs in a machine font read
 * as page text but are not text; they corrupt visual-line reconstruction.
 */
function isMachinePatternText(value: string): boolean {
  const compact = value.replace(/\s/gu, "");
  if (compact.length < 30) {
    return false;
  }
  const binaryCount = compact.match(/[01]/gu)?.length ?? 0;
  return binaryCount / compact.length >= 0.95;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedRectangle(viewport: ConvertibleViewport, left: number, bottom: number, right: number, top: number): NormalizedBounds {
  const convert = viewport.convertToViewportPoint === undefined ? (x: number, y: number): [number, number] => [x, viewport.height - y] : (x: number, y: number): [number, number] => viewport.convertToViewportPoint!(x, y);
  const points = [convert(left, bottom), convert(left, top), convert(right, bottom), convert(right, top)];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const normalizedLeft = clamp01(Math.min(...xs) / viewport.width);
  const normalizedTop = clamp01(Math.min(...ys) / viewport.height);
  const normalizedRight = clamp01(Math.max(...xs) / viewport.width);
  const normalizedBottom = clamp01(Math.max(...ys) / viewport.height);

  return {
    x: normalizedLeft,
    y: normalizedTop,
    width: Math.max(0, normalizedRight - normalizedLeft),
    height: Math.max(0, normalizedBottom - normalizedTop),
  };
}

function positionedItem(item: PdfTextItemLike, viewport: ConvertibleViewport): PositionedTextItem {
  const transform = item.transform ?? [];
  const x = transform[4] ?? 0;
  const baseline = transform[5] ?? 0;
  const transformHeight = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
  const height = Math.max(0.01, Math.abs(item.height ?? (transformHeight || 10)));
  const transformWidth = Math.hypot(transform[0] ?? 0, transform[1] ?? 0);
  const width = Math.max(0, Math.abs(item.width ?? transformWidth * item.str.length * 0.5));

  return {
    str: item.str,
    bounds: normalizedRectangle(viewport, x, baseline, x + width, baseline + height),
    hasEOL: item.hasEOL ?? false,
  };
}

function unionBounds(bounds: readonly NormalizedBounds[]): NormalizedBounds {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));

  return {
    x: clamp01(left),
    y: clamp01(top),
    width: clamp01(right) - clamp01(left),
    height: clamp01(bottom) - clamp01(top),
  };
}

function wordsFromItem(item: PositionedTextItem): ExtractedTextWord[] {
  const output: ExtractedTextWord[] = [];
  const characterCount = Math.max(1, item.str.length);

  for (const match of item.str.matchAll(/\S+/gu)) {
    const index = match.index;
    const text = match[0];
    const startRatio = index / characterCount;
    const widthRatio = text.length / characterCount;
    output.push({
      text,
      bounds: {
        x: clamp01(item.bounds.x + item.bounds.width * startRatio),
        y: item.bounds.y,
        width: Math.min(1 - clamp01(item.bounds.x + item.bounds.width * startRatio), item.bounds.width * widthRatio),
        height: item.bounds.height,
      },
    });
  }

  return output;
}

function reconstructLines(items: PositionedTextItem[]): ExtractedTextLine[] {
  const sorted = [...items].sort((left, right) => {
    const vertical = left.bounds.y - right.bounds.y;
    return Math.abs(vertical) > 0.001 ? vertical : left.bounds.x - right.bounds.x;
  });
  const lines: MutableTextLine[] = [];

  for (const item of sorted) {
    const centerY = item.bounds.y + item.bounds.height / 2;
    let line: MutableTextLine | undefined;
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const candidate = lines[lineIndex]!;
      if (Math.abs(candidate.y - centerY) <= Math.max(0.002, Math.max(candidate.height, item.bounds.height) * 0.45)) {
        line = candidate;
        break;
      }
    }
    if (line === undefined) {
      lines.push({
        y: centerY,
        height: item.bounds.height,
        items: [item],
      });
    } else {
      line.items.push(item);
      line.height = Math.max(line.height, item.bounds.height);
      line.y = (line.y * (line.items.length - 1) + centerY) / line.items.length;
    }
  }

  return lines.sort((left, right) => left.y - right.y).map((line) => {
    const lineItems = line.items.sort((left, right) => left.bounds.x - right.bounds.x);
    let text = "";
    let rightEdge: number | null = null;
    const words: ExtractedTextWord[] = [];

    for (const item of lineItems) {
      if (rightEdge !== null && item.bounds.x - rightEdge > Math.max(0.001, line.height * 0.08)) {
        text += " ";
      }
      text += item.str;
      rightEdge = item.bounds.x + item.bounds.width;
      words.push(...wordsFromItem(item));
    }

    return {
      text: text.trim(),
      bounds: unionBounds(lineItems.map((item) => item.bounds)),
      words,
    };
  }).filter((line) => line.text.length > 0);
}

export async function extractPageText(page: PdfPageLike): Promise<ExtractedPageText> {
  const content = await page.getTextContent();
  if (content.items.length > MAX_TEXT_ITEMS_PER_PAGE) {
    throw new ExtractionFailure("RESOURCE_LIMIT", "A PDF page contains too many text items to process safely.");
  }

  const viewport = page.getViewport({ scale: 1, rotation: page.rotate }) as ConvertibleViewport;
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new ExtractionFailure("INVALID_PDF", "A PDF page has invalid text dimensions.");
  }

  const items: PositionedTextItem[] = [];
  let characterCount = 0;
  for (const value of content.items) {
    if (!isTextItem(value) || isMachinePatternText(value.str)) {
      continue;
    }
    characterCount += value.str.length;
    if (characterCount > MAX_TEXT_CHARACTERS_PER_PAGE) {
      throw new ExtractionFailure("RESOURCE_LIMIT", "A PDF page contains too much text to process safely.");
    }
    items.push(positionedItem(value, viewport));
  }

  const orderedText = items.map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`).join("").trim();
  const lines = reconstructLines(items);
  const visualLines = lines.map((line) => line.text);

  return {
    orderedText,
    visualLines,
    lines,
    words: lines.flatMap((line) => line.words),
    hasText: items.some((item) => item.str.trim().length > 0),
  };
}
