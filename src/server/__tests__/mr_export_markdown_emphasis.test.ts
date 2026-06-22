/**
 * EXPORT-FORMAT-FIX-1 #2 — inline-markdown emphasis must not leak into the DOCX, and signature/fill-in
 * underscore runs must be preserved.
 *
 * Root cause fixed: all-caps lines are detected as titles/headings and rendered as a single plain run;
 * `stripWholeBold` only removed a FULL `**…**` wrap, so a partial/inline `**`/`__` marker in an all-caps
 * heading (e.g. "**DATE OF EXECUTION:** ____") survived as literal text. Also `__bold__` was never parsed.
 * The fix strips inline markers in headings and parses `__bold__` in body — WITHOUT corrupting underscore
 * fill-in lines (the `__` parse is guarded against longer underscore runs).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer } from 'docx';
import { markdownToDocxParagraphs, DocxFileChild } from '../utils/markdownToDocx.js';

async function bodyXml(children: DocxFileChild[]): Promise<string> {
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(tmpdir(), `mr_emph_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
  writeFileSync(tmpPath, buffer);
  const xml = execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
  return xml.replace(/.*<w:body>/s, '').replace(/<\/w:body>.*/s, '');
}

describe('EXPORT-FORMAT-FIX-1 #2 — markdown emphasis does not leak', () => {
  it('all-caps heading with partial ** keeps no literal asterisks (keeps the text + underscores)', async () => {
    const xml = await bodyXml(markdownToDocxParagraphs('**DATE OF EXECUTION:** ____________'));
    expect(xml).not.toContain('**');
    expect(xml).toContain('DATE OF EXECUTION:');
    expect(xml).toMatch(/_{6,}/); // the signature fill-in underscores survive
  });

  it('all-caps heading with __ keeps no literal double-underscore markers around the title text', async () => {
    const xml = await bodyXml(markdownToDocxParagraphs('__ARTICLE II — POWERS GRANTED__'));
    expect(xml).toContain('ARTICLE II'); // the title text is rendered
    expect(xml).not.toContain('__ARTICLE'); // the leading marker is gone
    expect(xml).not.toContain('GRANTED__'); // the trailing marker is gone
  });

  it('body __bold__ becomes a bold run, no literal markers', async () => {
    const xml = await bodyXml(markdownToDocxParagraphs('Signed by __John Doe__ today.'));
    expect(xml).toContain('John Doe');
    expect(xml).not.toContain('__John');
    expect(xml).not.toContain('Doe__');
    expect(xml).toMatch(/<w:b\b/); // a bold run exists
  });

  it('body **bold** still becomes a bold run, no literal markers', async () => {
    const xml = await bodyXml(markdownToDocxParagraphs('This **Durable Power** is granted.'));
    expect(xml).toContain('Durable Power');
    expect(xml).not.toContain('**');
    expect(xml).toMatch(/<w:b\b/);
  });

  it('a signature/fill-in underscore run in body text is preserved, not parsed as bold', async () => {
    const xml = await bodyXml(markdownToDocxParagraphs('Print name: ____________________'));
    expect(xml).toMatch(/_{12,}/); // the long underscore run is intact (not mangled by __ parsing)
  });
});
