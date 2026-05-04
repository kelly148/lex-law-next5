/**
 * markdownToDocx.ts
 *
 * MR-EXPORT-FORMAT-3 — Satterwhite Formal Document Formatting Specification (v4).
 *
 * Replaces the looser house-style assumptions from MR-EXPORT-FORMAT-1 and
 * MR-EXPORT-FORMAT-2 with deterministic renderer rules based on the exact
 * Satterwhite Law Firm Document Formatting Specification.
 *
 * Key changes in v4 (MR-EXPORT-FORMAT-3):
 *   - Exact constants: lowercase hex, DXA page size (12240x15840), margins 1440,
 *     header/footer offsets 708, content width 9360.
 *   - Body charcoal 404040 (no pure-black body text).
 *   - Two-paragraph section-header pattern: heading paragraph (Times New Roman
 *     12pt bold navy left-aligned) + empty gold-rule paragraph.
 *   - Cover page architecture for fiduciary instruments (trusts, wills, POAs,
 *     advance directives): typography-only cover with navy rules, gold rules,
 *     principal name, firm block, CONFIDENTIAL, page break.
 *   - Running header: right-aligned Calibri italic 8pt navy with bottom border.
 *   - Running footer: left firm text + right tab PAGE field, Calibri 8pt navy,
 *     top border, tab stop at 9360. Uses SimpleField("PAGE").
 *   - Body paragraph: Times New Roman 12pt charcoal 404040, justified,
 *     line spacing 276 auto, after 180, no before, no first-line indent.
 *   - Bold heading normalization: strip ** markers from heading detection;
 *     no literal ** artifacts in DOCX.
 *   - Table: WidthType.DXA 9360, ShadingType.CLEAR, navy header, white bold
 *     Calibri, alternating f2f2f2, borders cccccc.
 *   - Lists: literal A./B./C. and 1./2./3. text, left indent 720, no docx
 *     auto-numbering, no unicode bullet for content bullets.
 *   - Signature/notary: exact spec pattern with d9d9d9 bottom border, right
 *     indent 4680, two-paragraph section-header pattern for Execution and
 *     Notary Acknowledgment headings.
 *   - XML hygiene: no w:highlightCs, no rootKey, pBdr child ordering safe.
 *   - Full-content preservation: no line/block count limit in renderer.
 *
 * Public API:
 *   markdownToDocxParagraphs(markdown) -> DocxFileChild[]   (backward-compat)
 *   buildSatterwhiteSection(markdown, opts) -> ISectionOptions
 */
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  HighlightColor,
  LineRuleType,
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

// ── Exact constants (Satterwhite Formatting Specification) ────────────────────
// Page setup — US Letter, portrait
const PAGE_WIDTH_DXA = 12240;
const PAGE_HEIGHT_DXA = 15840;
const MARGIN_DXA = 1440;
const HEADER_OFFSET_DXA = 708;
const FOOTER_OFFSET_DXA = 708;
const CONTENT_WIDTH_DXA = 9360;

// Colors — exact lowercase hex per spec
const FIRM_NAVY = '1f3864';
const FIRM_GOLD = 'bf8f00';
const BODY_CHARCOAL = '404040';
const SIGNATURE_LINE_GRAY = 'd9d9d9';
const TABLE_BORDER_GRAY = 'cccccc';
const TABLE_ROW_SHADE = 'f2f2f2';
const DRAFTER_RED = 'c00000';
const WHITE = 'FFFFFF';

// Fonts — two-font system only
const BODY_FONT = 'Times New Roman';
const DISPLAY_FONT = 'Calibri';

// Sizes in half-points
const BODY_SIZE = 24;            // 12pt
const SECTION_HEADING_SIZE = 24; // 12pt per spec
const COVER_TITLE_SIZE = 36;     // 18pt
const COVER_PRINCIPAL_SIZE = 28; // 14pt
const COVER_CAPTION_SIZE = 20;   // 10pt
const RUNNING_HF_SIZE = 16;      // 8pt

// Spacing in DXA/twips
const SECTION_HEADING_BEFORE = 360;
const SECTION_HEADING_AFTER = 120;
const GOLD_RULE_AFTER = 160;
const BODY_AFTER = 180;
const SIGNATURE_RIGHT_INDENT = 4680;

