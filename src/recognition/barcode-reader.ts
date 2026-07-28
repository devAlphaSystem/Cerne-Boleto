import type * as ZxingLibrary from "@zxing/library";

import type { NormalizedBounds } from "../candidates/types";
import type { RenderedPage } from "../document/types";

interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Represents a 44-digit ITF barcode decode and its location on the page.
 */
export interface DecodedBarcode {
  /**
   * Provides the decoded 44-digit barcode value.
   */
  text: string;
  /**
   * Identifies the barcode symbology used to produce the value.
   */
  source: "itf";
  /**
   * Locates the detected barcode within normalized page coordinates.
   */
  bounds: NormalizedBounds;
}
/**
 * Invokes caller-controlled cancellation or deadline checks during barcode scanning.
 *
 * @callback BarcodeCheckpoint
 * @throws {Error} If the caller requires barcode scanning to stop.
 */

/**
 * Defines optional behavior for an ITF barcode scan.
 */
export interface BarcodeReadOptions {
  /**
   * Indicates whether blurred photographic variants should supplement the original pixels.
   */
  photoEnhancements?: boolean;
  /**
   * Provides a checkpoint invoked before and during scan-region processing.
   *
   * @type {BarcodeCheckpoint}
   */
  checkpoint?: () => void;
}

interface BarcodeRuntime {
  zxing: typeof ZxingLibrary;
  hints: Map<ZxingLibrary.DecodeHintType, unknown>;
}

let barcodeRuntimePromise: Promise<BarcodeRuntime> | undefined;

function loadBarcodeRuntime(): Promise<BarcodeRuntime> {
  barcodeRuntimePromise ??= import("@zxing/library").then((imported) => {
    const zxing = (imported as unknown as { default?: typeof imported }).default ?? imported;
    const { BarcodeFormat, DecodeHintType } = zxing;
    const hints = new Map<ZxingLibrary.DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.ITF]);
    hints.set(DecodeHintType.ALLOWED_LENGTHS, Int32Array.from([44]));
    hints.set(DecodeHintType.TRY_HARDER, true);
    return { zxing, hints };
  }).catch((error: unknown) => {
    barcodeRuntimePromise = undefined;
    throw error;
  });
  return barcodeRuntimePromise;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function addRegion(regions: PixelRegion[], width: number, height: number, left: number, top: number, right: number, bottom: number): void {
  const roundedLeft = Math.max(0, Math.floor(left * width));
  const roundedTop = Math.max(0, Math.floor(top * height));
  const roundedRight = Math.min(width, Math.ceil(right * width));
  const roundedBottom = Math.min(height, Math.ceil(bottom * height));
  const regionWidth = roundedRight - roundedLeft;
  const regionHeight = roundedBottom - roundedTop;

  if (regionWidth >= 96 && regionHeight >= 32) {
    regions.push({
      left: roundedLeft,
      top: roundedTop,
      width: regionWidth,
      height: regionHeight,
    });
  }
}

function scanRegions(width: number, height: number): PixelRegion[] {
  const regions: PixelRegion[] = [];

  for (const parts of [4, 3, 2]) {
    const overlap = 0.08 / parts;
    for (let index = 0; index < parts; index += 1) {
      addRegion(regions, width, height, 0, index / parts - overlap, 1, (index + 1) / parts + overlap);
    }
  }

  addRegion(regions, width, height, 0, 0, 0.72, 0.55);
  addRegion(regions, width, height, 0.28, 0, 1, 0.55);
  addRegion(regions, width, height, 0, 0.45, 0.72, 1);
  addRegion(regions, width, height, 0.28, 0.45, 1, 1);
  addRegion(regions, width, height, 0, 0, 1, 1);

  return regions;
}

function boxBlurLuminance(source: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height);
  const lastColumn = width - 1;
  const lastRow = height - 1;

  function fillRow(row: Uint16Array, y: number): void {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      row[x] = source[x === 0 ? index : index - 1]! + source[index]! + source[x === lastColumn ? index : index + 1]!;
    }
  }

  let previous = new Uint16Array(width);
  let current = new Uint16Array(width);
  let next = new Uint16Array(width);
  fillRow(current, 0);
  previous.set(current);

  for (let y = 0; y < height; y += 1) {
    if (y < lastRow) {
      fillRow(next, y + 1);
    } else {
      next.set(current);
    }
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      output[rowOffset + x] = (previous[x]! + current[x]! + next[x]!) / 9;
    }
    const spent = previous;
    previous = current;
    current = next;
    next = spent;
  }
  return output;
}

function decodeBitmap(reader: ZxingLibrary.Reader, bitmap: ZxingLibrary.BinaryBitmap, hints: Map<ZxingLibrary.DecodeHintType, unknown>): ZxingLibrary.Result | null {
  const stackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
    return reader.decode(bitmap, hints);
  } catch {
    return null;
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
    reader.reset();
  }
}

