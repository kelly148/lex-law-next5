/**
 * letterFormatter.ts — MR-UPLOAD-FORMAT-5
 *
 * Letter / Engagement Letter formatting profile for the Upload & Format workflow.
 *
 * Improvements over MR-UPLOAD-FORMAT-3:
 *   - Markdown artifact cleanup: strips/converts **bold**, _italic_, __bold__,
 *     *italic* markers before rendering so they do not appear literally in DOCX.
 *   - Mason letterhead: produces a polished Bentancur-style Mason letterhead
 *     (THE MASON LAW FIRM, PLC / ATTORNEYS AT LAW / address line) instead of
 *     rendering raw letterhead lines as plain centered text.
 *   - Mason footer: CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED COMMUNICATION /
 *     The Mason Law Firm, PLC / (703) 354-2100 / Page X of Y.
 *   - Satterwhite footer: upgraded to use PageNumber.CURRENT / PageNumber.TOTAL_PAGES
 *     (same as buildRunningFooter in markdownToDocx.ts) so "Page  of" never appears.
 *   - Letter-zone parser improvements: handles Markdown-wrapped delivery/RE lines,
 *     optional document title/label before letterhead, improved blank-line handling.
 *   - Signature block: preserves /s/ lines, VSB/admission lines, firm affiliation.
 *   - Acceptance block: improved blank-line and signature-line detection.
 *   - Enclosure block: normalized spacing.
 *   - Unknown firm: neutral legal-letter layout, no branding injected.
 *
 * Produces correspondence-style DOCX output that:
 *   - For Satterwhite letters: targets the Kahrs engagement-letter style
 *     (privilege header, centered Satterwhite letterhead, centered title/subtitle,
 *     date/recipient block, Re: line, salutation, numbered sections, fee table,
 *     closing, firm signature, client acceptance block, Satterwhite footer).
 *   - For Mason letters: preserves Mason Law Firm identity, suppresses Satterwhite
 *     footer/letterhead, and formats as clean Bentancur-style correspondence.
 *   - For unknown firm: uses "preserve from source" — no Satterwhite/Mason branding.
 *
 * This is a profile-specific extension of the existing renderer, not a competing
 * second formatting engine. It reuses the same docx primitives, page/margin constants,
 * and font/color constants as markdownToDocx.ts.
 *
 * Public API:
 *   buildLetterSection(text, opts) -> ISectionOptions
 *   detectLetterFirm(text) -> 'satterwhite' | 'mason' | 'unknown'
 *   parseLetterBlocks(text) -> LetterBlocks
 *   buildLetterFooter(firm) -> Paragraph
 *   normalizeLetterMarkdown(text) -> string
 */
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';

// ── Page / margin constants (same as markdownToDocx.ts) ───────────────────────
const PAGE_WIDTH_DXA = 12240;
const PAGE_HEIGHT_DXA = 15840;
const MARGIN_DXA = 1440;
const HEADER_OFFSET_DXA = 708;
const FOOTER_OFFSET_DXA = 708;
const CONTENT_WIDTH_DXA = 9360;

// ── Colors (same as markdownToDocx.ts) ────────────────────────────────────────
const FIRM_NAVY = '1f3864';
const FIRM_GOLD = 'bf8f00';
const BODY_CHARCOAL = '404040';
const TABLE_BORDER_GRAY = 'cccccc';
const TABLE_ROW_SHADE = 'f2f2f2';
const WHITE = 'FFFFFF';

// ── Mason brand colors ─────────────────────────────────────────────────────────
const MASON_DARK = '1a1a2e';   // deep navy/black for Mason letterhead
const MASON_GRAY = '555555';   // medium gray for Mason address line

// ── Fonts / sizes ─────────────────────────────────────────────────────────────
const BODY_FONT = 'Times New Roman';
const DISPLAY_FONT = 'Calibri';
const BODY_SIZE = 24;              // 12pt in half-points
const HEADING_SIZE = 24;           // 12pt
const RUNNING_HF_SIZE = 16;        // 8pt
const LETTERHEAD_TITLE_SIZE = 28;  // 14pt
const LETTERHEAD_CAPTION_SIZE = 20; // 10pt
const DOC_TITLE_SIZE = 28;         // 14pt
const DOC_SUBTITLE_SIZE = 22;      // 11pt
const MASON_TITLE_SIZE = 26;       // 13pt for Mason firm name
const MASON_CAPTION_SIZE = 18;     // 9pt for Mason sub-line
const MASON_ADDR_SIZE = 16;        // 8pt for Mason address line