// ── Semantic detection ────────────────────────────────────────────────────────

/**
 * Strip whole-line bold markers (**text**) from a line.
 * Returns the inner text if the entire line is bold-wrapped, otherwise returns
 * the original line unchanged.
 */
function stripWholeBold(line: string): { text: string; wasBold: boolean } {
  const t = line.trim();
  const m = /^\*{2}(.+?)\*{2}$/.exec(t);
  if (m && m[1]) return { text: m[1].trim(), wasBold: true };
  return { text: t, wasBold: false };
}

/**
 * Detect whether a line (after stripping bold markers) is a legal document title.
 * All-caps, at least 5 chars, no lowercase, at least 3 uppercase letters.
 */
function isDocumentTitle(line: string): boolean {
  const { text: t } = stripWholeBold(line);
  if (t.length < 5 || /^---/.test(t) || /^\|/.test(t) || /^#/.test(t)) return false;
  return !/[a-z]/.test(t) && /[A-Z]{3,}/.test(t);
}

/**
 * Detect whether a line is an article heading.
 * Examples: "ARTICLE I — TRUST NAME AND DECLARATION", "**ARTICLE I**"
 */
function isArticleHeading(line: string): boolean {
  const { text: t } = stripWholeBold(line);
  return /^ARTICLE\s+[IVXLCDM\d]+\b/i.test(t);
}

/**
 * Detect whether a line is a section heading (e.g. "Section 1.1 Name of Trust.").
 */
function isSectionHeading(line: string): boolean {
  const { text: t } = stripWholeBold(line);
  return /^Section\s+\d+\.\d+\b/.test(t);
}

/**
 * Detect whether a line is an execution lead-in or major execution heading.
 * Examples: "EXECUTION", "Execution", "IN WITNESS WHEREOF"
 */
function isExecutionLeadIn(line: string): boolean {
  const { text: t } = stripWholeBold(line);
  return /^EXECUTION\s*$/i.test(t) || /^IN WITNESS WHEREOF/i.test(t);
}

/**
 * Detect whether a line is a Notary Acknowledgment heading.
 */
function isNotaryAcknowledgmentHeading(line: string): boolean {
  const { text: t } = stripWholeBold(line);
  return /^NOTARY ACKNOWLEDGMENT\s*$/i.test(t) || /^ACKNOWLEDGMENT\s*$/i.test(t);
}

/**
 * Detect whether a line is a signature block label.
 * Examples: "PRINCIPAL:", "ATTORNEY-IN-FACT:", "AGENT:", "TRUSTEE:"
 */
function isSignatureLabel(line: string): boolean {
  const t = line.trim();
  return /^(PRINCIPAL|ATTORNEY-IN-FACT|AGENT|SUCCESSOR AGENT|GRANTOR|TRUSTEE|BORROWER|LENDER|PERSONAL REPRESENTATIVE)\s*:/i.test(t);
}

/**
 * Detect whether a line is a notary block line.
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
 */
function isPreparerLine(line: string): boolean {
  return /^Prepared\s+[Bb]y\s*:/i.test(line.trim());
}

/**
 * Detect whether a line is a drafter note (*Drafter Note: ...*).
 */
function isDrafterNote(line: string): boolean {
  return /^\*Drafter Note:/i.test(line);
}

/**
 * Detect whether a line is a list item (ordered, lettered, or unordered).
 */
function isListItem(line: string): boolean {
  return /^[-+]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^[A-Z]\.\s+/.test(line);
}

/**
 * Detect whether a line looks like a table row (starts and ends with |).
 */
function isTableRow(line: string): boolean {
  return /^\|.+\|/.test(line.trim());
}

/**
 * Detect whether a line is a signature line placeholder (underscores or dashes).
 */
function isSignatureLine(line: string): boolean {
  const t = line.trim();
  return /^_{10,}$/.test(t) || /^-{10,}$/.test(t);
}

/**
 * Detect whether a document is a fiduciary instrument (trust, will, POA, advance directive).
 */
function isFiduciaryInstrument(markdown: string): boolean {
  const upper = markdown.slice(0, 2000).toUpperCase();
  return (
    /REVOCABLE\s+(LIVING\s+)?TRUST/.test(upper) ||
    /IRREVOCABLE\s+TRUST/.test(upper) ||
    /LAST\s+WILL\s+AND\s+TESTAMENT/.test(upper) ||
    /DURABLE\s+(FINANCIAL\s+)?POWER\s+OF\s+ATTORNEY/.test(upper) ||
    /ADVANCE\s+(MEDICAL\s+)?DIRECTIVE/.test(upper) ||
    /HEALTHCARE\s+DIRECTIVE/.test(upper) ||
    /LIVING\s+WILL/.test(upper)
  );
}

/**
 * Extract the document title from the first title-like line in the content.
 */
function extractDocumentTitle(markdown: string): string | null {
  const lines = markdown.split('\n');
  for (const line of lines.slice(0, 15)) {
    const t = line.trim();
    if (!t) continue;
    if (/^# /.test(t)) return t.slice(2).trim();
    const { text, wasBold } = stripWholeBold(t);
    if (wasBold && isDocumentTitle(t)) return text;
    if (isDocumentTitle(t)) return t;
    if (isArticleHeading(t)) continue;
    break;
  }
  return null;
}

/**
 * Extract the principal/settlor/grantor name from the content.
 */
function extractPrincipalName(markdown: string): string | null {
  const placeholderMatch = /\[\[([A-Z][A-Z\s]+(?:NAME|CLIENT|SETTLOR|GRANTOR|TESTATOR|PRINCIPAL))\]\]/i.exec(markdown.slice(0, 3000));
  if (placeholderMatch) return placeholderMatch[0];
  const grantorMatch = /(?:created by|established by|made by|between)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i.exec(markdown.slice(0, 3000));
  if (grantorMatch && grantorMatch[1]) return grantorMatch[1];
  return null;
}

/**
 * Determine the role caption for the principal on the cover page.
 */
function getRoleCaption(markdown: string): string {
  const upper = markdown.slice(0, 2000).toUpperCase();
  if (/REVOCABLE\s+(LIVING\s+)?TRUST/.test(upper) || /IRREVOCABLE\s+TRUST/.test(upper)) {
    return 'Settlor / Grantor';
  }
  if (/LAST\s+WILL\s+AND\s+TESTAMENT/.test(upper)) return 'Testator';
  if (/DURABLE\s+(FINANCIAL\s+)?POWER\s+OF\s+ATTORNEY/.test(upper)) return 'Principal';
  if (/ADVANCE\s+(MEDICAL\s+)?DIRECTIVE/.test(upper) || /HEALTHCARE\s+DIRECTIVE/.test(upper)) return 'Principal';
  return 'Principal';
}

// ── Inline parser ─────────────────────────────────────────────────────────────

/**
 * Parse inline Markdown formatting within a single line of text.
 * Handles ***bold-italic***, **bold**, *italic*, and [[PLACEHOLDER]] spans.
 */
function parseInline(line: string, opts?: { bodyFont?: boolean; color?: string }): TextSegment[] {
  const useBodyFont = opts?.bodyFont ?? false;
  const defaultColor = opts?.color;
  const segments: TextSegment[] = [];
  const pattern = /(\[\[([^\]]*)\]\]|\*{3}(.+?)\*{3}|\*{2}(.+?)\*{2}|\*([^*\n]+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: line.slice(lastIndex, match.index),
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
        ...(defaultColor ? { color: defaultColor } : {}),
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
        ...(defaultColor ? { color: defaultColor } : {}),
      });
    } else if (full.startsWith('**')) {
      // Inline bold in body: body charcoal, not navy
      segments.push({
        text: match[4] ?? '',
        bold: true,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
        color: defaultColor ?? BODY_CHARCOAL,
      });
    } else {
      segments.push({
        text: match[5] ?? '',
        italics: true,
        ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
        ...(defaultColor ? { color: defaultColor } : {}),
      });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < line.length) {
    segments.push({
      text: line.slice(lastIndex),
      ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      ...(defaultColor ? { color: defaultColor } : {}),
    });
  }
  if (segments.length === 0) {
    segments.push({
      text: line,
      ...(useBodyFont ? { font: BODY_FONT, size: BODY_SIZE } : {}),
      ...(defaultColor ? { color: defaultColor } : {}),
    });
  }
  return segments;
}

