/**
 * Represents the subset of a PDF.js text item consumed by text reconstruction.
 */
export interface PdfTextItemLike {
  /** Stores the text item's Unicode content. */
  str: string;
  /** Provides the PDF.js transformation matrix when positional data is available. */
  transform?: number[];
  /** Specifies the text item's reported width in viewport units. */
  width?: number;
  /** Specifies the text item's reported height in viewport units. */
  height?: number;
  /** Indicates that the content stream ends a line after this item. */
  hasEOL?: boolean;
}

/**
 * Represents the viewport dimensions required by PDF text and render adapters.
 */
export interface PdfViewportLike {
  /** Specifies the viewport width in pixels or PDF units. */
  width: number;
  /** Specifies the viewport height in pixels or PDF units. */
  height: number;
}

/**
 * Exposes the PDF.js page operations used by extraction and rendering.
 */
export interface PdfPageLike {
  /** Identifies the page using a 1-based index. */
  pageNumber: number;
  /** Records the page's intrinsic clockwise rotation in degrees. */
  rotate: number;
  /**
   * Retrieves the page's native text-content items.
   *
   * @returns {Promise<{items: Array<unknown>}>} Resolves with the raw PDF.js text items.
   * @throws {Error} If PDF.js cannot read the page's text content.
   */
  getTextContent(): Promise<{ items: unknown[] }>;
  /**
   * Creates a viewport for a requested scale and optional rotation.
   *
   * @param {Object} options - The viewport transformation options.
   * @param {number} options.scale - The scale applied to PDF page units.
   * @param {number} [options.rotation] - The clockwise rotation in degrees.
   * @returns {PdfViewportLike} The calculated viewport dimensions.
   * @throws {Error} If PDF.js cannot construct the requested viewport.
   */
  getViewport(options: { scale: number; rotation?: number }): PdfViewportLike;
  /**
   * Starts rendering the page with PDF.js-compatible options.
   *
   * @param {Record<string, unknown>} options - The canvas, viewport, and PDF.js rendering options.
   * @returns {{promise: Promise<void>}} The render task and its completion promise.
   * @throws {Error} If PDF.js cannot initialize the render task.
   */
  render(options: Record<string, unknown>): { promise: Promise<void> };
  /**
   * Releases PDF.js resources retained by the page.
   *
   * @param {boolean} [resetStats] - Whether PDF.js should reset page statistics.
   * @returns {boolean} Whether cleanup completed immediately.
   */
  cleanup(resetStats?: boolean): boolean;
}

/**
 * Exposes the PDF.js document operations used by the normalized document adapter.
 */
export interface PdfDocumentLike {
  /** Specifies the total number of pages in the PDF. */
  numPages: number;
  /**
   * Retrieves a PDF page by its 1-based index.
   *
   * @param {number} pageNumber - The 1-based page index to retrieve.
   * @returns {Promise<PdfPageLike>} Resolves with the requested PDF.js page.
   * @throws {Error} If the page number is invalid or PDF.js cannot load the page.
   */
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/**
 * Couples a parsed PDF.js document with deterministic cleanup.
 */
export interface PdfHandle {
  /** Exposes the parsed PDF.js document operations. */
  document: PdfDocumentLike;
  /**
   * Destroys the PDF.js loading task and releases document resources.
   *
   * @returns {Promise<void>} Resolves when the PDF resources are released.
   * @throws {Error} If PDF.js cannot destroy the loading task.
   */
  close(): Promise<void>;
}
