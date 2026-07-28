import type { NormalizedBounds } from "../candidates/types";
import type { RenderRecipe } from "../options";
import type { DocumentFormat } from "../types";

/**
 * Represents a word extracted from a document page with normalized bounds.
 */
export interface ExtractedTextWord {
  /** Stores the extracted word content. */
  text: string;
  /** Locates the word relative to the page dimensions. */
  bounds: NormalizedBounds;
}

/**
 * Represents a visually reconstructed text line and its positioned words.
 */
export interface ExtractedTextLine {
  /** Stores the reconstructed line content. */
  text: string;
  /** Locates the complete line relative to the page dimensions. */
  bounds: NormalizedBounds;
  /** Lists the positioned words that form the line. */
  words: ExtractedTextWord[];
}

/**
 * Collects the native and visually reconstructed text representations of a page.
 */
export interface ExtractedPageText {
  /** Stores text in the item order returned by PDF.js for the page content stream. */
  orderedText: string;
  /** Lists visually reconstructed lines as plain text. */
  visualLines: string[];
  /** Lists visually reconstructed lines with positional metadata. */
  lines: ExtractedTextLine[];
  /** Lists every positioned word extracted from the page. */
  words: ExtractedTextWord[];
  /** Indicates whether the page contains usable native text. */
  hasText: boolean;
}

/**
 * Exposes a rendered page surface and coordinate-mapping operations for recognition.
 */
export interface RenderedPage {
  /** Specifies the rendered width in pixels. */
  width: number;
  /** Specifies the rendered height in pixels. */
  height: number;
  /** Records the scale that was applied after resource-limit adjustments. */
  appliedScale: number;
  /** Records the effective clockwise rotation of the rendered output in degrees. */
  rotation: number;
  /**
   * Returns the rendered page's RGBA pixel buffer.
   *
   * @returns {Uint8ClampedArray} The pixel buffer in row-major RGBA order.
   * @throws {ExtractionFailure} If the rendered surface has already been disposed.
   * @throws {Error} If the native canvas runtime cannot read the rendered pixels.
   */
  getPixels(): Uint8ClampedArray;
  /**
   * Encodes the rendered page as a PNG buffer.
   *
   * @returns {Promise<Buffer>} Resolves with the encoded PNG bytes.
   * @throws {ExtractionFailure} If the rendered surface has already been disposed.
   * @throws {Error} If the native canvas encoder cannot produce the PNG data.
   */
  toPng(): Promise<Buffer>;
  /**
   * Maps bounds from rendered coordinates back to the source page.
   *
   * @param {NormalizedBounds} bounds - The bounds relative to the rendered page.
   * @returns {NormalizedBounds} The equivalent bounds relative to the source page.
   */
  mapBoundsToPage(bounds: NormalizedBounds): NormalizedBounds;
  /** Releases any cached pixel copy while keeping the rendered surface usable. */
  releasePixels(): void;
  /** Disposes the rendered surface and its cached pixels. */
  dispose(): void;
}

/**
 * Exposes text extraction, rendering, and cleanup for one document page.
 */
export interface DocumentPageLike {
  /** Identifies the page using a 1-based index. */
  pageNumber: number;
  /**
   * Extracts native text when the document format provides a text layer.
   *
   * @returns {Promise<ExtractedPageText>|null} A pending native-text result, or `null` when the format has no text layer.
   * @throws {ExtractionFailure} If native PDF text exceeds configured safety limits.
   * @throws {Error} If the underlying document engine cannot read the text layer.
   */
  nativeText(): Promise<ExtractedPageText> | null;
  /**
   * Renders the page according to a recognition recipe within a pixel budget.
   *
   * @param {RenderRecipe} recipe - The scale, rotation, and image-processing operations to apply.
   * @param {number} maxPixels - The maximum allowed rendered pixel area.
   * @returns {Promise<RenderedPage>} Resolves with the rendered page surface.
   * @throws {ExtractionFailure} If the page is unavailable or exceeds the rendering limits.
   * @throws {Error} If the underlying PDF or canvas engine cannot render the page.
   */
  render(recipe: RenderRecipe, maxPixels: number): Promise<RenderedPage>;
  /** Releases transient resources retained by the source page. */
  cleanup(): void;
}

/**
 * Exposes a normalized document handle shared by PDF and image extraction flows.
 */
export interface DocumentHandle {
  /** Identifies the detected source document format. */
  format: DocumentFormat;
  /** Specifies the total number of pages available through the handle. */
  numPages: number;
  /** Describes the decoded source image dimensions for raster inputs. */
  sourceImageDimensions?: Readonly<{
    /** Specifies the decoded source width in pixels. */
    width: number;
    /** Specifies the decoded source height in pixels. */
    height: number;
  }>;
  /**
   * Retrieves a page by its 1-based index.
   *
   * @param {number} pageNumber - The 1-based page index to retrieve.
   * @returns {Promise<DocumentPageLike>} Resolves with the requested page adapter.
   * @throws {ExtractionFailure} If a page other than one is requested from an image document.
   * @throws {Error} If the underlying document engine cannot load the page.
   */
  getPage(pageNumber: number): Promise<DocumentPageLike>;
  /**
   * Releases resources held by the document and leaves subsequent rendering unsupported.
   *
   * @returns {Promise<void>} Resolves when document cleanup is complete.
   * @throws {Error} If the underlying document engine cannot complete cleanup.
   */
  close(): Promise<void>;
}
