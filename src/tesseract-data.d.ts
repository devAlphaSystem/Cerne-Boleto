/**
 * Declares the Portuguese Tesseract language-data package shape used by OCR setup.
 */
declare module "@tesseract.js-data/por" {
  /**
   * Provides the bundled Portuguese language code, compression flag, and data path.
   */
  const languageData: {
    /** Identifies the Portuguese Tesseract language code. */
    code: "por";
    /** Indicates that the bundled trained-data file is gzip-compressed. */
    gzip: true;
    /** Locates the directory that contains the trained-data file. */
    langPath: string;
  };

  export default languageData;
}
