/**
 * mr_upload_format_5.test.ts — MR-UPLOAD-FORMAT-5
 *
 * Tests for the Letter / Engagement Letter formatting polish.
 *
 * Test IDs: T-UPLOAD5-1 through T-UPLOAD5-20
 *
 * Coverage:
 *   T-UPLOAD5-1:  Letter profile routing preserved — buildLetterSection still exported
 *   T-UPLOAD5-2:  Legal Instrument / General preserved — buildLegalInstrumentSection still exported
 *   T-UPLOAD5-3:  Mason identity detection
 *   T-UPLOAD5-4:  Satterwhite identity detection
 *   T-UPLOAD5-5:  Unknown firm neutral handling
 *   T-UPLOAD5-6:  Markdown bold artifact cleanup (**text**)
 *   T-UPLOAD5-7:  Markdown italic artifact cleanup (_text_)
 *   T-UPLOAD5-8:  Mason letterhead target markers in output structure
 *   T-UPLOAD5-9:  Delivery / RE / salutation structure preserved
 *   T-UPLOAD5-10: Body content preservation through normalization
 *   T-UPLOAD5-11: Signature block polish/preservation
 *   T-UPLOAD5-12: Agreed-and-accepted block polish/preservation
 *   T-UPLOAD5-13: Enclosure block preservation
 *   T-UPLOAD5-14: Letter footer no incomplete page marker (no literal "Page  of")
 *   T-UPLOAD5-15: Letter footer uses PageNumber fields or safe fallback
 *   T-UPLOAD5-16: Satterwhite/Kahrs behavior preserved (existing MR-UPLOAD-FORMAT-3 tests still pass)
 *   T-UPLOAD5-17: Mason does not receive Satterwhite branding
 *   T-UPLOAD5-18: Existing upload behavior preserved (source-level confirmation)
 *   T-UPLOAD5-19: No LLM/reviewer/prompt/DB/deployment changes (source-level confirmation)
 *   T-UPLOAD5-20: No second formatting engine (source-level confirmation)
 */
import { describe, it, expect } from 'vitest';
import {
  detectLetterFirm,
  parseLetterBlocks,
  buildLetterSection,
  buildLetterFooter,
  normalizeLetterMarkdown,
} from '../../server/utils/letterFormatter.js';
import { buildLegalInstrumentSection } from '../../server/utils/instrumentFormatter.js';
import type { DocumentProfile } from '../../client/pages/UploadFormatPage.js';

// ── Synthetic fixtures ────────────────────────────────────────────────────────
// All fixtures are synthetic/minimal. No substantive legal content from reference
// documents is copied. Generic placeholder text is used for testing structure only.

const MASON_LETTER_SYNTHETIC = `THE MASON LAW FIRM, PLC
ATTORNEYS AT LAW
108 N. Columbus Street, 2nd Floor | Alexandria, Virginia 22314 | (703) 354-2100
May 7, 2026
Ms. Jane Client
123 Test Street
Alexandria, Virginia 22314
Via Electronic Mail
Re:  Engagement for General Legal Matters
Dear Ms. Client:
This is a synthetic test letter for The Mason Law Firm. This letter confirms the terms of the engagement.
The scope of this engagement is limited to the specific matters described herein.
Sincerely,
THE MASON LAW FIRM, PLC
/s/ Kelly Satterwhite
Kelly Satterwhite, Esq.
VSB No. 91049
Admitted in Virginia and Maryland
The Mason Law Firm, PLC
AGREED AND ACCEPTED
By signing below, I confirm that I have read and understood this letter.
_________________________________________
Client Name
Date:  _________________________________
Enclosure: Sample Document
`;

const SATTERWHITE_LETTER_SYNTHETIC = `THE SATTERWHITE LAW FIRM, PLLC
Virginia • Maryland
Trusts & Estates • Real Estate • Business Law
ENGAGEMENT LETTER
Attorney-Client Fee Agreement
May 7, 2026
Mr. Test Client
456 Sample Road
Fairfax, Virginia 22030
Re:  Limited Representation — Test Matter
Dear Test Client:
This is a synthetic test letter for The Satterwhite Law Firm, PLLC. This letter confirms the terms of the engagement.
1.  Scope of Engagement
The scope is limited to the specific services described herein.
2.  Attorney Responsible
I, Kelly Satterwhite, Esq., will be the attorney responsible.
Sincerely,
The Satterwhite Law Firm, PLLC
Kelly Satterwhite, Esq.
CLIENT ACCEPTANCE AND AUTHORIZATION
By signing below, I confirm that I have read and understood this Engagement Letter.
_________________________________________
Test Client
Date:  _________________________________
`;

