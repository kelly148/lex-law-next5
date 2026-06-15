/**
 * chatReviewPanelEngine.ts — CHAT-COPILOT-2 Increment B: the prompt builders, structured-output schemas,
 * parsers, citation flag-not-reject logic, and hashing for the multi-model review panel.
 *
 * PURE (no DB, no network, no provider SDK). The procedure (procedures/chatReviewPanel.ts) wires these to
 * the bundle assembler (reused) and the egress broker (every lane). Kept separate so the prompt/parse
 * contract is unit-testable in isolation.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ChatReviewDispositionSchema,
  type ChatReviewDisposition,
  type ChatReviewCitationStatus,
} from '../../shared/schemas/chatCopilot.js';

/** Stable content hash (workProductHash / bundleHash / suggestionHash). */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ── Structured output contracts (forced via structuredOutputSchema on the LLM call) ─────────────────────

/** What each panel reviewer (GPT/Gemini/Grok) returns: an itemized list of suggestions. */
export const ReviewerSuggestionsSchema = z.object({
  suggestions: z.array(z.object({ suggestion: z.string().min(1) })).max(50),
});
export type ReviewerSuggestions = z.infer<typeof ReviewerSuggestionsSchema>;

/** What the PRIMARY (Claude) dispositioner returns: one disposition per reviewer-suggestion index. */
export const DispositionsSchema = z.object({
  dispositions: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      disposition: ChatReviewDispositionSchema,
      reasoning: z.string().min(1),
    }),
  ),
});
export type Dispositions = z.infer<typeof DispositionsSchema>;

// ── Prompt builders ─────────────────────────────────────────────────────────────────────────────────────

export interface ReviewerPromptArgs {
  workProduct: string;
  bundleContextText: string;
  mode?: string | null;
}

const REVIEWER_SYSTEM = [
  'You are an INDEPENDENT reviewer model on a panel. You did NOT write the work product below; you are not',
  "on the team that did. It is an attorney's INTERNAL AI-drafting work product (analysis/draft text) — NOT",
  'a client-facing document and NOT something being sent or filed. Your job: surface concrete, ITEMIZED',
  'suggestions to improve it. One distinct issue per suggestion. Do NOT rewrite the document; suggest.',
  'When a suggestion relies on a source provided in the [GROUNDED CONTEXT], cite it inline as',
  '[[cite:SOURCE_ID]]. You MAY also reference a real authority that is NOT in the context (e.g. a VA',
  'statute or ethics opinion) — it will be FLAGGED for the attorney to verify, never silently discarded.',
  'Return ONLY the structured suggestions; no preamble.',
].join('\n');

export function buildReviewerReviewPrompt(args: ReviewerPromptArgs): { systemPrompt: string; userPrompt: string } {
  const modeLine = args.mode ? `\n[REVIEW MODE] ${args.mode}\n` : '\n';
  const ctx = args.bundleContextText ? `${args.bundleContextText}\n\n` : '';
  const userPrompt =
    `${ctx}[WORK PRODUCT UNDER REVIEW]\n${args.workProduct}\n${modeLine}` +
    'List your itemized suggestions to improve the work product above.';
  return { systemPrompt: REVIEWER_SYSTEM, userPrompt };
}

export interface DispositionerPromptArgs {
  workProduct: string;
  bundleContextText: string;
  /** The flattened reviewer suggestions, in the index order the dispositioner must answer. */
  suggestions: { index: number; reviewerModel: string; suggestion: string }[];
}

const DISPOSITIONER_SYSTEM = [
  'You are the PRIMARY model that produced the work product below. A panel of OTHER models has suggested',
  'changes to it. You are now judging critiques of your OWN prior work — you have a stake, so be honest and',
  'self-critical; the attorney makes the final call and is the backstop. For EACH numbered suggestion,',
  'return a disposition: "adopt" (you agree it improves the work product), "reject" (you disagree — give the',
  'reason), or "modify_and_adopt" (you partly agree — adopt with a stated modification). Give concise',
  'reasoning for every suggestion. Disposition EVERY index exactly once; do not merge, drop, or invent',
  'suggestions. Nothing you return is applied automatically — these are advisory dispositions for the attorney.',
].join('\n');

