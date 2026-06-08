/**
 * analysisContext.ts — ASSESSMENT-DRAWER-1 fix: assemble the matter's uploaded/intake material TEXT into
 * the pre-drafting analysis context.
 *
 * ROOT CAUSE this addresses: matterIntake.generateAnalysis previously built its LLM prompt from matter
 * title + parties ONLY, so the assessment never saw the documents/materials drawer and (correctly, given
 * its empty context) reported "no information provided." This builds a TOKEN-BUDGETED source-materials block
 * from extraction-complete material textContent so the assessment reflects the file.
 *
 * PURE + deterministic (no I/O) so the budgeting/truncation is unit-tested. Only the attorney's OWN matter
 * materials are included (already owner-scoped + soft-delete-filtered by the caller's query). NOT a raw dump:
 * a total character budget caps cost/context, with explicit truncation/omission notes so the model (and the
 * attorney reading the basis) can never mistake a budget cap for "nothing was provided."
 */

export interface AnalysisMaterialInput {
  filename: string | null;
  textContent: string | null;
  extractionStatus: string;
}

export interface AnalysisMaterialsBlock {
  block: string; // '' when no usable material text
  includedCount: number;
  truncatedCount: number;
  omittedCount: number;
}

const DEFAULT_TOTAL_CHAR_BUDGET = 120_000; // ~30k tokens of input context; bounds cost on large packets

/**
 * Build the source-materials prompt block from extraction-complete materials, within a total character
 * budget. Materials are consumed in the order given (the caller lists them recency-first); when the budget
 * is exhausted the overflowing material is truncated (with a note) and any remainder are omitted (counted).
 */
export function buildAnalysisMaterialsBlock(
  materials: AnalysisMaterialInput[],
  totalCharBudget: number = DEFAULT_TOTAL_CHAR_BUDGET,
): AnalysisMaterialsBlock {
  const usable = materials.filter(
    (m) => m.extractionStatus === 'completed' && typeof m.textContent === 'string' && m.textContent.trim().length > 0,
  );
  if (usable.length === 0) return { block: '', includedCount: 0, truncatedCount: 0, omittedCount: 0 };

  let remaining = Math.max(0, totalCharBudget);
  let includedCount = 0;
  let truncatedCount = 0;
  let omittedCount = 0;
  const entries: string[] = [];

  for (const m of usable) {
    const label = m.filename && m.filename.trim() !== '' ? m.filename.trim() : 'pasted text';
    const text = (m.textContent ?? '').trim();
    if (remaining <= 0) {
      omittedCount++;
      continue;
    }
    if (text.length <= remaining) {
      entries.push(`--- ${label} ---\n${text}`);
      remaining -= text.length;
      includedCount++;
    } else {
      entries.push(`--- ${label} (truncated to fit) ---\n${text.slice(0, remaining)}\n[…truncated]`);
      remaining = 0;
      includedCount++;
      truncatedCount++;
    }
  }

  const notes: string[] = [];
  if (truncatedCount > 0) notes.push(`${truncatedCount} material(s) were truncated to fit the context budget.`);
  if (omittedCount > 0) notes.push(`${omittedCount} additional material(s) were omitted for length — request a focused pass if needed.`);

  const header =
    'Source materials (client-provided intake / matter files — attorney work-product context; base the assessment on these):';
  const block = [header, '', entries.join('\n\n'), notes.length > 0 ? `\n(${notes.join(' ')})` : ''].join('\n');
  return { block, includedCount, truncatedCount, omittedCount };
}
