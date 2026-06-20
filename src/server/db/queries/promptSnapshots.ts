/**
 * prompt_snapshots query wrapper — INSTR-1A0 (INSTRUCTIONS-LEG-1).
 *
 * INSERT-ONLY in 1A0: the table is an append-only audit record of the full composed system
 * text actually sent per draft job (both paths, flag on or off). No product read path exists
 * yet, so no Zod-wall read wrapper is defined here — it arrives with the first consumer.
 * The writer is invoked BEST-EFFORT from the LLM-dispatch chokepoint (a snapshot failure is
 * logged loudly but never breaks a model call), matching the chokepoint's other provenance
 * writes (kb_events, draft-under-override).
 */

import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../connection.js';
import { promptSnapshots, type NewPromptSnapshot } from '../schema.js';

export async function insertPromptSnapshot(row: NewPromptSnapshot): Promise<void> {
  await db.insert(promptSnapshots).values(row);
}

// ============================================================
// PROMPT-SNAPSHOT-READ-1 (F5) — the first product read path.
// ============================================================
// Owner-scoped, display-only projection of the full composed system text actually sent for a document's
// latest draft/regeneration job. This is the Zod wall the table's append-only contract anticipated: a
// minimal read shape (no SHA/provenance internals) gated through PromptSnapshotReadSchema.parse(). The
// createdAt column is used for ordering but deliberately NOT projected — the default tRPC JSON transformer
// would serialize a Date to a string and desync the inferred client type. Read-only; no egress surface.
export const PromptSnapshotReadSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobType: z.string(),
  callRole: z.string(),
  source: z.string(),
  systemText: z.string(),
  modelString: z.string(),
});
export type PromptSnapshotRead = z.infer<typeof PromptSnapshotReadSchema>;

export async function getLatestPromptSnapshotForDocument(
  documentId: string,
  userId: string,
): Promise<PromptSnapshotRead | null> {
  const rows = await db
    .select({
      id: promptSnapshots.id,
      jobId: promptSnapshots.jobId,
      jobType: promptSnapshots.jobType,
      callRole: promptSnapshots.callRole,
      source: promptSnapshots.source,
      systemText: promptSnapshots.systemText,
      modelString: promptSnapshots.modelString,
    })
    .from(promptSnapshots)
    // Owner scope: userId is the table's ownership column, so this returns a row ONLY for the owner —
    // a document that is not the caller's yields no snapshot (no cross-user exposure).
    .where(and(eq(promptSnapshots.userId, userId), eq(promptSnapshots.documentId, documentId)))
    .orderBy(desc(promptSnapshots.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return PromptSnapshotReadSchema.parse(rows[0]);
}
