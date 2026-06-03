/**
 * Cross-matter invocation gate — FOLD-L1-4 (MM-8b).
 *
 * THE contamination boundary. A reusable artifact derived from one matter may be invoked
 * in another ONLY when BOTH conditions hold: the attorney has explicitly widened its
 * reusableScope to 'cross_matter' AND the caller passes an explicit per-use opt-in. Every
 * allowed cross-matter invocation is FAIL-VISIBLY audited (no audit => the invocation is
 * refused — a confidentiality-critical action must be auditable or not happen).
 *
 * evaluateCrossMatterInvocation() is PURE and exhaustively unit-tested — it is the whole
 * point of L1-4. invokeReusableArtifact() does the owner-scoped fetch + gate + audit.
 */

import { TRPCError } from '@trpc/server';
import { getReusableArtifactById } from '../db/queries/reusableArtifacts.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';
import {
  type ReusableArtifactRow,
  type CrossMatterGateDecision,
} from '../../shared/schemas/reusableArtifacts.js';

/**
 * PURE gate decision. Default-deny across matters:
 *   - originMatterId == null            -> firm-level, allowed (not client-derived).
 *   - originMatterId == targetMatterId  -> same matter, allowed (not cross).
 *   - cross-matter:
 *       reusableScope != 'cross_matter' -> BLOCKED (matter-only default).
 *       !explicitOptIn                  -> BLOCKED (no per-use opt-in).
 *       else                            -> allowed (explicit, scoped, opted-in).
 */
export function evaluateCrossMatterInvocation(params: {
  artifact: Pick<ReusableArtifactRow, 'originMatterId' | 'reusableScope'>;
  targetMatterId: string;
  explicitOptIn: boolean;
}): CrossMatterGateDecision {
  const { artifact, targetMatterId, explicitOptIn } = params;

  if (artifact.originMatterId === null) {
    return { allowed: true, crossMatter: false, reason: 'firm_level' };
  }
  if (artifact.originMatterId === targetMatterId) {
    return { allowed: true, crossMatter: false, reason: 'same_matter' };
  }
  // Cross-matter from here down.
  if (artifact.reusableScope !== 'cross_matter') {
    return { allowed: false, crossMatter: true, reason: 'blocked_scope_matter_only' };
  }
  if (!explicitOptIn) {
    return { allowed: false, crossMatter: true, reason: 'blocked_no_opt_in' };
  }
  return { allowed: true, crossMatter: true, reason: 'cross_matter_opt_in' };
}

export interface InvokeReusableArtifactResult {
  artifact: ReusableArtifactRow;
  decision: CrossMatterGateDecision;
  /** Present only for an allowed cross-matter invocation — a contamination caution. */
  contaminationWarning?: string;
}

/**
 * Invoke a reusable artifact into a target matter, through the gate. Owner-scoped.
 * Throws NOT_FOUND if the artifact is not owned by userId; throws FORBIDDEN
 * (CROSS_MATTER_BLOCKED) if the gate denies. An allowed CROSS-matter invocation is
 * fail-visibly audited (insertAuditEvent throws on failure -> invocation refused).
 */
export async function invokeReusableArtifact(params: {
  artifactId: string;
  targetMatterId: string;
  userId: string;
  explicitOptIn: boolean;
  rationale?: string | null;
}): Promise<InvokeReusableArtifactResult> {
  const artifact = await getReusableArtifactById(params.artifactId, params.userId);
  if (!artifact) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Reusable artifact not found' });
  }

  const decision = evaluateCrossMatterInvocation({
    artifact,
    targetMatterId: params.targetMatterId,
    explicitOptIn: params.explicitOptIn,
  });

  if (!decision.allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CROSS_MATTER_BLOCKED' });
  }

  if (decision.crossMatter) {
    // Confidentiality-critical: fail-visibly audit the cross-matter invocation.
    await insertAuditEvent({
      userId: params.userId,
      matterId: params.targetMatterId,
      eventType: 'disposition',
      actor: 'attorney',
      summary: `Cross-matter invocation of reusable ${artifact.kind} "${artifact.title}"`,
      targetType: 'reusable_artifact',
      targetId: artifact.id,
      action: 'cross_matter_invoke',
      rationale: params.rationale ?? null,
      scope: 'matter',
      payload: { originMatterId: artifact.originMatterId },
    });
  }

  if (decision.crossMatter) {
    return {
      artifact,
      decision,
      contaminationWarning:
        'Cross-matter content: verify no other-client specifics (names, terms, amounts) carried over before use.',
    };
  }
  return { artifact, decision };
}
