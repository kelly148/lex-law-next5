/**
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 1 (measurement harness)
 *
 * Per-provider token accounting. The foundational finding of the triad review:
 * token accounting is PER-PROVIDER. A single "demand at 16384" number mis-calibrates at
 * least one model because reasoning tokens count against the budget differently:
 *
 *   - OpenAI (GPT-5 / o-series): max_completion_tokens. completion_tokens INCLUDES the
 *     invisible reasoning consumed before any JSON. reasoning_tokens is a SUBSET of
 *     completion_tokens; the EMITTED output is completion_tokens - reasoning_tokens. The model
 *     can burn the whole budget thinking and emit zero/truncated JSON (finish_reason 'length').
 *   - xAI (Grok): OpenAI-compatible; same accounting where it reports reasoning tokens.
 *   - Google (Gemini 2.5): maxOutputTokens. thoughtsTokenCount (reasoning) is SEPARATE from
 *     candidatesTokenCount (emitted output); BOTH consume maxOutputTokens, so the budget
 *     consumed is thoughts + candidates.
 *   - Anthropic (Claude): max_tokens. Thinking is folded INTO output_tokens with no separate
 *     count exposed — the reasoning/output split is UNAVAILABLE and is recorded as null.
 *
 * This module is MEASUREMENT-ONLY. It is pure (no I/O), never throws on partial input, and no
 * runtime control flow depends on its output. The offline measurement runner
 * (tools/calibration/budget_cal1_harness.mjs) mirrors this logic inline because it runs as
 * plain Node ESM without the TS build; keep the two in sync (the unit test pins this copy).
 */

export type ReasoningAccountingMode =
  // reasoning ⊂ completion budget (OpenAI, xAI)
  | 'within-output'
  // reasoning separate from emitted output; both consume the output budget (Gemini)
  | 'separate-from-output'
  // no separate reasoning count exposed (Anthropic, unknown providers)
  | 'unavailable';

export type TruncationAxis = 'reasoning-bound' | 'output-bound' | 'indeterminate';

export interface TokenAccountingInput {
  /** "provider:model", e.g. "openai:gpt-5". */
  modelString: string;
  /** The output/token budget requested for this call (the maxTokens passed to the adapter). */
  requestedMaxTokens?: number | null;
  /** Provider-reported prompt/input tokens. */
  tokensPrompt: number;
  /**
   * Provider-reported completion/output tokens:
   * OpenAI/xAI completion_tokens (includes reasoning); Gemini candidatesTokenCount (emitted
   * only); Anthropic output_tokens (includes any thinking, no split).
   */
  tokensCompletion: number;
  /** Provider-reported reasoning/thinking tokens where available; null/undefined when unavailable. */
  tokensReasoning?: number | null;
  /** Provider finish/stop reason as surfaced in providerMetadata (finishReason | stopReason). */
  finishReason?: string | null;
}

export interface TokenAccounting {
  provider: string;
  modelId: string;
  requestedMaxTokens: number | null;
  reasoningAccounting: ReasoningAccountingMode;
  promptTokens: number;
  /** Reasoning/thinking tokens; null when the provider exposes no separate count. */
  reasoningTokens: number | null;
  /** Emitted (visible) output tokens, best-effort per provider semantics. */
  emittedOutputTokens: number;
  /** Tokens consumed against the OUTPUT budget (the thing requestedMaxTokens caps). */
  budgetConsumedTokens: number;
  /** Total tokens billed for the call (prompt + everything generated). */
  totalTokens: number;
  /** Was the call truncated at the output ceiling? */
  truncated: boolean;
  /** requestedMaxTokens - budgetConsumedTokens (remaining headroom); null when budget unknown. */
  distanceToTruncation: number | null;
  /**
   * emittedOutputTokens / budgetConsumedTokens (0..1) — the signal L2 (Increment 3) branches
   * on: a truncation with a high emitted fraction is output-bound (retry-at-larger likely
   * helps); a low fraction is reasoning-bound (retry is futile). null when nothing was consumed.
   */
  emittedOutputFraction: number | null;
  /**
   * On truncation, which axis ran out: reasoning ate the budget vs. genuine long output.
   * 'indeterminate' off-truncation or when the reasoning split is unavailable.
   */
  truncationAxis: TruncationAxis;
}

const TRUNCATION_FINISH_REASONS = new Set(['length', 'max_tokens', 'MAX_TOKENS']);

function nonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function splitModelString(modelString: string): { provider: string; modelId: string } {
  const i = modelString.indexOf(':');
  if (i < 0) return { provider: modelString, modelId: '' };
  return { provider: modelString.slice(0, i), modelId: modelString.slice(i + 1) };
}

export function reasoningAccountingFor(provider: string): ReasoningAccountingMode {
  if (provider === 'openai' || provider === 'xai') return 'within-output';
  if (provider === 'google') return 'separate-from-output';
  return 'unavailable'; // anthropic and any unknown provider
}

export function isTruncationFinishReason(finishReason?: string | null): boolean {
  if (!finishReason) return false;
  return TRUNCATION_FINISH_REASONS.has(finishReason);
}

/**
 * Normalize a single provider call's raw token counts into a comparable, per-provider-correct
 * reasoning/output split with a truncation read. Pure; never throws.
 */
