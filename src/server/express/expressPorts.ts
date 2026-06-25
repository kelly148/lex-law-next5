/**
 * expressPorts.ts — EXPRESS-AUTO-REVIEW-LOOP-1 E6: the REAL, EGRESS-BACKED PORTS for the E5 loop.
 *
 * E5 (reviewLoop.ts) built the bounded anti-drift loop over two INJECTED function ports — `ReviewPort`
 * (produce this pass's reviewer suggestions) and `RegeneratePort` (rebuild the next candidate). E5 makes NO
 * egress / LLM / network / DB call itself; E6 (E6-widened E5 is async) supplies the real implementations:
 *   - the REVIEW PORT dispatches the candidate to a reviewer model THROUGH the EXISTING egress broker
 *     (documentEgressSend, surface 'reviewer', enforceProviderAllowlist TRUE), parses the EXISTING bare-array
 *     reviewer contract, and adapts each item to a RoutableSuggestion via deterministic span-derivation;
 *   - the REGENERATE PORT is a DETERMINISTIC SPLICE of the loop's cumulative adopted char-range edits onto the
 *     ORIGINAL text (no model, NO egress, no drift) — fail-closed on a drifted anchor.
 *
 * THE WHOLE POINT IS FAIL-CLOSED EGRESS (build spec §E6; the egress guardrails):
 *   - REUSE the EXISTING broker (documentEgressSend) + the EXISTING EgressSurface values ('reviewer' for the
 *     review dispatch, 'evaluator' for the optional confidence classifier). NO new egress path, audit table,
 *     env var, or EgressSurface/EgressSubject enum.
 *   - enforceProviderAllowlist: TRUE on every broker call (fail-closed; ships inert until the allowlist is
 *     populated — a provider not on the allowlist BLOCKS). The broker is NEVER bypassed.
 *   - FAIL-CLOSED ON HOLD: a held / sealed / no-external / conflicts matter makes the broker throw
 *     DocumentEgressBlockedError. The ReviewPort lets that error PROPAGATE — it NEVER swallows it into a
 *     partial candidate or an empty-suggestion success. runExpressLoop (E6-widened to await the port) lets it
 *     bubble; the procedure catches it at the top and HALTS with a clean { status:'blocked' }, so the loop
 *     never routes a partial candidate and never auto-adopts anything.
 *   - SPAN-LOCUS FAIL-CLOSED (the anchored-edit option): a reviewer suggestion is prose; it carries NO char
 *     offsets. The reviewer prompt asks for a machine-locatable anchored edit — beforeText (a VERBATIM
 *     substring of the candidate), afterText, an optional CLASS_A category. We derive the offset by locating
 *     beforeText UNIQUELY in the candidate. If beforeText is ABSENT or AMBIGUOUS (occurs more than once), we
 *     emit a DEGENERATE, CLAIM-LESS suggestion (targetStart=targetEnd=0, no claimedClassA) so it ESCALATES via
 *     the E1/E2 path — we NEVER fabricate an offset and NEVER auto-adopt a guessed locus (this preserves the
 *     E1 locus-gate guarantee). A unique match yields real offsets + isDeletion=(afterText.trim()==='').
 *
 * NON-FINAL: the loop returns a NON-FINAL candidate (E5 labels isFinal:false). E6 NEVER finalizes, persists as
 * final, records, or sends; and it NEVER persists the ledger (durable ledger persistence is the DEFERRED E4b).
 *
 * Flag-dark with the rest of Express (isAutoReviewLoopEnabled, default OFF); the procedure enforces the flag.
 */

import { z } from 'zod';
import { documentEgressSend } from '../egress/documentEgress.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import { RawSuggestionsArraySchema } from '../llm/parsers/feedbackParser.js';
import type { LoopSuggestion, ReviewPort, RegeneratePort, AdoptedChange, LoopContext } from './reviewLoop.js';
import type { ClassACategory } from './adoptRouter.js';
import type { ClassifierSignal } from './inlineEscalation.js';

// ── the reviewer output contract (REUSED — no new schema) ──────────────────────────────────────────────

