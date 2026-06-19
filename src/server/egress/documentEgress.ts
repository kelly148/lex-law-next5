/**
 * EGRESS-CONTROL-PLANE-1 — the DOCUMENT egress adapter over the shared auditedEgress primitive.
 *
 * The document/matter analogue of egressClient (the chat adapter). It binds, to the universal
 * gate → SYNCHRONOUS pre-dispatch record → fail-closed throw → dispatch → complete skeleton:
 *   - the SCOPED hold evaluator (resolveEffectiveHold: matter + global; NO synthetic conversationId);
 *   - the provider allowlist (reused GROUNDED_CHAT_PROVIDERS, fail-closed — same posture as chat);
 *   - the generalized egress_events row builder + writer (store-by-reference: a HASH, never the draft text);
 *   - a SINGLE provider dispatch (resolveAdapter(...).generate) INSIDE this approved chokepoint module
 *     (so no caller does a raw adapter.generate — the CI guard's containment invariant).
 *
 * FAIL-CLOSED (refined per the triad disposition): unconditional for the HOLD CHECK — if resolveEffectiveHold
 * cannot CONFIRM there is no applicable hold (it throws), the send is BLOCKED ('hold_check_uncertain'); a
 * present no_external hold blocks ('hold_no_external'); a provider not on the allowlist blocks. An
 * audit-WRITE failure prevents egress (the primitive aborts before dispatch — no unlogged send). The caller
 * maps any of these to its degraded outcome (for the advisory sendability classifier: CLASSIFIER_UNAVAILABLE).
 */
