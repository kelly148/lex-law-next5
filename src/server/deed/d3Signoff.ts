/**
 * d3Signoff.ts — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 1 constants.
 *
 * The deterministic comparator (Inc 2), the export-route OBSERVE wiring (Inc 3), and the UI (Inc 4) build on
 * this data core. NC-1 holds throughout: nothing here composes or corrects operative text.
 */
import { createHash } from 'node:crypto';

/**
 * NC-D3-4 — the stamped comparator version. Written into EVERY sign-off record so a later normalization /
 * comparator change cannot retroactively launder old sign-offs (a record proves what a specific comparator
 * version concluded). BUMP this on any change to the normalization spec or the comparator logic.
 */
export const D3_COMPARATOR_VERSION = 'd3-comparator-v1';

/**
 * NC-D3-1 — fork provenance. Fork A compares the assembled deed against the EXTRACTED source TEXT / consolidated
 * facts (honestly labeled — never "source document"). Fork B (source-image) is the deferred D3B ticket; when it
 * lands it records a different provenance value alongside, without reworking this gate.
 */
export const D3_FORK_PROVENANCE = 'extracted_text_fork_a';

/** Content hash of an assembled deed (newline-normalized) — binds a sign-off to the exact content; a material
 *  change supersedes it (a fresh sign-off is required). */
export function hashDeedContent(s: string): string {
  return createHash('sha256').update(s.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Content hash of the source facts the comparison ran against (canonical, order-independent for the party set). */
export function hashSourceFacts(facts: { legal: string | null; parcel: string | null; owners: readonly string[] }): string {
  const canonical = JSON.stringify({ legal: facts.legal ?? '', parcel: facts.parcel ?? '', owners: [...facts.owners].sort() });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** The recorded gate mode at sign-off time. A record is only ever created in 'observe' or 'enforce' — the 'off'
 *  mode produces no record and no gate (NC-D3-7). */
export type D3SignoffGateMode = 'observe' | 'enforce';

/** The sign-off outcome. 'overridden' = a genuinely-absent/withheld source fact was passed via the high-friction,
 *  audit-logged attorney override (NC-D3-3); a legal-description MISMATCH is NEVER overridden. */
export type D3SignoffVerdict = 'pass' | 'blocked' | 'overridden';

export type D3SignoffDecision =
  | { ok: true; verdict: 'pass' | 'overridden' }
  | { ok: false; code: 'D3_HARD_BLOCK' | 'D3_ATTESTATION_REQUIRED' | 'D3_OVERRIDE_REQUIRED' };

/**
 * PURE sign-off gate decision (NC-D3-1 + NC-D3-3). Order matters:
 *   1. hard_block (present-vs-present MISMATCH of legal/parcel) is NON-overridable — refuse.
 *   2. the dual-prong attestation (vs-original + not-OCR-only) is mandatory in every case.
 *   3. overridable_block (absent/withheld source value) passes ONLY with the high-friction override -> overridden.
 *   4. otherwise -> pass.
 */
export function evaluateSignoffDecision(input: {
  tier: 'hard_block' | 'overridable_block' | 'pass';
  attorneyAttestedVsOriginal: boolean;
  notOcrOnly: boolean;
  hasOverride: boolean;
}): D3SignoffDecision {
  if (input.tier === 'hard_block') return { ok: false, code: 'D3_HARD_BLOCK' };
  if (!input.attorneyAttestedVsOriginal || !input.notOcrOnly) return { ok: false, code: 'D3_ATTESTATION_REQUIRED' };
  if (input.tier === 'overridable_block') {
    if (!input.hasOverride) return { ok: false, code: 'D3_OVERRIDE_REQUIRED' };
    return { ok: true, verdict: 'overridden' };
  }
  return { ok: true, verdict: 'pass' };
}
