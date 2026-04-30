/**
 * markdownToDocx.test.ts
 *
 * MR-EXPORT-1 — Unit tests (T1–T12) and DOCX export handler integration test
 * for the markdownToDocxParagraphs helper.
 *
 * Testing strategy (per §3.6 step 6):
 *   Unit tests (T1–T12): Use Packer.toBuffer() + unzip + XML inspection to
 *   verify that the generated DOCX document.xml contains the expected Word
 *   paragraph style markers (e.g., <w:pStyle w:val="Heading1"/>) and run
 *   properties (e.g., <w:b/> for bold). This approach is stable and does not
 *   rely on undocumented private fields of docx objects.
 *
 *   Integration test: Renders a mixed-Markdown document through the helper,
 *   generates a DOCX buffer, and inspects the XML to verify:
 *     - Recognized Markdown control markers do NOT appear as literal text.
 *     - Deferred Markdown markers DO appear as literal text.
 *     - Backward compatibility: plain-text content exports successfully.
 *
 * Integration test location decision (per §3.6 step 5):
 *   No handler-level test file exists for src/server/index.ts. The integration
 *   test is placed in this file under describe('DOCX export handler integration')
 *   per the §3.6 step 5 default decision. This keeps all test surface area
 *   inside the §3.1 allowlist.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer, Paragraph } from 'docx';
import { markdownToDocxParagraphs } from '../utils/markdownToDocx.js';

// ── Helper: generate DOCX XML from paragraphs ────────────────────────────────

/**
 * Render an array of Paragraphs into a DOCX buffer and return the
 * word/document.xml content as a string for inspection.
 */
