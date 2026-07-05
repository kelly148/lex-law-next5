/**
 * recordableDeedFormatter.ts — DEED-EXPORT-FORMAT-1.
 *
 * Renders a DEED document's plain-text content as a PLAIN, BLACK-ONLY, RECORDABLE instrument DOCX section — the
 * artifact the attorney actually records. It deliberately carries NO firm branding, NO product colors, and NO
 * house-style header/footer: a recordable deed is a basic instrument, not a Whereas-branded document. This
 * REPLACES buildSatterwhiteSection for documentType 'deed' (all 7 deed types share this format).
 *
 * SCOPE: renderer/template only. The deed assemblers emit the SUBSTANTIVE content (parties, legal description,
 * derivation, consideration) as plain text (paragraphs joined by "\n\n"); this module wraps it in the
 * recordable PRESENTATION. Recordable-boilerplate scaffolding the presentation owns (the footer trio, the full
 * Universal-Title return-to block, the notary registration line) is added here as template, not generated
 * content. The drafter's-notes block stays out of the recordable body (as today — notes are never in `content`).
 *
 * TARGET (DEED-EXPORT-FORMAT-1 §Target, cross-checked against the canonical deed-materials exemplars):
 *   Times-class serif, 12pt, BLACK ONLY. Two-column caption. Centered bold title. Centered "Witnesseth, that:".
 *   Justified body with first-line indents; legal description as an indented block. Signature "____ (SEAL)"
 *   with the name beneath. Notary block with signature/registration/commission lines. Footer trio:
 *   "File No.: <n>" left · "VA – DEED OF <TYPE>" center small bold · "Page X of Y" right.
 */

import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
  Paragraph,
  TabStopType,
  TextRun,
  type ISectionOptions,
  type IStylesOptions,
} from 'docx';

const SERIF = 'Times New Roman';
const BODY = 24; // 12pt in half-points
const TITLE = 28; // 14pt
const SMALL = 18; // 9pt (footer)
const BLACK = '000000';
const CAPTION_TAB = 2880; // ~2" — the two-column caption value column
const FOOTER_TAB_CENTER = 4680;
const FOOTER_TAB_RIGHT = 9360;
const FIRST_LINE_INDENT = 720; // 0.5"
const LEGAL_BLOCK_INDENT = 720;

/**
 * The Universal Title recordable return-to block. A recordable CONSTANT (like the footer), NOT generated
 * content — used only when the deed's return-to resolves to the default "Universal Title"; a custom return-to
 * is rendered verbatim.
 */
const UNIVERSAL_TITLE_RETURN_BLOCK = [
  'Universal Title',
  '3031 Fairview Park Drive',
  'Suite 375',
  'Falls Church, VA 22042',
  '(703) 354-2100',
];

export interface RecordableDeedSectionOptions {
  /** If provided, a PLAIN-BLACK draft watermark line at the top (no branding). Null/undefined on finalized. */
  watermarkText?: string | null;
}

/**
 * Document-level styles for a recordable deed: neutralize the docx library's DEFAULT colored style definitions
 * (Heading1–6/Title in Office blue, the Hyperlink style in 0563C1) to BLACK so styles.xml carries NO color —
 * "no colored elements anywhere" (DEED-EXPORT-FORMAT-1 §2). The deed body never applies these styles (it uses
 * explicit black runs), but the operator wants the dormant style definitions clean too. Pass this as the
 * Document `styles` when documentType is 'deed'.
 */
export const RECORDABLE_DEED_STYLES: IStylesOptions = {
  default: {
    document: { run: { font: SERIF, size: BODY, color: BLACK } },
    heading1: { run: { color: BLACK } },
    heading2: { run: { color: BLACK } },
    heading3: { run: { color: BLACK } },
    heading4: { run: { color: BLACK } },
    heading5: { run: { color: BLACK } },
    heading6: { run: { color: BLACK } },
    title: { run: { color: BLACK } },
    hyperlink: { run: { color: BLACK } }, // the Office-default Hyperlink blue (0563C1) -> black
  },
};

