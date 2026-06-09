/**
 * pdfRasterize.ts — MATERIALS-DROPZONE-1 Increment B: in-process PDF → page-image rasterization.
 *
 * Used ONLY for scanned PDFs (no text layer): unpdf returns empty text ('partial'), and those pages
 * are rasterized here and OCR'd. Digital PDFs keep the existing unpdf text path (no rasterization).
 *
 * Engine: @hyzyla/pdfium (PDFium compiled to WebAssembly, MIT). Pure WASM — no native addon, no
 * system package, NO runtime network egress (the WASM binary ships inside the package; we use the
 * default non-CDN entry point). With the default colorSpace, pdfium sets PDFium's REVERSE_BYTE_ORDER
 * flag and hands the render callback RGBA pixels (matching the library's own sharp({raw,channels:4})
 * example), so we copy them straight into a pngjs RGBA buffer — no channel swap. pngjs (pure-JS, MIT)
 * encodes each page to a PNG buffer that tesseract.js can OCR.
 */
import { PNG } from 'pngjs';

export interface RasterizeOptions {
  /** Cap pages OCR'd from one PDF (avoid pathologically large scans). */
  maxPages?: number;
  /** Render scale (≈2 ⇒ ~144 DPI; higher = sharper but slower/larger). */
  scale?: number;
}

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_SCALE = 2;

/** Encode a raw RGBA bitmap (pdfium delivers RGBA via REVERSE_BYTE_ORDER) to a PNG buffer. */
function rgbaToPng(data: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  const dst = png.data; // RGBA, length width*height*4
  dst.set(data.subarray(0, Math.min(data.length, dst.length)));
  return PNG.sync.write(png);
}

/**
 * Rasterize each page of a PDF buffer to a PNG buffer, in-process. Returns one PNG per page
 * (capped at maxPages). Throws on a corrupt/unreadable PDF — the caller maps that to 'failed'.
 */
export async function rasterizePdfToImages(
  pdf: Buffer,
  opts: RasterizeOptions = {},
): Promise<Buffer[]> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const scale = opts.scale ?? DEFAULT_SCALE;

  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const lib = await PDFiumLibrary.init();
  try {
    const doc = await lib.loadDocument(new Uint8Array(pdf));
    try {
      const images: Buffer[] = [];
      let pageIndex = 0;
      for (const page of doc.pages()) {
        if (pageIndex >= maxPages) break;
        pageIndex += 1;
        const rendered = await page.render({
          scale,
          render: (o) => Promise.resolve(rgbaToPng(o.data, o.width, o.height)),
        });
        images.push(Buffer.from(rendered.data));
      }
      return images;
    } finally {
      doc.destroy();
    }
  } finally {
    lib.destroy();
  }
}
