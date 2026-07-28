import type { BinaryBitmap, DecodeHintType, LuminanceSource, Reader, Result } from "@zxing/library";

import type { NormalizedBounds } from "../candidates/types";
import type { RenderedPage } from "../document/types";

interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DecodedBarcode {
  text: string;
  source: "itf";
  bounds: NormalizedBounds;
}

export interface BarcodeReadOptions {
  /** Enables bounded photo-specific blur and global-threshold attempts. */
  photoEnhancements?: boolean;
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

/**
 * Overlapping horizontal bands let a one-dimensional reader find independent
 * barcodes instead of repeatedly returning only the first barcode on a page.
 */
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

/**
 * A one-pixel box blur fuses the dotted modules of thermal-printer barcodes
 * into solid bars, which binarizes far more reliably in photographs.
 */
function boxBlurLuminance(source: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const horizontal = new Float32Array(width * height);
  const output = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = source[y * width + Math.max(0, x - 1)] ?? 0;
      const center = source[y * width + x] ?? 0;
      const right = source[y * width + Math.min(width - 1, x + 1)] ?? 0;
      horizontal[y * width + x] = (left + center + right) / 3;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = horizontal[Math.max(0, y - 1) * width + x] ?? 0;
      const center = horizontal[y * width + x] ?? 0;
      const bottom = horizontal[Math.min(height - 1, y + 1) * width + x] ?? 0;
      output[y * width + x] = (top + center + bottom) / 3;
    }
  }
  return output;
}

function decodeBitmap(reader: Reader, bitmap: BinaryBitmap, hints: Map<DecodeHintType, unknown>): Result | null {
  try {
    return reader.decode(bitmap, hints);
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

function resultBounds(result: Result, region: PixelRegion, pageWidth: number, pageHeight: number): NormalizedBounds {
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

export async function readBarcodes(rendered: RenderedPage, options: BarcodeReadOptions = {}): Promise<DecodedBarcode[]> {
  const imported = await import("@zxing/library");
  const zxing = (imported as unknown as { default?: typeof imported }).default ?? imported;
  const { BarcodeFormat, BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer, HybridBinarizer, ITFReader, InvertedLuminanceSource, RGBLuminanceSource } = zxing;
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.ITF]);
  hints.set(DecodeHintType.ALLOWED_LENGTHS, Int32Array.from([44]));
  hints.set(DecodeHintType.TRY_HARDER, true);

  const pixels = rendered.getPixels();
  const luminance = new Uint8ClampedArray(rendered.width * rendered.height);
  for (let pixel = 0, rgba = 0; pixel < luminance.length; pixel += 1, rgba += 4) {
    const red = pixels[rgba] ?? 255;
    const green = pixels[rgba + 1] ?? 255;
    const blue = pixels[rgba + 2] ?? 255;
    luminance[pixel] = (red + green * 2 + blue) / 4;
  }

  const pageSource = new RGBLuminanceSource(luminance, rendered.width, rendered.height);
  const blurredSource = options.photoEnhancements === true ? new RGBLuminanceSource(boxBlurLuminance(luminance, rendered.width, rendered.height), rendered.width, rendered.height) : null;
  const reader = new ITFReader();
  const output: DecodedBarcode[] = [];

  for (const region of scanRegions(rendered.width, rendered.height)) {
    let cropped: LuminanceSource;
    try {
      cropped = pageSource.crop(region.left, region.top, region.width, region.height);
    } catch {
      continue;
    }

    const sources: LuminanceSource[] = [cropped, new InvertedLuminanceSource(cropped)];
    if (blurredSource !== null) {
      try {
        const croppedBlurred = blurredSource.crop(region.left, region.top, region.width, region.height);
        sources.push(croppedBlurred, new InvertedLuminanceSource(croppedBlurred));
      } catch {
        // The original crop remains usable when a derived photographic crop fails.
      }
    }
    for (const source of sources) {
      const adaptive = decodeBitmap(reader, new BinaryBitmap(new HybridBinarizer(source)), hints);
      const result = adaptive ?? (options.photoEnhancements === true ? decodeBitmap(reader, new BinaryBitmap(new GlobalHistogramBinarizer(source)), hints) : null);
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