/**
 * Convert an array of TextSegments into an array of docx TextRun instances.
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

// ── Section header: two-paragraph pattern ────────────────────────────────────

/**
 * Build the two-paragraph section-header pattern per spec:
 *   P1: heading text — Times New Roman 12pt bold navy left-aligned,
 *       spacing before 360, after 120.
 *   P2: empty paragraph with bottom border gold bf8f00, sz=4, space=4,
 *       spacing after 160.
 *
 * Returns [headingParagraph, goldRuleParagraph].
 */
function buildSectionHeader(text: string): [Paragraph, Paragraph] {
  const headingParagraph = new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: FIRM_NAVY,
        font: BODY_FONT,
        size: SECTION_HEADING_SIZE,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: SECTION_HEADING_BEFORE, after: SECTION_HEADING_AFTER },
    keepNext: true,
  });
  const goldRuleParagraph = new Paragraph({
    children: [new TextRun({ text: '' })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_GOLD },
    },
    spacing: { after: GOLD_RULE_AFTER },
  });
  return [headingParagraph, goldRuleParagraph];
}

// ── Paragraph builders ────────────────────────────────────────────────────────

/**
 * Build a body paragraph per spec:
 * Times New Roman 12pt, charcoal 404040, justified, line spacing 276 auto,
 * after 180, no before, no first-line indent, widow control.
 */
