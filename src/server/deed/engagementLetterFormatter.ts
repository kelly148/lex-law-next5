/**
 * engagementLetterFormatter.ts — DEED-DRAFT-AGENT-1 Inc 3: the Bien-Aime canonical .docx section builder.
 *
 * Renders the plain-text engagement letter produced by deedEngagementLetter.buildEngagementLetter into a
 * Mason house-style DOCX section matching the Bien-Aime canonical formatting (seed §4): a centered, bold,
 * dark-blue LETTER-SPACED "THE MASON LAW FIRM, PLC" letterhead + "ATTORNEYS AT LAW", a thick navy rule and a
 * thin gold rule, a centered contact line; left date/addressee; a bold RE: line; a justified, first-line-
 * indented body with the vesting sentence bold inline; an indented sign-off block; and a bold AGREED-AND-
 * ACCEPTED block with an inline "Date:" signature line and an italic enclosure line.
 *
 * Why a DEDICATED builder (not the shared letterFormatter.buildLetterSection): the existing Mason letter
 * profile carries the OLD letterhead (2nd Floor / 354-2100) and is consumed by the stateless /api/upload-
 * format path — changing it would regress that path. This builder is used ONLY for documentType
 * 'engagement_letter' (a brand-new type), so existing documents are byte-for-byte unchanged.
 *
 * Parsing: a content-cue classifier tuned to the generator's known block order, robust to [[ ]] placeholders
 * (it never relies on a parseable date — an unfilled date placeholder still renders correctly).
 */

import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
  PageOrientation,
  Paragraph,
  TabStopType,
  TextRun,
  type ISectionOptions,
} from 'docx';
import { ENGAGEMENT_LETTER_DOC_TYPE } from './deedEngagementLetter.js';

export { ENGAGEMENT_LETTER_DOC_TYPE };

// ── Page / margin constants (same as letterFormatter.ts) ──────────────────────
const PAGE_WIDTH_DXA = 12240;
const PAGE_HEIGHT_DXA = 15840;
const MARGIN_DXA = 1440;
const HEADER_OFFSET_DXA = 708;
const FOOTER_OFFSET_DXA = 708;
const CONTENT_WIDTH_DXA = 9360;

// ── Colors ────────────────────────────────────────────────────────────────────
const FIRM_NAVY = '1f3864'; // dark blue for the Mason letterhead + firm name
const FIRM_GOLD = 'bf8f00'; // the thin gold/tan rule
const BODY_CHARCOAL = '404040';
const RULE_GRAY = '777777';

// ── Fonts / sizes ─────────────────────────────────────────────────────────────
const BODY_FONT = 'Times New Roman';
const DISPLAY_FONT = 'Calibri';
const BODY_SIZE = 24; // 12pt
const RUNNING_HF_SIZE = 16; // 8pt
const FIRMNAME_SIZE = 32; // 16pt letterhead firm name
const TAGLINE_SIZE = 20; // 10pt "ATTORNEYS AT LAW"
const CONTACT_SIZE = 16; // 8pt contact line

// ── Spacing / indents ───────────────────────────────────────────────────────────
const BODY_AFTER = 200;
const FIRST_LINE_INDENT = 360; // 0.25in
const SIGNOFF_INDENT = 4320; // ~3in — indent the sign-off block toward center-right

/**
 * The Mason canonical letterhead — a SINGLE config constant (seed §7). The address floor was OPERATOR-
 * CONFIRMED 2026-06-23 ("First Floor"); the phone is the canonical Bien-Aime pairing. A one-line change here
 * is the only edit needed if the operator later revises the contact line.
 */
export const MASON_LETTERHEAD = {
  firmName: 'THE MASON LAW FIRM, PLC',
  tagline: 'ATTORNEYS AT LAW',
  contact: '108 N. Columbus Street, First Floor • Alexandria, Virginia 22314 • (703) 855-7380',
  footerContact: 'The Mason Law Firm, PLC • (703) 855-7380',
} as const;

/** Pure predicate: should the persisted-document export use this Bien-Aime builder for `documentType`? */
export function isEngagementLetterDocType(documentType: string | null | undefined): boolean {
  return documentType === ENGAGEMENT_LETTER_DOC_TYPE;
}

const VESTING_ANCHOR = 'title to the Property will be held by';

// ── small paragraph builders ────────────────────────────────────────────────────

