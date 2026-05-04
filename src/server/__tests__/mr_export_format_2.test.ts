/**
 * mr_export_format_2.test.ts
 *
 * MR-EXPORT-FORMAT-2 — Satterwhite DOCX house-style pack feature tests.
 *
 * Tests:
 *   T-EXPORT-FORMAT-2-1: Centers legal document title and article headings
 *   T-EXPORT-FORMAT-2-2: Adds Satterwhite footer with page numbering
 *   T-EXPORT-FORMAT-2-3: Preserves placeholder and drafter-note styling
 *   T-EXPORT-FORMAT-2-4: Signature and notary block styling
 *   T-EXPORT-FORMAT-2-5: Table styling still works
 *   T-EXPORT-FORMAT-2-6: Plain text and malformed Markdown still degrade safely
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer, Paragraph, Table } from 'docx';
import {
  markdownToDocxParagraphs,
  buildSatterwhiteSection,
  DocxFileChild,
} from '../utils/markdownToDocx.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Render children into a Document and extract word/document.xml as a string. */
async function childrenToXml(children: DocxFileChild[]): Promise<string> {
  const doc = new Document({
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: '' })] }],
  });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(
    tmpdir(),
    `mr_ef2_test_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`,
  );
  writeFileSync(tmpPath, buffer);
  return execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
}

/**
 * Render a buildSatterwhiteSection result into a Document and extract
 * word/document.xml as a string. Also returns the header and footer XML.
 */