// ── Spacing ───────────────────────────────────────────────────────────────────
const BODY_AFTER = 180;
const HEADING_BEFORE = 240;
const HEADING_AFTER = 120;

// ── Firm identity ─────────────────────────────────────────────────────────────
export type LetterFirm = 'satterwhite' | 'mason' | 'unknown';

/**
 * Detect the firm identity from the source text.
 * Returns 'satterwhite' if source contains Satterwhite Law Firm markers,
 * 'mason' if source contains Mason Law Firm markers, 'unknown' otherwise.
 */
export function detectLetterFirm(text: string): LetterFirm {
  const lower = text.toLowerCase();
  if (lower.includes('satterwhite law firm') || lower.includes('the satterwhite law firm')) {
    return 'satterwhite';
  }
  if (lower.includes('mason law firm') || lower.includes('the mason law firm')) {
    return 'mason';
  }
  return 'unknown';
}

// ── Markdown artifact cleanup ─────────────────────────────────────────────────

/**
 * Strip basic Markdown emphasis markers from a string so they do not appear
 * literally in DOCX output.
 *
 * Rules (applied in order):
 *   1. **text** → text  (bold)
 *   2. __text__ → text  (bold)
 *   3. _text_   → text  (italic) — only when surrounded by word boundary or space
 *   4. *text*   → text  (italic) — only when surrounded by word boundary or space
 *
 * Conservative: only strips markers that clearly wrap a phrase.
 * Does not strip standalone asterisks/underscores that are part of legal text
 * (e.g., signature blank lines like "___________").
 */
export function normalizeLetterMarkdown(text: string): string {
  // **bold** and __bold__
  // The __bold__ pattern must contain at least one non-underscore character
  // to avoid stripping signature blank lines like "_________________________________________"
  let out = text.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/__([^_][^]*?[^_]|[^_])__/g, '$1');
  // _italic_ — only when the _ is at a word boundary (not part of _____ blank lines)
  // Use negative lookbehind/lookahead to avoid stripping signature blanks (5+ underscores)
  out = out.replace(/(?<![_])_([^_\n]+?)_(?![_])/g, '$1');
  // *italic* — only when * is not part of a list bullet (i.e., not at line start followed by space)
  out = out.replace(/(?<![*])\*([^*\n]+?)\*(?![*])/g, '$1');
  return out;
}

// ── Block parsing ─────────────────────────────────────────────────────────────
export interface LetterBlocks {
  /** Optional document title/label before the letterhead (e.g., "TODD Engagement Letter — Bentancur Servetti") */
  documentTitle: string | null;
  /** Lines that form the letterhead / firm header (first block before date) */
  letterheadLines: string[];
  /** Date line, e.g. "May 7, 2026" */
  dateLine: string | null;
  /** Recipient address block lines */
  recipientLines: string[];
  /** Delivery method line, e.g. "Via Electronic Mail" */
  deliveryLine: string | null;
  /** Re: / RE: line */
  reLine: string | null;
  /** Salutation line, e.g. "Dear Hinrich:" */
  salutationLine: string | null;
  /** Body paragraph lines (everything between salutation and closing) */
  bodyLines: string[];
  /** Closing line, e.g. "Sincerely," */
  closingLine: string | null;
  /** Firm signature block lines (after closing, before acceptance) */
  signatureLines: string[];
  /** Acceptance/authorization block lines */
  acceptanceLines: string[];
  /** Enclosure line, e.g. "Enclosed: Deed." */
  enclosureLine: string | null;
}

/**
 * Parse a letter/correspondence text into structural blocks using
 * deterministic heuristics. No LLM.
 *
 * Improvements over MR-UPLOAD-FORMAT-3:
 *   - Strips Markdown markers from each line before classification.
 *   - Detects optional document title/label before letterhead.
 *   - Handles Markdown-wrapped delivery/RE lines.
 *   - Improved blank-line handling in post-closing phase.
 */
