import type { NormalizedBounds } from "../candidates/types";
import type { RenderRecipe } from "../options";
import type { DocumentFormat } from "../types";

export interface ExtractedTextWord {
  text: string;
  bounds: NormalizedBounds;
}

export interface ExtractedTextLine {
  text: string;
  bounds: NormalizedBounds;
  words: ExtractedTextWord[];
}

export interface ExtractedPageText {
  orderedText: string;
  /** Plain strings retained for compatibility with the original extractor. */
  visualLines: string[];
  /** Reconstructed visual lines with normalized page coordinates. */
  lines: ExtractedTextLine[];
  /** All positioned words in visual reading order. */
  words: ExtractedTextWord[];
  hasText: boolean;
}

/**
 * A rendered visual page shared by every recognition stage. PDF pages produce
 * it through pdfjs rendering; standalone images produce it directly from the
 * decoded pixels without pretending to be PDFs.
 */
export interface RenderedPage {
  width: number;
  height: number;
  appliedScale: number;
  rotation: number;
  getPixels(): Uint8ClampedArray;
  toPng(): Promise<Buffer>;
  /** Maps recognition coordinates back to the canonical untransformed page. */
  mapBoundsToPage(bounds: NormalizedBounds): NormalizedBounds;
  /** Releases the backing canvas and any cached pixel buffer. */
  dispose(): void;
}

export interface DocumentPageLike {
  pageNumber: number;
  /** Structured native text, or null for formats without a text layer. */
  nativeText(): Promise<ExtractedPageText> | null;
  render(recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage>;
  cleanup(): void;
}

export interface DocumentHandle {
  format: DocumentFormat;
  numPages: number;
  sourceImageDimensions?: Readonly<{
    width: number;
    height: number;
  }>;
  getPage(pageNumber: number): Promise<DocumentPageLike>;
  close(): Promise<void>;
}
