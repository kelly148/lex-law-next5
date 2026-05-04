/**
 * markdownToDocx.ts
 *
 * MR-EXPORT-FORMAT-2 — Satterwhite DOCX house-style pack (v3).
 *
 * Builds on MR-EXPORT-FORMAT-1 (v2) to deliver a deterministic Satterwhite
 * house-style DOCX renderer for legal instruments.
 *
 * New in v3 (MR-EXPORT-FORMAT-2):
 *   - Legal-document semantic detection (title, article/section headings,
 *     execution lead-in, signature labels, notary blocks, preparer block).
 *   - Centered title/cover treatment (Calibri bold navy, larger size, gold divider).
 *   - Centered article headings and execution/notary display headings.
 *   - Running header: document title or "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED".
 *   - Footer: "The Satterwhite Law Firm, PLLC • 703-855-7380 • Page [X]" with
 *     real Word PAGE field (PageNumber.CURRENT).
 *   - Signature/notary block polish: controlled spacing, centered display headings,
 *     clean signature lines, notarial seal placeholder.
 *   - Table polish: navy header, white Calibri bold, alternating gray, thin borders.
 *   - Document-wide settings: widow/orphan control, keepNext on headings,
 *     consistent margins, Times New Roman 12pt justified body.
 *
 * Preserved from v2 (MR-EXPORT-FORMAT-1):
 *   # Title               -> HEADING_1 (Calibri bold navy, gold bottom border, centered)
 *   ## Section Title      -> HEADING_2 (Calibri bold navy, gold bottom border)
 *   ### Subsection        -> HEADING_3 (Calibri bold navy, gold bottom border)
 *   #### Sub-subsection   -> HEADING_4 (Calibri bold navy)
 *   **bold**              -> TextRun bold: true
 *   *italic*              -> TextRun italics: true
 *   ***bold-italic***     -> TextRun bold + italic
 *   ---                   -> Paragraph with bottom border (horizontal rule)
 *   - item / + item       -> Indented paragraph with bullet prefix
 *   1. item               -> Indented paragraph with number prefix
 *   | col | col |         -> docx Table (navy header, alternating shading, borders)
 *   [[PLACEHOLDER]]       -> TextRun with yellow highlight
 *   *Drafter Note: ...*   -> Red italic paragraph
 *   plain text            -> Times New Roman 12pt justified paragraph
 *
 * Public API:
 *   markdownToDocxParagraphs(markdown) -> DocxFileChild[]   (backward-compat)
 *   buildSatterwhiteSection(markdown, opts) -> ISectionOptions  (v3 section builder)
 */
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  HeadingLevel,
  HighlightColor,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single inline text segment with optional formatting. */
interface TextSegment {
  text: string;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  highlight?: (typeof HighlightColor)[keyof typeof HighlightColor];
  font?: string;
  size?: number;
}

/** A DOCX file child — either a Paragraph or a Table. */
export type DocxFileChild = Paragraph | Table;

/**
 * Options for buildSatterwhiteSection.
 * watermarkText: if provided, overrides the running header with a watermark string.
 */