export function buildDispositionerPrompt(
  args: DispositionerPromptArgs,
): { systemPrompt: string; userPrompt: string } {
  const ctx = args.bundleContextText ? `${args.bundleContextText}\n\n` : '';
  const numbered = args.suggestions
    .map((s) => `[${s.index}] (from ${s.reviewerModel}) ${s.suggestion}`)
    .join('\n');
  const userPrompt =
    `${ctx}[WORK PRODUCT (yours, under panel review)]\n${args.workProduct}\n\n` +
    `[PANEL SUGGESTIONS — disposition each index exactly once]\n${numbered}`;
  return { systemPrompt: DISPOSITIONER_SYSTEM, userPrompt };
}

// ── Parsers (robust to string OR already-parsed object output) ──────────────────────────────────────────

function coerceObject(output: unknown): unknown {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }
  return output;
}

/**
 * Itemize one reviewer's raw output into suggestion strings. Robust: accepts the structured
 * { suggestions: [...] } object, a bare array, or (fallback) the whole text as a single suggestion when it
 * cannot be parsed — so a malformed-but-nonempty reviewer reply is never silently dropped (it becomes one
 * itemized suggestion the attorney still sees). Returns [] only for genuinely empty output.
 */
export function parseReviewerSuggestions(output: unknown, rawText: string): string[] {
  const obj = coerceObject(output);
  const parsed = ReviewerSuggestionsSchema.safeParse(obj);
  if (parsed.success) {
    return parsed.data.suggestions.map((s) => s.suggestion.trim()).filter((s) => s.length > 0);
  }
  if (Array.isArray(obj)) {
    const items = obj
      .map((x) => (typeof x === 'string' ? x : typeof (x as { suggestion?: unknown })?.suggestion === 'string' ? (x as { suggestion: string }).suggestion : ''))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length > 0) return items;
  }
  const fallback = rawText.trim();
  return fallback.length > 0 ? [fallback] : [];
}

/** Parse the dispositioner output into per-index dispositions. Robust to string/object. */
export function parseDispositions(
  output: unknown,
): { index: number; disposition: ChatReviewDisposition; reasoning: string }[] {
  const obj = coerceObject(output);
  const parsed = DispositionsSchema.safeParse(obj);
  if (parsed.success) return parsed.data.dispositions;
  if (Array.isArray(obj)) {
    const arr = DispositionsSchema.shape.dispositions.safeParse(obj);
    if (arr.success) return arr.data;
  }
  return [];
}

// ── Citation flag-not-reject ────────────────────────────────────────────────────────────────────────────

const CITE_RE = /\[\[cite:([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Determine a suggestion's citation status against the panel bundle. A reviewer-cited source NOT in the
 * bundle is FLAGGED 'unverified' (not rejected — a reviewer may correctly cite a real authority outside the
 * bundle, applying the same hallucination-verification posture as the primary). A suggestion that cites
 * only bundle sources is 'in_bundle'; one that cites nothing has no citation to verify (null).
 */
export function citationStatusForSuggestion(
  suggestion: string,
  bundleSourceIds: ReadonlySet<string>,
): ChatReviewCitationStatus | null {
  const cited: string[] = [];
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(suggestion)) !== null) cited.push(m[1]!.trim());
  if (cited.length === 0) return null;
  return cited.every((c) => bundleSourceIds.has(c)) ? 'in_bundle' : 'unverified';
}

/**
 * Self-review exclusion: a panel "other reviewer" can never be the dispositioner (Claude). Reject any
 * reviewer key whose resolved model is an anthropic/claude model. Pure predicate over the reviewer key +
 * its resolved model string.
 */
export function isSelfReviewExcluded(reviewerKey: string, resolvedModel: string | undefined): boolean {
  if (reviewerKey.toLowerCase().includes('claude')) return true;
  // Match the dispositioner's provider robustly: any anthropic-provider model OR any 'claude' model name,
  // regardless of the provider:model separator convention.
  const model = (resolvedModel ?? '').toLowerCase();
  return model.startsWith('anthropic') || model.includes('claude');
}