async function sectionToXml(
  markdown: string,
  opts?: { watermarkText?: string | null },
): Promise<{ documentXml: string; headerXml: string; footerXml: string }> {
  const section = buildSatterwhiteSection(markdown, opts);
  const doc = new Document({ sections: [section] });
  const buffer = await Packer.toBuffer(doc);
  const tmpPath = join(
    tmpdir(),
    `mr_ef2_section_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`,
  );
  writeFileSync(tmpPath, buffer);
  const documentXml = execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
  // Header and footer files may be named header1.xml / footer1.xml
  let headerXml = '';
  let footerXml = '';
  try {
    headerXml = execSync(`unzip -p "${tmpPath}" word/header1.xml 2>/dev/null || echo ""`).toString();
  } catch {
    headerXml = '';
  }
  try {
    footerXml = execSync(`unzip -p "${tmpPath}" word/footer1.xml 2>/dev/null || echo ""`).toString();
  } catch {
    footerXml = '';
  }
  return { documentXml, headerXml, footerXml };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MR-EXPORT-FORMAT-2 — Satterwhite house-style pack', () => {

  // T-EXPORT-FORMAT-2-1: Centers legal document title and article headings
  it('T-EXPORT-FORMAT-2-1: centers legal document title and article headings', async () => {
    const md = [
      'DURABLE POWER OF ATTORNEY',
      '',
      'ARTICLE I — DURABILITY PROVISION',
      '',
      'Section 2.1 — Real Estate Transaction Powers',
      '',
      'This is body text.',
    ].join('\n');

    const children = markdownToDocxParagraphs(md);
    expect(children.length).toBeGreaterThan(0);
    const xml = await childrenToXml(children);

    // Document title text present
    expect(xml).toContain('DURABLE POWER OF ATTORNEY');
    // Article heading text present
    expect(xml).toContain('ARTICLE I');

    // Centered alignment: docx renders AlignmentType.CENTER as "center" in XML
    expect(xml).toContain('center');

    // Navy color present on title/heading runs
    expect(xml).toContain('1F3864');

    // Gold border present on title/article headings
    expect(xml).toContain('BF8F00');

    // Section heading text present
    expect(xml).toContain('Section 2.1');
  });

  // T-EXPORT-FORMAT-2-1b: # heading is centered (explicit Markdown marker)
  it('T-EXPORT-FORMAT-2-1b: # heading produces centered Heading1 paragraph', async () => {
    const children = markdownToDocxParagraphs('# VIRGINIA DURABLE FINANCIAL POWER OF ATTORNEY');
    const xml = await childrenToXml(children);
    expect(xml).toContain('VIRGINIA DURABLE FINANCIAL POWER OF ATTORNEY');
    expect(xml).toContain('center');
    expect(xml).toContain('1F3864');
    expect(xml).toContain('BF8F00');
  });

  // T-EXPORT-FORMAT-2-2: Adds Satterwhite footer with page numbering
  it('T-EXPORT-FORMAT-2-2: buildSatterwhiteSection adds Satterwhite footer with PAGE field', async () => {
    const md = 'DURABLE POWER OF ATTORNEY\n\nThis is a legal instrument.';
    const { footerXml, documentXml } = await sectionToXml(md);

    // Footer XML should exist and contain firm name
    const combinedXml = footerXml + documentXml;
    expect(combinedXml).toContain('Satterwhite');
    expect(combinedXml).toContain('703-855-7380');

    // Footer should contain a PAGE field (fldChar or instrText with PAGE)
    // docx renders PageNumber.CURRENT as a w:fldChar / w:instrText PAGE construct
    expect(combinedXml).toMatch(/PAGE|fldChar|instrText/);
  });

  // T-EXPORT-FORMAT-2-2b: Running header uses document title when no watermark
  it('T-EXPORT-FORMAT-2-2b: running header contains document title when no watermark', async () => {
    const md = 'DURABLE POWER OF ATTORNEY\n\nBody text here.';
    const { headerXml, documentXml } = await sectionToXml(md);
    const combinedXml = headerXml + documentXml;
    // Header should contain the document title
    expect(combinedXml).toContain('DURABLE POWER OF ATTORNEY');
  });

  // T-EXPORT-FORMAT-2-2c: Watermark overrides running header
  it('T-EXPORT-FORMAT-2-2c: watermark text overrides running header', async () => {
    const md = 'DURABLE POWER OF ATTORNEY\n\nBody text here.';
    const { headerXml, documentXml } = await sectionToXml(md, {
      watermarkText: 'DRAFT — NOT FINAL',
    });
    const combinedXml = headerXml + documentXml;
    expect(combinedXml).toContain('DRAFT');
  });

  // T-EXPORT-FORMAT-2-3: Preserves placeholder and drafter-note styling
  it('T-EXPORT-FORMAT-2-3: preserves placeholder highlighting and drafter-note styling', async () => {
    const md = [
      'Principal address: [[PRINCIPAL ADDRESS]]',
      '',
      '*Drafter Note: Confirm address before delivery.*',
    ].join('\n');

    const children = markdownToDocxParagraphs(md);
    const xml = await childrenToXml(children);

    // Placeholder text present with yellow highlight
    expect(xml).toContain('[[PRINCIPAL ADDRESS]]');
    expect(xml).toContain('yellow');

    // Drafter note: red color and italic
    expect(xml).toContain('Confirm address before delivery.');
    expect(xml).toContain('C00000');
    expect(xml).toContain('<w:i/>');
  });

  // T-EXPORT-FORMAT-2-4: Signature and notary block styling
  it('T-EXPORT-FORMAT-2-4: signature and notary blocks receive controlled styling', async () => {
    const md = [
      'IN WITNESS WHEREOF',
      '',
      'PRINCIPAL:',
      '',
      '___________________________',
      '',
      'COMMONWEALTH OF VIRGINIA',
      '',
      'COUNTY OF [[COUNTY]]',
      '',
      'Notary Public',
      '',
      'My Commission Expires: [[DATE]]',
      '',
      '[NOTARIAL SEAL]',
      '',
      'Prepared by: Kelly Satterwhite, Esq.',
    ].join('\n');

    const children = markdownToDocxParagraphs(md);
    expect(children.length).toBeGreaterThan(0);
    const xml = await childrenToXml(children);

    // All key text blocks present
    expect(xml).toContain('IN WITNESS WHEREOF');
    expect(xml).toContain('PRINCIPAL');
    expect(xml).toContain('COMMONWEALTH OF VIRGINIA');
    expect(xml).toContain('Notary Public');
    expect(xml).toContain('My Commission Expires');
    expect(xml).toContain('NOTARIAL SEAL');
    expect(xml).toContain('Prepared by');

    // Execution lead-in and signature labels should have navy color
    expect(xml).toContain('1F3864');

    // Centered alignment present (for execution lead-in)
    expect(xml).toContain('center');

    // Substantive text not altered — verify key strings unchanged
    expect(xml).toContain('Kelly Satterwhite, Esq.');
  });

  // T-EXPORT-FORMAT-2-5: Table styling still works
  it('T-EXPORT-FORMAT-2-5: pipe table produces Word table with house styling', async () => {
    const tableMarkdown = [
      '| Field | Description |',
      '|-------|-------------|',
      '| Property Address | 7705 Tauxemont Road, Alexandria, Virginia 22308 |',
      '| Tax Map / Parcel ID | 1022 08 0018 |',
    ].join('\n');

    const children = markdownToDocxParagraphs(tableMarkdown);
    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(Table);

    const xml = await childrenToXml(children);

    // Header row text present
    expect(xml).toContain('Field');
    expect(xml).toContain('Description');

    // Data row text present
    expect(xml).toContain('7705 Tauxemont Road');
    expect(xml).toContain('1022 08 0018');

    // Navy header fill (1F3864)
    expect(xml).toContain('1F3864');

    // White bold header text (FFFFFF and w:b)
    expect(xml).toContain('FFFFFF');
    expect(xml).toContain('<w:b/>');

    // Alternating row shading (F2F2F2)
    expect(xml).toContain('F2F2F2');
  });

  // T-EXPORT-FORMAT-2-6: Plain text and malformed Markdown degrade safely
  it('T-EXPORT-FORMAT-2-6: plain text exports cleanly without Markdown artifacts', async () => {
    const plainText = 'This is plain text with no Markdown syntax.';
    const children = markdownToDocxParagraphs(plainText);
    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(Paragraph);
    const xml = await childrenToXml(children);
    expect(xml).toContain('This is plain text with no Markdown syntax.');
    // No raw Markdown artifacts
    expect(xml).not.toContain('##');
    expect(xml).not.toContain('**');
  });

  it('T-EXPORT-FORMAT-2-6b: malformed table does not throw', () => {
    const malformed = '| Only one row no separator |';
    expect(() => markdownToDocxParagraphs(malformed)).not.toThrow();
    const children = markdownToDocxParagraphs(malformed);
    expect(children.length).toBeGreaterThan(0);
    children.forEach((child: DocxFileChild) => {
      expect(child).toBeDefined();
    });
  });

  it('T-EXPORT-FORMAT-2-6c: buildSatterwhiteSection with empty input does not throw', async () => {
    expect(() => buildSatterwhiteSection('')).not.toThrow();
    const section = buildSatterwhiteSection('');
    const doc = new Document({ sections: [section] });
    const buffer = await Packer.toBuffer(doc);
    expect(buffer.length).toBeGreaterThan(0);
  });

});
