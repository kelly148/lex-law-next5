/**
 * goldenReviewerDiff.ts — ULTRABUILD-1 W6 (run-sheet G.6): the pure, unit-testable core of the golden
 * reviewer-prompt drift detector. A second drift-detection layer under governance rule G.3 (model-swap ⇒
 * recalibrate): a small fixed prompt set is run and each reviewer output is reduced to a SEMANTIC
 * feature-signature; a signature that drifts from its stored baseline localizes WHICH taxonomy behavior
 * changed after a model swap — a feature-vector diff, NOT a literal text diff, so cosmetic LLM wording variance
 * does not trip it.
 *
 * PURE: string in, object out. No fs, no fetch, no network, no env. The .mjs harness holds a verbatim inline
 * copy of extractSignature/diffSignature (it runs as plain Node ESM without the TS build); THIS module is the
 * source of truth and this file's colocated test pins the copy (the tokenAccounting.ts convention).
 *
 * NO LIVE PROVIDER CALLS anywhere in W6 — the harness runs against committed synthetic fixtures. The first live
 * baseline capture is CAL-1, a separate operator-gated dispatch.
 *
 * Contract pinned: LEGACY reviewer output shape (a JSON array of {title, body, severity}) parsed by
 * parseFeedbackOutput. The LEAN-contract signature is a documented follow-up.
 */

import { parseFeedbackOutput, type ParsedFeedbackSuggestion } from '../llm/parsers/feedbackParser.js';

/** The four calibrated reviewer scenarios (CLAUDE.md taxonomy). */
export type GoldenScenarioId = 'P8-T1' | 'P8-T6' | 'P8-T7' | 'P8-T10';

/** The derived status of a scenario output. PARSE_FAILURE = the raw output was not valid reviewer JSON. */
export type SignatureStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'PARSE_FAILURE';

/** A normalized semantic signature: the taxonomy behaviors present, plus a derived status + item count. */
export interface GoldenSignature {
  scenarioId: GoldenScenarioId;
  status: SignatureStatus;
  itemCount: number;
  features: Record<string, boolean>;
}

function joinText(items: readonly ParsedFeedbackSuggestion[]): string {
  return items.map((i) => `${i.title}\n${i.body}`).join('\n').toLowerCase();
}

function hasMajorOrCritical(items: readonly ParsedFeedbackSuggestion[]): boolean {
  return items.some((i) => i.severity === 'critical' || i.severity === 'major');
}