function buildBodyParagraph(line: string): Paragraph {
  return new Paragraph({
    children: segmentsToTextRuns(parseInline(line, { bodyFont: true, color: BODY_CHARCOAL })),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 276, lineRule: LineRuleType.AUTO, after: BODY_AFTER, before: 0 },
    widowControl: true,
  });
}

/**
 * Build a drafter-note paragraph: red italic Times New Roman.
 */
function buildDrafterNote(line: string): Paragraph {
  let text = line;
  if (text.startsWith('*') && text.endsWith('*') && text.length > 2) {
    text = text.slice(1, -1);
  }
  return new Paragraph({
    children: [
      new TextRun({ text, italics: true, color: DRAFTER_RED, font: BODY_FONT, size: BODY_SIZE }),
    ],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: BODY_AFTER },
  });
}

/**
 * Build a list item paragraph.
 * Lettered (A./B./C.) and numbered (1./2./3.) items: literal text, left indent 720.
 * Unordered (-/+): literal text, left indent 720.
 * No docx auto-numbering.
 */
function buildListItem(line: string): Paragraph {
  let prefix = '';
  let content = line;
  const letteredMatch = /^([A-Z]\.\s+)(.*)$/.exec(line);
  if (letteredMatch) {
    prefix = letteredMatch[1] ?? '';
    content = letteredMatch[2] ?? '';
  } else {
    const orderedMatch = /^(\d+[.)]\s*)(.*)$/.exec(line);
    if (orderedMatch) {
      prefix = orderedMatch[1] ?? '';
      content = orderedMatch[2] ?? '';
    } else {
      const unorderedMatch = /^[-+]\s+(.*)$/.exec(line);
      if (unorderedMatch) {
        prefix = '';
        content = unorderedMatch[1] ?? '';
      }
    }
  }
  return new Paragraph({
    children: [
      ...(prefix ? [new TextRun({ text: prefix, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL })] : []),
      ...segmentsToTextRuns(parseInline(content, { bodyFont: true, color: BODY_CHARCOAL })),
    ],
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 276, lineRule: LineRuleType.AUTO, after: BODY_AFTER },
    indent: { left: 720 },
  });
}

/**
 * Build a signature line: empty paragraph with bottom border d9d9d9, sz=4, space=4,
 * right indent 4680.
 */
function buildSignatureLine(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: SIGNATURE_LINE_GRAY },
    },
    indent: { right: SIGNATURE_RIGHT_INDENT },
    spacing: { after: 120 },
  });
}

/**
 * Build a signature label paragraph: bold Times New Roman 12pt charcoal.
 */
function buildSignatureLabel(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        color: BODY_CHARCOAL,
        font: BODY_FONT,
        size: BODY_SIZE,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: 60 },
    keepNext: true,
  });
}

/**
 * Build a notary block paragraph: Times New Roman 12pt charcoal.
 * Jurisdiction lines (COMMONWEALTH OF, STATE OF, COUNTY OF) get bold navy.
 */