/**
 * The reviewer structured-output contract is the EXISTING legacy reviewer wrapper: a bare JSON array of
 * { title, body, severity } (RawSuggestionsArraySchema, src/server/llm/parsers/feedbackParser.ts). E6 reuses
 * it verbatim — it is the request contract that already validates against every provider adapter — and adapts
 * each item to a RoutableSuggestion via deterministic span-derivation. No new schema; no new EgressSurface.
 */
export const ExpressReviewerOutputSchema = RawSuggestionsArraySchema;
export type ExpressReviewerOutput = z.infer<typeof ExpressReviewerOutputSchema>;

// ── deterministic span-derivation from prose feedback (the E1-locus-preserving rail) ───────────────────

/**
 * A reviewer suggestion's referenced edit, parsed from its prose body. A reviewer suggestion has NO offsets;
 * to route it we must locate WHAT text it targets. We accept a structured, conservative convention the prompt
 * asks for: an explicit BEFORE quote (the exact, verbatim text in the candidate the suggestion is about) and,
 * for a mechanical fix, an explicit AFTER quote + an optional Class-A category claim. When the body does NOT
 * carry a locatable BEFORE quote, the suggestion has NO derivable locus -> it escalates (un-locatable ->
 * escalate, via a degenerate claim-less suggestion).
 */
interface DerivedEdit {
  beforeText: string | null;
  afterText: string | null;
  claimedClassA: ClassACategory | undefined;
}

/** The closed set of Class-A category tokens E6 will honor in a suggestion's claim (mirrors ClassACategory). */
const CLASS_A_TOKENS: ReadonlySet<string> = new Set<ClassACategory>([
  'whitespace_spacing',
  'punctuation',
  'casing_non_operative',
  'typo_fix',
  'numbering',
  'cross_reference_repair',
  'non_operative_grammar',
  'literal_duplicate_removal',
]);

/** A degenerate, claim-less suggestion: a zero-width target at 0 with no Class-A claim. It can never be
 *  auto-adopted (no Class-A claim => the E2 classifier escalates it; a zero-width point at 0 lands in no
 *  protected span but carries no adopt authority). This is the un-locatable -> escalate emission. */
function escalateOnlySuggestion(): LoopSuggestion {
  return { targetStart: 0, targetEnd: 0, isDeletion: false };
}

/**
 * Pull the FIRST double-quoted run after a labeled marker (e.g. BEFORE: "…") out of a body. Deterministic.
 * Returns null when the marker or its quote is absent. The quote may contain anything except a double quote.
 */
function quotedAfterMarker(body: string, marker: RegExp): string | null {
  const m = marker.exec(body);
  if (m === null) return null;
  return m[1] ?? null;
}

/**
 * Parse a reviewer suggestion's prose body into a DerivedEdit, deterministically. The convention (asked for in
 * the reviewer prompt) is an explicit, machine-locatable edit envelope embedded in the body:
 *   BEFORE: "<exact current text>"   AFTER: "<proposed text>"   [CLASS_A: <category>]
 * Only a BEFORE quote yields a locatable locus. AFTER + CLASS_A are what the E2 Class-A classifier verifies —
 * they are never trusted to authorize an adopt by themselves (E2 re-verifies before/after deterministically).
 * Pure; same body -> same DerivedEdit.
 */
export function deriveEditFromBody(body: string): DerivedEdit {
  const beforeText = quotedAfterMarker(body, /BEFORE:\s*"([^"]*)"/i);
  const afterText = quotedAfterMarker(body, /AFTER:\s*"([^"]*)"/i);
  const claimRaw = (/CLASS_A:\s*([a-z_]+)/i.exec(body)?.[1] ?? '').toLowerCase();
  const claimedClassA = CLASS_A_TOKENS.has(claimRaw) ? (claimRaw as ClassACategory) : undefined;
  return { beforeText, afterText, claimedClassA };
}