export interface SatterwhiteSectionOptions {
  watermarkText?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Firm navy color (hex, no #). */
const NAVY = '1F3864';
/** Firm gold color for heading dividers (hex, no #). */
const GOLD = 'BF8F00';
/** Red for drafter notes (hex, no #). */
const RED = 'C00000';
/** Heading font. */
const HEADING_FONT = 'Calibri';
/** Body font. */
const BODY_FONT = 'Times New Roman';
/** Body font size in half-points (12pt = 24). */
const BODY_SIZE = 24;
/** Document title font size in half-points (18pt = 36). */
const TITLE_SIZE = 36;
/** Article heading font size in half-points (14pt = 28). */
const ARTICLE_SIZE = 28;
/** Spacing after body paragraph in twips (120 = 6pt). */
const BODY_SPACING_AFTER = 120;
/** Spacing before heading in twips (240 = 12pt). */
const HEADING_SPACING_BEFORE = 240;
/** Spacing after heading in twips (120 = 6pt). */
const HEADING_SPACING_AFTER = 120;
/** Spacing before display heading (title/article) in twips (360 = 18pt). */
const DISPLAY_SPACING_BEFORE = 360;
/** Spacing after display heading in twips (240 = 12pt). */
const DISPLAY_SPACING_AFTER = 240;
/** Table header fill color (navy). */
const TABLE_HEADER_FILL = NAVY;
/** Table alternating row fill (light gray). */
const TABLE_ALT_FILL = 'F2F2F2';
/** Table border color. */
const TABLE_BORDER_COLOR = 'CCCCCC';
/** Firm footer text (without page number). */
const FIRM_FOOTER_TEXT = 'The Satterwhite Law Firm, PLLC \u2022 703-855-7380 \u2022 Page\u00a0';
/** Default running header for client-retained legal instruments. */
const DEFAULT_HEADER_TEXT = 'CONFIDENTIAL \u2014 ATTORNEY-CLIENT PRIVILEGED';

// ── Semantic detection ────────────────────────────────────────────────────────

/**
 * Detect whether a line is a legal document title.
 * Matches all-caps lines that look like document titles (no leading # marker).
 * Examples: "DURABLE POWER OF ATTORNEY", "VIRGINIA DURABLE FINANCIAL POWER OF ATTORNEY"
 */
function isDocumentTitle(line: string): boolean {
  const t = line.trim();
  // Must be all-caps (allowing spaces, hyphens, em-dashes, slashes, parens, digits)
  // Must be at least 5 chars and not a separator
  if (t.length < 5 || /^---/.test(t)) return false;
  if (/^\|/.test(t)) return false;
  if (/^#/.test(t)) return false;
  // No lowercase letters present, at least 3 uppercase letters
  return !/[a-z]/.test(t) && /[A-Z]{3,}/.test(t);
}

/**
 * Detect whether a line is an article heading.
 * Examples: "ARTICLE I — DURABILITY PROVISION", "ARTICLE II — POWERS GRANTED"
 */
function isArticleHeading(line: string): boolean {
  return /^ARTICLE\s+[IVXLCDM\d]+\b/i.test(line.trim());
}

/**
 * Detect whether a line is an execution lead-in.
 * Examples: "IN WITNESS WHEREOF", "EXECUTION"
 */
function isExecutionLeadIn(line: string): boolean {
  return /^IN WITNESS WHEREOF/i.test(line.trim()) || /^EXECUTION\s*$/i.test(line.trim());
}

/**
 * Detect whether a line is a signature block label.
 * Examples: "PRINCIPAL:", "ATTORNEY-IN-FACT:", "AGENT:", "SUCCESSOR AGENT:"
 */
function isSignatureLabel(line: string): boolean {
  return /^(PRINCIPAL|ATTORNEY-IN-FACT|AGENT|SUCCESSOR AGENT|GRANTOR|TRUSTEE|BORROWER|LENDER)\s*:/i.test(
    line.trim(),
  );
}

/**
 * Detect whether a line is a notary block line.
 * Examples: "COMMONWEALTH OF VIRGINIA", "COUNTY OF", "City of Alexandria, to-wit:"
 */
function isNotaryLine(line: string): boolean {
  const t = line.trim();
  return (
    /^COMMONWEALTH OF/i.test(t) ||
    /^STATE OF/i.test(t) ||
    /^COUNTY OF/i.test(t) ||
    /^CITY OF .+,\s*to-wit/i.test(t) ||
    /^Notary Public/i.test(t) ||
    /^My Commission Expires/i.test(t) ||
    /^\[NOTARIAL SEAL\]/i.test(t)
  );
}

/**
 * Detect whether a line is a preparer block line.
 * Examples: "Prepared by:", "Prepared By:"
 */
function isPreparerLine(line: string): boolean {
  return /^Prepared\s+[Bb]y\s*:/i.test(line.trim());
}

/**
 * Extract the document title from the first title-like line in the content.
 * Used to populate the running header.
 */
function extractDocumentTitle(markdown: string): string | null {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Explicit # heading
    if (/^# /.test(t)) return t.slice(2).trim();
    // All-caps document title
    if (isDocumentTitle(t)) return t;
    // First non-empty line if nothing else found in first 10 lines
    break;
  }
  return null;
}

// ── Inline parser ─────────────────────────────────────────────────────────────

/**
 * Parse inline Markdown formatting within a single line of text.
 * Handles ***bold-italic***, **bold**, *italic*, and [[PLACEHOLDER]] spans.
 * Unmatched asterisks render as literal text (no throw).
 */
function parseInline(line: string, opts?: { bodyFont?: boolean }): TextSegment[] {
  const useBodyFont = opts?.bodyFont ?? false;
  const segments: TextSegment[] = [];
  const pattern = /(\[\[([^\]]*)\]\]|\*{3}(.+?)\*{3}|\*{2}(.+?)\*{2}|\*([^*\n]+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: line.slice(lastIndex, match.index),
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      });
    }
    const full = match[0];
    if (full.startsWith('[[')) {
      segments.push({
        text: full,
        highlight: HighlightColor.YELLOW,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      });
    } else if (full.startsWith('***')) {
      segments.push({
        text: match[3] ?? '',
        bold: true,
        italics: true,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      });
    } else if (full.startsWith('**')) {
      segments.push({
        text: match[4] ?? '',
        bold: true,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      });
    } else {
      segments.push({
        text: match[5] ?? '',
        italics: true,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < line.length) {
    segments.push({
      text: line.slice(lastIndex),
      ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
    });
  }
  if (segments.length === 0) {
    segments.push({
      text: line,
      ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
    });
  }
  return segments;
}

/**
 * Convert an array of TextSegments into an array of docx TextRun instances.
 * Filters out zero-length text segments to avoid empty TextRuns.
 */
function segmentsToTextRuns(segments: TextSegment[]): TextRun[] {
  return segments
    .filter((s) => s.text.length > 0)
    .map(
      (s) =>
        new TextRun({
          text: s.text,
          ...(s.bold ? { bold: true } : {}),
          ...(s.italics ? { italics: true } : {}),
          ...(s.color ? { color: s.color } : {}),
          ...(s.highlight ? { highlight: s.highlight } : {}),
          ...(s.font ? { font: s.font } : {}),
          ...(s.size ? { size: s.size } : {}),
        }),
    );
}

// ── Paragraph builders ────────────────────────────────────────────────────────

/**
 * Build a document title paragraph: centered, Calibri bold navy, 18pt, gold divider.
 */
function buildDocumentTitle(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: NAVY,
        font: HEADING_FONT,
        size: TITLE_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: DISPLAY_SPACING_BEFORE, after: DISPLAY_SPACING_AFTER },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 1, color: GOLD } },
    keepNext: true,
  });
}

