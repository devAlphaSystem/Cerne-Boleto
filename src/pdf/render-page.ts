import { undoRecipeRotation } from "../document/geometry";
import type { RenderedPage } from "../document/types";
import { ExtractionFailure } from "../errors";
import type { RenderRecipe } from "../options";
import type { PdfPageLike } from "./types";

const MAX_CANVAS_DIMENSION = 32_767;

/**
 * Renders a PDF page for recognition while enforcing canvas dimension and area limits.
 *
 * @param {PdfPageLike} page - The PDF.js-compatible page to render.
 * @param {RenderRecipe} recipe - The scale and rotation requested for the PDF render.
 * @param {number} maxPixels - The maximum allocated canvas area in pixels.
 * @returns {Promise<RenderedPage>} Resolves with a disposable rendered page surface.
 * @throws {ExtractionFailure} If the PDF page dimensions are invalid or exceed supported limits.
 * @throws {Error} If the native canvas module or PDF.js renderer cannot produce the page.
 */
export async function renderPage(page: PdfPageLike, recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const rotation = (((page.rotate + recipe.rotation) % 360) + 360) % 360;
  let scale = recipe.scale;
  let viewport = page.getViewport({ scale, rotation });
  let width = 0;
  let height = 0;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
      throw new ExtractionFailure("INVALID_PDF", "A PDF page has invalid dimensions.");
    }

    width = Math.max(1, Math.ceil(viewport.width));
    height = Math.max(1, Math.ceil(viewport.height));
    const allocatedPixels = width * height;
    if (width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION && allocatedPixels <= maxPixels) {
      break;
    }

    const hasSubpixelAxis = viewport.width < 1 || viewport.height < 1;
    const pixelFactor = hasSubpixelAxis ? maxPixels / allocatedPixels : Math.sqrt(maxPixels / allocatedPixels);
    const reduction = Math.min(pixelFactor, MAX_CANVAS_DIMENSION / width, MAX_CANVAS_DIMENSION / height) * 0.999;
    if (!Number.isFinite(reduction) || reduction <= 0 || reduction >= 1) {
      throw new ExtractionFailure("INVALID_PDF", "A PDF page exceeds the supported render dimensions.");
    }
    scale *= reduction;
    viewport = page.getViewport({ scale, rotation });
  }

  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || width * height > maxPixels) {
    throw new ExtractionFailure("INVALID_PDF", "A PDF page exceeds the supported render dimensions.");
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    intent: "display",
    background: "#ffffff",
  }).promise;
  let pixels: Uint8ClampedArray | null = null;
  let disposed = false;

  function assertAvailable(): void {
    if (disposed) {
      throw new ExtractionFailure("PROCESSING_ERROR", "The rendered PDF surface is already disposed.");
    }
  }

  return {
    width,
    height,
    appliedScale: scale,
    rotation,
    getPixels(): Uint8ClampedArray {
      assertAvailable();
      pixels ??= context.getImageData(0, 0, width, height).data;
      return pixels;
    },
    toPng(): Promise<Buffer> {
      assertAvailable();
      return canvas.encode("png");
    },
    mapBoundsToPage(bounds) {
      return undoRecipeRotation(bounds, recipe.rotation);
    },
    releasePixels(): void {
      pixels = null;
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      pixels = null;
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