/**
 * Locate the single occurrence of `needle` in `haystack`. Deterministic, fail-closed:
 *   - absent           -> null (un-locatable)
 *   - exactly one      -> its [start, end)
 *   - more than one    -> null (AMBIGUOUS: an offset we cannot pin to one occurrence is un-locatable)
 * An empty needle is un-locatable (we cannot deterministically pick a zero-width point). This is the rail that
 * preserves the E1 locus-gate guarantee: a locus we cannot DETERMINISTICALLY pin never reaches an auto-adopt.
 */
export function locateUniqueSpan(haystack: string, needle: string): { start: number; end: number } | null {
  if (needle.length === 0) return null;
  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  const second = haystack.indexOf(needle, first + 1);
  if (second !== -1) return null; // ambiguous -> un-locatable -> escalate
  return { start: first, end: first + needle.length };
}

/**
 * Adapt ONE reviewer item ({ title, body, severity }) to a LoopSuggestion against the current candidate.
 *
 * SPAN-LOCUS FAIL-CLOSED: derive the BEFORE quote from the body and locate it UNIQUELY in the candidate. If it
 * cannot be located (absent / ambiguous / no BEFORE quote), the locus is unknown -> emit a DEGENERATE,
 * CLAIM-LESS suggestion (escalateOnlySuggestion) that can NEVER auto-adopt. When the BEFORE quote IS uniquely
 * located, set the real char-range target + before/after/claimedClassA so E1 (locus) and E2 (Class-A) decide
 * deterministically as designed. A removal (empty/absent AFTER) is honestly flagged isDeletion (E1 escalates).
 */
export function adaptFeedbackItemToSuggestion(
  item: { title: string; body: string; severity: 'critical' | 'major' | 'minor' },
  candidateText: string,
): LoopSuggestion {
  const edit = deriveEditFromBody(item.body);
  if (edit.beforeText === null) return escalateOnlySuggestion(); // no BEFORE quote -> un-locatable -> escalate

  const span = locateUniqueSpan(candidateText, edit.beforeText);
  if (span === null) return escalateOnlySuggestion(); // absent or AMBIGUOUS -> un-locatable -> escalate

  const isDeletion = edit.afterText === null || edit.afterText.trim() === '';
  const suggestion: LoopSuggestion = {
    targetStart: span.start,
    targetEnd: span.end,
    isDeletion,
    beforeText: edit.beforeText,
    ...(edit.afterText !== null ? { afterText: edit.afterText } : {}),
    ...(edit.claimedClassA !== undefined ? { claimedClassA: edit.claimedClassA } : {}),
  };
  return suggestion;
}

/**
 * Adapt a whole reviewer output array to LoopSuggestions against the current candidate. Pure + deterministic.
 * Exported so the procedure (and tests) can adapt a mocked broker output without re-dispatching.
 */
export function adaptFeedbackToSuggestions(
  output: ExpressReviewerOutput,
  candidateText: string,
): LoopSuggestion[] {
  return output.map((item) => adaptFeedbackItemToSuggestion(item, candidateText));
}

// ── the reviewer system + user prompt (asks for the anchored, locatable edit envelope) ─────────────────

/**
 * The reviewer system prompt. It asks for the EXISTING bare-array { title, body, severity } contract (so the
 * request validates against every provider), and additionally asks the reviewer to embed a machine-locatable
 * anchored edit envelope in each body so E6 can deterministically pin the locus. A suggestion WITHOUT a
 * uniquely-locatable BEFORE quote is treated as un-locatable and ESCALATES (it is never auto-adopted) — the
 * model is told so. The literal word "JSON" must appear (OpenAI json_object mode requires it).
 */
