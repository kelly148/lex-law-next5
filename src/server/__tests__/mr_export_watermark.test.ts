/**
 * EXPORT-FORMAT-FIX-1 #3 — the draft/confidential notice renders as a TRUE Word watermark (VML w:pict),
 * not as body text or only as header text. Drives off the same watermarkText override the export route uses.
 *
 * NOTE: this asserts the watermark XML STRUCTURE is present and well-formed (the docx packs). Visual
 * rendering (the diagonal WordArt) must be verified in Word — it cannot be asserted from XML alone.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer } from 'docx';
import { buildSatterwhiteSection } from '../utils/markdownToDocx.js';

async function headerXml(markdown: string, opts?: { watermarkText?: string | null }): Promise<string> {
  const doc = new Document({ sections: [buildSatterwhiteSection(markdown, opts)] });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(tmpdir(), `mr_wm_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
  writeFileSync(tmpPath, buffer);
  try {
    return execSync(`unzip -p "${tmpPath}" word/header1.xml`).toString();
  } catch {
    return '';
  }
}

describe('EXPORT-FORMAT-FIX-1 #3 — true w:pict watermark', () => {
  it('with watermarkText, the header carries a real VML w:pict watermark shape', async () => {
    const xml = await headerXml('# Power of Attorney\n\nBody.', { watermarkText: 'DRAFT — NOT FINAL' });
    expect(xml).toContain('w:pict'); // a true picture/shape container (Cowork: hasWatermark)
    expect(xml).toContain('v:shape'); // VML shape
    expect(xml).toContain('_x0000_t136'); // the WordArt text-path shapetype
    expect(xml).toContain('DRAFT'); // the watermark text
    expect(xml).toContain('c00000'); // red fill
    // The pict must be a well-formed direct child of the header — NOT wrapped in the invalid <undefined>
    // element that ImportedXmlComponent.fromXmlString emits if its document-root wrapper is returned as-is.
    expect(xml).not.toContain('<undefined');
    expect(xml).toMatch(/<w:hdr[\s>][\s\S]*<w:p[\s>][\s\S]*<w:pict>/); // pict sits inside a <w:p> under <w:hdr>
  });

  it('without watermarkText, the header has NO w:pict (plain running header only)', async () => {
    const xml = await headerXml('DURABLE POWER OF ATTORNEY\n\nBody.');
    expect(xml).not.toContain('w:pict');
    expect(xml).toContain('1f3864'); // still the navy running-header text
  });

  it('the document still packs without error when a watermark is applied', async () => {
    const doc = new Document({
      sections: [buildSatterwhiteSection('VIRGINIA REVOCABLE LIVING TRUST AGREEMENT\n\nBody.', { watermarkText: 'DRAFT — SUBSTANTIVELY COMPLETE, PENDING FINAL FORMATTING' })],
    });
    await expect(Packer.toBuffer(doc)).resolves.toBeInstanceOf(Buffer);
  });
});
