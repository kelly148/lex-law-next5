/**
 * letterFormatter.ts — MR-UPLOAD-FORMAT-3
 *
 * Letter / Engagement Letter formatting profile for the Upload & Format workflow.
 *
 * Produces correspondence-style DOCX output that:
 *   - For Satterwhite letters: targets the Kahrs engagement-letter style
 *     (privilege header, centered Satterwhite letterhead, centered title/subtitle,
 *     date/recipient block, Re: line, salutation, numbered sections, fee table,
 *     closing, firm signature, client acceptance block, Satterwhite footer).
 *   - For Mason letters: preserves Mason Law Firm identity, suppresses Satterwhite
 *     footer/letterhead, and formats as clean correspondence.
 *   - For unknown firm: uses "preserve from source" — no Satterwhite footer injected.
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
 */
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  PageOrientation,
  Paragraph,
  ShadingType,
  SimpleField,
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

// ── Fonts / sizes ─────────────────────────────────────────────────────────────
const BODY_FONT = 'Times New Roman';
const DISPLAY_FONT = 'Calibri';
const BODY_SIZE = 24;         // 12pt in half-points
const HEADING_SIZE = 24;      // 12pt
const RUNNING_HF_SIZE = 16;   // 8pt
const LETTERHEAD_TITLE_SIZE = 28; // 14pt
const LETTERHEAD_CAPTION_SIZE = 20; // 10pt
const DOC_TITLE_SIZE = 28;    // 14pt
const DOC_SUBTITLE_SIZE = 22; // 11pt

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

// ── Block parsing ─────────────────────────────────────────────────────────────
export interface LetterBlocks {
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
 */
export function parseLetterBlocks(text: string): LetterBlocks {
  const lines: string[] = text.split('\n');
  const result: LetterBlocks = {
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

  for (let i = 0; i < lines.length; i++) {
    const raw: string = lines[i] ?? '';
    const trimmed = raw.trim();

    if (trimmed === '') {
      _blankCount++;
    } else {
      _blankCount = 0;
    }

    if (phase === 'letterhead') {
      if (trimmed === '') continue;
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
      result.bodyLines.push(raw ?? ''); // preserve original indentation for body
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
        color: opts?.color ?? FIRM_NAVY,
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
 * For Satterwhite: "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED"
 * For Mason: empty (no Satterwhite privilege header on Mason correspondence)
 * For unknown: empty
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
 * For Satterwhite: "The Satterwhite Law Firm, PLLC • 703-855-7380 [tab] Page X"
 *                  second line: "Confidential — Attorney-Client Privileged Communication"
 * For Mason: no Satterwhite footer — use source letterhead firm name if detectable, else empty.
 * For unknown: empty footer.
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
        new SimpleField('PAGE'),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_DXA }],
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY },
      },
    });
  }
  // Mason / unknown: empty footer — do not inject Satterwhite branding
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
 *   - Mason source → no Satterwhite header/footer, preserve Mason letterhead as body text,
 *     date/recipient, Re:, salutation, body, closing, signature, acceptance block.
 *   - Unknown → no Satterwhite header/footer, render as clean correspondence.
 */
export function buildLetterSection(
  text: string,
  opts?: LetterSectionOptions,
): ISectionOptions {
  const firm = opts?.firmOverride ?? detectLetterFirm(text);
  const blocks = parseLetterBlocks(text);

  const children: (Paragraph | Table)[] = [];

  // ── Privilege header (Satterwhite only) ──────────────────────────────────────
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
    // Mason: render letterhead lines as centered display text, no Satterwhite branding
    for (const line of blocks.letterheadLines) {
      if (line.trim()) {
        children.push(centeredParagraph(line, {
          bold: false,
          size: BODY_SIZE,
          color: BODY_CHARCOAL,
          font: BODY_FONT,
          spaceAfter: 60,
        }));
      }
    }
    if (blocks.letterheadLines.length > 0) {
      children.push(emptyParagraph());
    }
  } else {
    // Unknown: render letterhead lines as body text
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
      children.push(bodyParagraph(line.trim()));
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