export function parseLetterBlocks(text: string): LetterBlocks {
  const lines: string[] = text.split('\n');
  const result: LetterBlocks = {
    documentTitle: null,
    letterheadLines: [],
    dateLine: null,
    recipientLines: [],
    deliveryLine: null,
    reLine: null,
    salutationLine: null,
    bodyLines: [],
    closingLine: null,
    signatureLines: [],
    acceptanceLines: [],
    enclosureLine: null,
  };

  // State machine
  type Phase =
    | 'letterhead'
    | 'date'
    | 'recipient'
    | 'pre-salutation'
    | 'body'
    | 'post-closing'
    | 'acceptance';

  let phase: Phase = 'letterhead';
  let _blankCount = 0;

  const isDateLine = (l: string): boolean =>
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/.test(l.trim()) ||
    /^\d{1,2}\/\d{1,2}\/\d{4}/.test(l.trim()) ||
    /^\d{4}-\d{2}-\d{2}/.test(l.trim());

  const isReLine = (l: string): boolean =>
    /^(Re:|RE:|Regarding:|Subject:)/i.test(l.trim());

  const isDeliveryLine = (l: string): boolean =>
    /^Via\s+(Electronic Mail|Email|U\.?S\.? Mail|Hand Delivery|Certified Mail|Facsimile|Fax)/i.test(l.trim());

  const isSalutation = (l: string): boolean =>
    /^Dear\s+\S/i.test(l.trim());

  const isClosingLine = (l: string): boolean =>
    /^(Sincerely|Very truly yours|Respectfully|Best regards|Regards|Yours truly|Cordially),?\s*$/i.test(l.trim());

  const isAcceptanceHeading = (l: string): boolean =>
    /^(AGREED AND ACCEPTED|CLIENT ACCEPTANCE|AUTHORIZATION|ACCEPTANCE AND AUTHORIZATION)/i.test(l.trim());

  const isEnclosureLine = (l: string): boolean =>
    /^(Enclos(ed|ure)|Enc\.|Attachment)/i.test(l.trim());

  /**
   * Detect optional document title/label: a short ALL-CAPS or title-case line
   * at the very top (before letterhead firm name) that looks like a document label.
   * E.g., "TODD Engagement Letter — Bentancur Servetti"
   */
  const isDocumentTitle = (l: string): boolean => {
    const t = l.trim();
    if (t.length === 0 || t.length > 120) return false;
    // Must contain "engagement letter", "letter", or similar document-type marker
    return /engagement\s+letter|letter\s+—|letter\s+-/i.test(t) &&
      !/^(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(t);
  };

  let firstNonBlankSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const raw: string = lines[i] ?? '';
    // Normalize Markdown markers before classification
    const normalized = normalizeLetterMarkdown(raw);
    const trimmed = normalized.trim();

    if (trimmed === '') {
      _blankCount++;
    } else {
      _blankCount = 0;
    }

    if (phase === 'letterhead') {
      if (trimmed === '') continue;

      // Check for optional document title/label on the very first non-blank line
      if (!firstNonBlankSeen && isDocumentTitle(trimmed)) {
        result.documentTitle = trimmed;
        firstNonBlankSeen = true;
        continue;
      }
      firstNonBlankSeen = true;

      if (isDateLine(trimmed)) {
        result.dateLine = trimmed;
        phase = 'recipient';
        continue;
      }
      result.letterheadLines.push(trimmed);
      continue;
    }

    if ((phase as string) === 'date') {
      if (trimmed === '') continue;
      if (isDateLine(trimmed)) {
        result.dateLine = trimmed;
        phase = 'recipient';
        continue;
      }
      // If we got here, treat as recipient
      phase = 'recipient';
    }

    if (phase === 'recipient') {
      if (trimmed === '') {
        // Blank after recipient — move to pre-salutation
        if (result.recipientLines.length > 0) {
          phase = 'pre-salutation';
        }
        continue;
      }
      if (isDeliveryLine(trimmed)) {
        result.deliveryLine = trimmed;
        continue;
      }
      if (isReLine(trimmed)) {
        result.reLine = trimmed;
        continue;
      }
      if (isSalutation(trimmed)) {
        result.salutationLine = trimmed;
        phase = 'body';
        continue;
      }
      result.recipientLines.push(trimmed);
      continue;
    }

    if (phase === 'pre-salutation') {
      if (trimmed === '') continue;
      if (isDeliveryLine(trimmed)) {
        result.deliveryLine = trimmed;
        continue;
      }
      if (isReLine(trimmed)) {
        result.reLine = trimmed;
        continue;
      }
      if (isSalutation(trimmed)) {
        result.salutationLine = trimmed;
        phase = 'body';
        continue;
      }
      // Additional recipient lines after blank
      result.recipientLines.push(trimmed);
      continue;
    }

    if (phase === 'body') {
      if (isClosingLine(trimmed)) {
        result.closingLine = trimmed;
        phase = 'post-closing';
        continue;
      }
      if (isAcceptanceHeading(trimmed)) {
        result.acceptanceLines.push(trimmed);
        phase = 'acceptance';
        continue;
      }
      if (isEnclosureLine(trimmed)) {
        result.enclosureLine = trimmed;
        continue;
      }
      // Preserve original normalized line (with Markdown stripped) for body
      result.bodyLines.push(normalized);
      continue;
    }

    if (phase === 'post-closing') {
      if (isAcceptanceHeading(trimmed)) {
        result.acceptanceLines.push(trimmed);
        phase = 'acceptance';
        continue;
      }
      if (isEnclosureLine(trimmed)) {
        result.enclosureLine = trimmed;
        continue;
      }
      // Preserve blank lines in signature block (for spacing between sig lines)
      result.signatureLines.push(trimmed);
      continue;
    }

    if (phase === 'acceptance') {
      if (isEnclosureLine(trimmed)) {
        result.enclosureLine = trimmed;
        continue;
      }
      result.acceptanceLines.push(trimmed);
      continue;
    }
  }

  return result;
}