// ── run + paragraph helpers (black serif only) ─────────────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  underline?: boolean;
  size?: number;
}
function run(text: string, o: RunOpts = {}): TextRun {
  return new TextRun({
    text,
    font: SERIF,
    size: o.size ?? BODY,
    color: BLACK,
    ...(o.bold ? { bold: true } : {}),
    ...(o.underline ? { underline: {} } : {}),
  });
}
function centered(text: string, o: RunOpts = {}): Paragraph {
  return new Paragraph({ children: [run(text, o)], alignment: AlignmentType.CENTER, spacing: { after: 160 } });
}
function justified(text: string, opts: { indent?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [run(text)],
    alignment: AlignmentType.JUSTIFIED,
    ...(opts.indent ? { indent: { firstLine: FIRST_LINE_INDENT } } : {}),
    spacing: { after: 160 },
  });
}
function left(children: TextRun[]): Paragraph {
  return new Paragraph({ children, alignment: AlignmentType.LEFT, spacing: { after: 120 } });
}
/** A full-width horizontal rule (a bottom border on an empty paragraph), BLACK. */
function horizontalRule(): Paragraph {
  return new Paragraph({
    children: [run('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 2, color: BLACK } },
    spacing: { after: 160 },
  });
}
/** A two-column caption row: bold label, tab, value (hanging second column). */
function captionRow(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [run(label, { bold: true }), new TextRun({ text: '\t', font: SERIF, size: BODY, color: BLACK }), run(value)],
    tabStops: [{ type: TabStopType.LEFT, position: CAPTION_TAB }],
    indent: { left: CAPTION_TAB, hanging: CAPTION_TAB },
    spacing: { after: 60 },
  });
}

// ── party-name rendering (bold names; underline surnames) — best-effort from the recital text ─────────────

/**
 * Render one party clause (e.g. `Marcus T. Ellison and Priya Ellison, husband and wife`) into runs: each NAME
 * is BOLD with its SURNAME (last word) additionally UNDERLINED; a trailing descriptor (marital status,
 * relationship, entity form) is plain. Convention (matches the assembler recital): the name(s) precede the
 * FIRST comma, "and"-joined; everything from the first comma on is the descriptor. Best-effort: on anything
 * unexpected it falls back to a single bold run for the whole clause (never throws, never drops text).
 */
function renderPartyClauseRuns(clause: string): TextRun[] {
  try {
    const firstComma = clause.indexOf(', ');
    const namesPart = firstComma >= 0 ? clause.slice(0, firstComma) : clause;
    const descriptorPart = firstComma >= 0 ? clause.slice(firstComma) : ''; // leading ", <descriptor>" kept
    const runs: TextRun[] = [];
    for (const part of namesPart.split(/(\s+and\s+)/)) {
      if (/^\s+and\s+$/.test(part)) { runs.push(run(part)); continue; } // separator — plain
      if (part.trim().length === 0) continue;
      const words = part.split(/(\s+)/); // keep whitespace
      let lastWordIdx = -1;
      for (let i = words.length - 1; i >= 0; i -= 1) if (words[i]!.trim().length > 0) { lastWordIdx = i; break; }
      words.forEach((w, i) => {
        if (w.trim().length === 0) { runs.push(run(w, { bold: true })); return; }
        runs.push(run(w, { bold: true, underline: i === lastWordIdx }));
      });
    }
    if (descriptorPart) runs.push(run(descriptorPart)); // descriptor — plain
    return runs.length > 0 ? runs : [run(clause, { bold: true })];
  } catch {
    return [run(clause, { bold: true })];
  }
}

/** The recital template: "THIS DEED OF <TYPE>, made this ... by and between <G>, (the "<GL>"), and <E>, (the "<EL>")," */
const RECITAL_RE = /^(.*?\bby and between\s+)(.+?)(,\s*\(the\s*"[^"]*"\),\s*and\s+)(.+?)(,\s*\(the\s*"[^"]*"\),?.*)$/s;

/** Render the opening recital: justified + first-line indent, with the two party clauses bold (surnames underlined). */
function renderRecital(text: string): Paragraph {
  const m = RECITAL_RE.exec(text);
  if (!m) {
    return justified(text, { indent: true }); // no confident parse -> plain justified recital (never mis-bold)
  }
  const [, prefix, grantorClause, mid, granteeClause, suffix] = m;
  const children: TextRun[] = [
    run(prefix ?? ''),
    ...renderPartyClauseRuns(grantorClause ?? ''),
    run(mid ?? ''),
    ...renderPartyClauseRuns(granteeClause ?? ''),
    run(suffix ?? ''),
  ];
  return new Paragraph({
    children,
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: FIRST_LINE_INDENT },
    spacing: { after: 160 },
  });
}

