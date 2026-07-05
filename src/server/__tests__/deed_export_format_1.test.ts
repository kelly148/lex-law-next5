/**
 * DEED-EXPORT-FORMAT-1 — the recordable deed DOCX renderer is a PLAIN, BLACK-ONLY, recordable instrument with
 * NO firm branding and NO product colors. The invariants here are the regression guard the dispatch requires:
 *   - zero non-black colors anywhere (body + header + footer + styles);
 *   - zero "Satterwhite Law Firm" branding + zero product colors/phone anywhere;
 *   - centered bold title, centered "Witnesseth, that:", two-column caption, footer trio, full return-to block,
 *     bold + surname-underlined party names.
 * Synthetic content only (the Ellison fixture family; no real client data). CI (Linux) is authoritative for the
 * `unzip` shell-out (a local-Windows unzip-on-cmd failure is a harness artifact, not an engine defect).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, readdirSync, readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Document, Packer } from 'docx';
import { buildRecordableDeedSection, RECORDABLE_DEED_STYLES } from '../utils/recordableDeedFormatter.js';

// A synthetic gift deed content string that mirrors the assembler's plain-text structure (paragraphs joined by
// blank lines). Names are the synthetic Ellison fixture family — never real client data.
const SYNTHETIC_DEED = [
  'Exempt from recordation tax pursuant to Va. Code § 58.1-811(D), 1950 Code of Virginia, as amended.',
  'Prepared by: Kelly Satterwhite, Esq. (VSB #91049), The Mason Law Firm, PLC.',
  ["File Number: 36-2026-7777", "Grantee's Address: 123 Cedar Run Lane, Manassas, Virginia 20109", 'Tax I.D. Number: 12-345-6789', 'Assessed Value: $250,000.00', 'Consideration: $0.00'].join('\n'),
  'THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION — NO TITLE INSURANCE.',
  'DEED OF GIFT',
  'THIS DEED OF GIFT, made this ___ day of ____________, 20___, by and between Marcus T. Ellison and Priya Ellison, husband and wife, (the "Grantors"), and Hannah R. Ellison, the Grantors\' daughter, (the "Grantee"),',
  'WITNESSETH:',
  'That for and in consideration of good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantors do hereby grant and convey, with Special Warranty, unto the said Grantee, in fee simple, as joint tenants with the right of survivorship, all of the following described real property, together with the improvements thereon and the appurtenances thereunto belonging, located in Prince William County, Commonwealth of Virginia, to wit:',
  'Lot 12, Section 3, CEDAR RUN ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  'For derivation of title see Deed recorded in Deed Book 5500 at Page 12.',
  'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record, to the extent the same lawfully apply.',
  'WITNESS the following signature(s) and seal(s):',
  '_______________________________ (SEAL)\nMarcus T. Ellison',
  '_______________________________ (SEAL)\nPriya Ellison',
  'COMMONWEALTH OF VIRGINIA\nCITY/COUNTY OF ____________________, to-wit:',
  'The foregoing instrument was acknowledged before me this ___ day of ____________, 20___, by Marcus T. Ellison and Priya Ellison.',
  'My commission expires: ____________________\n_______________________________\nNotary Public',
  'After recording, return to: Universal Title.',
].join('\n\n');

let ALL_XML = '';
let DOCUMENT_XML = '';
let FOOTER_XML = '';

async function renderAndUnzip(content: string, watermark: string | null): Promise<Record<string, string>> {
  const section = buildRecordableDeedSection(content, { watermarkText: watermark });
  const buffer = await Packer.toBuffer(new Document({ sections: [section], styles: RECORDABLE_DEED_STYLES }));
  const dir = mkdtempSync(join(tmpdir(), 'deed_export_'));
  const docxPath = join(dir, 'd.docx');
  writeFileSync(docxPath, buffer);
  execSync(`unzip -o -q "${docxPath}" -d "${join(dir, 'unz')}"`);
  const wordDir = join(dir, 'unz', 'word');
  const out: Record<string, string> = {};
  for (const f of readdirSync(wordDir)) {
    if (f.endsWith('.xml')) out[f] = readFileSync(join(wordDir, f), 'utf-8');
  }
  return out;
}

beforeAll(async () => {
  const parts = await renderAndUnzip(SYNTHETIC_DEED, 'DRAFT — NOT FINAL');
  DOCUMENT_XML = parts['document.xml'] ?? '';
  FOOTER_XML = Object.entries(parts).filter(([k]) => k.startsWith('footer')).map(([, v]) => v).join('\n');
  ALL_XML = Object.values(parts).join('\n');
});

describe('DEED-EXPORT-FORMAT-1 — no color / no branding (the regression invariants)', () => {
  it('contains ZERO non-black color runs anywhere (body + header + footer + styles)', () => {
    const colors = [...ALL_XML.matchAll(/w:color\s+w:val="([0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toLowerCase());
    const nonBlack = [...new Set(colors)].filter((c) => c !== '000000');
    expect(nonBlack).toEqual([]);
  });

  it('carries NONE of the product colors (firm navy / draft red / body charcoal / Word blues)', () => {
    for (const c of ['1f3864', 'c00000', '404040', '0563c1', '1f4d78', '2e74b5', 'bf8f00']) {
      expect(ALL_XML.toLowerCase()).not.toContain(c);
    }
  });

  it('carries NO Satterwhite firm branding or firm phone anywhere', () => {
    expect(ALL_XML).not.toMatch(/Satterwhite Law Firm/i);
    expect(ALL_XML).not.toMatch(/Satterwhite,\s*PLLC/i);
    expect(ALL_XML).not.toContain('855-7380');
  });

  it('the renderer-added header + footer carry NO firm name at all', () => {
    expect(FOOTER_XML).not.toMatch(/Satterwhite/i);
    expect(FOOTER_XML).not.toMatch(/Mason Law Firm/i);
  });
});

describe('DEED-EXPORT-FORMAT-1 — recordable layout', () => {
  it('title is CENTERED + BOLD', () => {
    // The title run is bold, and a center-justified paragraph exists carrying it.
    expect(DOCUMENT_XML).toContain('DEED OF GIFT');
    expect(DOCUMENT_XML).toMatch(/w:jc\s+w:val="center"/);
    expect(DOCUMENT_XML).toContain('<w:b/>');
  });

  it('"Witnesseth, that:" is present (house wording), centered', () => {
    expect(DOCUMENT_XML).toContain('Witnesseth, that:');
  });

  it('body is JUSTIFIED (the operative/recital paragraphs)', () => {
    expect(DOCUMENT_XML).toMatch(/w:jc\s+w:val="(both|distribute)"/);
  });

  it('two-column caption: labels are bold and tabbed', () => {
    expect(DOCUMENT_XML).toContain('File Number:');
    expect(DOCUMENT_XML).toMatch(/<w:tab\b/);
  });

  it('party surnames are BOLD + UNDERLINED in the recital', () => {
    // The recital renders the grantor/grantee names bold; a surname carries an underline run.
    expect(DOCUMENT_XML).toContain('Ellison');
    expect(DOCUMENT_XML).toMatch(/<w:u\b/); // an underline appears (surname)
  });

  it('footer trio: File No. + VA – DEED OF GIFT + Page X of Y', () => {
    expect(FOOTER_XML).toContain('File No.: 36-2026-7777');
    expect(FOOTER_XML).toMatch(/VA . DEED OF GIFT/);
    expect(FOOTER_XML).toContain('Page ');
    expect(FOOTER_XML).toMatch(/PAGE|NUMPAGES/); // the PageNumber field
  });

  it('full return-to block (Universal Title + address)', () => {
    expect(DOCUMENT_XML).toContain('After recording return to:');
    expect(DOCUMENT_XML).toContain('Universal Title');
    expect(DOCUMENT_XML).toContain('Falls Church, VA 22042');
    expect(DOCUMENT_XML).toContain('(703) 354-2100');
  });

  it('notary block includes the registration + commission lines', () => {
    expect(DOCUMENT_XML).toMatch(/Notary Public(&apos;|')s signature/); // apostrophe is XML-escaped in the part
    expect(DOCUMENT_XML).toContain('Notary registration number:');
    expect(DOCUMENT_XML).toContain('My commission expires:');
  });

  it('a finalized export (no watermark) produces no header', async () => {
    const parts = await renderAndUnzip(SYNTHETIC_DEED, null);
    const headerParts = Object.keys(parts).filter((k) => k.startsWith('header'));
    expect(headerParts).toEqual([]);
  });
});
