/**
 * CHAT-COPILOT-2 Increment B — the multi-model REVIEW PANEL procedures (copilot surface).
 *
 * On-demand: the attorney picks a panel of OTHER models (GPT/Gemini/Grok) to review the current chat WORK
 * PRODUCT; the PRIMARY (Claude) dispositions every reviewer suggestion ADOPT/REJECT/MODIFY_AND_ADOPT with
 * reasoning; the attorney makes the FINAL call. INTERNAL WORK PRODUCT ONLY — there is deliberately NO
 * send/finalize/promote/draft affordance here (promote-to-draft is a separate future FIRE engagement).
 *
 * Gated behind CHAT_REVIEW_PANEL_ENABLED (default OFF, fail-closed): when OFF every procedure refuses with
 * PRECONDITION_FAILED and NO chat_review_* row is read/written. EVERY panel provider send (each reviewer
 * lane AND the dispositioner) routes through the single egress broker (egressClient.send) — this module is
 * a COPILOT_SURFACE entry in architecture_egress_broker.test.ts and imports NO canonical dispatch /
 * registry / llmFetch / adapter. Reviewer egress is gated by GROUNDED_CHAT_PROVIDERS (fail-closed) + holds
 * + the image guard, exactly like the primary path. userId is ALWAYS ctx.userId (Ch 35.2); every use is
 * owner + matter (+ conversation) isolation-guarded.
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { isChatReviewPanelEnabled } from '../config/featureFlags.js';
import { getMatterById } from '../db/queries/matters.js';
import { getConversationInContext, listMessages } from '../db/queries/chatCopilot.js';
import { assembleGroundedChatContext } from '../llm/chatGrounding.js';
import { egressClient, EgressBlockedError } from '../llm/egressClient.js';
import { PRIMARY_DRAFTER_MODEL, resolveReviewerModel } from '../llm/config.js';
import { getReviewerCeiling } from '../llm/modelCapabilities.js';
import {
  buildReviewerReviewPrompt,
  buildDispositionerPrompt,
  parseReviewerSuggestions,
  parseDispositions,
  citationStatusForSuggestion,
  isSelfReviewExcluded,
  hashText,
  PanelReviewerOutputSchema,
  DispositionsSchema,
} from '../llm/chatReviewPanelEngine.js';
import {
  insertReviewRun,
  getReviewRun,
  updateReviewRun,
  listReviewRunsForConversation,
  insertReviewRawOutput,
  listReviewRawOutputsForRun,
  insertReviewItems,
  updateReviewItemDisposition,
  setReviewItemAttorneyDecision,
  listReviewItemsForRun,
} from '../db/queries/chatReviewPanel.js';
import type {
  ChatReviewLaneStatus,
  ChatReviewRunStatus,
  ChatReviewDispositionerStatus,
} from '../../shared/schemas/chatCopilot.js';
import type { NewChatReviewItem } from '../db/schema.js';

function assertPanelEnabled(): void {
  if (!isChatReviewPanelEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CHAT_REVIEW_PANEL_DISABLED' });
  }
}

/**
 * CHAT-PANEL-REVIEWER-FIX-1 (A1): the panel reviewer + dispositioner lanes use the reviewer timeout budget
 * (~300s, matching the legacy reviewer_feedback sync lane) instead of the interactive chat_turn default
 * (120s). Passed per-call via the canonical params, so the primary interactive chat path (also jobType
 * 'chat_turn') keeps its 120s default unchanged.
 */
const REVIEWER_PANEL_TIMEOUT_MS = 300_000;

/**
 * CHAT-PANEL-REVIEWER-FIX-1 (A2): a lane whose egress was DISPATCHED but did not complete — the provider
 * rejected (a non-retryable api_error/parse_error) or timed out, and executeCanonicalMutation RETURNED a
 * non-completed status rather than throwing. panelSend throws this so runReview's catch maps the lane to a
 * real failed/timeout status carrying the true errorClass/errorMessage + the jobId link, instead of the
 * prior silent "success + empty output". errorClass surfaces 'parse_error' so A3 can retry the lane once.
 */
class PanelLaneError extends Error {
  constructor(
    readonly dispatchStatus: 'failed' | 'timed_out' | 'cancelled',
    readonly errorClass: string,
    readonly providerMessage: string,
    readonly jobId: string,
    readonly laneEgressEventId: string,
  ) {
    super(`PANEL_LANE_${dispatchStatus.toUpperCase()}: ${errorClass}`);
  }
}