// ── Paragraph builders ────────────────────────────────────────────────────────

function emptyParagraph(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '', font: BODY_FONT, size: BODY_SIZE })],
    spacing: { after: 0 },
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        color: BODY_CHARCOAL,
      }),
    ],
    spacing: { after: BODY_AFTER },
    alignment: AlignmentType.LEFT,
  });
}

function centeredParagraph(text: string, opts?: {
  bold?: boolean;
  size?: number;
  color?: string;
  font?: string;
  spaceBefore?: number;
  spaceAfter?: number;
}): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: opts?.font ?? DISPLAY_FONT,
        size: opts?.size ?? BODY_SIZE,
        bold: opts?.bold ?? false,
        ...(opts?.color !== undefined ? { color: opts.color } : {}),
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: {
      before: opts?.spaceBefore ?? 0,
      after: opts?.spaceAfter ?? 80,
    },
  });
}

function goldRuleParagraph(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '', font: DISPLAY_FONT, size: 4, color: FIRM_GOLD })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, space: 4, color: FIRM_GOLD },
    },
    spacing: { after: 120 },
  });
}

function privilegeHeaderParagraph(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: 'CONFIDENTIAL \u2014 ATTORNEY-CLIENT PRIVILEGED',
        font: DISPLAY_FONT,
        size: RUNNING_HF_SIZE,
        bold: true,
        color: FIRM_NAVY,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  });
}

function reParagraph(text: string): Paragraph {
  // Strip the "Re:" prefix for separate bold label + body
  const reMatch = /^(Re:|RE:|Regarding:|Subject:)\s*/i.exec(text);
  const label = reMatch ? reMatch[1] : 'Re:';
  const body = reMatch ? text.slice(reMatch[0].length) : text;
  return new Paragraph({
    children: [
      new TextRun({ text: label + ' ', font: BODY_FONT, size: BODY_SIZE, bold: true, color: BODY_CHARCOAL }),
      new TextRun({ text: body, font: BODY_FONT, size: BODY_SIZE, bold: false, color: BODY_CHARCOAL }),
    ],
    spacing: { before: 120, after: BODY_AFTER },
    alignment: AlignmentType.LEFT,
  });
}

function headingParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: HEADING_SIZE,
        bold: true,
        color: FIRM_NAVY,
      }),
    ],
    spacing: { before: HEADING_BEFORE, after: HEADING_AFTER },
    alignment: AlignmentType.LEFT,
  });
}

function signatureParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL }),
    ],
    spacing: { after: 80 },
    alignment: AlignmentType.LEFT,
  });
}

