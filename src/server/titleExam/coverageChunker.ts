/**
 * coverageChunker.ts — TITLE-EXAM-1 (T2), NC-10 coverage-guaranteed chunker.
 *
 * The module's WORST failure mode is a truncated exam that reads as complete (spec §3, NC-10). This
 * chunker is the deliberate opposite of the existing analysis-context builder (buildAnalysisMaterialsBlock),
 * which silently truncates at a char budget and only leaves a prose "[…truncated]" note. Here every input
 * character is placed in exactly one contiguous chunk and the coverage is ACCOUNTED (coveredChars vs
 * totalChars) so an incompleteness is a machine-readable fact, never a note that can be missed.
 *
 * PURE. No I/O, no provider, no DB. Flag-dark by construction (nothing live imports it until the exam
 * lanes are wired behind TITLE_EXAM_ENABLED).
 */

/** A contiguous slice of the source text. charStart inclusive, charEnd exclusive. */
export interface CoverageChunk {
  index: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface CoverageAccounting {
  totalChars: number;
  coveredChars: number;
  chunks: CoverageChunk[];
  /** Ranges of the input this chunker could NOT place in a chunk. Always [] here (it covers everything);
   *  the field exists so a downstream budget that DROPS chunks can record what it left out. */
  droppedRanges: Array<{ start: number; end: number }>;
  /** True iff every input character is covered by a chunk (coveredChars === totalChars) with nothing dropped. */
  complete: boolean;
}

/** A bounded chunk size. Chosen conservatively so a single chunk fits comfortably inside a lane request. */
export const DEFAULT_CHUNK_CHARS = 40_000;

/**
 * Partition `text` into contiguous chunks of at most `chunkChars` characters, covering EVERY character
 * with no gap and no overlap. The returned accounting proves full coverage (coveredChars === totalChars,
 * droppedRanges empty, complete true). A caller that must drop chunks for a downstream budget records that
 * in its own accounting (see intakeCompleteness.assessIntakeCompleteness) — this function never drops.
 */
export function chunkWithCoverage(
  text: string,
  chunkChars: number = DEFAULT_CHUNK_CHARS,
): CoverageAccounting {
  const totalChars = text.length;
  const size = Number.isFinite(chunkChars) && chunkChars > 0 ? Math.floor(chunkChars) : DEFAULT_CHUNK_CHARS;
  const chunks: CoverageChunk[] = [];

  if (totalChars === 0) {
    return { totalChars: 0, coveredChars: 0, chunks: [], droppedRanges: [], complete: true };
  }

  let start = 0;
  let index = 0;
  while (start < totalChars) {
    const end = Math.min(start + size, totalChars);
    chunks.push({ index, charStart: start, charEnd: end, text: text.slice(start, end) });
    start = end;
    index += 1;
  }

  const coveredChars = chunks.reduce((sum, c) => sum + (c.charEnd - c.charStart), 0);
  return {
    totalChars,
    coveredChars,
    chunks,
    droppedRanges: [],
    complete: coveredChars === totalChars,
  };
}
