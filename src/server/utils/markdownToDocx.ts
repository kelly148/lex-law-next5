/**
 * markdownToDocx.ts
 *
 * MR-EXPORT-1 — Markdown-to-DOCX helper.
 *
 * Converts a defined Markdown subset into an array of `docx` library Paragraph
 * constructs, ready to be embedded in a Document at the DOCX export handler.
 *
 * Supported Markdown subset (v1 only — DO NOT EXPAND without a new engagement):
 *   ## Section Title     → HeadingLevel.HEADING_1
 *   ### Subsection       → HeadingLevel.HEADING_2
 *   #### Sub-subsection  → HeadingLevel.HEADING_3
 *   **bold**             → TextRun bold: true
 *   *italic*             → TextRun italics: true
 *   ***bold-italic***    → TextRun bold: true, italics: true
 *   ---                  → Paragraph with bottom border (horizontal rule)
 *   plain text           → Paragraph with single TextRun
 *
 * Deferred (NOT supported in v1 — render as literal plain text):
 *   Single-# headings, lists, tables, links, code blocks, images, blockquotes,
 *   nested formatting beyond ***bold-italic***, HTML pass-through.
 *
 * Heading mapping is intentionally non-standard: ## is the application-level
 * top heading because MR-PROMPT-1's prompt instructs the LLM to use ## as the
 * document's top heading. ## → HEADING_1, ### → HEADING_2, #### → HEADING_3.
 */

import { BorderStyle, HeadingLevel, Paragraph, TextRun } from 'docx';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single inline text segment with optional bold/italic formatting. */
interface TextSegment {
  text: string;
  bold?: boolean;
  italics?: boolean;
}

// ── Inline parser ─────────────────────────────────────────────────────────────

/**
 * Parse inline Markdown formatting within a single line of text.
 *
 * Precedence order (to avoid greedy-match issues):
 *   1. ***text*** → bold + italic
 *   2. **text**   → bold
 *   3. *text*     → italic
 *   4. Unmatched asterisks → literal text (no error throw)
 *
 * Invariants:
 *   - Preserves surrounding plain text order.
 *   - Does NOT parse across line boundaries (caller splits on lines).
 *   - Empty formatting markers (e.g., ****, ** **, standalone ***) render as
 *     literal text rather than producing zero-width TextRuns.
 *   - List markers (- , * , + at line start) are handled by the line-level
 *     dispatcher as deferred Markdown before reaching this function.
 */
function parseInline(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Regex matches ***text***, **text**, or *text* — in that precedence order.
  // The pattern requires non-empty content between markers.
  const pattern = /(\*{3}(.+?)\*{3}|\*{2}(.+?)\*{2}|\*([^*\n]+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    // Capture any plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) });
    }

    const full = match[0];
    if (full.startsWith('***')) {
      // bold + italic: ***text***
      segments.push({ text: match[2] ?? '', bold: true, italics: true });
    } else if (full.startsWith('**')) {
      // bold: **text**
      segments.push({ text: match[3] ?? '', bold: true });
    } else {
      // italic: *text*
      segments.push({ text: match[4] ?? '', italics: true });
    }

    lastIndex = match.index + full.length;
  }

  // Capture any remaining plain text after the last match
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  // If no segments were produced (empty line), return a single empty segment
  if (segments.length === 0) {
    segments.push({ text: line });
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
        }),
    );
}

// ── Line-level dispatcher ─────────────────────────────────────────────────────

/**
 * Convert a single non-empty line into a docx Paragraph.
 *
 * Heading lines (## / ### / ####) are dispatched to heading paragraphs.
 * Horizontal rule lines (---) are dispatched to border paragraphs.
 * All other lines (including deferred Markdown) are rendered as plain text
 * with inline formatting applied.
 */
function lineToParagraph(line: string): Paragraph {
  // Heading: ## (HEADING_1)
  if (/^## /.test(line)) {
    const text = line.slice(3);
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: segmentsToTextRuns(parseInline(text)),
    });
  }

  // Heading: ### (HEADING_2)
  if (/^### /.test(line)) {
    const text = line.slice(4);
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: segmentsToTextRuns(parseInline(text)),
    });
  }

  // Heading: #### (HEADING_3)
  if (/^#### /.test(line)) {
    const text = line.slice(5);
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: segmentsToTextRuns(parseInline(text)),
    });
  }

  // Horizontal rule: --- alone on a line
  if (/^---$/.test(line.trim())) {
    return new Paragraph({
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 6,
          space: 1,
          color: '000000',
        },
      },
    });
  }

  // Plain paragraph (including deferred Markdown — renders as literal text)
  return new Paragraph({
    children: segmentsToTextRuns(parseInline(line)),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string into an array of docx Paragraph constructs.
 *
 * The function splits the input on blank lines to identify paragraph blocks,
 * then splits each block on single newlines to identify individual lines.
 * Each non-empty line produces exactly one Paragraph.
 *
 * Empty input returns an empty array.
 *
 * Backward compatibility: plain-text content with no Markdown syntax passes
 * through unchanged — each line becomes a plain Paragraph with a single TextRun.
 */
export function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  if (!markdown || markdown.trim().length === 0) {
    return [];
  }

  const paragraphs: Paragraph[] = [];

  // Split on one or more blank lines to get paragraph blocks
  const blocks = markdown.split(/\n{2,}/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Split block into individual lines
    const lines = trimmed.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      paragraphs.push(lineToParagraph(trimmedLine));
    }
  }

  return paragraphs;
}
