/**
 * mr_export_format_3.test.ts
 *
 * MR-EXPORT-FORMAT-3 — Satterwhite Formal Document Formatting Specification (v4).
 *
 * Tests:
 *   T-EF3-1:  Exact page setup constants (12240x15840, margins 1440, offsets 708)
 *   T-EF3-2:  Body charcoal 404040 (not pure black)
 *   T-EF3-3:  Two-paragraph section-header pattern (heading + gold rule)
 *   T-EF3-4:  Bold heading normalization (** markers stripped, no artifacts)
 *   T-EF3-5:  Body paragraph line spacing 276 auto, after 180
 *   T-EF3-6:  Table uses WidthType.DXA 9360, ShadingType.CLEAR, cccccc borders
 *   T-EF3-7:  Signature line uses d9d9d9 bottom border, right indent 4680
 *   T-EF3-8:  Running footer uses SimpleField PAGE (not PageNumber.CURRENT)
 *   T-EF3-9:  Running header is right-aligned Calibri italic 8pt navy
 *   T-EF3-10: Cover page generated for fiduciary instruments
 *   T-EF3-11: Full-content preservation (no block/line count limit)
 *   T-EF3-12: Watermark text overrides header, red bold
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer, Paragraph } from 'docx';
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
    `mr_ef3_test_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`,
  );
  writeFileSync(tmpPath, buffer);
  return execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
}

/**
 * Render a buildSatterwhiteSection result into a Document and extract
 * word/document.xml, header1.xml, and footer1.xml as strings.
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
    `mr_ef3_section_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`,
  );
  writeFileSync(tmpPath, buffer);
  const documentXml = execSync(`unzip -p "${tmpPath}" word/document.xml`).toString();
  let headerXml = '';
  let footerXml = '';
  // Cross-platform: plain `unzip -p` (the part always exists for a full section). The previous
  // `2>/dev/null || echo ""` produced a literal `""` on Windows cmd.exe (the `2>/dev/null` redirect is
  // invalid there), making these assertions falsely red locally though green on Linux CI. A genuinely
  // missing part still throws → the catch yields ''.
  try {
    headerXml = execSync(`unzip -p "${tmpPath}" word/header1.xml`).toString();
  } catch {
    headerXml = '';
  }
  try {
    footerXml = execSync(`unzip -p "${tmpPath}" word/footer1.xml`).toString();
  } catch {
    footerXml = '';
  }
  return { documentXml, headerXml, footerXml };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MR-EXPORT-FORMAT-3 — Satterwhite Formal Document Formatting Specification (v4)', () => {

  // T-EF3-1: Exact page setup constants
  it('T-EF3-1: section properties include exact page size 12240x15840 and margins 1440', async () => {
    const section = buildSatterwhiteSection('# Test Document\n\nBody text.');
    // Verify the section properties object has the correct values
    expect(section.properties).toBeDefined();
    const props = section.properties as Record<string, unknown>;
    const page = props['page'] as Record<string, unknown> | undefined;
    expect(page).toBeDefined();
    const size = page?.['size'] as Record<string, unknown> | undefined;
    expect(size?.['width']).toBe(12240);
    expect(size?.['height']).toBe(15840);
    const margin = page?.['margin'] as Record<string, unknown> | undefined;
    expect(margin?.['top']).toBe(1440);
    expect(margin?.['right']).toBe(1440);
    expect(margin?.['bottom']).toBe(1440);
    expect(margin?.['left']).toBe(1440);
    expect(margin?.['header']).toBe(708);
    expect(margin?.['footer']).toBe(708);
  });

  // T-EF3-2: Body charcoal 404040
  it('T-EF3-2: body paragraphs use charcoal 404040 not pure black', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('This is a plain body paragraph with no special formatting.'),
    );
    // Body text should use 404040, not 000000
    expect(xml).toContain('404040');
    expect(xml).not.toMatch(/<w:color w:val="000000"/);
  });

  // T-EF3-3: Two-paragraph section-header pattern
  it('T-EF3-3: article headings produce two-paragraph pattern (heading + gold rule bf8f00)', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('ARTICLE I — TRUST NAME AND DECLARATION\n\nBody text follows.'),
    );
    // Should contain the navy color for heading text
    expect(xml).toContain('1f3864');
    // Should contain the gold color for the rule paragraph
    expect(xml).toContain('bf8f00');
  });

  // T-EF3-3b: Explicit # heading also produces two-paragraph pattern
  it('T-EF3-3b: explicit # heading produces two-paragraph pattern with gold rule', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('# POWERS OF ATTORNEY\n\nBody text follows.'),
    );
    expect(xml).toContain('1f3864');
    expect(xml).toContain('bf8f00');
  });

  // T-EF3-4: Bold heading normalization
  it('T-EF3-4: ** markers stripped from headings — no literal asterisks in output', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('**ARTICLE II — POWERS GRANTED**\n\nBody text.'),
    );
    // The rendered text should not contain literal ** characters
    expect(xml).not.toContain('**ARTICLE');
    expect(xml).not.toContain('**');
    // Should still render as a section header with navy
    expect(xml).toContain('1f3864');
  });

  // T-EF3-5: Body paragraph line spacing 276 auto, after 180
  it('T-EF3-5: body paragraphs have line spacing 276 auto and after 180', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('This is a body paragraph that should have correct spacing.'),
    );
    // Line spacing 276
    expect(xml).toContain('276');
    // Spacing after 180
    expect(xml).toContain('180');
  });

  // T-EF3-6: Table uses WidthType.DXA 9360, ShadingType.CLEAR, cccccc borders
  it('T-EF3-6: table uses DXA width 9360, CLEAR shading, and cccccc borders', async () => {
    const tableMarkdown = `| Column A | Column B | Column C |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |`;
    const xml = await childrenToXml(markdownToDocxParagraphs(tableMarkdown));
    // Table width 9360 DXA
    expect(xml).toContain('9360');
    // Border color cccccc
    expect(xml).toContain('cccccc');
    // Navy header fill 1f3864
    expect(xml).toContain('1f3864');
    // Alternating row shade f2f2f2
    expect(xml).toContain('f2f2f2');
    // Should NOT use w:val="solid" shading type (must be clear)
    expect(xml).not.toMatch(/w:val="solid"/);
  });

  // T-EF3-7: Signature line uses d9d9d9 bottom border, right indent 4680
  it('T-EF3-7: signature line underscores produce d9d9d9 bottom border and right indent 4680', async () => {
    const xml = await childrenToXml(
      markdownToDocxParagraphs('______________________________\n\nPRINCIPAL:'),
    );
    // Signature line gray d9d9d9
    expect(xml).toContain('d9d9d9');
    // Right indent 4680
    expect(xml).toContain('4680');
  });

  // T-EF3-8: Running footer uses SimpleField PAGE
  it('T-EF3-8: running footer contains SimpleField PAGE instruction', async () => {
    const { footerXml } = await sectionToXml('# Test Document\n\nBody text.');
    // SimpleField PAGE renders as w:fldChar or w:instrText PAGE in the XML
    const combinedXml = footerXml;
    expect(combinedXml).toMatch(/PAGE|fldChar|instrText/);
    // Should contain firm text
    expect(combinedXml).toContain('Satterwhite');
  });

  // T-EF3-9: Running header is right-aligned Calibri italic 8pt navy
  it('T-EF3-9: running header is right-aligned and contains navy color 1f3864', async () => {
    const { headerXml } = await sectionToXml('DURABLE POWER OF ATTORNEY\n\nBody text.');
    // Header should contain navy color
    expect(headerXml).toContain('1f3864');
    // Header should contain right alignment
    expect(headerXml).toMatch(/jc.*right|right.*jc/);
  });

  // T-EF3-10: Cover page for fiduciary instruments
  it('T-EF3-10: fiduciary instrument generates cover page with CONFIDENTIAL and firm name', async () => {
    const trustMarkdown = `VIRGINIA REVOCABLE LIVING TRUST AGREEMENT

ARTICLE I — TRUST NAME AND DECLARATION

This trust is established by [[CLIENT NAME]], Settlor.`;
    const { documentXml } = await sectionToXml(trustMarkdown);
    // Cover page should include CONFIDENTIAL
    expect(documentXml).toContain('CONFIDENTIAL');
    // Cover page should include firm name
    expect(documentXml).toContain('SATTERWHITE');
  });

  // T-EF3-10b: Non-fiduciary documents do NOT get a cover page
  it('T-EF3-10b: non-fiduciary document does not generate cover page content', async () => {
    const deedMarkdown = `DEED OF TRUST

This Deed of Trust is made between the parties.`;
    const { documentXml } = await sectionToXml(deedMarkdown);
    // Should NOT contain the cover page firm block (which is only on cover pages)
    // The document body may still contain firm text in the footer, but not in the body
    // We verify no "Prepared by:" cover caption appears in document body
    expect(documentXml).not.toContain('Prepared by:');
  });

  // T-EF3-11: Full-content preservation
  it('T-EF3-11: renderer preserves all content blocks without truncation', async () => {
    // Generate a long document with 200 paragraphs
    const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: This is body text for paragraph number ${i + 1} in the document.`);
    const longMarkdown = paragraphs.join('\n\n');
    const children = markdownToDocxParagraphs(longMarkdown);
    // All 200 paragraphs should be rendered
    expect(children.length).toBe(200);
  });

  // T-EF3-12: Watermark text overrides header
  it('T-EF3-12: watermarkText option overrides running header with red bold text', async () => {
    const { headerXml } = await sectionToXml(
      '# Test Document\n\nBody text.',
      { watermarkText: 'DRAFT — NOT FOR EXECUTION' },
    );
    // Watermark text should appear in header
    expect(headerXml).toContain('DRAFT');
    // Watermark should use red color c00000
    expect(headerXml).toContain('c00000');
  });

  // T-EF3-12b: No watermark — default header uses document title
  it('T-EF3-12b: without watermark, header contains document title', async () => {
    const { headerXml } = await sectionToXml(
      'DURABLE POWER OF ATTORNEY\n\nBody text.',
    );
    // Header should contain the document title text
    expect(headerXml).toContain('DURABLE POWER OF ATTORNEY');
  });

});