/** Bound a lane failure reason to the laneFailureReason column (varchar(255)), preserving the jobId link
 *  (appended last and never truncated off). A parse_error is labeled as malformed-reviewer-output. */
function panelFailureReason(err: PanelLaneError): string {
  const suffix = ` (job ${err.jobId})`;
  const label = err.errorClass === 'parse_error' ? 'malformed reviewer output' : err.errorClass;
  const head = err.providerMessage ? `${label}: ${err.providerMessage}` : label;
  return (head.slice(0, 255 - suffix.length) + suffix).slice(0, 255);
}

/** CHAT-PANEL-REVIEWER-FIX-1 (A3): retry a reviewer lane EXACTLY once on a parse_error (e.g. a model that
 *  omitted the required severity enum). The canonical layer never retries parse_error (a re-roll is a
 *  separate decision), so this narrow lane-level re-ask gives a flaky reviewer one more chance before the
 *  lane is recorded as labeled malformed output. NEVER fabricates a missing field. Other failure classes
 *  (api_error, timeout, blocked) are not retried here. */
async function sendWithParseRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    if (err instanceof PanelLaneError && err.errorClass === 'parse_error') {
      return await send();
    }
    throw err;
  }
}

/** Assemble the bundle + the reviewer-prompt transmitting payload for a conversation's work product. */
async function assembleReviewBundle(args: {
  userId: string;
  matterId: string;
  documentId: string | null;
  mode: string | null;
  selectedMaterialIds: string[];
  selectedAttachmentIds: string[];
  workProduct: string;
}) {
  const grounding = await assembleGroundedChatContext({
    matterId: args.matterId,
    userId: args.userId,
    documentId: args.documentId,
    mode: args.mode,
    selectedMaterialIds: args.selectedMaterialIds,
    attachmentIds: args.selectedAttachmentIds,
  });
  const prompt = buildReviewerReviewPrompt({
    workProduct: args.workProduct,
    bundleContextText: grounding.contextText,
    mode: args.mode,
  });
  // The exact content that transmits to every reviewer lane (identical across lanes; only the model
  // differs). The bundleHash over this is the post-minimization, post-hold reality the attorney confirms.
  const transmitCore = [prompt.systemPrompt, prompt.userPrompt].join('\n\n');
  return { grounding, prompt, transmitCore, bundleSourceIds: new Set<string>(grounding.sourceIds) };
}

/** One panel egress through the broker. Returns the captured raw output + the audit event id + jobId.
 *  Throws EgressBlockedError (gate refused) or PanelLaneError (dispatched but did not complete — provider
 *  rejection/parse failure/timeout). The caller maps either to a lane. */
async function panelSend(params: {
  userId: string;
  matterId: string;
  conversationId: string;
  messageId: string | null;
  holdFlag: 'none' | 'no_panel' | 'no_external';
  modelString: string;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodTypeAny;
  serializedPayload: string;
  npiWithheldCount: number;
  attachmentIds: string[];
}): Promise<{ egressEventId: string; rawOutput: string; jobId: string }> {
  let captured = '';
  const egress = await egressClient.send({
    audit: {
      kind: 'chat_panel',
      authorizationBasis: 'panel_confirm',
      matterId: params.matterId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      holdFlag: params.holdFlag,
      minimizationApplied: true,
      minimizationProfile: 'npi_category_default',
      npiWithheldCount: params.npiWithheldCount,
      ...(params.attachmentIds.length > 0 ? { attachmentIds: params.attachmentIds } : {}),
      includedAttachmentCount: params.attachmentIds.length,
      serializedPayload: params.serializedPayload,
      carriesImageEgress: false,
    },
    canonical: {
      userId: params.userId,
      jobType: 'chat_turn',
      modelString: params.modelString,
      matterId: params.matterId,
      // CHAT-PANEL-REVIEWER-FIX-1 (A1): reviewer-budget timeout (~300s) instead of the 120s chat default,
      // so a slow gpt-5/Gemini reviewer-style turn is not cut short into a failure.
      timeoutMs: REVIEWER_PANEL_TIMEOUT_MS,
      txn1Enqueue: (jobId) => Promise.resolve({ jobId }),
      buildLlmParams: () => ({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        temperature: 0.4,
        // CHAT-PANEL-REVIEWER-FIX-1 (A1): per-model reviewer ceiling (reused from the legacy reviewer
        // path) instead of a flat 2048 — 2048 truncated a thinking model's output (Gemini emits no text
        // before the budget is spent) into an api_error.
        maxTokens: getReviewerCeiling(params.modelString),
        structuredOutputSchema: params.schema,
      }),
      txn2Commit: ({ output }) => {
        captured = typeof output === 'string' ? output : JSON.stringify(output);
        return Promise.resolve();
      },
      txn2Revert: () => Promise.resolve(),
      telemetryCtx: { userId: params.userId, matterId: params.matterId, documentId: null, jobId: null },
    },
  });
  // CHAT-PANEL-REVIEWER-FIX-1 (A2): the dispatch can RETURN a non-completed status WITHOUT throwing (a
  // non-retryable provider api_error/parse_error, or a timeout). Surface it as a real lane failure carrying
  // the true error + jobId link, instead of the prior silent "success + empty output".
  if (egress.result.status !== 'completed') {
    throw new PanelLaneError(
      egress.result.status,
      egress.result.errorClass ?? egress.result.status,
      egress.result.errorMessage ?? '',
      egress.result.jobId,
      egress.egressEventId,
    );
  }
  return { egressEventId: egress.egressEventId, rawOutput: captured, jobId: egress.result.jobId };
}

