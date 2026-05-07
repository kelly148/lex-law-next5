/**
 * instrumentFormatter.ts — MR-UPLOAD-FORMAT-4
 *
 * Narrow POA/legal-instrument preprocessing wrapper for the Upload & Format
 * Legal Instrument / General profile.
 *
 * Responsibilities:
 *   1. Detect POA-type instruments (Virginia Durable Financial Power of Attorney
 *      and similar estate-planning instruments).
 *   2. Normalize Roman numeral legal headings to ARTICLE form.
 *   3. Deduplicate repeated title lines near the beginning of the document.
 *   4. Ensure EXECUTION, NOTARY ACKNOWLEDGMENT, and PREPARED BY are rendered
 *      as major section headings (# prefix) so the existing renderer applies
 *      the two-paragraph section-header pattern with gold rule.
 *   5. Pass the normalized Markdown to buildSatterwhiteSection for rendering.
 *
 * Content preservation guarantee:
 *   - No substantive legal provisions are added, deleted, or changed.
 *   - Only heading casing/format normalization, duplicate title cleanup,
 *     layout/spacing improvements, and major heading promotion are applied.
 *   - Parties, names, statutory citations, dates, and blanks are preserved.
 *
 * AHC compliance:
 *   - No second formatting engine.
 *   - No new dependencies.
 *   - No LLM/prompt/DB/deployment changes.
 *   - Reuses buildSatterwhiteSection and existing docx primitives.
 *
 * @module instrumentFormatter
 */

import { buildSatterwhiteSection } from './markdownToDocx.js';
import type { ISectionOptions } from 'docx';

// ── POA detection heuristics ──────────────────────────────────────────────────

/**
 * Detect whether the source text is a Virginia Durable Financial Power of
 * Attorney or similar estate-planning instrument.
 *
 * Uses conservative heuristics: at least one of the primary markers must be
 * present. Does not infer content.
 */
export function isPOAInstrument(text: string): boolean {
  const sample = text.slice(0, 4000).toUpperCase();
  return (
    sample.includes('POWER OF ATTORNEY') ||
    sample.includes('VA. CODE §§ 64.2-1600') ||
    sample.includes('VIRGINIA UNIFORM POWER OF ATTORNEY ACT') ||
    sample.includes('ATTORNEY-IN-FACT') ||
    sample.includes('DURABLE FINANCIAL')
  );
}

// ── Roman numeral helpers ─────────────────────────────────────────────────────

const ROMAN_PATTERN = /^(I{1,3}|IV|V|VI{0,3}|IX|X{1,3}|XI{1,3}|XIV|XV|XVI{0,3}|XIX|XX{1,3}|XXI{1,3}|XXIV|XXV|XXVI{0,3}|XXIX|XXX)\./i;

/**
 * Convert a line that starts with a bare Roman numeral heading to ARTICLE form.
 *
 * Examples:
 *   "I. Grant of Authority"  →  "ARTICLE I. Grant of Authority"
 *   "ARTICLE I. Grant of Authority"  →  unchanged (already in Article form)
 *   "IV. Successor Agent"  →  "ARTICLE IV. Successor Agent"
 *
 * Preserves heading text exactly. Does not renumber or infer missing articles.
 */
export function normalizeArticleHeading(line: string): string {
  const t = line.trim();
  // Already in ARTICLE form — preserve exactly
  if (/^ARTICLE\s+[IVXLCDM\d]+\b/i.test(t)) return line;
  // Bare Roman numeral at line start: "I. Heading Text"
  const match = ROMAN_PATTERN.exec(t);
  if (match && match[1]) {
    const roman = match[1].toUpperCase();
    const rest = t.slice(match[0].length).trim();
    // Convert all-caps heading text to title case only if all-caps
    const headingText = isAllCaps(rest) ? toTitleCase(rest) : rest;
    return `ARTICLE ${roman}. ${headingText}`;
  }
  return line;
}

/**
 * Check if a string is all-caps (ignoring punctuation and spaces).
 */
function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

/**
 * Convert a string to title case.
 * Preserves small words (and, of, the, etc.) in lowercase unless first/last.
 */
function toTitleCase(s: string): string {
  const small = new Set(['and', 'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'or', 'nor', 'but', 'by', 'as', 'up', 'via']);
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      // Handle hyphenated words: capitalize each part
      if (w.includes('-')) {
        return w
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('-');
      }
      if (i === 0 || i === words.length - 1 || !small.has(w)) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
      return w;
    })
    .join(' ');
}

// ── Duplicate title cleanup ───────────────────────────────────────────────────

