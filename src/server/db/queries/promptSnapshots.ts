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

import { db } from '../connection.js';
import { promptSnapshots, type NewPromptSnapshot } from '../schema.js';

export async function insertPromptSnapshot(row: NewPromptSnapshot): Promise<void> {
  await db.insert(promptSnapshots).values(row);
}
