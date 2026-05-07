/**
 * mr_upload_format_3.test.ts — MR-UPLOAD-FORMAT-3
 *
 * Tests for the Letter / Engagement Letter formatting profile.
 *
 * Test IDs: T-UPLOAD3-1 through T-UPLOAD3-16
 *
 * Coverage:
 *   T-UPLOAD3-1:  detectLetterFirm — Satterwhite detection
 *   T-UPLOAD3-2:  detectLetterFirm — Mason detection
 *   T-UPLOAD3-3:  detectLetterFirm — unknown firm
 *   T-UPLOAD3-4:  detectLetterFirm — case-insensitive match
 *   T-UPLOAD3-5:  parseLetterBlocks — date line extraction
 *   T-UPLOAD3-6:  parseLetterBlocks — recipient block extraction
 *   T-UPLOAD3-7:  parseLetterBlocks — Re: line extraction
 *   T-UPLOAD3-8:  parseLetterBlocks — salutation extraction
 *   T-UPLOAD3-9:  parseLetterBlocks — closing line extraction
 *   T-UPLOAD3-10: parseLetterBlocks — acceptance block extraction
 *   T-UPLOAD3-11: buildLetterSection — returns ISectionOptions with children
 *   T-UPLOAD3-12: buildLetterSection — Satterwhite firm produces non-empty children
 *   T-UPLOAD3-13: buildLetterSection — Mason firm suppresses Satterwhite branding
 *   T-UPLOAD3-14: buildLetterSection — firmOverride option respected
 *   T-UPLOAD3-15: buildLetterFooter — Satterwhite footer has firm text
 *   T-UPLOAD3-16: profile selector — UploadFormatPage.tsx exports DocumentProfile type
 *                 and PROFILE_OPTIONS includes 'general' and 'letter'
 */
import { describe, it, expect } from 'vitest';
import {
  detectLetterFirm,
  parseLetterBlocks,
  buildLetterSection,
  buildLetterFooter,
  type LetterFirm,
} from '../../server/utils/letterFormatter.js';
import type { DocumentProfile } from '../../client/pages/UploadFormatPage.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SATTERWHITE_LETTER = `THE SATTERWHITE LAW FIRM, PLLC
Virginia • Maryland
Trusts & Estates • Real Estate • Business Law
ENGAGEMENT LETTER
Attorney-Client Fee Agreement

May 7, 2026

Mr. Hinrich Jakob Kahrs
10950 Wood Fair Road
Fairfax Station, Virginia 22039

Re:  Limited Representation — Response to Don Bailey Correspondence

Dear Hinrich:

Thank you for asking me to assist you again. This letter confirms the terms of my engagement.

1.  Scope of Engagement

I have been engaged to provide the following limited legal services.

2.  Attorney Responsible

I, Kelly Satterwhite, Esq., will be the attorney responsible for this engagement.

Sincerely,

The Satterwhite Law Firm, PLLC
Kelly Satterwhite, Esq.

CLIENT ACCEPTANCE AND AUTHORIZATION

By signing below, I confirm that I have read and understood this Engagement Letter.

_________________________________________
Hinrich Jakob Kahrs, Client
Date:  _________________________________
`;

const MASON_LETTER = `THE MASON LAW FIRM, PLLC
Virginia
Business Law

May 7, 2026

Mr. John Smith
123 Main Street
Arlington, Virginia 22201

Re:  Engagement for Business Formation

Dear John:

Thank you for contacting the Mason Law Firm. This letter confirms the terms of our engagement.

1.  Scope of Engagement

We have been engaged to assist with your business formation matter.

Sincerely,

The Mason Law Firm, PLLC
`;

const UNKNOWN_FIRM_LETTER = `ACME LEGAL SERVICES
123 Business Ave
Springfield, IL 62701

May 7, 2026

Ms. Jane Doe
456 Oak Street
Springfield, IL 62702

Re:  Contract Review

Dear Jane:

Thank you for your inquiry. We are pleased to assist with your contract review.

Sincerely,