export const EXPRESS_REVIEWER_SYSTEM = [
  'You are an independent reviewer of a Virginia legal-document DRAFT. Surface concrete, itemized',
  'suggestions to improve it — one distinct issue per suggestion. Do NOT rewrite the document; suggest.',
  'For each suggestion that targets a specific run of text, embed a machine-locatable anchored edit in the body',
  'in EXACTLY this form: BEFORE: "<the exact current text, copied VERBATIM from the draft>" AFTER: "<the',
  'proposed replacement text>". For a purely MECHANICAL fix (whitespace, punctuation, a non-operative casing or',
  'typo fix, list numbering, a cross-reference repair, non-operative grammar, or removal of a byte-identical',
  'literal duplicate) also add CLASS_A: <category>. Quote the BEFORE text EXACTLY and choose a run that appears',
  'ONCE in the draft — a suggestion whose BEFORE text is missing or appears more than once cannot be located',
  'and is escalated to the attorney, never auto-applied. Any substantive or operative change is escalated',
  'regardless of how it is labeled; the attorney is the final decision-maker.',
  'OUTPUT CONTRACT: Return ONLY a JSON array (no preamble, no prose outside the array). Each element is an',
  'object with exactly these fields: { "title": "short issue title", "body": "the suggestion detail including',
  'the BEFORE/AFTER/CLASS_A envelope when applicable", "severity": "critical" | "major" | "minor" }. Return',
  'the empty array [] if you have no suggestions.',
].join('\n');

/** Build the reviewer user prompt for a candidate + the loop's opaque context (the materials/instruction). */
export function buildExpressReviewerPrompt(candidateText: string, ctx: LoopContext): string {
  const materials = typeof ctx['originalMaterials'] === 'string' ? (ctx['originalMaterials'] as string) : '';
  const materialsBlock = materials.length > 0 ? `[ORIGINAL MATERIALS / INSTRUCTION]\n${materials}\n\n` : '';
  return (
    `${materialsBlock}[DRAFT UNDER REVIEW]\n${candidateText}\n\n` +
    'Return your itemized suggestions as the JSON array specified above, embedding the BEFORE/AFTER/CLASS_A ' +
    'envelope in each body when the suggestion targets specific text.'
  );
}

/** Coerce the broker's content (string OR already-parsed object) to a JSON value for schema validation. */
function coerceJson(content: unknown): unknown {
  if (typeof content === 'string') {
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
  return content;
}

// ── the egress-backed ReviewPort (fail-closed through the EXISTING broker, surface 'reviewer') ─────────

/**
 * The dependencies the egress-backed ReviewPort needs to dispatch through the broker: the document SUBJECT
 * (carries matter/document/version scope + userId — the broker resolves the matter/global hold from it) and
 * the reviewer model string. The subject is an EXISTING EgressSubject (type 'document'); no new enum.
 */
export interface ReviewPortDeps {
  subject: EgressSubject;
  /** The reviewer model string (provider:model), e.g. resolveReviewerModel('gpt'). */
  modelString: string;
  /** Optional abort timeout in ms for the provider call (default 300s, the reviewer envelope). */
  timeoutMs?: number | undefined;
  /** Optional injectable broker — defaults to the real documentEgressSend. Tests pass a mock. The seam keeps
   *  the port unit-testable WITHOUT a real LLM while still proving every broker call is fail-closed +
   *  allowlist-enforced. */
  send?: typeof documentEgressSend;
}

/**
 * Build the REAL (async) ReviewPort. On each loop pass it dispatches the candidate to the reviewer model
 * THROUGH the existing broker (surface 'reviewer', enforceProviderAllowlist TRUE), parses the bare-array
 * contract, and adapts each item to a LoopSuggestion via deterministic span-derivation (un-locatable ->
 * escalate). It satisfies the E6-widened (async-tolerant) E5 ReviewPort signature directly.
 *
 * FAIL-CLOSED: the broker throws DocumentEgressBlockedError on a held / sealed / no-external / conflicts /
 * uncertain matter, and this port lets it PROPAGATE (it does NOT catch it) — runExpressLoop awaits the port,
 * so the error bubbles out of the loop and the procedure maps it to { status:'blocked' }; the loop NEVER
 * routes a partial candidate and NEVER auto-adopts anything. A provider error likewise propagates.
 */
export function makeReviewPort(deps: ReviewPortDeps): ReviewPort {
  const send = deps.send ?? documentEgressSend;
  return async (candidateText: string, ctx: LoopContext): Promise<readonly LoopSuggestion[]> => {
    const userPrompt = buildExpressReviewerPrompt(candidateText, ctx);
    const serializedPayload = `${EXPRESS_REVIEWER_SYSTEM}\n\n${userPrompt}`;
    // FAIL-CLOSED: a DocumentEgressBlockedError (hold/sealed/no-external/conflicts/uncertain) PROPAGATES.
    const result = await send({
      subject: deps.subject,
      surface: 'reviewer',
      modelString: deps.modelString,
      llmParams: {
        systemPrompt: EXPRESS_REVIEWER_SYSTEM,
        userPrompt,
        temperature: 0.2,
        maxTokens: 4096,
        structuredOutputSchema: ExpressReviewerOutputSchema,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 300_000),
      },
      serializedPayload,
      // FAIL-CLOSED PROVIDER ALLOWLIST — never bypassed (ships inert until the allowlist is populated).
      enforceProviderAllowlist: true,
    });
    const parsed = ExpressReviewerOutputSchema.safeParse(coerceJson(result.content));
    if (!parsed.success) {
      // A malformed reviewer reply yields NO suggestions this round (the loop converges) — it NEVER fabricates
      // a suggestion and NEVER auto-adopts. Conservative: empty -> a no-adopt round, not a silent adopt.
      return [];
    }
    return adaptFeedbackToSuggestions(parsed.data, candidateText);
  };
}

