import type { NormalizedBounds } from "../candidates/types";

interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
}

interface TesseractLine {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
  words: TesseractWord[];
}

interface TesseractParagraph {
  lines: TesseractLine[];
}

interface TesseractBlock {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
  paragraphs: TesseractParagraph[];
}

interface TesseractPage {
  text: string;
  confidence: number;
  blocks: TesseractBlock[] | null;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bounds: NormalizedBounds;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bounds: NormalizedBounds;
  words: OcrWord[];
}

export interface OcrBlock {
  text: string;
  confidence: number;
  bounds: NormalizedBounds;
  lines: OcrLine[];
}

export interface OcrRecognition {
  text: string;
  confidence: number;
  blocks: OcrBlock[];
  lines: OcrLine[];
  words: OcrWord[];
}

export interface OcrSession {
  /** Full-page Portuguese OCR without a character whitelist. */
  recognize(image: Buffer): Promise<OcrRecognition>;
  /** Digit-only retry, intentionally restricted to a caller-selected region. */
  recognizeDigits(image: Buffer, region: NormalizedBounds): Promise<OcrRecognition>;
  terminate(): Promise<void>;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function pngDimensions(image: Buffer): ImageDimensions | null {
  if (image.length < 24 || image[0] !== 0x89 || image[1] !== 0x50 || image[2] !== 0x4e || image[3] !== 0x47 || image.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function inferredDimensions(page: TesseractPage): ImageDimensions {
  const blocks = page.blocks ?? [];
  return {
    width: Math.max(1, ...blocks.map((block) => block.bbox.x1)),
    height: Math.max(1, ...blocks.map((block) => block.bbox.y1)),
  };
}

function normalizedBounds(bbox: TesseractBbox, dimensions: ImageDimensions): NormalizedBounds {
  const left = clamp(Math.min(bbox.x0, bbox.x1), 0, dimensions.width);
  const top = clamp(Math.min(bbox.y0, bbox.y1), 0, dimensions.height);
  const right = clamp(Math.max(bbox.x0, bbox.x1), 0, dimensions.width);
  const bottom = clamp(Math.max(bbox.y0, bbox.y1), 0, dimensions.height);

  return {
    x: left / dimensions.width,
    y: top / dimensions.height,
    width: (right - left) / dimensions.width,
    height: (bottom - top) / dimensions.height,
  };
}

function recognitionFromPage(page: TesseractPage, dimensionsInput: ImageDimensions | null): OcrRecognition {
  const dimensions = dimensionsInput ?? inferredDimensions(page);
  const blocks: OcrBlock[] = [];

  for (const block of page.blocks ?? []) {
    const lines: OcrLine[] = [];
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words.filter((word) => word.text.trim().length > 0).map((word) => ({
          text: word.text,
          confidence: clamp(word.confidence, 0, 100),
          bounds: normalizedBounds(word.bbox, dimensions),
        }));
        if (line.text.trim().length > 0 || words.length > 0) {
          lines.push({
            text: line.text.trim(),
            confidence: clamp(line.confidence, 0, 100),
            bounds: normalizedBounds(line.bbox, dimensions),
            words,
          });
        }
      }
    }

    if (block.text.trim().length > 0 || lines.length > 0) {
      blocks.push({
        text: block.text.trim(),
        confidence: clamp(block.confidence, 0, 100),
        bounds: normalizedBounds(block.bbox, dimensions),
        lines,
      });
    }
  }

  const lines = blocks.flatMap((block) => block.lines);
  return {
    text: page.text,
    confidence: clamp(page.confidence, 0, 100),
    blocks,
    lines,
    words: lines.flatMap((line) => line.words),
  };
}

function pixelRectangle(
  region: NormalizedBounds,
  dimensions: ImageDimensions,
): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const left = clamp(Math.floor(region.x * dimensions.width), 0, dimensions.width - 1);
  const top = clamp(Math.floor(region.y * dimensions.height), 0, dimensions.height - 1);
  const right = clamp(Math.ceil((region.x + region.width) * dimensions.width), left + 1, dimensions.width);
  const bottom = clamp(Math.ceil((region.y + region.height) * dimensions.height), top + 1, dimensions.height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export async function createOcrSession(): Promise<OcrSession> {
  const [{ createWorker, OEM, PSM }, languageData] = await Promise.all([import("tesseract.js"), import("@tesseract.js-data/por")]);
  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    langPath: languageData.default.langPath,
    cacheMethod: "none",
    gzip: true,
  });
  let queue: Promise<void> = Promise.resolve();

  function schedule<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function recognizeFull(image: Buffer): Promise<OcrRecognition> {
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    return recognitionFromPage(result.data as TesseractPage, pngDimensions(image));
  }

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
    });
  } catch (error) {
    await worker.terminate().catch(() => undefined);
    throw error;
  }

  return {
    recognize(image: Buffer): Promise<OcrRecognition> {
      return schedule(() => recognizeFull(image));
    },
    recognizeDigits(image: Buffer, region: NormalizedBounds): Promise<OcrRecognition> {
      return schedule(async () => {
        const dimensions = pngDimensions(image);
        if (dimensions === null) {
          throw new TypeError("Digit-region OCR requires a PNG image with readable dimensions.");
        }
        if (!Number.isFinite(region.x) || !Number.isFinite(region.y) || !Number.isFinite(region.width) || !Number.isFinite(region.height) || region.width <= 0 || region.height <= 0) {
          throw new TypeError("Digit-region OCR requires a non-empty normalized region.");
        }

        await worker.setParameters({
          tessedit_char_whitelist: "0123456789",
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
        });
        try {
          const result = await worker.recognize(image, { rectangle: pixelRectangle(region, dimensions) }, { text: true, blocks: true });
          return recognitionFromPage(result.data as TesseractPage, dimensions);
        } finally {
          await worker.setParameters({
            tessedit_char_whitelist: "",
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            preserve_interword_spaces: "1",
          });
        }
      });
    },
    terminate(): Promise<void> {
      return schedule(async () => {
        await worker.terminate();
      });
    },
  };
}