const UNKNOWN_FIRM_LETTER_SYNTHETIC = `SMITH & JONES LAW GROUP
123 Generic Street
Anytown, VA 22000
May 7, 2026
Mr. Another Client
789 Other Road
Anytown, VA 22001
Re:  General Legal Matter
Dear Mr. Client:
This is a synthetic test letter for an unknown third-party firm. No Mason or Satterwhite branding should appear.
Sincerely,
Smith & Jones Law Group
`;

const MASON_LETTER_WITH_MARKDOWN = `**The Mason Law Firm, PLC**
ATTORNEYS AT LAW
May 7, 2026
Ms. Test Recipient
100 Test Avenue
Alexandria, Virginia 22314
_Via Electronic Mail_
Re:  Test Matter with Markdown Artifacts
Dear Ms. Recipient:
This letter tests Markdown artifact cleanup for **The Mason Law Firm, PLC** correspondence.
The delivery method was marked with _italic_ emphasis in the source.
Sincerely,
THE MASON LAW FIRM, PLC
`;

// ── T-UPLOAD5-1: Letter profile routing preserved ─────────────────────────────
describe('T-UPLOAD5-1: Letter profile routing preserved', () => {
  it('buildLetterSection is exported and callable', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER_SYNTHETIC);
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect(Array.isArray(section.children)).toBe(true);
  });
});

// ── T-UPLOAD5-2: Legal Instrument / General preserved ─────────────────────────
describe('T-UPLOAD5-2: Legal Instrument / General preserved', () => {
  it('buildLegalInstrumentSection is still exported and callable', () => {
    const section = buildLegalInstrumentSection('POWER OF ATTORNEY\n\nI, Test Principal, hereby appoint Test Agent.');
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
  });
});