function centered(text: string, opts: { bold?: boolean; size: number; color: string; spacing?: number; after?: number }): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: DISPLAY_FONT,
        size: opts.size,
        bold: opts.bold ?? false,
        color: opts.color,
        ...(opts.spacing !== undefined ? { characterSpacing: opts.spacing } : {}),
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: opts.after ?? 60 },
  });
}

function ruleParagraph(color: string, size: number, after: number): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '', font: DISPLAY_FONT, size: 2, color })],
    border: { bottom: { style: BorderStyle.SINGLE, size, space: 1, color } },
    spacing: { after },
  });
}

function leftLine(text: string, opts?: { bold?: boolean; italics?: boolean; after?: number; before?: number; color?: string }): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: opts?.bold ?? false,
        italics: opts?.italics ?? false,
        color: opts?.color ?? BODY_CHARCOAL,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { after: opts?.after ?? 80, ...(opts?.before !== undefined ? { before: opts.before } : {}) },
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL })],
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: FIRST_LINE_INDENT },
    spacing: { after: BODY_AFTER },
  });
}

/** The enclosed-deed paragraph, with the vesting clause (from the anchor to the end) bold inline (seed §4). */
function vestingParagraph(text: string): Paragraph {
  const idx = text.indexOf(VESTING_ANCHOR);
  if (idx < 0) return bodyParagraph(text);
  const before = text.slice(0, idx);
  const boldPart = text.slice(idx);
  return new Paragraph({
    children: [
      new TextRun({ text: before, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL }),
      new TextRun({ text: boldPart, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL, bold: true }),
    ],
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: FIRST_LINE_INDENT },
    spacing: { after: BODY_AFTER },
  });
}

function signoffLine(text: string, kind: 'plain' | 'firm' | 'slash'): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        bold: kind === 'firm',
        italics: kind === 'slash',
        color: kind === 'firm' ? FIRM_NAVY : BODY_CHARCOAL,
      }),
    ],
    alignment: AlignmentType.LEFT,
    indent: { left: SIGNOFF_INDENT },
    spacing: { after: 40 },
  });
}

// ── letterhead + header/footer ──────────────────────────────────────────────────

function buildLetterhead(): Paragraph[] {
  return [
    centered(MASON_LETTERHEAD.firmName, { bold: true, size: FIRMNAME_SIZE, color: FIRM_NAVY, spacing: 80, after: 40 }),
    centered(MASON_LETTERHEAD.tagline, { bold: false, size: TAGLINE_SIZE, color: FIRM_NAVY, spacing: 50, after: 60 }),
    ruleParagraph(FIRM_NAVY, 18, 30),
    ruleParagraph(FIRM_GOLD, 4, 60),
    centered(MASON_LETTERHEAD.contact, { bold: false, size: CONTACT_SIZE, color: RULE_GRAY, after: 200 }),
  ];
}