function resultBounds(result: ZxingLibrary.Result, region: PixelRegion, pageWidth: number, pageHeight: number): NormalizedBounds {
  const points = result.getResultPoints();
  if (points.length === 0) {
    return {
      x: region.left / pageWidth,
      y: region.top / pageHeight,
      width: region.width / pageWidth,
      height: region.height / pageHeight,
    };
  }

  const xs = points.map((point) => region.left + point.getX());
  const ys = points.map((point) => region.top + point.getY());
  const horizontalPadding = Math.max(2, pageWidth * 0.004);
  const estimatedHeight = Math.max(8, Math.min(pageHeight * 0.06, region.height * 0.18));
  const left = Math.max(0, Math.min(...xs) - horizontalPadding);
  const right = Math.min(pageWidth, Math.max(...xs) + horizontalPadding);
  const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const top = Math.max(0, centerY - estimatedHeight / 2);
  const bottom = Math.min(pageHeight, centerY + estimatedHeight / 2);

  return {
    x: clamp01(left / pageWidth),
    y: clamp01(top / pageHeight),
    width: clamp01(right / pageWidth) - clamp01(left / pageWidth),
    height: clamp01(bottom / pageHeight) - clamp01(top / pageHeight),
  };
}

function horizontalOverlap(left: NormalizedBounds, right: NormalizedBounds): number {
  const intersection = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return intersection / Math.max(0.000_001, Math.min(left.width, right.width));
}

function isSamePhysicalBarcode(left: DecodedBarcode, right: DecodedBarcode): boolean {
  if (left.text !== right.text || horizontalOverlap(left.bounds, right.bounds) < 0.55) {
    return false;
  }

  const leftCenterY = left.bounds.y + left.bounds.height / 2;
  const rightCenterY = right.bounds.y + right.bounds.height / 2;
  return Math.abs(leftCenterY - rightCenterY) <= Math.max(0.12, left.bounds.height, right.bounds.height);
}

function mergeBounds(left: NormalizedBounds, right: NormalizedBounds): NormalizedBounds {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y,
  };
}

/**
 * Decodes unique 44-digit ITF barcodes from prioritized regions of a rendered page.
 *
 * @param {RenderedPage} rendered - The rendered page whose pixels should be scanned.
 * @param {BarcodeReadOptions} [options={}] - Optional photographic and checkpoint behavior.
 * @returns {Promise<Array<DecodedBarcode>>} Resolves with spatially ordered, deduplicated barcode detections.
 * @throws {Error} If the barcode runtime, rendered pixels, or caller checkpoint fails.
 */
export async function readBarcodes(rendered: RenderedPage, options: BarcodeReadOptions = {}): Promise<DecodedBarcode[]> {
  const { zxing, hints } = await loadBarcodeRuntime();
  const { BinaryBitmap, HybridBinarizer, ITFReader, InvertedLuminanceSource, RGBLuminanceSource } = zxing;

  options.checkpoint?.();
  const pixels = rendered.getPixels();
  const pixelCount = rendered.width * rendered.height;
  const luminance = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0, rgba = 0; pixel < pixelCount; pixel += 1, rgba += 4) {
    luminance[pixel] = (pixels[rgba]! + pixels[rgba + 1]! * 2 + pixels[rgba + 2]!) / 4;
  }

  const pageSource = new RGBLuminanceSource(luminance, rendered.width, rendered.height);
  const blurredSource = options.photoEnhancements === true ? new RGBLuminanceSource(boxBlurLuminance(luminance, rendered.width, rendered.height), rendered.width, rendered.height) : null;
  const reader = new ITFReader();
  const output: DecodedBarcode[] = [];

  for (const region of scanRegions(rendered.width, rendered.height)) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    options.checkpoint?.();
    let cropped: ZxingLibrary.LuminanceSource;
    try {
      cropped = pageSource.crop(region.left, region.top, region.width, region.height);
    } catch {
      continue;
    }

    const sources: ZxingLibrary.LuminanceSource[] = [cropped, new InvertedLuminanceSource(cropped)];
    if (blurredSource !== null) {
      try {
        const croppedBlurred = blurredSource.crop(region.left, region.top, region.width, region.height);
        sources.push(croppedBlurred, new InvertedLuminanceSource(croppedBlurred));
      } catch {
        // The original crop remains usable when a derived photographic crop fails.
      }
    }
    for (const source of sources) {
      const result = decodeBitmap(reader, new BinaryBitmap(new HybridBinarizer(source)), hints);
      if (result === null || !/^[0-9]{44}$/u.test(result.getText())) {
        continue;
      }

      const candidate: DecodedBarcode = {
        text: result.getText(),
        source: "itf",
        bounds: resultBounds(result, region, rendered.width, rendered.height),
      };
      const existingIndex = output.findIndex((current) => isSamePhysicalBarcode(current, candidate));
      if (existingIndex === -1) {
        output.push(candidate);
      } else {
        const existing = output[existingIndex]!;
        output[existingIndex] = {
          ...existing,
          bounds: mergeBounds(existing.bounds, candidate.bounds),
        };
      }
    }
  }

  return output.sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
}
