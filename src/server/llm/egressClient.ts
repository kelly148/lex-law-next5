/**
 * CHAT-COPILOT-2 Increment A — G1 single, non-bypassable egress broker.
 *
 * EVERY copilot provider send (the primary chat call, grounded-context sends, and the Increment-B review
 * panel) routes through egressClient.send(). The broker, in one place:
 *   1. GATES the send AFTER bundle assembly, IMMEDIATELY before dispatch, BEFORE any retry/fallback:
 *        - the egress allowlist (GROUNDED_CHAT_PROVIDERS — reused; NO new env var) is FAIL-CLOSED:
 *          an empty / unconfirmable allowlist BLOCKS every provider, so the copilot cannot send at all
 *          (the intended GLBA posture — anthropic must be allowlisted for the copilot to operate);
 *        - holdFlag 'no_external' BLOCKS the primary AND grounding egress (G2);
 *        - image egress is NEVER permitted (G4): the payload must be text-only.
 *   2. WRITES the chat_egress_events audit row (allowed OR BLOCKED + blockReason) — blocked sends are
 *      logged too. The row is written BEFORE dispatch, so a send cannot leave without a logged decision.
 *   3. DISPATCHES (only if allowed) through the canonical mutation chokepoint — the ONLY provider dispatch
 *      path. NO silent provider fallback: a different provider would be a SEPARATE send() → a separate
 *      gate + a separate event.
 *   4. COMPLETES the audit row with the dispatch outcome (one update).
 *
 * The copilot surface reaches a provider ONLY through this module — enforced by the architecture test
 * (src/server/__tests__/architecture_egress_broker.test.ts). egressClient is the ONLY non-test module
 * outside the canonical chokepoint that imports executeCanonicalMutation for a copilot send.
 */

