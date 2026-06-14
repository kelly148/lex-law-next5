/**
 * In-memory EgressEventStore for CHAT-COPILOT-2 Increment A tests — mirrors the Drizzle store's
 * ownerScope semantics (every read filters by userId) and the Zod-Wall shape (parses each row), so the
 * broker's gate/log/dispatch behavior is fully exercised WITHOUT a DB. Inject via setEgressEventStore().
 */

import type { EgressEventStore, EgressCompletionPatch, EgressEventFilter } from '../db/queries/chatEgress.js';
import { ChatEgressEventRowSchema, type ChatEgressEventRow } from '../../shared/schemas/chatCopilot.js';
import type { NewChatEgressEvent } from '../db/schema.js';

export function createInMemoryEgressEventStore(now: () => Date = () => new Date(2026, 5, 14)): EgressEventStore {
  const events: ChatEgressEventRow[] = [];

  function build(row: NewChatEgressEvent): ChatEgressEventRow {
    // Mirror the DB column defaults, then parse through the Zod Wall (catches shape mismatches in tests).
    return ChatEgressEventRowSchema.parse({
      id: row.id,
      userId: row.userId,
      matterId: row.matterId,
      conversationId: row.conversationId ?? null,
      messageId: row.messageId ?? null,
      gateDecisionId: row.gateDecisionId ?? null,
      kind: row.kind,
      decision: row.decision,
      blockReason: row.blockReason ?? null,
      allowlistVersion: row.allowlistVersion ?? null,
      authorizationBasis: row.authorizationBasis ?? 'config_allowlist',
      provider: row.provider,
      model: row.model,
      minimizationApplied: row.minimizationApplied ?? false,
      minimizationProfile: row.minimizationProfile ?? null,
      npiCategoriesIncluded: (row.npiCategoriesIncluded as string[] | null | undefined) ?? null,
      npiCategoriesWithheld: (row.npiCategoriesWithheld as string[] | null | undefined) ?? null,
      holdHonored: row.holdHonored ?? false,
      holdExcludedAttachmentIds: (row.holdExcludedAttachmentIds as string[] | null | undefined) ?? null,
      inputBundleHash: row.inputBundleHash ?? null,
      attachmentIds: (row.attachmentIds as string[] | null | undefined) ?? null,
      region: row.region ?? null,
      correlationId: row.correlationId,
      requestId: row.requestId ?? null,
      status: row.status ?? 'pending',
      failureReason: row.failureReason ?? null,
      includedAttachmentCount: row.includedAttachmentCount ?? 0,
      npiWithheldCount: row.npiWithheldCount ?? 0,
      createdAt: now(),
      completedAt: null,
    });
  }

  return {
    insert(row: NewChatEgressEvent): Promise<ChatEgressEventRow> {
      const r = build(row);
      events.push(r);
      return Promise.resolve(r);
    },
    complete(id: string, userId: string, patch: EgressCompletionPatch): Promise<ChatEgressEventRow | null> {
      const r = events.find((e) => e.id === id && e.userId === userId);
      if (!r) return Promise.resolve(null);
      r.status = patch.status;
      r.failureReason = patch.failureReason ?? null;
      r.completedAt = patch.completedAt;
      return Promise.resolve(r);
    },
    get(id: string, userId: string): Promise<ChatEgressEventRow | null> {
      return Promise.resolve(events.find((e) => e.id === id && e.userId === userId) ?? null);
    },
    list(userId: string, filter: EgressEventFilter): Promise<ChatEgressEventRow[]> {
      const out = events
        .filter((e) => e.userId === userId)
        .filter((e) => (filter.matterId ? e.matterId === filter.matterId : true))
        .filter((e) => (filter.conversationId ? e.conversationId === filter.conversationId : true))
        .filter((e) => (filter.provider ? e.provider === filter.provider : true))
        .filter((e) => (filter.sinceCreatedAt ? e.createdAt >= filter.sinceCreatedAt : true))
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve(out);
    },
  };
}