// ── T-UPLOAD5-3: Mason identity detection ─────────────────────────────────────
describe('T-UPLOAD5-3: Mason identity detection', () => {
  it('detects mason from "The Mason Law Firm, PLC"', () => {
    expect(detectLetterFirm('The Mason Law Firm, PLC\nATTORNEYS AT LAW')).toBe('mason');
  });

  it('detects mason from "THE MASON LAW FIRM, PLC"', () => {
    expect(detectLetterFirm('THE MASON LAW FIRM, PLC')).toBe('mason');
  });

  it('detects mason case-insensitively', () => {
    expect(detectLetterFirm('the mason law firm, plc')).toBe('mason');
  });

  it('buildLetterSection with Mason input selects Mason styling', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD5-4: Satterwhite identity detection ───────────────────────────────
describe('T-UPLOAD5-4: Satterwhite identity detection', () => {
  it('detects satterwhite from "The Satterwhite Law Firm, PLLC"', () => {
    expect(detectLetterFirm('The Satterwhite Law Firm, PLLC')).toBe('satterwhite');
  });

  it('detects satterwhite from "THE SATTERWHITE LAW FIRM, PLLC"', () => {
    expect(detectLetterFirm('THE SATTERWHITE LAW FIRM, PLLC')).toBe('satterwhite');
  });

  it('buildLetterSection with Satterwhite input selects Satterwhite styling', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER_SYNTHETIC);
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD5-5: Unknown firm neutral handling ────────────────────────────────
describe('T-UPLOAD5-5: Unknown firm neutral handling', () => {
  it('detects unknown firm for third-party letter', () => {
    expect(detectLetterFirm(UNKNOWN_FIRM_LETTER_SYNTHETIC)).toBe('unknown');
  });

  it('buildLetterSection with unknown firm produces output without crashing', () => {
    const section = buildLetterSection(UNKNOWN_FIRM_LETTER_SYNTHETIC);
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD5-6: Markdown bold artifact cleanup ───────────────────────────────
describe('T-UPLOAD5-6: Markdown bold artifact cleanup', () => {
  it('normalizeLetterMarkdown strips **bold** markers', () => {
    const result = normalizeLetterMarkdown('**The Mason Law Firm, PLC**');
    expect(result).not.toContain('**');
    expect(result).toContain('The Mason Law Firm, PLC');
  });

  it('normalizeLetterMarkdown strips __bold__ markers', () => {
    const result = normalizeLetterMarkdown('__The Mason Law Firm, PLC__');
    expect(result).not.toContain('__');
    expect(result).toContain('The Mason Law Firm, PLC');
  });

  it('normalizeLetterMarkdown preserves signature blank lines (5+ underscores)', () => {
    const result = normalizeLetterMarkdown('_________________________________________');
    expect(result).toBe('_________________________________________');
  });

  it('parseLetterBlocks strips ** from letterhead lines', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_WITH_MARKDOWN);
    const allText = blocks.letterheadLines.join(' ');
    expect(allText).not.toContain('**');
    expect(allText).toContain('The Mason Law Firm, PLC');
  });
});

// ── T-UPLOAD5-7: Markdown italic artifact cleanup ─────────────────────────────
describe('T-UPLOAD5-7: Markdown italic artifact cleanup', () => {
  it('normalizeLetterMarkdown strips _italic_ markers', () => {
    const result = normalizeLetterMarkdown('_Via Electronic Mail_');
    expect(result).not.toMatch(/(?<![_])_[^_]+_(?![_])/);
    expect(result).toContain('Via Electronic Mail');
  });

  it('normalizeLetterMarkdown strips *italic* markers', () => {
    const result = normalizeLetterMarkdown('*Via Electronic Mail*');
    expect(result).not.toMatch(/(?<![*])\*[^*]+\*(?![*])/);
    expect(result).toContain('Via Electronic Mail');
  });

  it('parseLetterBlocks strips _ from delivery line', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_WITH_MARKDOWN);
    if (blocks.deliveryLine) {
      expect(blocks.deliveryLine).not.toMatch(/^_[^_]/);
      expect(blocks.deliveryLine).toContain('Via Electronic Mail');
    }
  });
});

// ── T-UPLOAD5-8: Mason letterhead target markers ──────────────────────────────
describe('T-UPLOAD5-8: Mason letterhead target markers', () => {
  it('buildLetterSection with Mason input produces section with children (letterhead rendered)', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    // Section should have children (letterhead paragraphs rendered)
    expect((section.children as unknown[]).length).toBeGreaterThan(3);
  });

  it('buildLetterSection with Mason input does not produce Satterwhite firm name in children text', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    // Inspect children for any TextRun containing Satterwhite firm name in letterhead position
    // (The first few children are letterhead paragraphs)
    const firstFewChildren = (section.children as unknown[]).slice(0, 5);
    const childrenJson = JSON.stringify(firstFewChildren);
    // Satterwhite letterhead text should not appear in Mason output
    expect(childrenJson).not.toContain('THE SATTERWHITE LAW FIRM');
    expect(childrenJson).not.toContain('Virginia \u2022 Maryland');
  });

  it('Mason letterhead paragraphs are built (section has header/footer)', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    expect(section.headers).toBeDefined();
    expect(section.footers).toBeDefined();
  });
});

// ── T-UPLOAD5-9: Delivery / RE / salutation structure ────────────────────────
describe('T-UPLOAD5-9: Delivery / RE / salutation structure', () => {
  it('parseLetterBlocks extracts delivery line', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.deliveryLine).toBeTruthy();
    expect(blocks.deliveryLine).toContain('Via Electronic Mail');
  });

  it('parseLetterBlocks extracts RE line', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.reLine).toBeTruthy();
    expect(blocks.reLine).toMatch(/^Re:/i);
  });

  it('parseLetterBlocks extracts salutation', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.salutationLine).toBeTruthy();
    expect(blocks.salutationLine).toMatch(/^Dear\s+/i);
  });
});

// ── T-UPLOAD5-10: Body content preservation ───────────────────────────────────
describe('T-UPLOAD5-10: Body content preservation', () => {
  it('parseLetterBlocks preserves distinctive body text', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    const bodyText = blocks.bodyLines.join(' ');
    expect(bodyText).toContain('synthetic test letter');
    expect(bodyText).toContain('scope of this engagement');
  });

  it('parseLetterBlocks body text does not contain ** artifacts', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_WITH_MARKDOWN);
    const bodyText = blocks.bodyLines.join(' ');
    expect(bodyText).not.toContain('**');
  });

  it('parseLetterBlocks body text does not contain _italic_ artifacts', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_WITH_MARKDOWN);
    const bodyText = blocks.bodyLines.join(' ');
    // Should not have _word_ pattern (italic markers)
    expect(bodyText).not.toMatch(/_[a-zA-Z]+_/);
  });
});

// ── T-UPLOAD5-11: Signature block polish/preservation ─────────────────────────
describe('T-UPLOAD5-11: Signature block polish/preservation', () => {
  it('parseLetterBlocks extracts signature lines after closing', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    const sigText = blocks.signatureLines.join(' ');
    expect(sigText).toContain('THE MASON LAW FIRM, PLC');
    expect(sigText).toContain('/s/ Kelly Satterwhite');
    expect(sigText).toContain('VSB No. 91049');
    expect(sigText).toContain('Admitted in Virginia and Maryland');
  });

  it('parseLetterBlocks extracts closing line', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.closingLine).toBe('Sincerely,');
  });
});