// ── the footer trio + optional plain-black draft watermark header ────────────────────────────────────────

function buildFooter(fileNumber: string, deedTypeCaps: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: FOOTER_TAB_CENTER },
          { type: TabStopType.RIGHT, position: FOOTER_TAB_RIGHT },
        ],
        children: [
          run(`File No.: ${fileNumber}`, { size: SMALL }),
          new TextRun({ text: '\t', font: SERIF, size: SMALL, color: BLACK }),
          run(`VA – ${deedTypeCaps}`, { size: SMALL, bold: true }),
          new TextRun({ text: '\t', font: SERIF, size: SMALL, color: BLACK }),
          new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: SERIF, size: SMALL, color: BLACK }),
        ],
      }),
    ],
  });
}

function buildWatermarkHeader(watermarkText: string): Header {
  // PLAIN BLACK — no color, no branding (operator direction: "very basic, no firm colors").
  return new Header({ children: [centered(watermarkText, { bold: true, size: SMALL })] });
}

// ── content classification + the main builder ────────────────────────────────────────────────────────────

/** Pull "File Number: <v>" from the caption block (for the footer). Empty string if absent. */
function extractFileNumber(paragraphs: string[]): string {
  for (const p of paragraphs) {
    const m = /File Number:\s*(.+)/i.exec(p);
    if (m) return (m[1] ?? '').split('\n')[0]!.trim();
  }
  return '____';
}
/** The title line ("DEED OF GIFT", "DEED OF TRUST", …) — the short all-caps "DEED OF …" paragraph. */
function extractDeedTypeCaps(paragraphs: string[]): string {
  for (const p of paragraphs) {
    const t = p.trim();
    if (/^DEED OF [A-Z ]+$/.test(t) && t.length < 60) return t;
    if (/^(TRANSFER ON DEATH DEED|DEED OF (GIFT|TRUST|CONFIRMATION|BARGAIN AND SALE))/i.test(t)) return t.toUpperCase();
  }
  return 'DEED';
}
function isTitleLine(t: string): boolean {
  return /^(DEED OF [A-Z ]+|TRANSFER ON DEATH DEED)$/i.test(t.trim()) && t.trim().length < 60;
}
function isCaptionLabelLine(line: string): boolean {
  return /^(Prepared by|File Number|Grantee's Address|Grantor's Address|Tax I\.?D\.? Number|Parcel|Assessed Value|Consideration|Title Insurance|GPIN):/i.test(line.trim());
}

/**
 * Build the recordable deed DOCX section from the deed's plain-text content. Fail-safe: any paragraph that is
 * not confidently recognized is rendered as plain justified body text (never dropped, never mis-styled).
 */