function anyMatch(text: string, ...patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/** Extract the per-scenario feature signature + status from the parsed reviewer items. Pure + deterministic. */
function featuresFor(
  scenarioId: GoldenScenarioId,
  items: readonly ParsedFeedbackSuggestion[],
): { features: Record<string, boolean>; status: SignatureStatus } {
  const text = joinText(items);
  switch (scenarioId) {
    case 'P8-T1': {
      // Execution-blank suppression: a routine signature/notary/date blank on a pre-execution draft must NOT
      // be surfaced as UNSUPPRESSED feedback (empty valid output may be correct). CAL-T1-2: credit a card
      // that carries routine_blank_flag + suppress_by_default as a PARTIAL (cal7b classifyP8T1 parity) rather
      // than a FAIL — the reviewer identified the routine blank but suppressed it by default, which is the
      // desired behavior, not drift. Only an UNSUPPRESSED routine-blank flag is real drift (FAIL).
      const flagsRoutineBlank =
        anyMatch(text, /signature block|notary|acknowledgment|date line|execution block|jurat/) &&
        anyMatch(text, /blank|incomplete|missing|fill in|not (yet )?(signed|completed)/);
      const suppressedRoutineBlank =
        anyMatch(text, /"routine_blank_flag"\s*:\s*true/) &&
        anyMatch(text, /"suppress_by_default"\s*:\s*true/);
      const features = { flagsRoutineBlank, suppressedRoutineBlank, emptyOutput: items.length === 0 };
      const status: SignatureStatus =
        items.length === 0
          ? 'PASS'
          : !flagsRoutineBlank
            ? 'PASS'
            : suppressedRoutineBlank
              ? 'PARTIAL'
              : 'FAIL';
      return { features, status };
    }
    case 'P8-T6': {
      // Counterparty over-disclosure: flag audience over-disclosure as SUBSTANTIVE while PRESERVING the
      // attorney's selected business offer (never treat the settled offer as a defect).
      const flagsAudienceRisk = anyMatch(
        text,
        /audience|over-?disclos|opposing counsel|counterparty|internal|walk-?away|reveal|expose/,
      );
      const preservesOffer = !anyMatch(
        text,
        /change the (offer|split|50)|revise the offer|different (offer|split)|renegotiat|lower the (offer|number)/,
      );
      const substantive = hasMajorOrCritical(items) || anyMatch(text, /substantive|drafting|audience risk/);
      const features = { flagsAudienceRisk, preservesOffer, substantive };
      const status = flagsAudienceRisk && preservesOffer ? (substantive ? 'PASS' : 'PARTIAL') : 'FAIL';
      return { features, status };
    }
    case 'P8-T7': {
      // Governing-law / sendability blocker: escalate a jurisdiction mismatch as a BLOCKER requiring attorney
      // decision before send.
      const identifiesGoverningLaw = anyMatch(
        text,
        /governing law|jurisdiction|choice of law|california|conflict of law|venue/,
      );
      const escalatesBlocker =
        hasMajorOrCritical(items) ||
        anyMatch(text, /blocker|before (it can be )?sent|before send|do not send|must be resolved/);
      const features = { identifiesGoverningLaw, escalatesBlocker };
      const status = identifiesGoverningLaw && escalatesBlocker ? 'PASS' : identifiesGoverningLaw ? 'PARTIAL' : 'FAIL';
      return { features, status };
    }
    case 'P8-T10': {
      // Business-decision separation: surface BOTH options (recourse vs non-recourse), require an attorney
      // decision, and NEVER pick / rewrite to change structure.
      // "recourse" alone must be distinguished from "non-recourse" (which contains it): mentionsRecourse
      // requires a standalone occurrence NOT preceded by a hyphen.
      const mentionsRecourse = anyMatch(text, /(^|[^-])recourse/);
      const mentionsNonRecourse = anyMatch(text, /non-?recourse/);
      const surfacesBothPaths =
        (mentionsRecourse && mentionsNonRecourse) ||
        anyMatch(text, /both (options|paths)|option a[\s\S]*option b/);
      const requiresAttorneyDecision = anyMatch(
        text,
        /attorney (decision|choice|should decide|must decide|to decide)|business decision|your (call|decision)|requires a decision/,
      );
      const choosesPath = anyMatch(
        text,
        /recommend (the )?(non-?recourse|recourse)|should (use|choose|be) (non-?recourse|recourse)|change (it|the note) to (non-?recourse|recourse)/,
      );
      const features = { surfacesBothPaths, requiresAttorneyDecision, choosesPath };
      const status =
        surfacesBothPaths && requiresAttorneyDecision && !choosesPath ? 'PASS' : choosesPath ? 'FAIL' : 'PARTIAL';
      return { features, status };
    }
    default: {
      const exhaustive: never = scenarioId;
      throw new Error(`unknown golden scenario: ${String(exhaustive)}`);
    }
  }
}

/**
 * Reduce one reviewer raw output to its semantic signature for a scenario. A malformed (non-JSON / schema-
 * invalid) output yields status PARSE_FAILURE with no features (itself a detectable drift). PURE.
 */
export function extractSignature(scenarioId: GoldenScenarioId, rawOutput: string): GoldenSignature {
  let items: ParsedFeedbackSuggestion[];
  try {
    items = parseFeedbackOutput(rawOutput);
  } catch {
    return { scenarioId, status: 'PARSE_FAILURE', itemCount: 0, features: {} };
  }
  const { features, status } = featuresFor(scenarioId, items);
  return { scenarioId, status, itemCount: items.length, features };
}

/** One changed field between a baseline and a current signature. */
export interface SignatureDiff {
  field: string;
  baseline: unknown;
  current: unknown;
}

/**
 * Localize WHICH behavior drifted between a stored baseline signature and a current one — status, item count,
 * and each feature. Empty array = no drift. PURE.
 */
export function diffSignature(baseline: GoldenSignature, current: GoldenSignature): SignatureDiff[] {
  const diffs: SignatureDiff[] = [];
  if (baseline.status !== current.status) diffs.push({ field: 'status', baseline: baseline.status, current: current.status });
  if (baseline.itemCount !== current.itemCount) {
    diffs.push({ field: 'itemCount', baseline: baseline.itemCount, current: current.itemCount });
  }
  const keys = new Set([...Object.keys(baseline.features), ...Object.keys(current.features)]);
  for (const k of keys) {
    if (baseline.features[k] !== current.features[k]) {
      diffs.push({ field: `features.${k}`, baseline: baseline.features[k], current: current.features[k] });
    }
  }
  return diffs;
}