function buildNotaryParagraph(text: string): Paragraph {
  const isSeal = /^\[NOTARIAL SEAL\]/i.test(text.trim());
  const isJurisdictionLine = /^(COMMONWEALTH OF|STATE OF|COUNTY OF|CITY OF)/i.test(text.trim());
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        color: isJurisdictionLine ? FIRM_NAVY : BODY_CHARCOAL,
        bold: isJurisdictionLine || isSeal,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: isSeal ? 240 : 60, after: isSeal ? 240 : 60 },
  });
}

/**
 * Build a preparer block paragraph: italic Times New Roman.
 */
function buildPreparerParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: BODY_SIZE,
        italics: true,
        color: BODY_CHARCOAL,
      }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 240, after: BODY_AFTER },
  });
}

/**
 * Build a section heading paragraph (Section 1.1 style):
 * bold Times New Roman 12pt charcoal, justified, keepNext.
 */
function buildSectionHeadingParagraph(text: string): Paragraph {
  return new Paragraph({
    children: segmentsToTextRuns(
      parseInline(text, { bodyFont: true, color: BODY_CHARCOAL }).map((s) => ({ ...s, bold: true })),
    ),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 276, lineRule: LineRuleType.AUTO, after: BODY_AFTER },
    widowControl: true,
    keepNext: true,
  });
}

// ── Table builder ─────────────────────────────────────────────────────────────

/**
 * Parse a Markdown pipe table block into a docx Table per spec:
 * - WidthType.DXA, width 9360.
 * - Navy header row, white bold Calibri text.
 * - Alternating f2f2f2 data row shading.
 * - Thin borders cccccc.
 * - ShadingType.CLEAR (not SOLID).
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
      const fillColor = isHeader ? FIRM_NAVY : isAltRow ? TABLE_ROW_SHADE : WHITE;
      const borderDef = { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_GRAY };
      const cells = Array.from({ length: colCount }, (_, colIndex) => {
        const cellText = rowCells[colIndex] ?? '';
        const textRun = isHeader
          ? new TextRun({ text: cellText, bold: true, color: WHITE, font: DISPLAY_FONT, size: BODY_SIZE })
          : new TextRun({ text: cellText, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL });
        return new TableCell({
          children: [new Paragraph({ children: [textRun] })],
          shading: { fill: fillColor, type: ShadingType.CLEAR },
          borders: { top: borderDef, bottom: borderDef, left: borderDef, right: borderDef },
        });
      });
      return new TableRow({ children: cells });
    });
    return new Table({
      rows: tableRows,
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    });
  } catch {
    return null;
  }
}

// ── Cover page builder ────────────────────────────────────────────────────────

/**
 * Build a typography-only cover page for fiduciary instruments per spec Section 6.
 * Returns an array of Paragraph elements forming the cover page.
 */
