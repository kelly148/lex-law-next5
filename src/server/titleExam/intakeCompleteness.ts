/**
 * intakeCompleteness.ts — TITLE-EXAM-1 (T2), NC-10 input-completeness guard.
 *
 * Combines the coverage-guaranteed chunker's full coverage of the AVAILABLE text with the coverage GAPS
 * that occurred UPSTREAM of it — pages beyond the rasterize/processing cap, OCR-failed pages, and any lane
 * char budget that cannot ingest all chunks — into a single, explicit completeness verdict. A truncated
 * exam must NEVER read as complete (spec §3, NC-10); this produces the incompleteness banner state
 * (session.completeness / incompletenessReason / droppedPageCount) as a machine-readable fact.
 *
 * PURE. Flag-dark by construction (nothing live imports it until intake is wired behind TITLE_EXAM_ENABLED).
 */

import { chunkWithCoverage, DEFAULT_CHUNK_CHARS, type CoverageAccounting } from './coverageChunker.js';

export interface IntakeCoverageInput {
  /** The text actually available to the exam (already OCR/text-extracted). */
  extractedText: string;
  /** Total pages in the source abstract package, if known. */
  totalSourcePages?: number;
  /** Pages actually rasterized/extracted. Defaults to min(totalSourcePages, pageCap) when a cap applies. */
  processedPages?: number;
  /** The rasterize/processing page cap (e.g. 25). Pages beyond it are dropped. */
  pageCap?: number;
  /** Pages that were processed but OCR could not read (their text is absent). */
  failedPages?: number;
  /** Max chars a single exam lane can ingest across chunks (0/undefined = unbounded). */
  laneCharBudget?: number;
  /** Chunk size for the coverage chunker (defaults to DEFAULT_CHUNK_CHARS). */
  chunkChars?: number;
}

export interface IntakeCompleteness {
  completeness: 'complete' | 'incomplete';
  droppedPageCount: number;
  /** Prominent banner text when incomplete (enumerates the causes); null when complete. */
  incompletenessReason: string | null;
  /** Full-coverage accounting of the available text. */
  coverage: CoverageAccounting;
  /** Whether every chunk fits inside the lane char budget (true when no budget applies). */
  coveredByLaneBudget: boolean;
  /** Chars beyond the lane budget that a single-pass lane would drop (0 when within budget). */
  charsBeyondLaneBudget: number;
}

function nonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Assess intake completeness. Returns 'incomplete' when ANY coverage gap exists — pages dropped for the
 * page cap, OCR-failed pages, or content beyond the lane char budget — with a banner enumerating each
 * cause. Returns 'complete' only when nothing was dropped and the chunker covers the whole available text.
 */
export function assessIntakeCompleteness(input: IntakeCoverageInput): IntakeCompleteness {
  const coverage = chunkWithCoverage(input.extractedText, input.chunkChars ?? DEFAULT_CHUNK_CHARS);

  const totalSourcePages = nonNeg(input.totalSourcePages ?? 0);
  const pageCap = nonNeg(input.pageCap ?? 0);
  const failedPages = nonNeg(input.failedPages ?? 0);

  // How many pages actually made it into the extracted text. If not given, infer from the cap.
  const cappedProcessable =
    pageCap > 0 && totalSourcePages > 0 ? Math.min(totalSourcePages, pageCap) : totalSourcePages;
  const processedPages = nonNeg(input.processedPages ?? cappedProcessable);

  // Pages never examined = (source - processed) + (processed but unreadable). A page is only "covered"
  // when it was processed AND readable.
  const pagesBeyondCap = Math.max(0, totalSourcePages - processedPages);
  const droppedPageCount = pagesBeyondCap + failedPages;

  // Lane char budget: content a single-pass lane cannot ingest is dropped.
  const laneCharBudget = nonNeg(input.laneCharBudget ?? 0);
  const charsBeyondLaneBudget =
    laneCharBudget > 0 ? Math.max(0, coverage.totalChars - laneCharBudget) : 0;
  const coveredByLaneBudget = charsBeyondLaneBudget === 0;

  const causes: string[] = [];
  if (pagesBeyondCap > 0) {
    causes.push(
      `${pagesBeyondCap} page(s) were not examined${pageCap > 0 ? ` (beyond the ${pageCap}-page processing cap)` : ''}`,
    );
  }
  if (failedPages > 0) {
    causes.push(`${failedPages} page(s) failed OCR and could not be read`);
  }
  if (charsBeyondLaneBudget > 0) {
    causes.push(
      `${charsBeyondLaneBudget} character(s) of the abstract exceed the lane ingest budget and were not examined in a single pass`,
    );
  }
  // The chunker itself never drops; guard anyway so a future change surfaces rather than hides.
  if (!coverage.complete || coverage.droppedRanges.length > 0) {
    causes.push('the abstract text could not be fully chunked for examination');
  }

  const isIncomplete = causes.length > 0;
  const incompletenessReason = isIncomplete
    ? `INCOMPLETE EXAMINATION — do not rely on this as a full title examination: ${causes.join('; ')}.`
    : null;

  return {
    completeness: isIncomplete ? 'incomplete' : 'complete',
    droppedPageCount,
    incompletenessReason,
    coverage,
    coveredByLaneBudget,
    charsBeyondLaneBudget,
  };
}