function laneFromError(err: unknown): { laneStatus: ChatReviewLaneStatus; failureReason: string; egressEventId: string | null } {
  if (err instanceof EgressBlockedError) {
    return { laneStatus: 'blocked', failureReason: err.blockReason, egressEventId: err.egressEventId };
  }
  // CHAT-PANEL-REVIEWER-FIX-1 (A2): a dispatched-but-failed lane carries the real status + provider error.
  if (err instanceof PanelLaneError) {
    const laneStatus: ChatReviewLaneStatus = err.dispatchStatus === 'timed_out' ? 'timeout' : 'failed';
    return { laneStatus, failureReason: panelFailureReason(err), egressEventId: err.laneEgressEventId };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { laneStatus: 'failed', failureReason: msg.length > 240 ? msg.slice(0, 240) : msg, egressEventId: null };
}

export const chatReviewPanelRouter = router({
  // Ungated flag read so the copilot UI can decide whether to render the panel affordance.
  isPanelEnabled: protectedProcedure.query(() => ({ enabled: isChatReviewPanelEnabled() })),

  // ── prepareReview — assemble + panel-CONFIRM. Shows the POST-minimization/POST-hold transmitting set +
  //    the exact reviewer models, persists the run (the panelConfirmId). Does NOT dispatch. ──
  prepareReview: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        matterId: z.string().uuid(),
        messageId: z.string().uuid(),
        reviewerModels: z.array(z.string().min(1).max(32)).min(1).max(5),
        mode: z.string().max(32).optional(),
        selectedMaterialIds: z.array(z.string().uuid()).max(50).optional(),
        selectedAttachmentIds: z.array(z.string().uuid()).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertPanelEnabled();
      const matter = await getMatterById(input.matterId, ctx.userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
      const cctx = { userId: ctx.userId, matterId: input.matterId };
      const conv = await getConversationInContext(input.conversationId, cctx); // isolation guard

      // Hold posture: 'no_external' blocks ALL egress; 'no_panel' blocks the panel specifically. Either
      // means the panel cannot run for this conversation — refuse cleanly (the broker is the backstop).
      if (conv.holdFlag === 'no_external' || conv.holdFlag === 'no_panel') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `PANEL_HELD_${conv.holdFlag.toUpperCase()}` });
      }

      // De-dup reviewer keys; enforce SELF-REVIEW EXCLUSION (Claude is the dispositioner, never a panel
      // reviewer) and that every key resolves to a known model. Self-review / unknown keys are rejected.
      const reviewerKeys = [...new Set(input.reviewerModels)];
      for (const key of reviewerKeys) {
        const resolved = resolveReviewerModel(key);
        if (!resolved) throw new TRPCError({ code: 'BAD_REQUEST', message: `UNKNOWN_REVIEWER_MODEL: ${key}` });
        if (isSelfReviewExcluded(key, resolved)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'SELF_REVIEW_EXCLUDED: the primary (Claude) cannot be a panel reviewer' });
        }
      }

      // The work product under review: the named assistant message (server-sourced for the hash).
      const messages = await listMessages(input.conversationId, cctx);
      const target = messages.find((m) => m.id === input.messageId && m.role === 'assistant');
      if (!target || target.content == null || target.content.trim().length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reviewable assistant message not found' });
      }
      const workProduct = target.content;

      const { grounding, transmitCore } = await assembleReviewBundle({
        userId: ctx.userId,
        matterId: input.matterId,
        documentId: conv.documentId,
        mode: input.mode ?? null,
        selectedMaterialIds: input.selectedMaterialIds ?? [],
        selectedAttachmentIds: input.selectedAttachmentIds ?? [],
        workProduct,
      });

      const runId = uuidv4();
      await insertReviewRun({
        id: runId,
        userId: ctx.userId,
        matterId: input.matterId,
        conversationId: conv.id,
        messageId: input.messageId,
        workProductHash: hashText(workProduct),
        bundleHash: hashText(transmitCore),
        reviewerModels: reviewerKeys,
        status: 'prepared',
        dispositionerStatus: 'pending',
      });

      // Panel-CONFIRM preview: the POST-filter reality — what WILL transmit + what is excluded + reviewers.
      return {
        panelConfirmId: runId,
        reviewers: reviewerKeys,
        transmitting: {
          includedSources: grounding.sources.map((s) => ({ sourceId: s.sourceId, kind: s.kind, label: s.label })),
          npiWithheldCount: grounding.npiWithheldCount,
          omittedCount: grounding.omittedCount,
          truncated: grounding.truncated,
          includedAttachmentCount: grounding.includedAttachmentIds.length,
        },
      };
    }),

  // ── runReview — execute a CONFIRMED run: fan out to each reviewer lane (one logged egress each), itemize
  //    + persist (raw by-reference, 1:1 traceable items), then the PRIMARY dispositions every suggestion. ──
  runReview: protectedProcedure
    .input(z.object({ panelConfirmId: z.string().uuid(), matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertPanelEnabled();
      const run = await getReviewRun(input.panelConfirmId, ctx.userId);
      if (!run || run.matterId !== input.matterId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Panel run not found' });
      if (run.status !== 'prepared') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PANEL_RUN_NOT_PREPARED' });

      const cctx = { userId: ctx.userId, matterId: input.matterId };
      const conv = await getConversationInContext(run.conversationId, cctx);
      const messages = await listMessages(run.conversationId, cctx);
      const target = messages.find((m) => m.id === run.messageId && m.role === 'assistant');
      if (!target || target.content == null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reviewable message gone' });
      const workProduct = target.content;

      const bundle = await assembleReviewBundle({
        userId: ctx.userId,
        matterId: input.matterId,
        documentId: conv.documentId,
        mode: null,
        selectedMaterialIds: [],
        selectedAttachmentIds: [],
        workProduct,
      });
      // Post-filter reality: the confirmed bundle must equal what now transmits (work product / grounding
      // could have changed since confirm). On drift, refuse — the attorney must re-confirm.
      if (hashText(bundle.transmitCore) !== run.bundleHash || hashText(workProduct) !== run.workProductHash) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PANEL_BUNDLE_CHANGED' });
      }

      await updateReviewRun(run.id, ctx.userId, { status: 'running' });

      const npiWithheldCount = bundle.grounding.npiWithheldCount;
      const attachmentIds = bundle.grounding.includedAttachmentIds;
      const flat: { index: number; reviewerModel: string; suggestion: string; itemId: string }[] = [];
      let anyReviewerSucceeded = false;

      for (const key of run.reviewerModels) {
        const modelString = resolveReviewerModel(key) ?? key;
        // FAIL-CLOSED MID-RUN: re-read the LIVE hold before each lane — a hold set mid-run blocks the
        // remaining lanes (the broker is authoritative; this also surfaces the live posture to the audit).
        const liveConv = await getConversationInContext(run.conversationId, cctx);
        const rawId = uuidv4();
        try {
          // CHAT-PANEL-REVIEWER-FIX-1 (A3): retry the lane once on a parse_error (e.g. a model that omitted
          // the required severity enum) before recording it failed; never fabricate the missing field.
          const { egressEventId, rawOutput } = await sendWithParseRetry(() =>
            panelSend({
              userId: ctx.userId,
              matterId: input.matterId,
              conversationId: run.conversationId,
              messageId: run.messageId,
              holdFlag: liveConv.holdFlag,
              modelString,
              systemPrompt: bundle.prompt.systemPrompt,
              userPrompt: bundle.prompt.userPrompt,
              schema: PanelReviewerOutputSchema,
              serializedPayload: bundle.transmitCore,
              npiWithheldCount,
              attachmentIds,
            }),
          );
          const suggestions = parseReviewerSuggestions(rawOutput, rawOutput);
          await insertReviewRawOutput({
            id: rawId,
            userId: ctx.userId,
            matterId: input.matterId,
            runId: run.id,
            reviewerModel: key,
            rawText: rawOutput,
            laneStatus: 'success',
            laneFailureReason: null,
            egressEventId,
          });
          // Itemize: 1:1 — every reviewer suggestion -> exactly one item (no silent merge/drop).
          const itemRows: NewChatReviewItem[] = suggestions.map((suggestion) => {
            const itemId = uuidv4();
            flat.push({ index: flat.length, reviewerModel: key, suggestion, itemId });
            return {
              id: itemId,
              userId: ctx.userId,
              matterId: input.matterId,
              runId: run.id,
              reviewerModel: key,
              rawOutputRef: rawId,
              suggestionHash: hashText(suggestion),
              suggestion,
              primaryDisposition: null,
              primaryReasoning: null,
              citationStatus: citationStatusForSuggestion(suggestion, bundle.bundleSourceIds),
              attorneyDecision: 'pending',
              attorneyOverrideReason: null,
              laneStatus: 'success',
            };
          });
          await insertReviewItems(itemRows);
          if (suggestions.length > 0) anyReviewerSucceeded = true;
        } catch (err) {
          const lane = laneFromError(err);
          await insertReviewRawOutput({
            id: rawId,
            userId: ctx.userId,
            matterId: input.matterId,
            runId: run.id,
            reviewerModel: key,
            rawText: null,
            laneStatus: lane.laneStatus,
            laneFailureReason: lane.failureReason,
            egressEventId: lane.egressEventId,
          });
        }
      }

      // ── PRIMARY (Claude) dispositioner — runs only if at least one reviewer produced suggestions. ──
      let dispositionerStatus: ChatReviewDispositionerStatus;
      if (!anyReviewerSucceeded) {
        dispositionerStatus = 'skipped'; // zero reviewers available — never render an empty "agreement".
      } else {
        // CHAT-PANEL-DISPOSITIONER-ROBUSTNESS-1 (A): the PRIMARY synthesis is the dispositioner analogue of
        // a reviewer lane — Claude can intermittently return non-strict JSON (or a miscounted set). Mirror
        // the A3 reviewer retry: attempt synthesis, and on a RETRYABLE failure (a parse_error egress, or a
        // malformed/miscounted disposition set) retry EXACTLY ONCE before the honest "not yet synthesized"
        // fallback. A timeout / non-transient api_error / a blocked hold is NOT retried (a re-ask won't
        // improve it). Each attempt is its own logged egress (parity with the A3 reviewer retry).
        const dprompt = buildDispositionerPrompt({
          workProduct,
          bundleContextText: bundle.grounding.contextText,
          suggestions: flat.map((f) => ({ index: f.index, reviewerModel: f.reviewerModel, suggestion: f.suggestion })),
        });
        const attemptSynthesis = async (): Promise<
          { ok: true; dispositions: ReturnType<typeof parseDispositions> } | { ok: false; retryable: boolean }
        > => {
          let rawOutput: string;
          try {
            // Re-read the LIVE hold before each attempt (fail-closed mid-run; a hold set between attempts
            // blocks the retry).
            const liveConv = await getConversationInContext(run.conversationId, cctx);
            const sent = await panelSend({
              userId: ctx.userId,
              matterId: input.matterId,
              conversationId: run.conversationId,
              messageId: run.messageId,
              holdFlag: liveConv.holdFlag,
              modelString: PRIMARY_DRAFTER_MODEL,
              systemPrompt: dprompt.systemPrompt,
              userPrompt: dprompt.userPrompt,
              schema: DispositionsSchema,
              serializedPayload: [dprompt.systemPrompt, dprompt.userPrompt].join('\n\n'),
              npiWithheldCount,
              attachmentIds,
            });
            rawOutput = sent.rawOutput;
          } catch (err) {
            // Retry only a parse_error (the observed Claude non-strict-JSON flake). A timeout already spent
            // its full budget; a non-transient api_error / a blocked hold won't improve on a re-ask.
            const retryable = err instanceof PanelLaneError && err.errorClass === 'parse_error';
            return { ok: false, retryable };
          }
          const dispositions = parseDispositions(rawOutput);
          const indices = dispositions.map((d) => d.index);
          const inRangeUnique = new Set(indices.filter((i) => i >= 0 && i < flat.length));
          // The dispositioner must answer EVERY item index exactly once (no gaps, no duplicates, no
          // out-of-range) — else the synthesis is unusable and must NOT be applied as if fully vetted.
          const wellFormed =
            indices.length === flat.length &&
            new Set(indices).size === indices.length &&
            inRangeUnique.size === flat.length;
          // A miscounted/malformed set (egress succeeded, content unusable) is a retryable synthesis failure.
          return wellFormed ? { ok: true, dispositions } : { ok: false, retryable: true };
        };

        let synth = await attemptSynthesis();
        if (!synth.ok && synth.retryable) {
          synth = await attemptSynthesis(); // retry exactly once
        }
        if (!synth.ok) {
          // Honest degraded state PRESERVED (final fallback): raw reviewer suggestions are kept
          // (primaryDisposition null), shown explicitly "not yet synthesized". NEVER fabricate a
          // disposition or reasoning.
          dispositionerStatus = 'failed';
        } else {
          try {
            const byIndex = new Map(synth.dispositions.map((d) => [d.index, d]));
            for (const f of flat) {
              const d = byIndex.get(f.index);
              if (d) {
                await updateReviewItemDisposition(f.itemId, ctx.userId, {
                  primaryDisposition: d.disposition,
                  primaryReasoning: d.reasoning,
                });
              }
            }
            dispositionerStatus = 'success';
          } catch (dbErr) {
            // ME-7 (REVIEWER-ROBUSTNESS-1): this branch is reached ONLY after synthesis SUCCEEDED — so a
            // throw here is an INFRASTRUCTURE failure (the disposition DB write), NOT a model-quality
            // problem. The honest degraded client state (dispositionerStatus='failed' -> "not yet
            // synthesized") is preserved, but we now LOG the real error distinctly instead of swallowing
            // it, so an infra failure is not silently misread as a reviewer/synthesis-quality outcome.
            // NPI-safe: only the error is logged, never document/feedback content.
            dispositionerStatus = 'failed';
            console.error(
              '[chat-review-panel] disposition DB write FAILED after a successful synthesis ' +
                '(infrastructure failure, not model-quality; surfaced as the honest degraded state):',
              dbErr instanceof Error ? `${dbErr.name}: ${dbErr.message}` : String(dbErr),
            );
          }
        }
      }

      const status: ChatReviewRunStatus = 'complete';
      await updateReviewRun(run.id, ctx.userId, { status, dispositionerStatus });
      const items = await listReviewItemsForRun(run.id, ctx.userId);
      // rawOutputs: per-lane verbatim feedback + status — drill-down + absent-reviewer attribution for the UX.
      const rawOutputs = await listReviewRawOutputsForRun(run.id, ctx.userId);
      return { runId: run.id, status, dispositionerStatus, items, rawOutputs };
    }),

  // ── listReviews — prior panel runs (+ their items) for a conversation, owner+conversation scoped. ──
  listReviews: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid(), matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertPanelEnabled();
      await getConversationInContext(input.conversationId, { userId: ctx.userId, matterId: input.matterId });
      const runs = await listReviewRunsForConversation(input.conversationId, ctx.userId);
      const out = [];
      for (const r of runs) {
        const items = await listReviewItemsForRun(r.id, ctx.userId);
        const rawOutputs = await listReviewRawOutputsForRun(r.id, ctx.userId);
        out.push({ run: r, items, rawOutputs });
      }
      return { runs: out };
    }),

  // ── recordAttorneyDecision — the FINAL, manual per-suggestion decision (the backstop; nothing auto-applies). ──
  recordAttorneyDecision: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        matterId: z.string().uuid(),
        decision: z.enum(['accept', 'override']),
        overrideReason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertPanelEnabled();
      const updated = await setReviewItemAttorneyDecision(
        input.itemId,
        ctx.userId,
        input.decision,
        input.overrideReason ?? null,
      );
      if (!updated || updated.matterId !== input.matterId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Review item not found' });
      }
      return { item: updated };
    }),
});