/**
 * Build an article heading paragraph: centered, Calibri bold navy, 14pt, gold divider.
 */
function buildArticleHeading(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: NAVY,
        font: HEADING_FONT,
        size: ARTICLE_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: DISPLAY_SPACING_BEFORE, after: HEADING_SPACING_AFTER },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: GOLD } },
    keepNext: true,
  });
}

/**
 * Build an execution lead-in paragraph: centered, Calibri bold navy, 12pt.
 * Used for "IN WITNESS WHEREOF" and similar display headings.
 */
function buildExecutionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: NAVY,
        font: HEADING_FONT,
        size: BODY_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: DISPLAY_SPACING_BEFORE, after: HEADING_SPACING_AFTER },
    keepNext: true,
  });
}

/**
 * Build a signature label paragraph: left-aligned, Calibri bold navy.
 * Used for "PRINCIPAL:", "ATTORNEY-IN-FACT:", etc.
 */
function buildSignatureLabel(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: NAVY,
        font: HEADING_FONT,
        size: BODY_SIZE,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 60 },
    keepNext: true,
  });
}

/**
 * Build a notary block paragraph: left-aligned, Times New Roman 12pt.
 * "[NOTARIAL SEAL]" gets extra spacing as a seal placeholder.
 */
function buildNotaryParagraph(text: string): Paragraph {
  const isSeal = /^\[NOTARIAL SEAL\]/i.test(text.trim());
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        ...(isSeal ? { bold: true } : {}),
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: isSeal ? 240 : 60, after: isSeal ? 240 : 60 },
  });
}

