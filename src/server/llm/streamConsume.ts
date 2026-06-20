/**
 * Shared LLM-stream accumulator (F3 token streaming, DRAFT-STREAMING-1).
 *
 * The ONE place that consumes an LlmClient.generateStream() iterable: it forwards each incremental text
 * delta to `onDelta` (the display overlay — e.g. the per-job SSE bus) and returns the terminal
 * LlmGenerateResult, which is the AUTHORITATIVE value the caller persists via the existing two-transaction
 * commit. Deltas are ephemeral/display-only; the final result is the single source of truth.
 *
 * Provider adapters only yield chunks; this accumulator owns the delta->final assembly so every provider
 * reuses the identical LlmGenerateResult shape (no per-adapter accumulation drift). It reaches no provider
 * (it consumes an already-opened iterable), so it sits outside the adapter chokepoint by design.
 */
import { LlmProviderError, type LlmGenerateResult, type LlmStreamChunk } from './types.js';

export async function consumeLlmStream(
  stream: AsyncIterable<LlmStreamChunk>,
  onDelta: (text: string) => void,
): Promise<LlmGenerateResult> {
  let final: LlmGenerateResult | null = null;
  for await (const chunk of stream) {
    if (chunk.kind === 'delta') {
      // A delta carries display text only. An empty delta is a no-op (do not notify).
      if (chunk.text.length > 0) onDelta(chunk.text);
    } else {
      // The terminal chunk. A well-behaved adapter yields exactly one; if it yields more, the last wins
      // (the stream is already complete by contract, so this is defensive only).
      final = chunk.result;
    }
  }
  if (final === null) {
    // The adapter completed the iterable without a terminal result — treat as an api_error so the existing
    // failure path (txn2Revert, mark failed) runs and NOTHING partial is persisted (discard-on-interrupt).
    throw new LlmProviderError('api_error', 'LLM stream ended without a final result chunk');
  }
  return final;
}