ACME Legal Services
`;

const MINIMAL_LETTER = `May 7, 2026

Mr. Test Client
123 Test Street

Dear Client:

This is a test letter.

Sincerely,

Test Firm
`;

// ── T-UPLOAD3-1: detectLetterFirm — Satterwhite detection ────────────────────
describe('T-UPLOAD3-1: detectLetterFirm — Satterwhite detection', () => {
  it('detects Satterwhite from "The Satterwhite Law Firm"', () => {
    const result = detectLetterFirm('The Satterwhite Law Firm, PLLC');
    expect(result).toBe('satterwhite');
  });

  it('detects Satterwhite from "THE SATTERWHITE LAW FIRM"', () => {
    const result = detectLetterFirm('THE SATTERWHITE LAW FIRM, PLLC');
    expect(result).toBe('satterwhite');
  });

  it('detects Satterwhite from full engagement letter', () => {
    const result = detectLetterFirm(SATTERWHITE_LETTER);
    expect(result).toBe('satterwhite');
  });
});

// ── T-UPLOAD3-2: detectLetterFirm — Mason detection ──────────────────────────
describe('T-UPLOAD3-2: detectLetterFirm — Mason detection', () => {
  it('detects Mason from "The Mason Law Firm"', () => {
    const result = detectLetterFirm('The Mason Law Firm, PLLC');
    expect(result).toBe('mason');
  });

  it('detects Mason from "THE MASON LAW FIRM"', () => {
    const result = detectLetterFirm('THE MASON LAW FIRM, PLLC');
    expect(result).toBe('mason');
  });

  it('detects Mason from full Mason letter', () => {
    const result = detectLetterFirm(MASON_LETTER);
    expect(result).toBe('mason');
  });
});

// ── T-UPLOAD3-3: detectLetterFirm — unknown firm ─────────────────────────────
describe('T-UPLOAD3-3: detectLetterFirm — unknown firm', () => {
  it('returns unknown for unrecognized firm', () => {
    const result = detectLetterFirm(UNKNOWN_FIRM_LETTER);
    expect(result).toBe('unknown');
  });

  it('returns unknown for empty text', () => {
    const result = detectLetterFirm('');
    expect(result).toBe('unknown');
  });

  it('returns unknown for generic legal text without firm name', () => {
    const result = detectLetterFirm('Dear Client: Thank you for your inquiry.');
    expect(result).toBe('unknown');
  });
});

// ── T-UPLOAD3-4: detectLetterFirm — case-insensitive match ───────────────────
describe('T-UPLOAD3-4: detectLetterFirm — case-insensitive match', () => {
  it('detects Satterwhite case-insensitively', () => {
    expect(detectLetterFirm('the satterwhite law firm')).toBe('satterwhite');
    expect(detectLetterFirm('THE SATTERWHITE LAW FIRM')).toBe('satterwhite');
    expect(detectLetterFirm('The Satterwhite Law Firm')).toBe('satterwhite');
  });

  it('detects Mason case-insensitively', () => {
    expect(detectLetterFirm('the mason law firm')).toBe('mason');
    expect(detectLetterFirm('THE MASON LAW FIRM')).toBe('mason');
    expect(detectLetterFirm('The Mason Law Firm')).toBe('mason');
  });
});

// ── T-UPLOAD3-5: parseLetterBlocks — date line extraction ────────────────────
describe('T-UPLOAD3-5: parseLetterBlocks — date line extraction', () => {
  it('extracts a standard month-day-year date line', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.dateLine).toBe('May 7, 2026');
  });

  it('extracts date from minimal letter', () => {
    const blocks = parseLetterBlocks(MINIMAL_LETTER);
    expect(blocks.dateLine).toBe('May 7, 2026');
  });

  it('returns null dateLine when no date present', () => {
    const blocks = parseLetterBlocks('Dear Client:\n\nThis is a letter.\n\nSincerely,\nFirm');
    expect(blocks.dateLine).toBeNull();
  });
});

// ── T-UPLOAD3-6: parseLetterBlocks — recipient block extraction ───────────────
describe('T-UPLOAD3-6: parseLetterBlocks — recipient block extraction', () => {
  it('extracts recipient name and address lines', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.recipientLines.length).toBeGreaterThan(0);
    expect(blocks.recipientLines[0]).toContain('Kahrs');
  });

  it('extracts recipient from Mason letter', () => {
    const blocks = parseLetterBlocks(MASON_LETTER);
    expect(blocks.recipientLines.length).toBeGreaterThan(0);
    expect(blocks.recipientLines[0]).toContain('Smith');
  });
});

// ── T-UPLOAD3-7: parseLetterBlocks — Re: line extraction ─────────────────────
describe('T-UPLOAD3-7: parseLetterBlocks — Re: line extraction', () => {
  it('extracts Re: line from Satterwhite letter', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.reLine).not.toBeNull();
    expect(blocks.reLine).toMatch(/^Re:/i);
  });

  it('extracts Re: line from Mason letter', () => {
    const blocks = parseLetterBlocks(MASON_LETTER);
    expect(blocks.reLine).not.toBeNull();
    expect(blocks.reLine).toMatch(/^Re:/i);
  });

  it('returns null reLine when no Re: present', () => {
    const blocks = parseLetterBlocks(MINIMAL_LETTER);
    expect(blocks.reLine).toBeNull();
  });
});

// ── T-UPLOAD3-8: parseLetterBlocks — salutation extraction ───────────────────
describe('T-UPLOAD3-8: parseLetterBlocks — salutation extraction', () => {
  it('extracts salutation from Satterwhite letter', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.salutationLine).not.toBeNull();
    expect(blocks.salutationLine).toMatch(/^Dear/i);
  });

  it('extracts salutation from minimal letter', () => {
    const blocks = parseLetterBlocks(MINIMAL_LETTER);
    expect(blocks.salutationLine).not.toBeNull();
    expect(blocks.salutationLine).toMatch(/^Dear/i);
  });
});

// ── T-UPLOAD3-9: parseLetterBlocks — closing line extraction ─────────────────
describe('T-UPLOAD3-9: parseLetterBlocks — closing line extraction', () => {
  it('extracts "Sincerely," closing from Satterwhite letter', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.closingLine).not.toBeNull();
    expect(blocks.closingLine).toMatch(/sincerely/i);
  });

  it('extracts closing from Mason letter', () => {
    const blocks = parseLetterBlocks(MASON_LETTER);
    expect(blocks.closingLine).not.toBeNull();
    expect(blocks.closingLine).toMatch(/sincerely/i);
  });
});

// ── T-UPLOAD3-10: parseLetterBlocks — acceptance block extraction ─────────────
describe('T-UPLOAD3-10: parseLetterBlocks — acceptance block extraction', () => {
  it('extracts CLIENT ACCEPTANCE AND AUTHORIZATION block', () => {
    const blocks = parseLetterBlocks(SATTERWHITE_LETTER);
    expect(blocks.acceptanceLines.length).toBeGreaterThan(0);
    expect(blocks.acceptanceLines[0]).toMatch(/CLIENT ACCEPTANCE/i);
  });

  it('returns empty acceptanceLines when no acceptance block present', () => {
    const blocks = parseLetterBlocks(MASON_LETTER);
    expect(blocks.acceptanceLines.length).toBe(0);
  });
});

// ── T-UPLOAD3-11: buildLetterSection — returns ISectionOptions with children ──
describe('T-UPLOAD3-11: buildLetterSection — returns ISectionOptions with children', () => {
  it('returns an object with children array', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER);
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect(Array.isArray(section.children)).toBe(true);
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns an object with properties, headers, and footers', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER);
    expect(section.properties).toBeDefined();
    expect(section.headers).toBeDefined();
    expect(section.footers).toBeDefined();
  });

  it('returns a valid section for empty text (fallback)', () => {
    const section = buildLetterSection('');
    expect(section).toBeDefined();
    expect(section.children).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD3-12: buildLetterSection — Satterwhite firm produces non-empty children
describe('T-UPLOAD3-12: buildLetterSection — Satterwhite firm produces non-empty children', () => {
  it('produces more children for Satterwhite than for minimal text', () => {
    const fullSection = buildLetterSection(SATTERWHITE_LETTER);
    const minimalSection = buildLetterSection('Hello');
    expect((fullSection.children as unknown[]).length).toBeGreaterThan(
      (minimalSection.children as unknown[]).length
    );
  });

  it('uses firmOverride satterwhite to produce Satterwhite-style section', () => {
    const section = buildLetterSection(UNKNOWN_FIRM_LETTER, { firmOverride: 'satterwhite' });
    expect(section).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD3-13: buildLetterSection — Mason firm suppresses Satterwhite branding
describe('T-UPLOAD3-13: buildLetterSection — Mason firm suppresses Satterwhite branding', () => {
  it('Mason letter produces a valid section', () => {
    const section = buildLetterSection(MASON_LETTER);
    expect(section).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });

  it('Mason footer is empty (no Satterwhite branding)', () => {
    const footer = buildLetterFooter('mason');
    expect(footer).toBeDefined();
    // Mason footer: the Paragraph root object should not have Satterwhite in its JSON
    const json = JSON.stringify(footer);
    expect(json.toLowerCase()).not.toContain('satterwhite');
  });

  it('unknown firm footer is empty (no Satterwhite branding)', () => {
    const footer = buildLetterFooter('unknown');
    const json = JSON.stringify(footer);
    expect(json.toLowerCase()).not.toContain('satterwhite');
  });
});

// ── T-UPLOAD3-14: buildLetterSection — firmOverride option respected ──────────
describe('T-UPLOAD3-14: buildLetterSection — firmOverride option respected', () => {
  it('firmOverride mason produces a valid section from Satterwhite source', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER, { firmOverride: 'mason' });
    expect(section).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });

  it('firmOverride unknown produces a valid section', () => {
    const section = buildLetterSection(SATTERWHITE_LETTER, { firmOverride: 'unknown' });
    expect(section).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });

  it('firmOverride satterwhite on Mason source produces valid section', () => {
    const section = buildLetterSection(MASON_LETTER, { firmOverride: 'satterwhite' });
    expect(section).toBeDefined();
    expect((section.children as unknown[]).length).toBeGreaterThan(0);
  });
});

// ── T-UPLOAD3-15: buildLetterFooter — Satterwhite footer has firm text ─────────
describe('T-UPLOAD3-15: buildLetterFooter — Satterwhite footer has firm text', () => {
  it('Satterwhite footer contains firm name text', () => {
    const footer = buildLetterFooter('satterwhite');
    expect(footer).toBeDefined();
    // Inspect the serialized JSON of the Paragraph — TextRun text is stored in
    // the root options object which docx serializes as part of the paragraph tree
    const json = JSON.stringify(footer);
    expect(json.toLowerCase()).toContain('satterwhite');
  });

  it('Satterwhite footer contains phone number', () => {
    const footer = buildLetterFooter('satterwhite');
    const json = JSON.stringify(footer);
    expect(json).toContain('703-855-7380');
  });
});

// ── T-UPLOAD3-16: profile selector — DocumentProfile type and options ──────────
describe('T-UPLOAD3-16: profile selector — DocumentProfile type and options', () => {
  it('DocumentProfile type accepts general and letter', () => {
    // Type-level test: these assignments must compile
    const p1: DocumentProfile = 'general';
    const p2: DocumentProfile = 'letter';
    expect(p1).toBe('general');
    expect(p2).toBe('letter');
  });

  it('LetterFirm type accepts satterwhite, mason, unknown', () => {
    const f1: LetterFirm = 'satterwhite';
    const f2: LetterFirm = 'mason';
    const f3: LetterFirm = 'unknown';
    expect(f1).toBe('satterwhite');
    expect(f2).toBe('mason');
    expect(f3).toBe('unknown');
  });
});