/**
 * Build a preparer block paragraph: left-aligned, Times New Roman 12pt italic.
 */
function buildPreparerParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        italics: true,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: BODY_SPACING_AFTER },
  });
}

/**
 * Build a firm-standard heading paragraph.
 * H1: centered, Calibri bold navy, gold bottom border.
 * H2/H3: left-aligned (or centered if article-style), Calibri bold navy, gold bottom border.
 * H4: left-aligned, Calibri bold navy, no border.
 */
function buildHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  const isH1 = level === HeadingLevel.HEADING_1;
  const isTopLevel =
    level === HeadingLevel.HEADING_1 ||
    level === HeadingLevel.HEADING_2 ||
    level === HeadingLevel.HEADING_3;
  const runs = segmentsToTextRuns(
    parseInline(text).map((s) => ({ ...s, bold: true, color: NAVY, font: HEADING_FONT })),
  );
  return new Paragraph({
    heading: level,
    children: runs,
    alignment: isH1 ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: HEADING_SPACING_BEFORE, after: HEADING_SPACING_AFTER },
    keepNext: true,
    ...(isTopLevel
      ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: GOLD } } }
      : {}),
  });
}

/**
 * Build a firm-standard body paragraph.
 * Times New Roman 12pt, justified, widow/orphan control, spacing after 6pt.
 */
function buildBodyParagraph(line: string): Paragraph {
  return new Paragraph({
    children: segmentsToTextRuns(parseInline(line, { bodyFont: true })),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: BODY_SPACING_AFTER },
    widowControl: true,
  });
}

/**
 * Build a drafter-note paragraph: red italic.
 * Strips surrounding * markers if the whole line is italic-wrapped.
 */
function buildDrafterNote(line: string): Paragraph {
  let text = line;
  if (text.startsWith('*') && text.endsWith('*') && text.length > 2) {
    text = text.slice(1, -1);
  }
  return new Paragraph({
    children: [
      new TextRun({ text, italics: true, color: RED, font: BODY_FONT, size: BODY_SIZE }),
    ],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: BODY_SPACING_AFTER },
  });
}

/**
 * Build a list item paragraph with indentation and visible prefix.
 * Unordered: "•  item text"
 * Ordered: "N.  item text" (prefix preserved from input)
 */
function buildListItem(line: string): Paragraph {
  let prefix = '';
  let content = line;
  const orderedMatch = /^(\d+[.)]\s*)(.*)$/.exec(line);
  if (orderedMatch) {
    prefix = orderedMatch[1] ?? '';
    content = orderedMatch[2] ?? '';
  } else {
    const unorderedMatch = /^[-+]\s+(.*)$/.exec(line);
    if (unorderedMatch) {
      prefix = '\u2022  ';
      content = unorderedMatch[1] ?? '';
    }
  }
  return new Paragraph({
    children: [
      new TextRun({ text: prefix, font: BODY_FONT, size: BODY_SIZE }),
      ...segmentsToTextRuns(parseInline(content, { bodyFont: true })),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { after: 60 },
    indent: { left: 720 },
  });
}

