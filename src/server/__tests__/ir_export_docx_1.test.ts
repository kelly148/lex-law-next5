/**
 * IR-EXPORT-DOCX-1 — the information-request .docx export renders a REAL docx through the shared engine.
 *
 * The exportText procedure now (for format='docx') feeds its structured text to markdownToDocxParagraphs
 * (the same engine as Upload & Format), wraps it in a docx Document, and returns Packer.toBuffer as base64.
 * This proves that path produces a valid .docx (a ZIP — magic bytes "PK\x03\x04", base64 prefix "UEsD")
 * from information-request text, without needing a live DB.
 */
import { describe, it, expect } from 'vitest';
import { Document as DocxDocument, Packer } from 'docx';
import { markdownToDocxParagraphs } from '../utils/markdownToDocx.js';

const IR_TEXT = [
  'Information Request Matrix',
  '='.repeat(40),
  '',
  '## Assets',
  '',
  'Q: List all bank accounts.',
  'A: Checking at First Bank; savings at Second Bank.',
  '',
  'Q: Do you own real property?',
  '',
  '## Beneficiaries',
  '',
  'Q: Name the primary beneficiary.',
  'A: Jane Doe.',
  '',
].join('\n');

describe('IR-EXPORT-DOCX-1 — real docx from information-request text', () => {
  it('renders a valid .docx (ZIP magic) from the structured IR text via the shared engine', async () => {
    const children = markdownToDocxParagraphs(IR_TEXT);
    expect(children.length).toBeGreaterThan(0);
    const docxFile = new DocxDocument({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(docxFile);
    expect(buffer.length).toBeGreaterThan(0);
    // .docx is a ZIP: first bytes are PK\x03\x04 -> base64 begins "UEsD".
    const base64 = buffer.toString('base64');
    expect(base64.startsWith('UEsD')).toBe(true);
    // sanity: the raw bytes start with the ZIP local-file-header signature.
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });
});