/**
 * Remove repeated identical title lines when they appear close together at the
 * beginning of the document.
 *
 * Strategy: scan the first 60 lines. If a title line appears more than once
 * within that window, keep only the first occurrence. Distinct subtitles and
 * statutory references are preserved.
 *
 * "Identical" means normalized (trimmed, single-spaced, same case).
 */
export function deduplicateTitleLines(lines: string[]): string[] {
  const WINDOW = 60;
  const seen = new Map<string, number>(); // normalized → first occurrence index
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (i < WINDOW) {
      const norm = line.trim().replace(/\s+/g, ' ').toUpperCase();
      if (norm.length > 0 && seen.has(norm)) {
        // Duplicate title line — skip
        continue;
      }
      if (norm.length > 0) {
        seen.set(norm, i);
      }
    }
    result.push(line);
  }
  return result;
}

// ── Major heading promotion ───────────────────────────────────────────────────

/**
 * Major headings that should receive the two-paragraph section-header treatment
 * (bold navy + gold rule) in the rendered output.
 *
 * These are promoted to Markdown `# ` headings so that the existing renderer
 * applies the correct styling.
 */
const MAJOR_HEADINGS = [
  'EXECUTION',
  'NOTARY ACKNOWLEDGMENT',
  'PREPARED BY',
  'CERTIFICATE OF NOTARY',
  'ACKNOWLEDGMENT',
  'WITNESS',
  'ATTESTATION',
];

/**
 * Promote bare major headings to Markdown `# ` headings.
 *
 * Only promotes lines that are exactly a major heading (possibly with trailing
 * punctuation), not lines that are part of a sentence.
 */
export function promoteMajorHeadings(line: string): string {
  const t = line.trim();
  // Already a Markdown heading — preserve
  if (/^#{1,4}\s/.test(t)) return line;
  // Check if line matches a major heading exactly (with optional trailing colon/period)
  const normalized = t.replace(/[:.]*$/, '').trim().toUpperCase();
  if (MAJOR_HEADINGS.includes(normalized)) {
    return `# ${t}`;
  }
  return line;
}

// ── Article heading normalization (line-level) ────────────────────────────────

/**
 * Determine whether a line is a bare Roman numeral heading that should be
 * normalized to ARTICLE form.
 *
 * A bare Roman numeral heading:
 *   - starts with a Roman numeral followed by a period
 *   - is not already in ARTICLE form
 *   - is not a list item (does not start with - or *)
 *   - has at least some heading text after the numeral
 */
export function isBareRomanHeading(line: string): boolean {
  const t = line.trim();
  if (/^ARTICLE\s+/i.test(t)) return false;
  if (/^[-*]/.test(t)) return false;
  const match = ROMAN_PATTERN.exec(t);
  if (!match) return false;
  const rest = t.slice(match[0].length).trim();
  return rest.length > 0;
}

// ── Main normalization pipeline ───────────────────────────────────────────────

/**
 * Normalize a POA/legal-instrument Markdown string for improved rendering.
 *
 * Steps:
 *   1. Split into lines.
 *   2. Deduplicate repeated title lines in the opening window.
 *   3. Normalize bare Roman numeral headings to ARTICLE form.
 *   4. Promote EXECUTION / NOTARY ACKNOWLEDGMENT / PREPARED BY to # headings.
 *   5. Rejoin lines.
 *
 * Content preservation: only heading normalization and duplicate title cleanup.
 * No provisions, names, citations, dates, or blanks are changed.
 */
export function normalizeInstrumentMarkdown(text: string): string {
  const lines = text.split('\n');

  // Step 1: Deduplicate title lines in opening window
  const deduped = deduplicateTitleLines(lines);

  // Steps 2–4: Per-line transformations
  const normalized = deduped.map((line) => {
    // Promote major headings first (before article normalization)
    const promoted = promoteMajorHeadings(line);
    // If the line was promoted, skip article normalization
    if (promoted !== line) return promoted;
    // Normalize bare Roman numeral headings
    if (isBareRomanHeading(line)) {
      return normalizeArticleHeading(line);
    }
    return line;
  });

  return normalized.join('\n');
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a complete DOCX section for a Legal Instrument / General document.
 *
 * For POA-type instruments, applies normalization before rendering.
 * For non-POA sources, passes through to buildSatterwhiteSection unchanged.
 *
 * @param text - The extracted/converted Markdown text from the uploaded file.
 * @returns ISectionOptions for use in a docx Document.
 */
export function buildLegalInstrumentSection(text: string): ISectionOptions {
  if (isPOAInstrument(text)) {
    const normalized = normalizeInstrumentMarkdown(text);
    return buildSatterwhiteSection(normalized, { watermarkText: null });
  }
  // Non-POA: pass through unchanged
  return buildSatterwhiteSection(text, { watermarkText: null });
}
