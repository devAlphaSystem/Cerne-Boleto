import { readFile } from "node:fs/promises";

import { ExtractionFailure } from "../errors";
import { extractPageText } from "../pdf/extract-text";
import { openPdfDocument } from "../pdf/open-document";
import type { PdfPageLike } from "../pdf/types";
import { openImageDocument } from "./image-document";
import type { LoadedInput } from "./load-input";
import type { DocumentHandle, DocumentPageLike } from "./types";

function pdfPageAdapter(page: PdfPageLike): DocumentPageLike {
  return {
    pageNumber: page.pageNumber,
    nativeText: () => extractPageText(page),
    render: async (recipe, maxPixels) => {
      const { renderPage } = await import("../pdf/render-page");
      return renderPage(page, recipe, maxPixels);
    },
    cleanup: () => {
      page.cleanup();
    },
  };
}

/**
 * Resolves a loaded input into the contiguous bytes the parsers require.
 *
 * PDF.js and the canvas image decoder both need the complete document in one buffer, so a stream spooled to a
 * temporary file is read back here, in a single exactly sized allocation, at the moment parsing begins. The
 * spool still pays off: the bytes were never held while the producer was slowly delivering them, and the
 * allocation is exact instead of the doubling overshoot a growing in-memory buffer would leave behind.
 *
 * PDF.js rejects a Node `Buffer`, so the bytes read back are re-viewed as a plain `Uint8Array`, matching what
 * the local-path branch of the loader already does.
 *
 * @param {LoadedInput} loaded - The validated bytes or their temporary file.
 * @returns {Promise<Uint8Array>} Resolves with the complete document bytes.
 * @throws {ExtractionFailure} If buffered bytes cannot be read back from temporary storage.
 */
async function documentBytes(loaded: LoadedInput): Promise<Uint8Array> {
  if (loaded.data !== null) {
    return loaded.data;
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(loaded.path);
  } catch (error) {
    throw new ExtractionFailure("PROCESSING_ERROR", "The buffered document could not be read back from temporary storage.", { cause: error });
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Opens validated input through the PDF or raster adapter behind a shared handle.
 *
 * @param {LoadedInput} loaded - The validated document bytes and detected format.
 * @param {number} maxSourceImagePixels - The maximum decoded source-image pixel area.
 * @param {number} maxCanvasPixels - The maximum PDF canvas allocation in pixels.
 * @returns {Promise<DocumentHandle>} Resolves with a format-independent document handle.
 * @throws {ExtractionFailure} If the document is invalid, protected, exceeds resource limits, or cannot be read back from temporary storage.
 * @throws {Error} If a PDF or native canvas dependency cannot open the document.
 */
export async function openDocument(loaded: LoadedInput, maxSourceImagePixels: number, maxCanvasPixels: number): Promise<DocumentHandle> {
  const data = await documentBytes(loaded);
  if (loaded.format === "pdf") {
    const handle = await openPdfDocument(data, maxSourceImagePixels, maxCanvasPixels);
    return {
      format: "pdf",
      numPages: handle.document.numPages,
      getPage: async (pageNumber) => pdfPageAdapter(await handle.document.getPage(pageNumber)),
      close: () => handle.close(),
    };
  }
  return openImageDocument(data, loaded.format, maxSourceImagePixels);
}