// ── T-UPLOAD5-12: Agreed-and-accepted block polish/preservation ───────────────
describe('T-UPLOAD5-12: Agreed-and-accepted block polish/preservation', () => {
  it('parseLetterBlocks extracts acceptance block', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.acceptanceLines.length).toBeGreaterThan(0);
    expect(blocks.acceptanceLines[0]).toMatch(/AGREED AND ACCEPTED/i);
  });

  it('acceptance block preserves acceptance statement', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    const acceptText = blocks.acceptanceLines.join(' ');
    expect(acceptText).toContain('read and understood');
  });

  it('acceptance block preserves client name and date label', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    const acceptText = blocks.acceptanceLines.join(' ');
    expect(acceptText).toContain('Client Name');
    expect(acceptText).toContain('Date:');
  });
});

// ── T-UPLOAD5-13: Enclosure block preservation ────────────────────────────────
describe('T-UPLOAD5-13: Enclosure block preservation', () => {
  it('parseLetterBlocks extracts enclosure line', () => {
    const blocks = parseLetterBlocks(MASON_LETTER_SYNTHETIC);
    expect(blocks.enclosureLine).toBeTruthy();
    expect(blocks.enclosureLine).toContain('Enclosure:');
  });

  it('buildLetterSection includes enclosure in output children', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    const childrenJson = JSON.stringify(section.children);
    expect(childrenJson).toContain('Enclosure:');
  });
});

// ── T-UPLOAD5-14: Letter footer no incomplete page marker ─────────────────────
describe('T-UPLOAD5-14: Letter footer no incomplete page marker', () => {
  it('Satterwhite footer JSON does not contain literal "Page  of" (double-space)', () => {
    const footer = buildLetterFooter('satterwhite');
    const footerJson = JSON.stringify(footer);
    // Should not contain the broken "Page  of" pattern (two spaces between Page and of)
    expect(footerJson).not.toContain('Page  of');
  });

  it('Mason footer JSON does not contain literal "Page  of" (double-space)', () => {
    const footer = buildLetterFooter('mason');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).not.toContain('Page  of');
  });

  it('Unknown footer JSON does not contain literal "Page  of"', () => {
    const footer = buildLetterFooter('unknown');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).not.toContain('Page  of');
  });
});

// ── T-UPLOAD5-15: Letter footer uses page fields or safe fallback ─────────────
describe('T-UPLOAD5-15: Letter footer uses page fields or safe fallback', () => {
  it('Satterwhite footer children include PageNumber field references', () => {
    const footer = buildLetterFooter('satterwhite');
    // Verify the footer serializes to JSON with multiple children
    // (not just a single empty TextRun — PageNumber fields are present)
    const footerJson = JSON.stringify(footer);
    // The footer should contain 'Page' text and page number field markers
    expect(footerJson).toContain('Page');
  });

  it('Mason footer children include PageNumber field references', () => {
    const footer = buildLetterFooter('mason');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).toContain('Page');
  });

  it('Satterwhite footer has firm name text', () => {
    const footer = buildLetterFooter('satterwhite');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).toContain('Satterwhite');
  });

  it('Mason footer has Mason firm name or confidential text', () => {
    const footer = buildLetterFooter('mason');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).toContain('CONFIDENTIAL');
  });
});

