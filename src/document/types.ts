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
  visualLines: string[];
  lines: ExtractedTextLine[];
  words: ExtractedTextWord[];
  hasText: boolean;
}

export interface RenderedPage {
  width: number;
  height: number;
  appliedScale: number;
  rotation: number;
  getPixels(): Uint8ClampedArray;
  toPng(): Promise<Buffer>;
  mapBoundsToPage(bounds: NormalizedBounds): NormalizedBounds;
  releasePixels(): void;
  dispose(): void;
}

export interface DocumentPageLike {
  pageNumber: number;
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