export function buildRecordableDeedSection(content: string, opts: RecordableDeedSectionOptions = {}): ISectionOptions {
  const paragraphs = content.split(/\n\n+/).map((p) => p.replace(/\r/g, '')).filter((p) => p.trim().length > 0);
  const fileNumber = extractFileNumber(paragraphs);
  const deedTypeCaps = extractDeedTypeCaps(paragraphs);

  const children: Paragraph[] = [];
  let prevEndedToWit = false;

  for (const para of paragraphs) {
    const t = para.trim();

    // Caption block: a paragraph of one or more "Label: value" lines -> two-column caption rows.
    if (para.includes('\n') && para.split('\n').some((l) => isCaptionLabelLine(l))) {
      for (const line of para.split('\n')) {
        const mm = /^([^:]+:)\s*(.*)$/.exec(line.trim());
        if (mm && isCaptionLabelLine(line)) children.push(captionRow(mm[1]!.trim(), (mm[2] ?? '').trim()));
        else if (line.trim().length > 0) children.push(justified(line.trim()));
      }
      prevEndedToWit = false;
      continue;
    }
    if (isCaptionLabelLine(t)) {
      const mm = /^([^:]+:)\s*(.*)$/.exec(t);
      if (mm) { children.push(captionRow(mm[1]!.trim(), (mm[2] ?? '').trim())); prevEndedToWit = false; continue; }
    }

    // Exemption / no-title-insurance caption line (no colon label) -> plain justified caption line.
    if (/^Exempt from recordation tax/i.test(t)) { children.push(justified(t)); prevEndedToWit = false; continue; }

    // Pre-exam disclaimer -> CENTERED caps + a horizontal rule beneath.
    if (/WITHOUT THE BENEFIT OF TITLE EXAMINATION/i.test(t)) {
      children.push(centered(t, { bold: true }));
      children.push(horizontalRule());
      prevEndedToWit = false;
      continue;
    }

    // Title -> CENTERED, BOLD, larger.
    if (isTitleLine(t)) { children.push(centered(t, { bold: true, size: TITLE })); prevEndedToWit = false; continue; }

    // Opening recital -> justified, first-line indent, party names bold + surname underlined.
    if (/^THIS\b.*\bby and between\b/is.test(t)) {
      children.push(renderRecital(t));
      prevEndedToWit = /to\s+wit:\s*$/i.test(t);
      continue;
    }

    // Witnesseth -> centered, regular weight, house wording.
    if (/^WITNESSETH\b/i.test(t)) { children.push(centered('Witnesseth, that:')); prevEndedToWit = false; continue; }

    // Legal description block (the paragraph right after the operative "…to wit:" paragraph) -> indented block.
    if (prevEndedToWit) {
      children.push(new Paragraph({ children: [run(t)], alignment: AlignmentType.JUSTIFIED, indent: { left: LEGAL_BLOCK_INDENT, right: LEGAL_BLOCK_INDENT }, spacing: { after: 160 } }));
      prevEndedToWit = false;
      continue;
    }

    // Signature line: "____ (SEAL)" optionally with the name on the next line beneath.
    if (/\(SEAL\)/.test(t)) {
      const lines = para.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      children.push(left([run(lines[0] ?? '_______________________________ (SEAL)')]));
      if (lines[1]) children.push(left([run(lines[1])]));
      prevEndedToWit = false;
      continue;
    }

    // Notary jurisdiction header.
    if (/^COMMONWEALTH OF VIRGINIA/i.test(t)) {
      for (const line of para.split('\n')) if (line.trim().length > 0) children.push(left([run(line.trim())]));
      prevEndedToWit = false;
      continue;
    }

    // Notary signature/commission block -> the recordable notary trio (signature line, registration, commission).
    if (/My commission expires/i.test(t) || /Notary Public\b/i.test(t)) {
      children.push(justified(para.replace(/\n+/g, ' ').replace(/_{3,}/g, '').replace(/Notary Public\.?/i, '').replace(/My commission expires:.*$/i, '').trim() || ' '));
      children.push(left([run('_______________________________')]));
      children.push(left([run("Notary Public's signature")]));
      children.push(left([run('Notary registration number: ____________________')]));
      children.push(left([run('My commission expires: ____________________')]));
      prevEndedToWit = false;
      continue;
    }

    // Return-to block: "After recording, return to: <X>." -> bold label + the full block.
    const rt = /^After recording,?\s*return to:\s*(.+?)\.?$/i.exec(t);
    if (rt) {
      children.push(left([run('After recording return to:', { bold: true })]));
      const target = (rt[1] ?? '').trim();
      const block = /^Universal Title\.?$/i.test(target) ? UNIVERSAL_TITLE_RETURN_BLOCK : target.split('\n');
      for (const line of block) if (line.trim().length > 0) children.push(left([run(line.trim())]));
      prevEndedToWit = false;
      continue;
    }

    // Everything else -> justified body with a first-line indent (operative / derivation / subject-to paragraphs).
    children.push(justified(t, { indent: true }));
    prevEndedToWit = /to\s+wit:\s*$/i.test(t);
  }

  return {
    properties: {},
    ...(opts.watermarkText ? { headers: { default: buildWatermarkHeader(opts.watermarkText) } } : {}),
    footers: { default: buildFooter(fileNumber, deedTypeCaps) },
    children,
  };
}