function buildCoverPage(markdown: string): Paragraph[] {
  const cover: Paragraph[] = [];
  const titleLine = extractDocumentTitle(markdown) ?? 'LEGAL DOCUMENT';
  const principalName = extractPrincipalName(markdown);

  // Top spacer
  cover.push(new Paragraph({
    children: [new TextRun({ text: '' })],
    spacing: { before: 1440, after: 0 },
  }));

  // Upper navy rule
  cover.push(new Paragraph({
    children: [new TextRun({ text: '' })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, space: 4, color: FIRM_NAVY },
    },
    spacing: { after: 360 },
  }));

  // Title (split on em-dash or hyphen if present)
  const titleParts = titleLine.includes('\u2014')
    ? titleLine.split('\u2014')
    : titleLine.includes(' - ')
    ? titleLine.split(' - ')
    : [titleLine];

  for (const part of titleParts) {
    cover.push(new Paragraph({
      children: [
        new TextRun({
          text: part.trim(),
          bold: true,
          color: FIRM_NAVY,
          font: DISPLAY_FONT,
          size: COVER_TITLE_SIZE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
    }));
  }

  // Double gold rule
  for (let i = 0; i < 2; i++) {
    cover.push(new Paragraph({
      children: [new TextRun({ text: '' })],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_GOLD },
      },
      spacing: { after: i === 0 ? 60 : 360 },
    }));
  }

  // Principal/settlor name
  if (principalName) {
    cover.push(new Paragraph({
      children: [
        new TextRun({
          text: principalName,
          bold: true,
          color: FIRM_NAVY,
          font: BODY_FONT,
          size: COVER_PRINCIPAL_SIZE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
    }));
    const roleCaption = getRoleCaption(markdown);
    cover.push(new Paragraph({
      children: [
        new TextRun({
          text: roleCaption,
          italics: true,
          color: BODY_CHARCOAL,
          font: BODY_FONT,
          size: COVER_CAPTION_SIZE,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
    }));
  }

  // Lower navy rule
  cover.push(new Paragraph({
    children: [new TextRun({ text: '' })],
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, space: 4, color: FIRM_NAVY },
    },
    spacing: { after: 480 },
  }));

  // Prepared by caption
  cover.push(new Paragraph({
    children: [
      new TextRun({
        text: 'Prepared by:',
        italics: true,
        color: BODY_CHARCOAL,
        font: BODY_FONT,
        size: COVER_CAPTION_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
  }));

  // Firm name
  cover.push(new Paragraph({
    children: [
      new TextRun({
        text: 'THE SATTERWHITE LAW FIRM, PLLC',
        bold: true,
        color: FIRM_NAVY,
        font: DISPLAY_FONT,
        size: BODY_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
  }));

  // Virginia • Maryland
  cover.push(new Paragraph({
    children: [
      new TextRun({
        text: 'Virginia \u2022 Maryland',
        color: BODY_CHARCOAL,
        font: DISPLAY_FONT,
        size: COVER_CAPTION_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }));

  // CONFIDENTIAL
  cover.push(new Paragraph({
    children: [
      new TextRun({
        text: 'CONFIDENTIAL',
        bold: true,
        color: FIRM_NAVY,
        font: DISPLAY_FONT,
        size: COVER_CAPTION_SIZE,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
  }));

  return cover;
}

// ── Line-level dispatcher ─────────────────────────────────────────────────────

/**
 * Convert a single non-empty line into one or more Paragraphs.
 * Returns an array because section headers produce two paragraphs.
 */
function lineToChildren(line: string): Paragraph[] {
  const t = line.trim();

  // Explicit Markdown heading markers — use two-paragraph section-header pattern
  if (/^# /.test(t)) return [...buildSectionHeader(t.slice(2).trim())];
  if (/^## /.test(t)) return [...buildSectionHeader(t.slice(3).trim())];
  if (/^### /.test(t)) return [...buildSectionHeader(t.slice(4).trim())];
  if (/^#### /.test(t)) return [buildSectionHeadingParagraph(t.slice(5).trim())];

  // Horizontal rule
  if (/^---$/.test(t)) {
    return [new Paragraph({
      children: [new TextRun({ text: '' })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY } },
      spacing: { after: BODY_AFTER },
    })];
  }

  if (isDrafterNote(t)) return [buildDrafterNote(t)];
  if (isListItem(t)) return [buildListItem(t)];

  // Article headings: two-paragraph section-header pattern
  if (isArticleHeading(t)) {
    const { text: cleanText } = stripWholeBold(t);
    return [...buildSectionHeader(cleanText)];
  }

  // Execution heading: two-paragraph section-header pattern
  if (isExecutionLeadIn(t)) {
    const { text: cleanText } = stripWholeBold(t);
    return [...buildSectionHeader(cleanText)];
  }

  // Notary Acknowledgment heading: two-paragraph section-header pattern
  if (isNotaryAcknowledgmentHeading(t)) {
    const { text: cleanText } = stripWholeBold(t);
    return [...buildSectionHeader(cleanText)];
  }

  // Section headings (Section 1.1 style)
  if (isSectionHeading(t)) {
    const { text: cleanText } = stripWholeBold(t);
    return [buildSectionHeadingParagraph(cleanText)];
  }

  // Signature line underscores
  if (isSignatureLine(t)) return [buildSignatureLine()];

  // Signature labels
  if (isSignatureLabel(t)) return [buildSignatureLabel(t)];

  // Notary block lines
  if (isNotaryLine(t)) return [buildNotaryParagraph(t)];

  // Preparer lines
  if (isPreparerLine(t)) return [buildPreparerParagraph(t)];

  // Document title (all-caps): two-paragraph section-header pattern
  if (isDocumentTitle(t)) {
    const { text: cleanText } = stripWholeBold(t);
    return [...buildSectionHeader(cleanText)];
  }

  // Default: body paragraph
  return [buildBodyParagraph(t)];
}

// ── Core renderer ─────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string into an array of docx FileChild constructs
 * (Paragraph or Table), ready to be embedded in a Document section.
 *
 * Full-content preservation: no line/block count limit. All blocks are processed.
 *
 * Backward-compatible public API.
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
        const paragraphs = lineToChildren(line);
        for (const p of paragraphs) {
          children.push(p);
        }
      } catch {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, font: BODY_FONT, size: BODY_SIZE, color: BODY_CHARCOAL })],
        }));
      }
    }
  }
  return children;
}

// ── Running header/footer builders ───────────────────────────────────────────

/**
 * Build the running header paragraph per spec:
 * Right-aligned, Calibri italic 8pt navy, bottom border navy sz=4 space=4.
 */
function buildRunningHeader(headerText: string, isWatermark: boolean): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: headerText,
        bold: isWatermark,
        italics: !isWatermark,
        color: isWatermark ? DRAFTER_RED : FIRM_NAVY,
        font: DISPLAY_FONT,
        size: RUNNING_HF_SIZE,
      }),
    ],
    alignment: AlignmentType.RIGHT,
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, space: 4, color: FIRM_NAVY },
    },
  });
}

/**
 * Build the running footer paragraph per spec:
 * Left firm text + right tab PAGE field.
 * Calibri 8pt navy, top border navy sz=4 space=4, tab stop right at 9360.
 * Uses SimpleField("PAGE") for real Word PAGE field.
 */
function buildRunningFooter(): Paragraph {
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

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a complete Satterwhite formal-document DOCX section object per spec.
 *
 * Returns an ISectionOptions-compatible object containing:
 *   - properties: explicit US Letter page size (12240x15840), margins 1440,
 *     header/footer offsets 708, portrait orientation.
 *   - headers: right-aligned Calibri italic 8pt navy running header.
 *   - footers: left firm text + right tab PAGE field, Calibri 8pt navy.
 *   - children: cover page (if fiduciary instrument) + rendered content.
 *
 * Profile/privilege routing carryforward (CF-EF3-1):
 *   Document profile/template-vs-signing-copy flag is not available in the
 *   current architecture. Placeholder/drafter-note behavior is preserved.
 */
export function buildSatterwhiteSection(
  markdown: string,
  opts?: SatterwhiteSectionOptions,
): ISectionOptions {
  const bodyChildren = markdownToDocxParagraphs(markdown);
  // Include all children (paragraphs and tables)
  const allChildren = bodyChildren.length > 0 ? bodyChildren : [new Paragraph({ children: [new TextRun({ text: '', font: BODY_FONT, size: BODY_SIZE })] })];

  // ── Running header text ─────────────────────────────────────────────────────
  const isWatermark = !!(opts?.watermarkText);
  let headerText: string;
  if (opts?.watermarkText) {
    headerText = opts.watermarkText;
  } else {
    const docTitle = extractDocumentTitle(markdown);
    const principalName = extractPrincipalName(markdown);
    if (docTitle && principalName) {
      headerText = `${docTitle} \u2022 ${principalName}`;
    } else if (docTitle) {
      headerText = docTitle;
    } else {
      headerText = 'CONFIDENTIAL \u2014 ATTORNEY-CLIENT PRIVILEGED';
    }
  }

  const headerParagraph = buildRunningHeader(headerText, isWatermark);
  const footerParagraph = buildRunningFooter();

  // ── Cover page for fiduciary instruments ────────────────────────────────────
  const hasCoverPage = !isWatermark && isFiduciaryInstrument(markdown);

  if (hasCoverPage) {
    const coverParagraphs = buildCoverPage(markdown);
    const pageBreakParagraph = new Paragraph({
      children: [new TextRun({ text: '', break: 1 })],
      pageBreakBefore: true,
    });
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
      children: [...coverParagraphs, pageBreakParagraph, ...allChildren],
    };
  }

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
    children: allChildren,
  };
}