// ── the RegeneratePort: DETERMINISTIC SPLICE of the adopted edits (no model, NO egress, fail-closed) ────

/** Thrown when the deterministic regenerate cannot apply an adopted edit because its anchor drifted — the
 *  original text no longer contains the recorded beforeText at the recorded offset. Fail-closed: we THROW
 *  rather than blind-splice (which could corrupt unrelated text). The procedure surfaces this as a loop
 *  failure, never a partial/auto-adopted candidate. */
export class RegenerateAnchorError extends Error {
  constructor(
    readonly ledgerId: string,
    readonly offsetStart: number,
    readonly offsetEnd: number,
  ) {
    super(
      `EXPRESS_REGENERATE_ANCHOR_DRIFT: adopted edit ${ledgerId} at [${offsetStart},${offsetEnd}) no longer ` +
        'matches its recorded beforeText in the original text — refusing to splice rather than corrupt text.',
    );
    this.name = 'RegenerateAnchorError';
  }
}

/**
 * Apply the cumulative adopted char-range edits to the ORIGINAL text DETERMINISTICALLY, fail-closed.
 *
 * Each AdoptedChange carries beforeText/afterText + [offsetStart, offsetEnd) AS OF the round it was adopted —
 * round-1 offsets are against the ORIGINAL text; a later round's offsets are against THAT round's candidate
 * (the original with the prior rounds' edits already spliced). Because the loop rebuilds from the ORIGINAL each
 * round (anti-drift), we apply ALL adopted edits onto the original here.
 *
 * STRATEGY (offset-anchored, descending, with a content-anchored fallback — fail-closed either way):
 *   1. Sort DESCENDING by offsetStart so an earlier splice never shifts a later (lower-offset) edit's offsets.
 *   2. For each edit, VERIFY the recorded offset: text.slice(start,end) === beforeText -> splice there (the
 *      common case — round-1 edits, and any round whose offset is still valid).
 *   3. If the offset anchor does NOT match (a later round's offset is into a different round's candidate), FALL
 *      BACK to locating beforeText UNIQUELY in the current text and splice there. A unique verbatim match is a
 *      deterministic, safe anchor (every adopted edit is a verified mechanical Class-A fix in locus-eligible,
 *      non-protected text, so its beforeText cannot collide with a protected span).
 *   4. If neither the offset nor a UNIQUE content match locates it (absent, or ambiguous), THROW
 *      RegenerateAnchorError — we NEVER blind-splice (which could corrupt unrelated text). Pure + deterministic.
 */
