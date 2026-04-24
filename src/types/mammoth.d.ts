/**
 * Minimal type declarations for mammoth (no @types/mammoth available).
 * Only the surface used by template.upload is declared here.
 */
declare module 'mammoth' {
  export interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string; paragraph?: unknown }>;
  }

  export function extractRawText(options: {
    buffer: Buffer;
  }): Promise<ConversionResult>;

  export function convertToHtml(options: {
    buffer: Buffer;
  }): Promise<ConversionResult>;
}
