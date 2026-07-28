import { ExtractionFailure, messageFromUnknown } from "../errors";
import type { PdfDocumentLike, PdfHandle } from "./types";

async function installCanvasGlobals(): Promise<void> {
  const canvas = await import("@napi-rs/canvas");
  const target = globalThis as unknown as Record<string, unknown>;
  target["DOMMatrix"] ??= canvas.DOMMatrix;
  target["ImageData"] ??= canvas.ImageData;
  target["Path2D"] ??= canvas.Path2D;
}

/**
 * Loads PDF.js with native canvas globals and opens a PDF under image limits.
 *
 * @param {Uint8Array} data - The PDF bytes to parse.
 * @param {number} maxSourceImagePixels - The maximum decoded image area accepted by PDF.js.
 * @param {number} maxCanvasPixels - The maximum PDF canvas area in pixels.
 * @returns {Promise<PdfHandle>} Resolves with the parsed PDF.js document and cleanup operation.
 * @throws {ExtractionFailure} If the PDF is encrypted or cannot be parsed.
 * @throws {Error} If the native canvas or PDF.js module cannot be loaded or initialize a loading task.
 */
export async function openPdfDocument(data: Uint8Array, maxSourceImagePixels: number, maxCanvasPixels: number): Promise<PdfHandle> {
  await installCanvasGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    maxImageSize: maxSourceImagePixels,
    canvasMaxAreaInBytes: maxCanvasPixels * 4,
    useSystemFonts: true,
    stopAtErrors: false,
    verbosity: 0,
  });

  try {
    const document = (await loadingTask.promise) as unknown as PdfDocumentLike;
    return {
      document,
      async close(): Promise<void> {
        await loadingTask.destroy();
      },
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    const name = error instanceof Error ? error.name : "";
    const message = messageFromUnknown(error);
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new ExtractionFailure("PASSWORD_REQUIRED", "The PDF is encrypted and requires a password.", { cause: error });
    }
    throw new ExtractionFailure("INVALID_PDF", "The PDF could not be parsed.", {
      cause: error,
    });
  }
}
