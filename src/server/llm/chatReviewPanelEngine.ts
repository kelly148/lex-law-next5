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
import { RawSuggestionsArraySchema } from './parsers/feedbackParser.js';

/** Stable content hash (workProductHash / bundleHash / suggestionHash). */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ── Structured output contracts (forced via structuredOutputSchema on the LLM call) ─────────────────────

/**
 * CHAT-PANEL-REVIEWER-FIX-1 — the panel reviewer lanes REUSE the legacy reviewer_feedback structured-output
 * contract: `RawSuggestionsArraySchema` (a bare JSON ARRAY of { title, body, severity }). This is the request
 * contract that already validates against all four providers, and adopting it fixes the panel-specific
 * dispatch failures:
 *   - the shared json_object adapters' normalizers (normalizeOpenAiStructuredOutput / normalizeGrokStructuredOutput)
 *     are built for a BARE ARRAY; the prior object schema `{ suggestions: [...] }` was unwrapped to its inner
 *     array and then failed validation against the object shape -> the grok `parse_error`;
 *   - a bare-array reviewer prompt naturally instructs a "JSON array", and OpenAI's json_object mode returns
 *     HTTP 400 unless the literal word "json" appears in the request (the prior panel prompt had none -> the
 *     gpt-5 `api_error`).
 * `severity` (critical|major|minor) is REQUIRED and attorney-meaningful; a model that omits it produces a
 * parse_error that A3 handles by retrying once then surfacing labeled-malformed output — NEVER by fabricating
 * a severity.
 */
export const PanelReviewerOutputSchema = RawSuggestionsArraySchema;
export type PanelReviewerOutput = z.infer<typeof PanelReviewerOutputSchema>;

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
  // CHAT-PANEL-REVIEWER-FIX-1 (A1): the OUTPUT CONTRACT matches the legacy reviewer wrapper
  // (RawSuggestionsArraySchema) so the request validates against all four providers. The literal word
  // "JSON" must appear here — OpenAI's json_object mode returns HTTP 400 without it.
  'OUTPUT CONTRACT: Return ONLY a JSON array (no preamble, no prose, nothing outside the array). Each',
  'element is an object with exactly these fields: { "title": "short issue title (under 80 chars)", "body":',
  '"the itemized suggestion detail — put any [[cite:SOURCE_ID]] here", "severity": "critical" | "major" |',
  '"minor" }. severity: critical = blocks responsible use; major = a substantive legal / risk-allocation /',
  'drafting issue; minor = precision, structure, or polish. EVERY element MUST include a severity. Return',
  'the empty array [] if you have no suggestions.',
].join('\n');

export function buildReviewerReviewPrompt(args: ReviewerPromptArgs): { systemPrompt: string; userPrompt: string } {
  const modeLine = args.mode ? `\n[REVIEW MODE] ${args.mode}\n` : '\n';
  const ctx = args.bundleContextText ? `${args.bundleContextText}\n\n` : '';
  const userPrompt =
    `${ctx}[WORK PRODUCT UNDER REVIEW]\n${args.workProduct}\n${modeLine}` +
    'Return your itemized suggestions to improve the work product above as the JSON array specified above.';
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
 * Compose one legacy reviewer item ({ title, body, severity }) into the panel's single suggestion string.
 * The panel has no severity column (no schema change in this fix), so the model-reported severity is
 * preserved INLINE — never inferred and never defaulted. The body (which carries any [[cite:...]]) is kept
 * verbatim so citation flag-not-reject still works downstream.
 */
function formatReviewerSuggestion(item: { title: string; body: string; severity: string }): string {
  const head = `[${item.severity.toUpperCase()}] ${item.title.trim()}`;
  const body = item.body.trim();
  return body.length > 0 ? `${head} — ${body}` : head;
}

/**
 * Itemize one reviewer's raw output into suggestion strings. CHAT-PANEL-REVIEWER-FIX-1 (A1): the canonical
 * shape is now the legacy reviewer wrapper — a bare JSON array of { title, body, severity } — which the
 * adapter has already validated against `PanelReviewerOutputSchema` on the success path. Robust fallbacks
 * remain so a malformed-but-nonempty reply is never silently dropped: a bare array of strings or {body}/
 * {suggestion} objects, else the whole text as one suggestion. Returns [] only for genuinely empty output.
 * Never fabricates a severity — only a model-supplied severity is ever shown (the legacy-wrapper branch).
 */
export function parseReviewerSuggestions(output: unknown, rawText: string): string[] {
  const obj = coerceObject(output);
  const parsed = PanelReviewerOutputSchema.safeParse(obj);
  if (parsed.success) {
    return parsed.data.map((s) => formatReviewerSuggestion(s).trim()).filter((s) => s.length > 0);
  }
  if (Array.isArray(obj)) {
    const items = obj
      .map((x) => {
        if (typeof x === 'string') return x;
        const o = x as { suggestion?: unknown; body?: unknown; title?: unknown };
        if (typeof o?.suggestion === 'string') return o.suggestion;
        if (typeof o?.body === 'string') return o.body;
        if (typeof o?.title === 'string') return o.title;
        return '';
      })
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