export function applyAdoptedEdits(originalText: string, adopted: readonly AdoptedChange[]): string {
  // Descending by offsetStart (ties by offsetEnd desc) so splicing one range never shifts a later range's
  // offsets. A defensive copy — never mutate the caller's array.
  const ordered = adopted
    .slice()
    .sort((a, b) => (b.offsetStart - a.offsetStart) || (b.offsetEnd - a.offsetEnd));

  let text = originalText;
  for (const change of ordered) {
    const start = Math.min(change.offsetStart, change.offsetEnd);
    const end = Math.max(change.offsetStart, change.offsetEnd);

    // 2) Offset anchor matches -> splice at the recorded offset (the common, exact case).
    if (text.slice(start, end) === change.beforeText) {
      text = text.slice(0, start) + change.afterText + text.slice(end);
      continue;
    }

    // 3) Offset drifted (a cross-round offset) -> fall back to a UNIQUE verbatim content match. Fail-closed:
    //    a missing or AMBIGUOUS match throws rather than guess.
    const located = locateUniqueSpan(text, change.beforeText);
    if (located === null) {
      throw new RegenerateAnchorError(change.ledgerId, start, end);
    }
    text = text.slice(0, located.start) + change.afterText + text.slice(located.end);
  }
  return text;
}

/**
 * Build the deterministic, NO-EGRESS RegeneratePort. Satisfies the E5 RegeneratePort signature exactly. It
 * rebuilds the next candidate from the ORIGINAL materials/text + the cumulative adopted set (anti-drift — the
 * prior candidate is never the input). With the deterministic apply-edits regenerate, `originalMaterials`
 * passed to the loop SHOULD be the ORIGINAL TEXT (so the adopted offsets resolve against it).
 */
export function makeRegeneratePort(): RegeneratePort {
  return (originalMaterials, adoptedChanges) => applyAdoptedEdits(originalMaterials, adoptedChanges);
}

// ── the OPTIONAL confidence classifier dispatch (surface 'evaluator', fail-closed) ─────────────────────

/** The evaluator structured-output contract for the optional per-suggestion confidence signal. */
export const ExpressClassifierOutputSchema = z.object({
  confidence: z.number().min(0).max(1),
  escalate: z.boolean().optional(),
});
export type ExpressClassifierOutput = z.infer<typeof ExpressClassifierOutputSchema>;

export interface ClassifierDispatchDeps {
  subject: EgressSubject;
  modelString: string;
  timeoutMs?: number | undefined;
  send?: typeof documentEgressSend;
}

/**
 * Build the OPTIONAL confidence-classifier dispatch (surface 'evaluator', enforceProviderAllowlist TRUE,
 * fail-closed). It returns a ClassifierSignal the loop's E3 layer reads — additive-only: it can RAISE an
 * inline escalation, NEVER authorize an adopt. Like the ReviewPort it lets a DocumentEgressBlockedError
 * PROPAGATE (the procedure halts). OPTIONAL: the loop runs fine with no classifier signal; this is the seam
 * for a future confidence pass, kept here so the 'evaluator' surface is wired through the SAME fail-closed
 * broker if/when the loop opts in. NOT invoked by default in this increment (the loop passes no signal).
 */
export function makeClassifierDispatch(
  deps: ClassifierDispatchDeps,
): (suggestionSummary: string) => Promise<ClassifierSignal | undefined> {
  const send = deps.send ?? documentEgressSend;
  return async (suggestionSummary) => {
    const systemPrompt =
      'You are an advisory confidence classifier. Given a proposed mechanical edit summary, return your ' +
      'confidence in [0,1] that it is purely mechanical and safe to auto-apply, and escalate:true if it ' +
      'should be escalated to the attorney. JSON only: { "confidence": <0..1>, "escalate": <bool> }.';
    const userPrompt = `[PROPOSED EDIT]\n${suggestionSummary}`;
    const result = await send({
      subject: deps.subject,
      surface: 'evaluator',
      modelString: deps.modelString,
      llmParams: {
        systemPrompt,
        userPrompt,
        temperature: 0,
        maxTokens: 256,
        structuredOutputSchema: ExpressClassifierOutputSchema,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 120_000),
      },
      serializedPayload: `${systemPrompt}\n\n${userPrompt}`,
      enforceProviderAllowlist: true,
    });
    const parsed = ExpressClassifierOutputSchema.safeParse(coerceJson(result.content));
    if (!parsed.success) return undefined;
    return {
      confidence: parsed.data.confidence,
      ...(parsed.data.escalate !== undefined ? { escalate: parsed.data.escalate } : {}),
    };
  };
}