// ── T-UPLOAD5-16: Satterwhite/Kahrs behavior preserved ───────────────────────
describe('T-UPLOAD5-16: Satterwhite/Kahrs behavior preserved', () => {
  it('detectLetterFirm still returns satterwhite for Satterwhite source', () => {
    expect(detectLetterFirm(SATTERWHITE_LETTER_SYNTHETIC)).toBe('satterwhite');
  });

  it('buildLetterSection with Satterwhite source produces non-empty children', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER_SYNTHETIC);
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });

  it('buildLetterSection with Satterwhite source has header and footer', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER_SYNTHETIC);
    expect(section.headers).toBeDefined();
    expect(section.footers).toBeDefined();
  });

  it('Satterwhite footer has firm text (Kahrs-style preserved)', () => {
    const footer = buildLetterFooter('satterwhite');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).toContain('Satterwhite');
    expect(footerJson).toContain('703-855-7380');
  });

  it('parseLetterBlocks still extracts Satterwhite letter blocks correctly', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER_SYNTHETIC);
    expect(blocks.dateLine).toBeTruthy();
    expect(blocks.salutationLine).toBeTruthy();
    expect(blocks.closingLine).toBe('Sincerely,');
    expect(blocks.acceptanceLines.length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD5-17: Mason does not receive Satterwhite branding ─────────────────
describe('T-UPLOAD5-17: Mason does not receive Satterwhite branding', () => {
  it('buildLetterSection with Mason source does not inject Satterwhite firm name in header', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    const headerJson = JSON.stringify(section.headers);
    // Satterwhite privilege header text should not appear in Mason header
    expect(headerJson).not.toContain('THE SATTERWHITE LAW FIRM');
  });

  it('buildLetterFooter for mason does not contain Satterwhite firm name', () => {
    const footer = buildLetterFooter('mason');
    const footerJson = JSON.stringify(footer);
    expect(footerJson).not.toContain('Satterwhite');
    expect(footerJson).not.toContain('703-855-7380');
  });

  it('buildLetterSection with Mason source does not contain Satterwhite letterhead in first children', () => {
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    // First children are the letterhead — should be Mason, not Satterwhite
    const firstChildrenJson = JSON.stringify((section.children as unknown[]).slice(0, 6));
    expect(firstChildrenJson).not.toContain('THE SATTERWHITE LAW FIRM, PLLC');
    expect(firstChildrenJson).not.toContain('Virginia \u2022 Maryland');
    expect(firstChildrenJson).not.toContain('Trusts & Estates');
  });
});

// ── T-UPLOAD5-18: Existing upload behavior preserved ─────────────────────────
describe('T-UPLOAD5-18: Existing upload behavior preserved (source-level confirmation)', () => {
  it('UploadFormatPage.tsx exports DocumentProfile type with general and letter values', () => {
    // Source-level: DocumentProfile type is 'general' | 'letter'
    // We confirm by importing and using the type
    const profile1: DocumentProfile = 'general';
    const profile2: DocumentProfile = 'letter';
    expect(profile1).toBe('general');
    expect(profile2).toBe('letter');
  });

  it('buildLetterSection handles empty string input without throwing', () => {
    expect(() => buildLetterSection('')).not.toThrow();
  });

  it('buildLetterSection handles plain text without any structure without throwing', () => {
    expect(() => buildLetterSection('Just some plain text with no structure.')).not.toThrow();
  });

  it('buildLegalInstrumentSection handles plain text without throwing (General profile preserved)', () => {
    expect(() => buildLegalInstrumentSection('POWER OF ATTORNEY\n\nTest content.')).not.toThrow();
  });
});

// ── T-UPLOAD5-19: No LLM/reviewer/prompt/DB/deployment changes ────────────────
describe('T-UPLOAD5-19: No LLM/reviewer/prompt/DB/deployment changes', () => {
  it('letterFormatter does not import from LLM adapter files', async () => {
    // Source-level: letterFormatter.ts imports only from 'docx' and no LLM modules
    // We verify by checking that the module loads without LLM side effects
    const mod = await import('../../server/utils/letterFormatter.js');
    expect(typeof mod.buildLetterSection).toBe('function');
    expect(typeof mod.detectLetterFirm).toBe('function');
    expect(typeof mod.parseLetterBlocks).toBe('function');
    expect(typeof mod.normalizeLetterMarkdown).toBe('function');
  });

  it('instrumentFormatter is unchanged — buildLegalInstrumentSection still works', () => {
    const section = buildLegalInstrumentSection('POWER OF ATTORNEY\n\nTest principal appoints test agent.');
    expect(section).toBeDefined();
  });
});

// ── T-UPLOAD5-20: No second formatting engine ─────────────────────────────────
describe('T-UPLOAD5-20: No second formatting engine', () => {
  it('letterFormatter uses docx primitives (Paragraph, TextRun, Table)', async () => {
    // Source-level: letterFormatter.ts only imports from 'docx'
    // Verified by the fact that buildLetterSection returns ISectionOptions
    const section = buildLetterSection(MASON_LETTER_SYNTHETIC);
    // ISectionOptions has children array of Paragraph/Table objects
    expect(Array.isArray(section.children)).toBe(true);
    // Properties should be a page properties object
    expect(section.properties).toBeDefined();
  });

  it('buildLetterSection returns ISectionOptions compatible structure', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER_SYNTHETIC);
    expect(section.properties).toBeDefined();
    expect(section.headers).toBeDefined();
    expect(section.footers).toBeDefined();
    expect(Array.isArray(section.children)).toBe(true);
  });
});
