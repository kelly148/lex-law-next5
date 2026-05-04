/**
 * markdownToDocx.ts
 *
 * MR-EXPORT-FORMAT-1 — Firm-standard Markdown-to-DOCX renderer (v2).
 *
 * Upgrades the v1 helper (MR-EXPORT-1) to render firm-standard DOCX structures
 * for the Satterwhite Law Firm final-formatting output.
 *
 * Supported Markdown subset (v2):
 *   # Title               -> HEADING_1 (Calibri bold navy, gold bottom border)
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
 * Backward compatibility: plain-text content with no Markdown syntax passes
 * through unchanged — each line becomes a plain body Paragraph.
 *
 * Graceful degradation: malformed/unsupported Markdown does not throw; it renders
 * as literal plain text.
 *
 * Heading mapping (v2):
 *   # -> HEADING_1, ## -> HEADING_2, ### -> HEADING_3, #### -> HEADING_4
 *   Note: In v1, ## mapped to HEADING_1. In v2, # maps to HEADING_1 and ##
 *   maps to HEADING_2. The final-formatting prompt uses ## for primary sections,
 *   so primary sections now render as HEADING_2 with the same firm styling.
 */
import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  HighlightColor,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

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
/** Spacing after body paragraph in twips (120 = 6pt). */
const BODY_SPACING_AFTER = 120;
/** Spacing before heading in twips (240 = 12pt). */
const HEADING_SPACING_BEFORE = 240;
/** Spacing after heading in twips (120 = 6pt). */
const HEADING_SPACING_AFTER = 120;
/** Table header fill color (navy). */
const TABLE_HEADER_FILL = NAVY;
/** Table alternating row fill (light gray). */
const TABLE_ALT_FILL = 'F2F2F2';
/** Table border color. */
const TABLE_BORDER_COLOR = 'CCCCCC';

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

// ── Inline parser ─────────────────────────────────────────────────────────────

/**
 * Parse inline Markdown formatting within a single line of text.
 * Handles ***bold-italic***, **bold**, *italic*, and [[PLACEHOLDER]] spans.
 * Unmatched asterisks render as literal text (no throw).
 */
function parseInline(line: string, opts?: { bodyFont?: boolean }): TextSegment[] {
  const useBodyFont = opts?.bodyFont ?? false;
  const segments: TextSegment[] = [];
  // Combined pattern: [[placeholder]], ***bold-italic***, **bold**, *italic*
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

// ── Heading builder ───────────────────────────────────────────────────────────

/**
 * Build a firm-standard heading paragraph.
 * Calibri bold navy, gold bottom border for H1/H2/H3, no border for H4.
 */
function buildHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
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
    spacing: { before: HEADING_SPACING_BEFORE, after: HEADING_SPACING_AFTER },
    ...(isTopLevel
      ? { border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: GOLD } } }
      : {}),
  });
}

// ── Body paragraph builder ────────────────────────────────────────────────────

/**
 * Build a firm-standard body paragraph.
 * Times New Roman 12pt, justified, spacing after 6pt.
 */
function buildBodyParagraph(line: string): Paragraph {
  return new Paragraph({
    children: segmentsToTextRuns(parseInline(line, { bodyFont: true })),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: BODY_SPACING_AFTER },
  });
}

// ── Drafter note builder ──────────────────────────────────────────────────────

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

// ── List item builder ─────────────────────────────────────────────────────────

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
    // Filter out separator lines (|---|---|)
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
 * Convert a single non-empty line into a Paragraph.
 * Dispatches to the appropriate builder based on line content.
 */
function lineToChild(line: string): Paragraph {
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
  return buildBodyParagraph(line);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string into an array of docx FileChild constructs
 * (Paragraph or Table), ready to be embedded in a Document at the DOCX export
 * handler.
 *
 * The function splits the input on blank lines to identify paragraph blocks,
 * then processes each block:
 *   - Table blocks (all lines are pipe rows or separator rows) -> docx Table
 *   - All other blocks -> individual line-level Paragraphs
 *
 * Empty input returns an empty array.
 *
 * Backward compatibility: plain-text content with no Markdown syntax passes
 * through unchanged — each line becomes a plain body Paragraph.
 *
 * Graceful degradation: malformed Markdown (e.g., broken table syntax) does
 * not throw; it falls back to literal plain-text paragraphs.
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
    // A table block: all lines are either pipe data rows or separator rows.
    // Separator rows (|---|---| style) match both isTableRow and isSepRow, so
    // count them separately and exclude from pipeLineCount to avoid double-counting.
    const sepLineCount = lines.filter((l) => /^\|[-:\s|]+\|?\s*$/.test(l)).length;
    const pipeLineCount = lines.filter((l) => isTableRow(l) && !/^\|[-:\s|]+\|?\s*$/.test(l)).length;
    const isTableBlock = pipeLineCount >= 1 && pipeLineCount + sepLineCount === lines.length;
    if (isTableBlock) {
      const table = buildTable(lines);
      if (table) {
        children.push(table);
        continue;
      }
      // Fallback: render as literal paragraphs if table parse fails
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