import { createHmac, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { parseModelString } from '../llm/config.js';
import { isGroundedChatProviderAllowed, parseGroundedChatProviders } from '../llm/chatCopilotConfig.js';
import { resolveAdapter } from '../llm/registry.js';
import type { LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';
import { recordEgressEvent, completeEgressEvent } from '../db/queries/egressEvents.js';
import { resolveEffectiveHold } from '../db/queries/egressHold.js';
import type { NewEgressEvent } from '../db/schema.js';
import type { EgressSubject, EgressSurface, EgressHoldScope } from '../../shared/schemas/egress.js';
import { auditedEgress, type AuditedEgressDecision } from './auditedEgress.js';

// Keying salt for the input-bundle hash (one-way HMAC over the WHOLE minimized payload). NOT an env var.
const EGRESS_BUNDLE_HASH_KEY = 'ecp1-egress-bundle-hash-v1';
function bundleHash(serializedPayload: string): string {
  return createHmac('sha256', EGRESS_BUNDLE_HASH_KEY).update(serializedPayload).digest('hex');
}
/** A stable fingerprint of the allowlist policy at decision time (the policy version on the audit row). */
function allowlistFingerprint(): string {
  const providers = parseGroundedChatProviders().slice().sort().join(',');
  return createHash('sha256').update('grounded_chat_providers:' + providers).digest('hex').slice(0, 16);
}
function errMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 240 ? m.slice(0, 240) : m;
}

/** Thrown when the gate refuses a document egress (after the blocked row is durably recorded). */
export class DocumentEgressBlockedError extends Error {
  readonly blockReason: string;
  readonly egressEventId: string;
  constructor(blockReason: string, egressEventId: string) {
    super(`DOCUMENT_EGRESS_BLOCKED: ${blockReason}`);
    this.blockReason = blockReason;
    this.egressEventId = egressEventId;
  }
}

export interface DocumentEgressParams {
  /** The polymorphic subject — type 'document' | 'document_job' | 'matter' (NOT 'conversation'). */
  subject: EgressSubject;
  /** Which document surface (e.g. 'sendability'). */
  surface: EgressSurface;
  /** The model id, e.g. EVALUATOR_MODEL. */
  modelString: string;
  /** The provider call params (systemPrompt/userPrompt/structuredOutputSchema/signal/...). */
  llmParams: LlmGenerateParams;
  /** The serialized payload to HASH for the audit row (never stored). */
  serializedPayload: string;
  /**
   * EGRESS-CONTROL-PLANE-1 Inc 3a: optional dispatch override. When provided, the plane uses it for the
   * SINGLE provider call instead of the internal resolveAdapter(...).generate — so a caller that owns its
   * own retry/abort/heartbeat machinery (the reviewer fan-out in canonicalMutation.runJob) keeps that
   * machinery while still getting exactly ONE pre-dispatch, hold-aware egress_events decision row (any
   * retries happen INSIDE this single dispatch, preserving the "exactly one decision row" invariant). The
   * provider call still lives inside an allowlisted chokepoint (runJob), so the CI guard is unaffected.
   * Default (sendability) keeps the internal single dispatch via the registry inside THIS module.
   */
  dispatch?: () => Promise<LlmGenerateResult>;
  /**
   * EGRESS-CONTROL-PLANE-1 Inc 3a: whether to apply the GROUNDED_CHAT_PROVIDERS chat-grounding allowlist as
   * a provider gate (default TRUE — sendability is byte-for-byte unchanged). The REVIEWER surface passes
   * FALSE: reviewer providers are validated at boot (REVIEWER-MODEL-VALIDATION-FIX-1) and pre-date this
   * plane (reviewers were never gated by the chat-grounding switch, which ships empty/unset in prod by GLBA
   * design). Onboarding reviewers must ADD log + hold WITHOUT adding a new provider-blocking gate they never
   * had — the no_external HOLD remains the egress control. The egress_events row is still written either way.
   */
  enforceProviderAllowlist?: boolean;
}

/**
 * Run one document/matter external-model send through the egress control plane. Returns the provider result
 * on allow + success. THROWS: DocumentEgressBlockedError on a blocked/uncertain hold (the blocked row is
 * recorded first); the underlying audit-write error if the pre-dispatch row could not be written (no
 * dispatch); or the provider/adapter error on an allowed-but-failed dispatch (the allowed decision stays
 * auditable). The caller (e.g. checkSendability) wraps this in its degrade-to-unavailable try/catch.
 */
export async function documentEgressSend(params: DocumentEgressParams): Promise<LlmGenerateResult> {
  const provider = parseModelString(params.modelString).providerId;
  const eventId = uuidv4();
  const subj = params.subject;

  // ── GATE (fail-closed). Resolve the binding hold + scope BEFORE the primitive records/dispatches. The
  //    hold check is checked after bundle assembly, immediately before dispatch (a hold set after assembly
  //    still blocks). An UNCONFIRMABLE hold check ⇒ BLOCKED (never proceed on uncertainty). ──
  const blockReasons: string[] = [];
  let holdScope: EgressHoldScope | null = null;
  try {
    const eff = await resolveEffectiveHold(subj);
    holdScope = eff.scope;
    if (eff.holdFlag === 'no_external') blockReasons.push('hold_no_external');
  } catch {
    blockReasons.push('hold_check_uncertain');
  }
  // The chat-grounding provider allowlist gates by default (sendability); the reviewer surface opts out
  // (enforceProviderAllowlist === false) since its providers are boot-validated and were never gated by the
  // chat-grounding switch. The no_external HOLD above remains the egress control on every surface.
  if (params.enforceProviderAllowlist !== false && !isGroundedChatProviderAllowed(provider)) {
    blockReasons.push('provider_not_allowlisted');
  }
  const decision: AuditedEgressDecision = {
    decision: blockReasons.length === 0 ? 'allowed' : 'blocked',
    blockReason: blockReasons.length > 0 ? blockReasons.join('+') : null,
  };

  const docId = subj.type === 'document' || subj.type === 'document_job' ? subj.documentId : null;
  const versionId = subj.type === 'document' || subj.type === 'document_job' ? subj.documentVersionId : null;
  const jobId = subj.type === 'document_job' ? subj.jobId : null;

  const { result } = await auditedEgress<LlmGenerateResult>({
    eventId,
    evaluateHold: () => decision,
    // ── LOG the decision SYNCHRONOUSLY before dispatch (blocked rows too); store-by-reference (hash). ──
    recordDecision: async (d) => {
      const row: NewEgressEvent = {
        id: eventId,
        userId: subj.userId,
        matterId: subj.matterId,
        surface: params.surface,
        subjectType: subj.type,
        // NO synthetic conversationId — a document send leaves conversationId NULL; linkage rides documentId.
        conversationId: subj.type === 'conversation' ? subj.conversationId : null,
        documentId: docId,
        documentVersionId: versionId,
        jobId,
        holdScope,
        decision: d.decision,
        blockReason: d.blockReason,
        provider,
        model: params.modelString,
        policyVersion: allowlistFingerprint(),
        inputBundleHash: bundleHash(params.serializedPayload),
        correlationId: uuidv4(),
        status: d.decision === 'blocked' ? 'blocked' : 'pending',
        failureReason: null,
      };
      await recordEgressEvent(row);
    },
    onBlocked: (blockReason) => new DocumentEgressBlockedError(blockReason, eventId),
    // ── DISPATCH — the provider call lives INSIDE an approved chokepoint (this module by default, or the
    //    caller-supplied override which itself must be inside an allowlisted chokepoint, e.g. runJob). Single
    //    dispatch; no silent fallback. The override (Inc 3a) lets the reviewer fan-out reuse runJob's retry/
    //    abort/heartbeat machinery while still recording exactly one pre-dispatch decision row. ──
    dispatch: params.dispatch ?? (() => resolveAdapter(params.modelString).generate(params.llmParams)),
    // ── COMPLETE the row with the outcome (best-effort; the allowed decision is already durable). ──
    completeDecision: async (outcome) => {
      await completeEgressEvent(
        eventId,
        subj.userId,
        outcome.ok
          ? { status: 'success', failureReason: null, completedAt: new Date() }
          : { status: 'failed', failureReason: errMessage(outcome.error), completedAt: new Date() },
      );
    },
  });
  return result;
}
