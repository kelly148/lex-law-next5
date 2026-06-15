/**
 * In-memory ChatReviewStore for CHAT-COPILOT-2 Increment B tests — mirrors the Drizzle store's ownerScope
 * semantics (every read filters by userId) and the Zod-Wall shape (parses each row), so the review-panel
 * flow is fully exercised WITHOUT a DB. Inject via setChatReviewStore().
 */

import type { ChatReviewStore, ReviewRunPatch, ReviewItemDispositionPatch } from '../db/queries/chatReviewPanel.js';
import {
  ChatReviewRunRowSchema,
  ChatReviewRawOutputRowSchema,
  ChatReviewItemRowSchema,
  type ChatReviewRunRow,
  type ChatReviewRawOutputRow,
  type ChatReviewItemRow,
  type ChatReviewAttorneyDecision,
} from '../../shared/schemas/chatCopilot.js';
import type { NewChatReviewRun, NewChatReviewRawOutput, NewChatReviewItem } from '../db/schema.js';

export function createInMemoryChatReviewStore(now: () => Date = () => new Date(2026, 5, 15)): ChatReviewStore {
  const runs: ChatReviewRunRow[] = [];
  const raws: ChatReviewRawOutputRow[] = [];
  const items: ChatReviewItemRow[] = [];

  return {
    insertRun(row: NewChatReviewRun): Promise<ChatReviewRunRow> {
      const r = ChatReviewRunRowSchema.parse({
        id: row.id,
        userId: row.userId,
        matterId: row.matterId,
        conversationId: row.conversationId,
        messageId: row.messageId ?? null,
        workProductHash: row.workProductHash,
        bundleHash: row.bundleHash,
        reviewerModels: row.reviewerModels,
        status: row.status ?? 'prepared',
        dispositionerStatus: row.dispositionerStatus ?? 'pending',
        createdAt: now(),
        updatedAt: now(),
      });
      runs.push(r);
      return Promise.resolve(r);
    },
    getRun(id: string, userId: string): Promise<ChatReviewRunRow | null> {
      return Promise.resolve(runs.find((x) => x.id === id && x.userId === userId) ?? null);
    },
    updateRun(id: string, userId: string, patch: ReviewRunPatch): Promise<ChatReviewRunRow | null> {
      const r = runs.find((x) => x.id === id && x.userId === userId);
      if (!r) return Promise.resolve(null);
      if (patch.status !== undefined) r.status = patch.status;
      if (patch.dispositionerStatus !== undefined) r.dispositionerStatus = patch.dispositionerStatus;
      return Promise.resolve(r);
    },
    listRunsForConversation(conversationId: string, userId: string): Promise<ChatReviewRunRow[]> {
      return Promise.resolve(
        runs.filter((x) => x.conversationId === conversationId && x.userId === userId)
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
    },
    insertRawOutput(row: NewChatReviewRawOutput): Promise<ChatReviewRawOutputRow> {
      const r = ChatReviewRawOutputRowSchema.parse({
        id: row.id,
        userId: row.userId,
        matterId: row.matterId,
        runId: row.runId,
        reviewerModel: row.reviewerModel,
        rawText: row.rawText ?? null,
        laneStatus: row.laneStatus ?? 'pending',
        laneFailureReason: row.laneFailureReason ?? null,
        egressEventId: row.egressEventId ?? null,
        createdAt: now(),
      });
      raws.push(r);
      return Promise.resolve(r);
    },
    listRawOutputsForRun(runId: string, userId: string): Promise<ChatReviewRawOutputRow[]> {
      return Promise.resolve(raws.filter((x) => x.runId === runId && x.userId === userId));
    },
    insertItems(rows: NewChatReviewItem[]): Promise<void> {
      for (const row of rows) {
        items.push(
          ChatReviewItemRowSchema.parse({
            id: row.id,
            userId: row.userId,
            matterId: row.matterId,
            runId: row.runId,
            reviewerModel: row.reviewerModel,
            rawOutputRef: row.rawOutputRef ?? null,
            suggestionHash: row.suggestionHash,
            suggestion: row.suggestion,
            primaryDisposition: row.primaryDisposition ?? null,
            primaryReasoning: row.primaryReasoning ?? null,
            citationStatus: row.citationStatus ?? null,
            attorneyDecision: row.attorneyDecision ?? 'pending',
            attorneyOverrideReason: row.attorneyOverrideReason ?? null,
            laneStatus: row.laneStatus ?? 'success',
            createdAt: now(),
            updatedAt: now(),
          }),
        );
      }
      return Promise.resolve();
    },
    updateItemDisposition(id: string, userId: string, patch: ReviewItemDispositionPatch): Promise<void> {
      const r = items.find((x) => x.id === id && x.userId === userId);
      if (r) {
        r.primaryDisposition = patch.primaryDisposition;
        r.primaryReasoning = patch.primaryReasoning;
      }
      return Promise.resolve();
    },
    setItemAttorneyDecision(
      id: string,
      userId: string,
      decision: ChatReviewAttorneyDecision,
      overrideReason: string | null,
    ): Promise<ChatReviewItemRow | null> {
      const r = items.find((x) => x.id === id && x.userId === userId);
      if (!r) return Promise.resolve(null);
      r.attorneyDecision = decision;
      r.attorneyOverrideReason = overrideReason;
      return Promise.resolve(r);
    },
    listItemsForRun(runId: string, userId: string): Promise<ChatReviewItemRow[]> {
      return Promise.resolve(items.filter((x) => x.runId === runId && x.userId === userId));
    },
  };
}