export function deriveTokenAccounting(input: TokenAccountingInput): TokenAccounting {
  const { provider, modelId } = splitModelString(input.modelString);
  const reasoningAccounting = reasoningAccountingFor(provider);

  const promptTokens = nonNeg(input.tokensPrompt);
  const completion = nonNeg(input.tokensCompletion);
  const rawReasoning =
    input.tokensReasoning === null || input.tokensReasoning === undefined
      ? null
      : nonNeg(input.tokensReasoning);
  // Anthropic (and unknown providers) expose no split: force reasoning to null even if a
  // caller passes a value, so the accounting mode is the single source of truth.
  const reasoningTokens = reasoningAccounting === 'unavailable' ? null : rawReasoning;

  let emittedOutputTokens: number;
  let budgetConsumedTokens: number;
  if (reasoningAccounting === 'within-output') {
    // completion_tokens includes reasoning; emitted = completion - reasoning (best-effort).
    emittedOutputTokens =
      reasoningTokens === null ? completion : Math.max(0, completion - reasoningTokens);
    // the max_completion_tokens budget is consumed by completion_tokens (reasoning + emitted).
    budgetConsumedTokens = completion;
  } else if (reasoningAccounting === 'separate-from-output') {
    // candidatesTokenCount = emitted; thoughtsTokenCount separate; budget covers both.
    emittedOutputTokens = completion;
    budgetConsumedTokens = completion + (reasoningTokens ?? 0);
  } else {
    // unavailable: output_tokens is the emitted count (may include thinking we cannot separate).
    emittedOutputTokens = completion;
    budgetConsumedTokens = completion;
  }

  const totalTokens = promptTokens + budgetConsumedTokens;
  const truncated = isTruncationFinishReason(input.finishReason);
  const requestedMaxTokens =
    input.requestedMaxTokens === null ||
    input.requestedMaxTokens === undefined ||
    !Number.isFinite(input.requestedMaxTokens)
      ? null
      : input.requestedMaxTokens;
  // distanceToTruncation is a LEADING INDICATOR on a SUCCESSFUL (non-truncated) call. NOTE: it
  // can be POSITIVE even when truncated is true — Gemini's thoughtsTokenCount can under-report
  // the budget actually consumed at the MAX_TOKENS ceiling, so budgetConsumedTokens may land
  // below requestedMaxTokens on a truncated call. Any consumer (e.g. the Increment-3 L2
  // escalation) must gate on `truncated` + `truncationAxis`, NOT on the sign of this field.
  const distanceToTruncation =
    requestedMaxTokens === null ? null : requestedMaxTokens - budgetConsumedTokens;
  const emittedOutputFraction =
    budgetConsumedTokens > 0 ? emittedOutputTokens / budgetConsumedTokens : null;

  let truncationAxis: TruncationAxis = 'indeterminate';
  if (truncated) {
    if (reasoningTokens !== null) {
      // We can see the split: reasoning consumed more than the emitted output => reasoning-bound.
      truncationAxis = reasoningTokens > emittedOutputTokens ? 'reasoning-bound' : 'output-bound';
    } else {
      // No reasoning visibility (Anthropic, or provider did not report it): cannot attribute.
      truncationAxis = 'indeterminate';
    }
  }

  return {
    provider,
    modelId,
    requestedMaxTokens,
    reasoningAccounting,
    promptTokens,
    reasoningTokens,
    emittedOutputTokens,
    budgetConsumedTokens,
    totalTokens,
    truncated,
    distanceToTruncation,
    emittedOutputFraction,
    truncationAxis,
  };
}

/** Compact one-line representation for the per-call server log (Increment 1 observability). */
export function formatTokenAccounting(acc: TokenAccounting): string {
  return [
    `provider=${acc.provider}`,
    `model=${acc.modelId}`,
    `maxTokens=${acc.requestedMaxTokens ?? 'n/a'}`,
    `prompt=${acc.promptTokens}`,
    `reasoning=${acc.reasoningTokens ?? 'n/a'}`,
    `emitted=${acc.emittedOutputTokens}`,
    `budgetUsed=${acc.budgetConsumedTokens}`,
    `total=${acc.totalTokens}`,
    `dist=${acc.distanceToTruncation ?? 'n/a'}`,
    `emitFrac=${acc.emittedOutputFraction === null ? 'n/a' : acc.emittedOutputFraction.toFixed(3)}`,
    `truncated=${acc.truncated}`,
    acc.truncated ? `axis=${acc.truncationAxis}` : '',
    `acct=${acc.reasoningAccounting}`,
  ]
    .filter(Boolean)
    .join(' ');
}

// ============================================================
// Pre-flight token-demand estimate (Increment 1 primitive)
//
// Counts INPUT tokens before fan-out so "document too large" can later (Increment 2+) be gated
// upstream rather than discovered by burning N×budget across N reviewers. Dependency-free
// heuristic consistent with the existing context pipeline (≈ 1 token / 4 chars). This is an
// ESTIMATE, not an exact tokenizer; the measurement runner reports the estimate-vs-actual gap.
// ============================================================

export const CHARS_PER_TOKEN = 4;

export function estimateInputTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface PreflightEstimate {
  estimatedInputTokens: number;
  requestedMaxTokens: number;
  /** estimatedInputTokens + requestedMaxTokens — a rough worst-case context footprint. */
  estimatedTotalTokens: number;
}

export function estimatePreflight(text: string, requestedMaxTokens: number): PreflightEstimate {
  const estimatedInputTokens = estimateInputTokens(text);
  return {
    estimatedInputTokens,
    requestedMaxTokens,
    estimatedTotalTokens: estimatedInputTokens + requestedMaxTokens,
  };
}
