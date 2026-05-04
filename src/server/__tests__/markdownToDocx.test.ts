/**
 * markdownToDocx.test.ts
 *
 * MR-EXPORT-FORMAT-1 — Updated unit tests (T1–T12) and integration tests
 * for the markdownToDocxParagraphs helper (v2).
 *
 * Changes from v1 test file:
 *   - paragraphsToXml now accepts DocxFileChild[] (Paragraph | Table)
 *   - T1: ## now maps to Heading2 (not Heading1) per v2 heading mapping
 *   - T2: ### now maps to Heading3 (not Heading2)
 *   - T3: #### now maps to Heading4 (not Heading3)
 *   - T12: deferred list items are now supported in v2 (not literal pass-through)
 *   - Integration test updated to reflect v2 heading mapping and new features
 *   - New tests T-EF1-1 through T-EF1-12 for v2 features added in separate file
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer, Paragraph } from 'docx';
import { markdownToDocxParagraphs, DocxFileChild } from '../utils/markdownToDocx.js';

// ── Helper: generate DOCX XML from file children ─────────────────────────────

/**
 * Render an array of DocxFileChild (Paragraph | Table) into a DOCX buffer
 * and return the word/document.xml content as a string for inspection.
 */
async function childrenToXml(children: DocxFileChild[]): Promise<string> {
  const doc = new Document({
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: '' })] }],
  });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(tmpdir(), `mr_export_format_1_test_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
  writeFileSync(tmpPath, buffer);
  const xml = execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
  return xml;
}

// Backward-compat alias for existing tests
async function paragraphsToXml(children: DocxFileChild[]): Promise<string> {
  return childrenToXml(children);
}

// ── Unit tests: T1–T12 (updated for v2) ──────────────────────────────────────
describe('markdownToDocxParagraphs — unit tests (v2)', () => {
  // T1: ## Section Title -> HeadingLevel.HEADING_2 (v2: ## is HEADING_2)
  it('T1: ## heading produces Paragraph with Heading2 style', async () => {
    const paragraphs = markdownToDocxParagraphs('## Section Title');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading2');
    expect(xml).toContain('Section Title');
  });
  // T2: ### Subsection Title -> HeadingLevel.HEADING_3 (v2: ### is HEADING_3)
  it('T2: ### heading produces Paragraph with Heading3 style', async () => {
    const paragraphs = markdownToDocxParagraphs('### Subsection Title');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading3');
    expect(xml).toContain('Subsection Title');
  });
  // T3: #### Sub-subsection -> HeadingLevel.HEADING_4 (v2: #### is HEADING_4)
  it('T3: #### heading produces Paragraph with Heading4 style', async () => {
    const paragraphs = markdownToDocxParagraphs('#### Sub-subsection');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading4');
    expect(xml).toContain('Sub-subsection');
  });
  // T4: **bold** -> TextRun with bold
  it('T4: **bold** produces TextRun with bold markup', async () => {
    const paragraphs = markdownToDocxParagraphs('**bold text**');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('bold text');
    expect(xml).toContain('<w:b/>');
  });
  // T5: *italic* -> TextRun with italic
  it('T5: *italic* produces TextRun with italic markup', async () => {
    const paragraphs = markdownToDocxParagraphs('*italic text*');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('italic text');
    expect(xml).toContain('<w:i/>');
  });
  // T6: ***bold-italic*** -> TextRun with bold + italic
  it('T6: ***bold-italic*** produces TextRun with bold and italic markup', async () => {
    const paragraphs = markdownToDocxParagraphs('***bold and italic***');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('bold and italic');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });
  // T7: --- -> Paragraph with bottom border
  it('T7: --- produces Paragraph with bottom border', async () => {
    const paragraphs = markdownToDocxParagraphs('---');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('w:pBdr');
  });
  // T8: empty string -> empty array
  it('T8: empty string returns empty array', () => {
    expect(markdownToDocxParagraphs('')).toHaveLength(0);
    expect(markdownToDocxParagraphs('   ')).toHaveLength(0);
  });
  // T9: plain text -> single Paragraph
  it('T9: plain text produces single Paragraph', async () => {
    const paragraphs = markdownToDocxParagraphs('Plain text here.');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Plain text here.');
  });
  // T10: mixed inline formatting in one line
  it('T10: mixed inline formatting in one line produces correct runs', async () => {
    const paragraphs = markdownToDocxParagraphs('Start **bold** middle *italic* end.');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Start');
    expect(xml).toContain('bold');
    expect(xml).toContain('middle');
    expect(xml).toContain('italic');
    expect(xml).toContain('end.');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });
  // T11: unmatched single asterisks do NOT break parsing
  it('T11: unmatched single asterisks render as literal text without throwing', async () => {
    const input = '5 * 3 = 15';
    expect(() => markdownToDocxParagraphs(input)).not.toThrow();
    const paragraphs = markdownToDocxParagraphs(input);
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('5 * 3 = 15');
    expect(xml).not.toContain('<w:i/>');
  });
  // T12: In v2, - list items are supported (not deferred); other deferred items still pass through
  it('T12: v2 list items are rendered; other deferred Markdown still passes through', async () => {
    // List item is now supported in v2
    const listInput = '- list item';
    expect(() => markdownToDocxParagraphs(listInput)).not.toThrow();
    const listParagraphs = markdownToDocxParagraphs(listInput);
    expect(listParagraphs.length).toBeGreaterThan(0);
    const listXml = await paragraphsToXml(listParagraphs);
    expect(listXml).toContain('list item');
    // Other deferred items still pass through as literal text
    const deferredInputs = [
      '[link](https://example.com)',
      '`inline code`',
      '> blockquote',
    ];
    for (const input of deferredInputs) {
      expect(() => markdownToDocxParagraphs(input)).not.toThrow();
      const paragraphs = markdownToDocxParagraphs(input);
      expect(paragraphs.length).toBeGreaterThan(0);
      const xml = await paragraphsToXml(paragraphs);
      const xmlEncoded = input.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      expect(xml).toContain(xmlEncoded);
    }
  });
});

// ── Integration test: DOCX export handler integration (v2) ───────────────────
describe('DOCX export handler integration (v2)', () => {
  it('renders mixed Markdown: recognized markers converted, deferred markers pass through, backward-compatible', async () => {
    const mixedMarkdown = [
      '# Document Title',
      '',
      '## Introduction',
      '',
      'This is a **bold** statement and an *italic* phrase.',
      '',
      '### Section One',
      '',
      '***Bold and italic*** combined.',
      '',
      '---',
      '',
      '#### Subsection A',
      '',
      'Plain paragraph with no formatting.',
      '',
      '- supported list item',
      '',
      '[deferred link](https://example.com)',
    ].join('\n');
    const children = markdownToDocxParagraphs(mixedMarkdown);
    const xml = await childrenToXml(children);
    // Recognized Markdown control markers must NOT appear as literal text
    expect(xml).not.toContain('# Document Title');
    expect(xml).not.toContain('## Introduction');
    expect(xml).not.toContain('### Section One');
    expect(xml).not.toContain('#### Subsection A');
    expect(xml).not.toContain('**bold**');
    expect(xml).not.toContain('*italic*');
    expect(xml).not.toContain('***Bold and italic***');
    // The standalone --- becomes a border paragraph
    expect(xml).toContain('w:pBdr');
    // Recognized content text IS present
    expect(xml).toContain('Document Title');
    expect(xml).toContain('Introduction');
    expect(xml).toContain('Section One');
    expect(xml).toContain('Subsection A');
    expect(xml).toContain('bold');
    expect(xml).toContain('italic');
    expect(xml).toContain('Bold and italic');
    expect(xml).toContain('Plain paragraph with no formatting.');
    // v2 heading mapping: # -> Heading1, ## -> Heading2, ### -> Heading3, #### -> Heading4
    expect(xml).toContain('Heading1');
    expect(xml).toContain('Heading2');
    expect(xml).toContain('Heading3');
    expect(xml).toContain('Heading4');
    // Bold and italic markup present
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    // List item content present (v2 supported)
    expect(xml).toContain('supported list item');
    // Deferred Markdown markers DO appear as literal text
    expect(xml).toContain('[deferred link](https://example.com)');
  });

  it('backward compatibility: plain-text document with no Markdown syntax exports successfully', async () => {
    const plainText = [
      'LAST WILL AND TESTAMENT',
      '',
      'I, John Smith, being of sound mind, hereby declare this to be my last will.',
      '',
      'ARTICLE I: REVOCATION',
      '',
      'I revoke all prior wills and codicils.',
    ].join('\n');
    expect(() => markdownToDocxParagraphs(plainText)).not.toThrow();
    const children = markdownToDocxParagraphs(plainText);
    expect(children.length).toBeGreaterThan(0);
    const xml = await childrenToXml(children);
    expect(xml).toContain('LAST WILL AND TESTAMENT');
    expect(xml).toContain('John Smith');
    expect(xml).toContain('ARTICLE I: REVOCATION');
    // No heading styles applied (no # markers in plain text)
    expect(xml).not.toContain('Heading1');
    expect(xml).not.toContain('Heading2');
    expect(xml).not.toContain('Heading3');
  });
});
