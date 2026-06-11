/**
 * CHAT-UI-1 W3 — concurrency / stale-preview guard (CONCURRENCY-GUARD-1, context integrity).
 *
 * If the underlying state changed since a preview/confirm was generated, do NOT act on the stale view
 * — block and re-resolve/re-confirm against the CURRENT state (brief W3 §3). This directly encodes the
 * §3 principle that the dangerous case is the field that DIDN'T change in the operator's mind: when a
 * preview is stale, coherence is re-run on the WHOLE current triple, so a field that silently moved
 * (e.g. recipient -> adverse) is caught against the field the operator still believes (e.g. privilege
 * still "on"). Reuses W1: stableStringify (the chain's serializer) for the snapshot, posture triggers
 * for the diff, and evaluateCoherence for the re-check.
 */
import {
  type Posture,
  type CoherenceFinding,
  type PostureTriggers,
  evaluateCoherence,
  hasHardBlock,
  posturePropertyTriggers,
} from './postureCoherence.js';
import { stableStringify } from './provenanceRow.js';

export interface PreviewSnapshot {
  /** The resolved triple at the moment the preview/confirm was generated. */
  triple: Posture;
  /** A stable hash of that triple — cheap staleness comparison against the current resolved triple. */
  hash: string;
}

/** Snapshot the triple a preview/confirm was generated against. */
export function capturePreview(triple: Posture): PreviewSnapshot {
  return { triple, hash: stableStringify(triple) };
}

/** Has the underlying triple changed since the snapshot? */
export function isPreviewStale(snapshot: PreviewSnapshot, current: Posture): boolean {
  return snapshot.hash !== stableStringify(current);
}

export interface StaleResolution {
  stale: boolean;
  /** ALWAYS the current resolved triple — the re-confirm binds to this, never the stale snapshot. */
  reConfirmTriple: Posture;
  /** Which posture fields moved from the snapshot to current (the fields that DID change). */
  changed: PostureTriggers;
  /** Coherence findings on the CURRENT triple (catches the danger a silently-moved field created). */
  findings: CoherenceFinding[];
  /** A HARD finding on the current triple blocks the act until re-confirmed. */
  blocked: boolean;
}

/**
 * Resolve an action taken against a (possibly stale) preview. The coherence check runs on the CURRENT
 * triple — so if recipient silently moved to adverse while privilege stayed "on", the re-confirm
 * surfaces the now-HARD privileged x adverse, even though privilege itself never changed.
 */
export function resolveStaleAction(
  snapshot: PreviewSnapshot,
  current: Posture,
  opts: { atEgress?: boolean } = {},
): StaleResolution {
  const findings = evaluateCoherence(current, { atEgress: opts.atEgress ?? false });
  return {
    stale: isPreviewStale(snapshot, current),
    reConfirmTriple: current,
    changed: posturePropertyTriggers(snapshot.triple, current),
    findings,
    blocked: hasHardBlock(findings),
  };
}