// ── Table builder ─────────────────────────────────────────────────────────────

/**
 * Parse a Markdown pipe table block into a docx Table.
 * Returns null if the block cannot be parsed as a valid table.
 *
 * Header row: navy background, white bold Calibri text.
 * Odd data rows: white background. Even data rows: light gray background.
 * All cells: thin gray borders.
 */
function buildTable(lines: string[]): Table | null {
  try {
    const dataLines = lines.filter((l) => !/^\|[-:\s|]+\|?\s*$/.test(l));
    if (dataLines.length === 0) return null;
    const parseRow = (line: string): string[] => {
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return trimmed.split('|').map((cell) => cell.trim());
    };
    const rows: string[][] = dataLines.map(parseRow);
    if (rows.length === 0 || !rows[0] || rows[0].length === 0) return null;
    const colCount = rows[0].length;
    const tableRows = rows.map((rowCells, rowIndex) => {
      const isHeader = rowIndex === 0;
      const isAltRow = !isHeader && rowIndex % 2 === 0;
      const fillColor = isHeader ? TABLE_HEADER_FILL : isAltRow ? TABLE_ALT_FILL : 'FFFFFF';
      const borderDef = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR };
      const cells = Array.from({ length: colCount }, (_, colIndex) => {
        const cellText = rowCells[colIndex] ?? '';
        const textRun = isHeader
          ? new TextRun({ text: cellText, bold: true, color: 'FFFFFF', font: HEADING_FONT })
          : new TextRun({ text: cellText, font: BODY_FONT, size: BODY_SIZE });
        return new TableCell({
          children: [new Paragraph({ children: [textRun] })],
          shading: { fill: fillColor, type: ShadingType.CLEAR },
          borders: { top: borderDef, bottom: borderDef, left: borderDef, right: borderDef },
        });
      });
      return new TableRow({ children: cells });
    });
    return new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });
  } catch {
    return null;
  }
}

// ── Line-level dispatcher ─────────────────────────────────────────────────────

/** Determine if a line is a drafter note (*Drafter Note: ...*). */
function isDrafterNote(line: string): boolean {
  return /^\*Drafter Note:/i.test(line);
}