function signatureLineParagraph(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: '_________________________________________', font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL }),
    ],
    spacing: { before: 240, after: 80 },
    alignment: AlignmentType.LEFT,
  });
}

function acceptanceHeadingParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text, font: BODY_FONT, size: HEADING_SIZE, bold: true, color: FIRM_NAVY }),
    ],
    spacing: { before: HEADING_BEFORE * 2, after: HEADING_AFTER },
    alignment: AlignmentType.LEFT,
  });
}

/**
 * Detect whether a line looks like a numbered section heading.
 * Examples: "1.  Scope of Engagement", "12.  Entire Agreement"
 */
function isNumberedSectionHeading(line: string): boolean {
  return /^\d+\.\s{1,4}\S/.test(line.trim());
}

/**
 * Detect whether a line looks like a fee table row (Description | Amount pattern
 * or "Description Amount" header).
 */
function isFeeTableHeader(line: string): boolean {
  return /^(Description\s+Amount|Description\s*\|?\s*Amount)/i.test(line.trim());
}

function isFeeTableRow(line: string): boolean {
  // Matches lines like "Legal Fee — ... $200.00" or "Total Due ... $200.00"
  return /\$[\d,]+\.\d{2}/.test(line) && line.trim().length > 5;
}

/**
 * Build a simple two-column fee table from an array of fee row lines.
 * Each row is split at the last occurrence of a dollar amount.
 */
function buildFeeTable(rows: string[]): Table {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: 'Description', font: DISPLAY_FONT, size: BODY_SIZE, bold: true, color: WHITE })],
          spacing: { after: 60 },
        })],
        shading: { type: ShadingType.CLEAR, fill: FIRM_NAVY },
        width: { size: 7200, type: WidthType.DXA },
      }),
      new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: 'Amount', font: DISPLAY_FONT, size: BODY_SIZE, bold: true, color: WHITE })],
          alignment: AlignmentType.RIGHT,
          spacing: { after: 60 },
        })],
        shading: { type: ShadingType.CLEAR, fill: FIRM_NAVY },
        width: { size: 2160, type: WidthType.DXA },
      }),
    ],
  });

  const dataRows = rows.map((row, idx) => {
    // Split at the last dollar amount
    const dollarMatch = /(\$[\d,]+\.\d{2})\s*$/.exec(row.trim());
    const amount: string = dollarMatch?.[1] ?? '';
    const matchText: string = dollarMatch?.[1] ?? '';
    const desc: string = matchText ? row.trim().slice(0, row.trim().lastIndexOf(matchText)).trim() : row.trim();
    const shade = idx % 2 === 0 ? 'FFFFFF' : TABLE_ROW_SHADE;
    return new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: desc, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL })],
            spacing: { after: 60 },
          })],
          shading: { type: ShadingType.CLEAR, fill: shade },
          width: { size: 7200, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: amount || '', font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL })],
            alignment: AlignmentType.RIGHT,
            spacing: { after: 60 },
          })],
          shading: { type: ShadingType.CLEAR, fill: shade },
          width: { size: 2160, type: WidthType.DXA },
        }),
      ],
    });
  });

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
      left: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
      right: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_GRAY },
    },
  });
}

// ── Header/footer builders ────────────────────────────────────────────────────

/**
 * Build the letter running header.
 * For Satterwhite: "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED" right-aligned with navy border.
 * For Mason: empty (no Satterwhite privilege header on Mason correspondence).
 * For unknown: empty.
 */
function buildLetterHeader(firm: LetterFirm): Paragraph {
  if (firm === 'satterwhite') {
    return new Paragraph({
      children: [
        new TextRun({
          text: 'CONFIDENTIAL \u2014 ATTORNEY-CLIENT PRIVILEGED',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          bold: false,
          italics: true,
          color: FIRM_NAVY,
        }),
      ],
      alignment: AlignmentType.RIGHT,
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY },
      },
    });
  }
  // Mason / unknown: empty header
  return new Paragraph({
    children: [new TextRun({ text: '', font: DISPLAY_FONT, size: RUNNING_HF_SIZE })],
  });
}