function buildWatermarkHeader(watermarkText: string | null | undefined): Header {
  if (!watermarkText) {
    return new Header({ children: [new Paragraph({ children: [new TextRun({ text: '', font: DISPLAY_FONT, size: RUNNING_HF_SIZE })] })] });
  }
  return new Header({
    children: [
      new Paragraph({
        children: [new TextRun({ text: watermarkText, font: DISPLAY_FONT, size: RUNNING_HF_SIZE, bold: true, color: RULE_GRAY })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: 'CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED COMMUNICATION', font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
          new TextRun({ text: '\t', font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
          new TextRun({ text: 'Page ', font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
          new TextRun({ children: [PageNumber.CURRENT], font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
          new TextRun({ text: ' of ', font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: FIRM_NAVY }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_DXA }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY } },
      }),
      new Paragraph({
        children: [new TextRun({ text: MASON_LETTERHEAD.footerContact, font: DISPLAY_FONT, size: RUNNING_HF_SIZE, color: RULE_GRAY })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

// ── block classification ─────────────────────────────────────────────────────────

const SALUTATION_RE = /^Dear\b.*:\s*$/;
const SIGNATURE_LINE_RE = /_{6,}\s+Date:/;

export interface EngagementLetterSectionOptions {
  watermarkText?: string | null;
}

export type EngagementLetterBlockRole =
  | 'date'
  | 'addressee'
  | 're'
  | 'salutation'
  | 'body'
  | 'signoff'
  | 'agreed'
  | 'signature'
  | 'enclosure';

export interface ClassifiedBlock {
  role: EngagementLetterBlockRole;
  text: string;
}

/**
 * PURE: classify the generator's plain text into ordered, role-tagged blocks. Order-preserving and ROBUST to
 * [[ ]] placeholders — the salutation is anchored BY POSITION (the first block after the RE line) as well as
 * the "Dear …:" cue, so an unfilled "[[ salutation ]]" still separates the addressee from the body (otherwise
 * the entire disclaimer spine would mis-classify as addressee). Exported for direct testing.
 */
export function classifyEngagementLetterBlocks(text: string): ClassifiedBlock[] {
  const blocks = text.split(/\n[ \t]*\n+/).map((b) => b.replace(/[ \t]+$/gm, '')).filter((b) => b.trim().length > 0);
  const out: ClassifiedBlock[] = [];
  let salutationSeen = false;
  let reSeen = false;

  blocks.forEach((block, i) => {
    const trimmed = block.trim();
    const firstLine = (block.split('\n')[0] ?? '').trim();
    let role: EngagementLetterBlockRole;

    if (i === 0) role = 'date';
    else if (firstLine.startsWith('RE:')) {
      reSeen = true;
      role = 're';
    } else if (!salutationSeen && (SALUTATION_RE.test(trimmed) || reSeen)) {
      salutationSeen = true;
      role = 'salutation';
    } else if (firstLine === 'Very truly yours,') role = 'signoff';
    else if (firstLine.startsWith('AGREED AND ACCEPTED')) role = 'agreed';
    else if (firstLine.startsWith('Enclosure:')) role = 'enclosure';
    else if (SIGNATURE_LINE_RE.test(block)) role = 'signature';
    else if (!salutationSeen) role = 'addressee';
    else role = 'body';

    out.push({ role, text: block });
  });
  return out;
}

/**
 * Build the Bien-Aime engagement-letter DOCX section from the generator's plain text. Deterministic; never
 * throws on well-formed input. Applies the canonical formatting per the classified block role.
 */
export function buildEngagementLetterSection(text: string, opts?: EngagementLetterSectionOptions): ISectionOptions {
  const children: Paragraph[] = [...buildLetterhead()];

  for (const { role, text: block } of classifyEngagementLetterBlocks(text)) {
    if (role === 'date') {
      children.push(leftLine(block.trim(), { after: 160 }));
    } else if (role === 're') {
      for (const line of block.split('\n')) children.push(leftLine(line.trim(), { bold: true, before: 120, after: 80 }));
    } else if (role === 'salutation') {
      children.push(leftLine(block.trim(), { before: 120, after: 120 }));
    } else if (role === 'signoff') {
      children.push(new Paragraph({ children: [new TextRun({ text: '', font: BODY_FONT, size: BODY_SIZE })], spacing: { before: 160 } }));
      for (const line of block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)) {
        const kind: 'plain' | 'firm' | 'slash' = line === MASON_LETTERHEAD.firmName ? 'firm' : line.startsWith('/s/') ? 'slash' : 'plain';
        children.push(signoffLine(line, kind));
      }
    } else if (role === 'agreed') {
      block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).forEach((line, idx) =>
        children.push(leftLine(line, { bold: idx === 0, before: idx === 0 ? 320 : 0, after: 80 })),
      );
    } else if (role === 'enclosure') {
      children.push(leftLine(block.trim(), { italics: true, before: 160, after: 60 }));
    } else if (role === 'signature') {
      block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).forEach((line, idx) =>
        children.push(leftLine(line, { before: idx === 0 ? 200 : 0, after: 40 })),
      );
    } else if (role === 'addressee') {
      for (const line of block.split('\n')) {
        if (line.trim().length > 0) children.push(leftLine(line.trim(), { after: 20 }));
      }
    } else {
      // body clause (justified, first-line indent; vesting clause bold inline)
      if (block.includes(VESTING_ANCHOR)) children.push(vestingParagraph(block.trim()));
      else children.push(bodyParagraph(block.trim()));
    }
  }

  return {
    properties: {
      page: {
        size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA, orientation: PageOrientation.PORTRAIT },
        margin: { top: MARGIN_DXA, right: MARGIN_DXA, bottom: MARGIN_DXA, left: MARGIN_DXA, header: HEADER_OFFSET_DXA, footer: FOOTER_OFFSET_DXA },
      },
    },
    headers: { default: buildWatermarkHeader(opts?.watermarkText) },
    footers: { default: buildFooter() },
    children,
  };
}