/** Determine if a line is a list item (ordered or unordered). */
function isListItem(line: string): boolean {
  return /^[-+]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

/** Determine if a line looks like a table row (starts and ends with |). */
function isTableRow(line: string): boolean {
  return /^\|.+\|/.test(line.trim());
}

/**
 * Convert a single non-empty line into a Paragraph (or delegate to semantic builders).
 * Dispatches in priority order: explicit Markdown markers first, then semantic detection.
 */
function lineToChild(line: string): Paragraph {
  // Explicit Markdown heading markers take priority over semantic detection
  if (/^# /.test(line)) return buildHeading(line.slice(2), HeadingLevel.HEADING_1);
  if (/^## /.test(line)) return buildHeading(line.slice(3), HeadingLevel.HEADING_2);
  if (/^### /.test(line)) return buildHeading(line.slice(4), HeadingLevel.HEADING_3);
  if (/^#### /.test(line)) return buildHeading(line.slice(5), HeadingLevel.HEADING_4);
  if (/^---$/.test(line.trim())) {
    return new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '000000' } },
    });
  }
  if (isDrafterNote(line)) return buildDrafterNote(line);
  if (isListItem(line)) return buildListItem(line);

  // Semantic detection for legal document blocks
  if (isArticleHeading(line)) return buildArticleHeading(line);
  if (isExecutionLeadIn(line)) return buildExecutionHeading(line);
  if (isSignatureLabel(line)) return buildSignatureLabel(line);
  if (isNotaryLine(line)) return buildNotaryParagraph(line);
  if (isPreparerLine(line)) return buildPreparerParagraph(line);
  if (isDocumentTitle(line)) return buildDocumentTitle(line);

  return buildBodyParagraph(line);
}

// ── Core renderer ─────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string into an array of docx FileChild constructs
 * (Paragraph or Table), ready to be embedded in a Document section.
 *
 * Backward-compatible public API (v2 behavior preserved).
 */
export function markdownToDocxParagraphs(markdown: string): DocxFileChild[] {
  if (!markdown || markdown.trim().length === 0) return [];
  const children: DocxFileChild[] = [];
  const blocks = markdown.split(/\n{2,}/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const sepLineCount = lines.filter((l) => /^\|[-:\s|]+\|?\s*$/.test(l)).length;
    const pipeLineCount = lines.filter((l) => isTableRow(l) && !/^\|[-:\s|]+\|?\s*$/.test(l)).length;
    const isTableBlock = pipeLineCount >= 1 && pipeLineCount + sepLineCount === lines.length;
    if (isTableBlock) {
      const table = buildTable(lines);
      if (table) {
        children.push(table);
        continue;
      }
    }
    for (const line of lines) {
      try {
        children.push(lineToChild(line));
      } catch {
        children.push(new Paragraph({ text: line }));
      }
    }
  }
  return children;
}

// ── Section builder (v3 — MR-EXPORT-FORMAT-2) ────────────────────────────────

/**
 * Build a complete Satterwhite house-style DOCX section object.
 *
 * Returns an ISectionOptions-compatible object containing:
 *   - properties: page margins
 *   - headers: running header (document title or watermark)
 *   - footers: Satterwhite firm footer with real PAGE field
 *   - children: rendered content paragraphs/tables
 *
 * The caller (export handler) passes this directly into the Document sections array.
 *
 * Running header logic:
 *   - If watermarkText is provided, the header shows the watermark (existing behavior).
 *   - Otherwise, the header shows the document title extracted from content,
 *     or falls back to DEFAULT_HEADER_TEXT ("CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED").
 *
 * Profile/privilege routing carryforward (CF-EF2-1):
 *   For third-party transaction documents the privilege footer should be omitted.
 *   This requires a document-type/profile flag from the export route, which is not
 *   available in the current architecture. Safe default (privilege header) is used.
 *   A future authorized index.ts/route change can pass a profile flag to suppress it.
 */
export function buildSatterwhiteSection(
  markdown: string,
  opts?: SatterwhiteSectionOptions,
): ISectionOptions {
  const children = markdownToDocxParagraphs(markdown);
  const contentChildren = children.length > 0 ? children : [new Paragraph({ text: '' })];

  // ── Running header ──────────────────────────────────────────────────────────
  let headerText: string;
  if (opts?.watermarkText) {
    headerText = opts.watermarkText;
  } else {
    headerText = extractDocumentTitle(markdown) ?? DEFAULT_HEADER_TEXT;
  }
  const headerParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: headerText,
        bold: !!opts?.watermarkText,
        color: opts?.watermarkText ? 'C00000' : NAVY,
        font: HEADING_FONT,
        size: opts?.watermarkText ? 20 : 18,
      }),
    ],
  });

  // ── Satterwhite footer with PAGE field ──────────────────────────────────────
  const footerParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: FIRM_FOOTER_TEXT,
        font: HEADING_FONT,
        size: 18,
        color: NAVY,
      }),
      new TextRun({
        children: [PageNumber.CURRENT],
        font: HEADING_FONT,
        size: 18,
        color: NAVY,
      }),
    ],
  });

  return {
    properties: {
      page: {
        margin: {
          top: 1440,    // 1 inch
          right: 1440,  // 1 inch
          bottom: 1440, // 1 inch
          left: 1440,   // 1 inch
        },
      },
    },
    headers: {
      default: new Header({ children: [headerParagraph] }),
    },
    footers: {
      default: new Footer({ children: [footerParagraph] }),
    },
    children: contentChildren,
  };
}