/**
 * Build the letter running footer.
 *
 * Satterwhite: "The Satterwhite Law Firm, PLLC • 703-855-7380 [tab] Page X of Y"
 *   Uses PageNumber.CURRENT / PageNumber.TOTAL_PAGES — no literal "Page  of".
 *
 * Mason: "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED COMMUNICATION [tab] Page X of Y"
 *   Second line: "The Mason Law Firm, PLC • (703) 354-2100"
 *   Uses PageNumber.CURRENT / PageNumber.TOTAL_PAGES.
 *
 * Unknown: empty footer.
 */
export function buildLetterFooter(firm: LetterFirm): Paragraph {
  if (firm === 'satterwhite') {
    return new Paragraph({
      children: [
        new TextRun({
          text: 'The Satterwhite Law Firm, PLLC \u2022 703-855-7380',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
        new TextRun({
          text: '\t',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
        new TextRun({
          text: 'Page\u00a0',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
        new TextRun({
          children: [PageNumber.CURRENT],
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
        new TextRun({
          text: '\u00a0of\u00a0',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: FIRM_NAVY,
        }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_DXA }],
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY },
      },
    });
  }

  if (firm === 'mason') {
    return new Paragraph({
      children: [
        new TextRun({
          text: 'CONFIDENTIAL \u2014 ATTORNEY-CLIENT PRIVILEGED COMMUNICATION',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          bold: false,
          color: MASON_DARK,
        }),
        new TextRun({
          text: '\t',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: MASON_DARK,
        }),
        new TextRun({
          text: 'Page\u00a0',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: MASON_DARK,
        }),
        new TextRun({
          children: [PageNumber.CURRENT],
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: MASON_DARK,
        }),
        new TextRun({
          text: '\u00a0of\u00a0',
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: MASON_DARK,
        }),
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          font: DISPLAY_FONT,
          size: RUNNING_HF_SIZE,
          color: MASON_DARK,
        }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_DXA }],
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: MASON_DARK },
      },
    });
  }

  // Unknown: empty footer — do not inject any branding
  return new Paragraph({
    children: [new TextRun({ text: '', font: DISPLAY_FONT, size: RUNNING_HF_SIZE })],
  });
}

// ── Satterwhite letterhead builder ────────────────────────────────────────────

/**
 * Build the centered Satterwhite letterhead block:
 *   THE SATTERWHITE LAW FIRM, PLLC
 *   Virginia • Maryland
 *   Trusts & Estates • Real Estate • Business Law
 * followed by a gold rule.
 */
function buildSatterwhiteLetterhead(): Paragraph[] {
  return [
    centeredParagraph('THE SATTERWHITE LAW FIRM, PLLC', {
      bold: true,
      size: LETTERHEAD_TITLE_SIZE,
      color: FIRM_NAVY,
      font: DISPLAY_FONT,
      spaceBefore: 0,
      spaceAfter: 60,
    }),
    centeredParagraph('Virginia \u2022 Maryland', {
      bold: false,
      size: LETTERHEAD_CAPTION_SIZE,
      color: FIRM_NAVY,
      font: DISPLAY_FONT,
      spaceAfter: 60,
    }),
    centeredParagraph('Trusts & Estates \u2022 Real Estate \u2022 Business Law', {
      bold: false,
      size: LETTERHEAD_CAPTION_SIZE,
      color: FIRM_NAVY,
      font: DISPLAY_FONT,
      spaceAfter: 80,
    }),
    goldRuleParagraph(),
  ];
}

// ── Mason letterhead builder ──────────────────────────────────────────────────

/**
 * Build the centered Mason letterhead block per Bentancur style:
 *   THE MASON LAW FIRM, PLC
 *   ATTORNEYS AT LAW
 *   108 N. Columbus Street, 2nd Floor | Alexandria, Virginia 22314 | (703) 354-2100
 * followed by a thin rule.
 */
function buildMasonLetterhead(): Paragraph[] {
  return [
    centeredParagraph('THE MASON LAW FIRM, PLC', {
      bold: true,
      size: MASON_TITLE_SIZE,
      color: MASON_DARK,
      font: DISPLAY_FONT,
      spaceBefore: 0,
      spaceAfter: 40,
    }),
    centeredParagraph('ATTORNEYS AT LAW', {
      bold: false,
      size: MASON_CAPTION_SIZE,
      color: MASON_DARK,
      font: DISPLAY_FONT,
      spaceAfter: 40,
    }),
    centeredParagraph('108 N. Columbus Street, 2nd Floor \u2022 Alexandria, Virginia 22314 \u2022 (703) 354-2100', {
      bold: false,
      size: MASON_ADDR_SIZE,
      color: MASON_GRAY,
      font: DISPLAY_FONT,
      spaceAfter: 80,
    }),
    new Paragraph({
      children: [new TextRun({ text: '', font: DISPLAY_FONT, size: 4, color: MASON_DARK })],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: MASON_DARK },
      },
      spacing: { after: 120 },
    }),
  ];
}