async function paragraphsToXml(paragraphs: Paragraph[]): Promise<string> {
  const doc = new Document({
    sections: [{ children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })] }],
  });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(tmpdir(), `mr_export_1_test_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
  writeFileSync(tmpPath, buffer);
  const xml = execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
  return xml;
}

// ── Unit tests: T1–T12 ───────────────────────────────────────────────────────

describe('markdownToDocxParagraphs — unit tests', () => {
  // T1: ## Section Title → HeadingLevel.HEADING_1
  it('T1: ## heading produces Paragraph with Heading1 style', async () => {
    const paragraphs = markdownToDocxParagraphs('## Section Title');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading1');
    expect(xml).toContain('Section Title');
  });

  // T2: ### Subsection Title → HeadingLevel.HEADING_2
  it('T2: ### heading produces Paragraph with Heading2 style', async () => {
    const paragraphs = markdownToDocxParagraphs('### Subsection Title');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading2');
    expect(xml).toContain('Subsection Title');
  });

  // T3: #### Sub-subsection Title → HeadingLevel.HEADING_3
  it('T3: #### heading produces Paragraph with Heading3 style', async () => {
    const paragraphs = markdownToDocxParagraphs('#### Sub-subsection Title');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('Heading3');
    expect(xml).toContain('Sub-subsection Title');
  });

  // T4: **bold** → TextRun with bold: true
  it('T4: **bold** produces TextRun with bold property', async () => {
    const paragraphs = markdownToDocxParagraphs('**bold text**');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    // Word XML uses <w:b/> for bold
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('bold text');
    // The ** markers themselves must NOT appear as literal text
    expect(xml).not.toContain('**bold text**');
  });

  // T5: *italic* → TextRun with italics: true
  it('T5: *italic* produces TextRun with italics property', async () => {
    const paragraphs = markdownToDocxParagraphs('*italic text*');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    // Word XML uses <w:i/> for italics
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('italic text');
    expect(xml).not.toContain('*italic text*');
  });

  // T6: ***bold-italic*** → TextRun with bold: true AND italics: true
  it('T6: ***bold-italic*** produces TextRun with both bold and italics', async () => {
    const paragraphs = markdownToDocxParagraphs('***bold and italic***');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('bold and italic');
    expect(xml).not.toContain('***bold and italic***');
  });

  // T7: --- on its own line → Paragraph with bottom border
  it('T7: --- produces Paragraph with bottom border', async () => {
    const paragraphs = markdownToDocxParagraphs('---');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    // Word XML uses <w:pBdr> for paragraph borders; bottom border present
    expect(xml).toContain('w:pBdr');
    expect(xml).toContain('w:bottom');
  });

  // T8: Plain paragraph (no Markdown syntax) → Paragraph with single TextRun
  it('T8: plain paragraph produces Paragraph with single TextRun', async () => {
    const paragraphs = markdownToDocxParagraphs('This is plain text.');
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('This is plain text.');
    // No heading styles
    expect(xml).not.toContain('Heading1');
    expect(xml).not.toContain('Heading2');
    expect(xml).not.toContain('Heading3');
  });

  // T9: Mixed input → exactly four Paragraphs in expected order
  it('T9: mixed input produces exactly four Paragraphs in expected order', async () => {
    const input = [
      '## Top Heading',
      '**bold line**',
      '*italic line*',
      'plain line',
    ].join('\n\n');
    const paragraphs = markdownToDocxParagraphs(input);
    expect(paragraphs).toHaveLength(4);
    const xml = await paragraphsToXml(paragraphs);
    // Paragraph 1: heading
    expect(xml).toContain('Heading1');
    expect(xml).toContain('Top Heading');
    // Paragraph 2: bold
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('bold line');
    // Paragraph 3: italic
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('italic line');
    // Paragraph 4: plain
    expect(xml).toContain('plain line');
  });

  // T10: Empty input → empty Paragraph array
  it('T10: empty input produces empty Paragraph array', () => {
    expect(markdownToDocxParagraphs('')).toHaveLength(0);
    expect(markdownToDocxParagraphs('   ')).toHaveLength(0);
    expect(markdownToDocxParagraphs('\n\n\n')).toHaveLength(0);
  });

  // T11: Unmatched single asterisks do NOT break parsing; render as literal text
  it('T11: unmatched single asterisks render as literal text without throwing', async () => {
    const input = '5 * 3 = 15';
    expect(() => markdownToDocxParagraphs(input)).not.toThrow();
    const paragraphs = markdownToDocxParagraphs(input);
    expect(paragraphs).toHaveLength(1);
    const xml = await paragraphsToXml(paragraphs);
    expect(xml).toContain('5 * 3 = 15');
    // No italic markup should be applied
    expect(xml).not.toContain('<w:i/>');
  });

  // T12: Deferred Markdown renders as literal plain text without throwing
  it('T12: deferred Markdown renders as literal plain text without throwing', async () => {
    const inputs = [
      '- list item',
      '[link](https://example.com)',
      '`inline code`',
      '# Single hash heading',
      '> blockquote',
    ];
    for (const input of inputs) {
      expect(() => markdownToDocxParagraphs(input)).not.toThrow();
      const paragraphs = markdownToDocxParagraphs(input);
      expect(paragraphs.length).toBeGreaterThan(0);
      const xml = await paragraphsToXml(paragraphs);
      // Content appears as literal text.
      // Note: XML encodes special characters — '>' becomes '&gt;' in XML text nodes.
      const xmlEncoded = input.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      expect(xml).toContain(xmlEncoded);
      // No heading styles applied
      expect(xml).not.toContain('Heading1');
      expect(xml).not.toContain('Heading2');
      expect(xml).not.toContain('Heading3');
    }
  });
});

// ── Integration test: DOCX export handler integration ────────────────────────

describe('DOCX export handler integration', () => {
  it('renders mixed Markdown: recognized markers absent as literals, deferred markers present as literals, plain text backward-compatible', async () => {
    // Mixed Markdown content simulating a finalized document
    const mixedMarkdown = [
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
      '- deferred list item',
      '',
      '[deferred link](https://example.com)',
    ].join('\n');

    const paragraphs = markdownToDocxParagraphs(mixedMarkdown);
    const xml = await paragraphsToXml(paragraphs);

    // Recognized Markdown control markers must NOT appear as literal text
    // (they should have been converted to Word formatting)
    expect(xml).not.toContain('## Introduction');
    expect(xml).not.toContain('### Section One');
    expect(xml).not.toContain('#### Subsection A');
    expect(xml).not.toContain('**bold**');
    expect(xml).not.toContain('*italic*');
    expect(xml).not.toContain('***Bold and italic***');
    // The standalone --- should not appear as literal text
    // (it becomes a border paragraph with no text content)
    // We verify it by checking the border element is present
    expect(xml).toContain('w:pBdr');

    // Recognized content text IS present (as Word-formatted runs)
    expect(xml).toContain('Introduction');
    expect(xml).toContain('Section One');
    expect(xml).toContain('Subsection A');
    expect(xml).toContain('bold');
    expect(xml).toContain('italic');
    expect(xml).toContain('Bold and italic');
    expect(xml).toContain('Plain paragraph with no formatting.');

    // Heading styles applied
    expect(xml).toContain('Heading1');
    expect(xml).toContain('Heading2');
    expect(xml).toContain('Heading3');

    // Bold and italic markup present
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');

    // Deferred Markdown markers DO appear as literal text (pass-through)
    expect(xml).toContain('- deferred list item');
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
    const paragraphs = markdownToDocxParagraphs(plainText);
    expect(paragraphs.length).toBeGreaterThan(0);
    const xml = await paragraphsToXml(paragraphs);

    // Plain text content present
    expect(xml).toContain('LAST WILL AND TESTAMENT');
    expect(xml).toContain('John Smith');
    expect(xml).toContain('ARTICLE I: REVOCATION');

    // No heading styles applied (no ## markers in plain text)
    expect(xml).not.toContain('Heading1');
    expect(xml).not.toContain('Heading2');
    expect(xml).not.toContain('Heading3');
  });
});