import { createHmac, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { TRPCError } from '@trpc/server';
import {
  executeCanonicalMutation,
  type CanonicalMutationParams,
  type CanonicalMutationResult,
} from '../db/canonicalMutation.js';
import { parseModelString } from './config.js';
import { isGroundedChatProviderAllowed, parseGroundedChatProviders } from './chatCopilotConfig.js';
import { recordEgressDecision, completeEgressEvent, type EgressCompletionPatch } from '../db/queries/chatEgress.js';
import type { ChatEgressKind, ChatEgressStatus, ChatHoldFlag, ChatEgressAuthBasis } from '../../shared/schemas/chatCopilot.js';
import type { NewChatEgressEvent } from '../db/schema.js';
// EGRESS-CONTROL-PLANE-1: the shared surface-agnostic egress primitive — egressClient is the CHAT adapter over it.
import { auditedEgress, type AuditedEgressDecision } from '../egress/auditedEgress.js';

// Keying salt for the input-bundle hash. The hash is over the WHOLE minimized payload (high entropy), so
// it is one-way regardless; the keyed HMAC is belt-and-suspenders so a low-entropy field (an SSN) cannot
// be brute-forced from the audit hash, and so hashes don't correlate across deployments. NOT an env var
// (Increment A adds none); rotatable later.
const EGRESS_BUNDLE_HASH_KEY = 'cc2-egress-bundle-hash-v1';

function bundleHash(serializedPayload: string): string {
  return createHmac('sha256', EGRESS_BUNDLE_HASH_KEY).update(serializedPayload).digest('hex');
}

/** A stable fingerprint of the allowlist policy at decision time (which providers were permitted). */
function allowlistFingerprint(): string {
  const providers = parseGroundedChatProviders().slice().sort().join(',');
  return createHash('sha256').update('grounded_chat_providers:' + providers).digest('hex').slice(0, 16);
}

function mapStatus(s: CanonicalMutationResult['status']): ChatEgressStatus {
  switch (s) {
    case 'completed':
      return 'success';
    case 'timed_out':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

function errMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 240 ? m.slice(0, 240) : m;
}

/**
 * CHAT-PANEL-REVIEWER-FIX-1 (A2): compose the real failure reason for the audit row from the canonical
 * result. Previously the broker wrote the literal status string ('failed'/'timed_out') and the true
 * provider error (api_error/parse_error/timeout + provider detail) was lost. Now we surface the REAL
 * errorClass + errorMessage plus the jobId link, so supervision can see WHY a send failed. The jobId is
 * appended LAST and the whole string is bounded to the failureReason column (varchar(255)); the jobId
 * suffix is preserved (the link is never truncated off). The errorMessage is the provider/adapter error
 * (HTTP status + sanitized provider detail — the adapters sanitize structured-output diagnostics), NOT
 * document content. Falls back to the status string when no error detail is available.
 */
function failureReasonFromResult(result: CanonicalMutationResult): string {
  const suffix = ` (job ${result.jobId})`;
  const head = result.errorMessage
    ? `${result.errorClass ?? 'error'}: ${result.errorMessage}`
    : (result.errorClass ?? result.status);
  return (head.slice(0, 255 - suffix.length) + suffix).slice(0, 255);
}

/** Complete the audit row best-effort: a failed completion update must NEVER mask the real dispatch
 *  outcome (success, or the underlying provider error). The decision row is already durably written. */
async function safeComplete(id: string, userId: string, patch: EgressCompletionPatch): Promise<void> {
  try {
    await completeEgressEvent(id, userId, patch);
  } catch {
    // swallow — the decision is logged; the row simply stays 'pending'.
  }
}

/** The audit/gate context for one copilot egress (everything EXCEPT the raw payload, which is hashed). */
export interface EgressAuditContext {
  kind: ChatEgressKind;
  matterId: string;
  conversationId?: string | null;
  messageId?: string | null;
  gateDecisionId?: string | null;
  /** The conversation's external-egress hold (G2). 'no_external' blocks primary + grounding egress;
   *  'no_panel' blocks the Increment-B review panel (kind 'chat_panel') for this conversation. */
  holdFlag: ChatHoldFlag;
  /** CHAT-COPILOT-2 Increment B: what authorized this send. Defaults to 'config_allowlist' (the primary +
   *  grounding path); the review panel sets 'panel_confirm' (the attorney's deliberate panel-confirm act).
   *  This does NOT relax the gate — the provider allowlist + holds + image guard still apply; it only
   *  records, on the audit row, which basis authorized the send so supervision can distinguish them. */
  authorizationBasis?: ChatEgressAuthBasis;
  minimizationApplied?: boolean;
  minimizationProfile?: string | null;
  npiCategoriesIncluded?: readonly string[] | null;
  npiCategoriesWithheld?: readonly string[] | null;
  holdExcludedAttachmentIds?: readonly string[] | null;
  attachmentIds?: readonly string[] | null;
  includedAttachmentCount?: number;
  npiWithheldCount?: number;
  region?: string | null;
  requestId?: string | null;
  /**
   * Q1 hash-at-gate: the COPILOT-COMPOSED outbound bundle (system prompt + any layered master + grounded
   * context + windowed history + turn) — the minimized, hold-filtered document/material payload this
   * egress control plane governs. LIMITATION (documented A1 follow-up): the platform's canonical dispatch
   * additionally prepends a best-effort matter-state metadata block downstream (matter phase/title/
   * open-item summaries), which is NOT covered by inputBundleHash; extending the hash to the
   * fully-composed prompt is a planned follow-up.
   */
  serializedPayload: string;
  /** G4: true if the payload carries any image bytes. MUST be false — only extracted TEXT egresses. */
  carriesImageEgress?: boolean;
}

export interface EgressSendRequest {
  audit: EgressAuditContext;
  /** The canonical-mutation dispatch params (the ONLY provider dispatch path). */
  canonical: CanonicalMutationParams;
}

export interface EgressSendResult {
  egressEventId: string;
  result: CanonicalMutationResult;
}

export class EgressBlockedError extends TRPCError {
  readonly blockReason: string;
  readonly egressEventId: string;
  constructor(blockReason: string, egressEventId: string) {
    super({ code: 'FORBIDDEN', message: `EGRESS_BLOCKED: ${blockReason}` });
    this.blockReason = blockReason;
    this.egressEventId = egressEventId;
  }
}

/**
 * Gate + log + dispatch one copilot egress. Throws EgressBlockedError (and writes a blocked audit row)
 * when the gate refuses — fail-closed. On allow, dispatches and returns the canonical result + event id.
 */
async function send(req: EgressSendRequest): Promise<EgressSendResult> {
  const { audit, canonical } = req;
  const provider = parseModelString(canonical.modelString).providerId;
  const eventId = uuidv4();

  // EGRESS-CONTROL-PLANE-1: egressClient is the CHAT ADAPTER over the shared auditedEgress primitive. The
  // chat hold rules + the chat_egress_events row + the chatEgress writer are bound here; the
  // gate → SYNCHRONOUS pre-dispatch record → fail-closed throw → dispatch → complete ORDERING (and thus chat
  // behavior) is UNCHANGED — it now lives in auditedEgress(). The public exports are untouched, and
  // egressClient still imports canonicalMutation + chatEgress (the architecture guard).
  const { result } = await auditedEgress<CanonicalMutationResult>({
    eventId,
    // ── GATE (fail-closed; the same four chat rules, evaluated once before dispatch) ──
    evaluateHold: (): AuditedEgressDecision => {
      const blockReasons: string[] = [];
      if (audit.holdFlag === 'no_external') blockReasons.push('hold_no_external');
      // CHAT-COPILOT-2 Increment B (G2): a 'no_panel' hold blocks the review-panel egress for this
      // conversation (it does NOT block the primary/grounding send — those are gated by 'no_external').
      if (audit.holdFlag === 'no_panel' && audit.kind === 'chat_panel') blockReasons.push('hold_no_panel');
      if (audit.carriesImageEgress === true) blockReasons.push('image_egress_forbidden');
      if (!isGroundedChatProviderAllowed(provider)) blockReasons.push('provider_not_allowlisted');
      return {
        decision: blockReasons.length === 0 ? 'allowed' : 'blocked',
        blockReason: blockReasons.length > 0 ? blockReasons.join('+') : null,
      };
    },
    // ── LOG the decision (before dispatch — a send cannot leave without a logged row); blocked rows too ──
    recordDecision: async (d) => {
      const row: NewChatEgressEvent = {
        id: eventId,
        userId: canonical.userId,
        matterId: audit.matterId,
        conversationId: audit.conversationId ?? null,
        messageId: audit.messageId ?? null,
        gateDecisionId: audit.gateDecisionId ?? null,
        kind: audit.kind,
        decision: d.decision,
        blockReason: d.blockReason,
        allowlistVersion: allowlistFingerprint(),
        authorizationBasis: audit.authorizationBasis ?? 'config_allowlist',
        provider,
        model: canonical.modelString,
        minimizationApplied: audit.minimizationApplied ?? false,
        minimizationProfile: audit.minimizationProfile ?? null,
        npiCategoriesIncluded: audit.npiCategoriesIncluded ? [...audit.npiCategoriesIncluded] : null,
        npiCategoriesWithheld: audit.npiCategoriesWithheld ? [...audit.npiCategoriesWithheld] : null,
        holdHonored: audit.holdFlag === 'no_external',
        holdExcludedAttachmentIds: audit.holdExcludedAttachmentIds ? [...audit.holdExcludedAttachmentIds] : null,
        inputBundleHash: bundleHash(audit.serializedPayload),
        attachmentIds: audit.attachmentIds ? [...audit.attachmentIds] : null,
        region: audit.region ?? null,
        correlationId: uuidv4(),
        requestId: audit.requestId ?? null,
        status: d.decision === 'blocked' ? 'blocked' : 'pending',
        failureReason: null,
        includedAttachmentCount: audit.includedAttachmentCount ?? 0,
        npiWithheldCount: audit.npiWithheldCount ?? 0,
      };
      await recordEgressDecision(row);
    },
    onBlocked: (blockReason) => new EgressBlockedError(blockReason, eventId),
    // ── DISPATCH (only path to a provider; no silent fallback) ──
    dispatch: () => executeCanonicalMutation(canonical),
    // ── COMPLETE the audit row with the outcome (best-effort; the primitive also swallows a failed update) ──
    completeDecision: async (outcome) => {
      if (outcome.ok) {
        await safeComplete(eventId, canonical.userId, {
          status: mapStatus(outcome.result.status),
          failureReason: outcome.result.status === 'completed' ? null : failureReasonFromResult(outcome.result),
          completedAt: new Date(),
        });
      } else {
        await safeComplete(eventId, canonical.userId, {
          status: 'failed',
          failureReason: errMessage(outcome.error),
          completedAt: new Date(),
        });
      }
    },
  });
  return { egressEventId: eventId, result };
}

export const egressClient = { send };