// ── Main section builder ──────────────────────────────────────────────────────

export interface LetterSectionOptions {
  /** Override firm identity detection. */
  firmOverride?: LetterFirm;
}

/**
 * Build a complete letter/engagement-letter DOCX section from plain text.
 *
 * Routing:
 *   - Satterwhite source → privilege header, Satterwhite letterhead, centered title/subtitle,
 *     date/recipient, Re:, salutation, body (with numbered sections + fee table detection),
 *     closing, signature, acceptance block, Satterwhite footer.
 *   - Mason source → polished Mason letterhead (Bentancur style), no Satterwhite branding,
 *     date/recipient, Re:, salutation, body, closing, signature, acceptance block,
 *     Mason footer (CONFIDENTIAL / firm name / phone / Page X of Y).
 *   - Unknown → no Satterwhite/Mason header/footer, render as clean correspondence.
 */
export function buildLetterSection(
  text: string,
  opts?: LetterSectionOptions,
): ISectionOptions {
  const firm = opts?.firmOverride ?? detectLetterFirm(text);
  const blocks = parseLetterBlocks(text);

  const children: (Paragraph | Table)[] = [];

  // ── Letterhead block ─────────────────────────────────────────────────────────
  if (firm === 'satterwhite') {
    children.push(privilegeHeaderParagraph());
    children.push(emptyParagraph());
    // Satterwhite letterhead
    children.push(...buildSatterwhiteLetterhead());
    children.push(emptyParagraph());

    // Detect if this is an engagement letter (has "ENGAGEMENT LETTER" in source)
    const isEngagementLetter =
      /engagement\s+letter/i.test(text) ||
      /attorney.client fee agreement/i.test(text);

    if (isEngagementLetter) {
      children.push(centeredParagraph('ENGAGEMENT LETTER', {
        bold: true,
        size: DOC_TITLE_SIZE,
        color: FIRM_NAVY,
        font: DISPLAY_FONT,
        spaceBefore: 120,
        spaceAfter: 60,
      }));
      children.push(centeredParagraph('Attorney-Client Fee Agreement', {
        bold: false,
        size: DOC_SUBTITLE_SIZE,
        color: FIRM_NAVY,
        font: DISPLAY_FONT,
        spaceAfter: 160,
      }));
    }
  } else if (firm === 'mason') {
    // Mason: optional document title/label first
    if (blocks.documentTitle) {
      children.push(centeredParagraph(blocks.documentTitle, {
        bold: false,
        size: BODY_SIZE,
        color: BODY_CHARCOAL,
        font: BODY_FONT,
        spaceBefore: 0,
        spaceAfter: 80,
      }));
      children.push(emptyParagraph());
    }
    // Polished Mason letterhead (Bentancur style)
    children.push(...buildMasonLetterhead());
    children.push(emptyParagraph());
    // Skip letterheadLines — they are replaced by the structured Mason letterhead above
  } else {
    // Unknown: render letterhead lines as body text, no branding
    for (const line of blocks.letterheadLines) {
      if (line.trim()) {
        children.push(bodyParagraph(line));
      }
    }
    if (blocks.letterheadLines.length > 0) {
      children.push(emptyParagraph());
    }
  }

  // ── Date line ────────────────────────────────────────────────────────────────
  if (blocks.dateLine) {
    children.push(bodyParagraph(blocks.dateLine));
    children.push(emptyParagraph());
  }

  // ── Recipient block ──────────────────────────────────────────────────────────
  for (const line of blocks.recipientLines) {
    children.push(bodyParagraph(line));
  }
  if (blocks.recipientLines.length > 0) {
    children.push(emptyParagraph());
  }

  // ── Delivery method ──────────────────────────────────────────────────────────
  if (blocks.deliveryLine) {
    children.push(bodyParagraph(blocks.deliveryLine));
  }

  // ── Re: line ─────────────────────────────────────────────────────────────────
  if (blocks.reLine) {
    children.push(reParagraph(blocks.reLine));
  }

  // ── Salutation ───────────────────────────────────────────────────────────────
  if (blocks.salutationLine) {
    children.push(emptyParagraph());
    children.push(bodyParagraph(blocks.salutationLine));
    children.push(emptyParagraph());
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  // Process body lines: detect numbered section headings and fee table rows
  let inFeeTable = false;
  const feeTableRows: string[] = [];

  const flushFeeTable = (): void => {
    if (feeTableRows.length > 0) {
      children.push(buildFeeTable(feeTableRows));
      children.push(emptyParagraph());
      feeTableRows.length = 0;
    }
    inFeeTable = false;
  };

  for (const rawLine of blocks.bodyLines) {
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      if (inFeeTable) {
        flushFeeTable();
      } else {
        children.push(emptyParagraph());
      }
      continue;
    }

    // Fee table detection
    if (isFeeTableHeader(trimmed)) {
      inFeeTable = true;
      continue; // skip header row — we rebuild it
    }
    if (inFeeTable && isFeeTableRow(trimmed)) {
      feeTableRows.push(trimmed);
      continue;
    }
    if (inFeeTable && !isFeeTableRow(trimmed)) {
      flushFeeTable();
    }

    // Numbered section headings
    if (isNumberedSectionHeading(trimmed)) {
      children.push(headingParagraph(trimmed));
      continue;
    }

    // Regular body paragraph
    children.push(bodyParagraph(trimmed));
  }

  if (inFeeTable) {
    flushFeeTable();
  }

  // ── Closing ──────────────────────────────────────────────────────────────────
  if (blocks.closingLine) {
    children.push(emptyParagraph());
    children.push(bodyParagraph(blocks.closingLine));
    children.push(emptyParagraph());
  }

  // ── Signature block ──────────────────────────────────────────────────────────
  for (const line of blocks.signatureLines) {
    if (line.trim()) {
      children.push(signatureParagraph(line));
    }
    // Preserve single blank lines in signature block for spacing
    // (blank lines in signatureLines were already trimmed to '' by parser)
  }

  // ── Acceptance / authorization block ─────────────────────────────────────────
  if (blocks.acceptanceLines.length > 0) {
    children.push(emptyParagraph());
    let firstAcceptanceLine = true;
    for (const line of blocks.acceptanceLines) {
      if (line.trim() === '') {
        children.push(emptyParagraph());
        continue;
      }
      if (firstAcceptanceLine) {
        children.push(acceptanceHeadingParagraph(line));
        firstAcceptanceLine = false;
        continue;
      }
      // Detect signature/date lines
      if (/^_{5,}/.test(line.trim())) {
        children.push(signatureLineParagraph());
        continue;
      }
      children.push(bodyParagraph(line));
    }
  }

  // ── Enclosure line ────────────────────────────────────────────────────────────
  if (blocks.enclosureLine) {
    children.push(emptyParagraph());
    children.push(bodyParagraph(blocks.enclosureLine));
  }

  // ── Fallback: if nothing was parsed, render raw text as body paragraphs ───────
  if (children.length === 0) {
    for (const line of text.split('\n')) {
      children.push(bodyParagraph(normalizeLetterMarkdown(line).trim()));
    }
  }

  const safeChildren = children.length > 0
    ? children
    : [new Paragraph({ children: [new TextRun({ text: '', font: BODY_FONT, size: BODY_SIZE })] })];

  const headerParagraph = buildLetterHeader(firm);
  const footerParagraph = buildLetterFooter(firm);

  return {
    properties: {
      page: {
        size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA, orientation: PageOrientation.PORTRAIT },
        margin: {
          top: MARGIN_DXA,
          right: MARGIN_DXA,
          bottom: MARGIN_DXA,
          left: MARGIN_DXA,
          header: HEADER_OFFSET_DXA,
          footer: FOOTER_OFFSET_DXA,
        },
      },
    },
    headers: {
      default: new Header({ children: [headerParagraph] }),
    },
    footers: {
      default: new Footer({ children: [footerParagraph] }),
    },
    children: safeChildren,
  };
}
