/**
 * pa_instruction_profiles query wrapper — FOLD-KB-1 (Increment 1: insert + owner-scoped reads).
 *
 * Ch 35.1 Zod Wall; owner-scoped via ownerScope(). The per-practice-area MASTER PROMPT layer
 * (Fork E) — the attorney's own tuned instructions, versioned. Profile ACTIVATION (which
 * version is live for a paKey) is an explicit attorney act added in Increment 2 (it records
 * an audit_events disposition and supersedes the prior active profile). The active profile
 * auto-loads into a generation job with its version captured immutably at job creation (R11)
 * — that wiring is Increment 3.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../connection.js';
import { paInstructionProfiles } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  PaInstructionProfileRowSchema,
  type PaInstructionProfileRow,
} from '../../../shared/schemas/practiceKb.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow(raw: unknown, userId: string): PaInstructionProfileRow {
  try {
    return PaInstructionProfileRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry('zod_parse_failed', { schemaName: 'PaInstructionProfileRowSchema', tableName: 'pa_instruction_profiles', errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' }, { userId, matterId: null, documentId: null, jobId: null });
    }
    throw err;
  }
}

/** Add a per-PA instruction profile (inactive by default; activation is an explicit act). */
export async function insertPaInstructionProfile(data: {
  id?: string;
  userId: string;
  paKey: string;
  title: string;
  body: string;
  version: string;
}): Promise<PaInstructionProfileRow> {
  const id = data.id ?? uuidv4();
  await db.insert(paInstructionProfiles).values({
    id,
    userId: data.userId,
    paKey: data.paKey,
    title: data.title,
    body: data.body,
    version: data.version,
    active: false,
  });
  const row = await getPaInstructionProfileById(id, data.userId);
  if (!row) throw new Error(`insertPaInstructionProfile: row not found after insert (id=${id})`);
  return row;
}

export async function getPaInstructionProfileById(id: string, userId: string): Promise<PaInstructionProfileRow | null> {
  const rows = await db.select().from(paInstructionProfiles).where(and(eq(paInstructionProfiles.id, id), ownerScope(paInstructionProfiles.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/**
 * The active profile for a paKey (owner-scoped), if any. There is at most one active
 * profile per (userId, paKey); activation (Increment 2) supersedes the prior one.
 */
export async function getActiveProfileForPaKey(paKey: string, userId: string): Promise<PaInstructionProfileRow | null> {
  const rows = await db
    .select()
    .from(paInstructionProfiles)
    .where(and(ownerScope(paInstructionProfiles.userId, userId), eq(paInstructionProfiles.paKey, paKey), eq(paInstructionProfiles.active, true)))
    .orderBy(desc(paInstructionProfiles.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return parseRow(rows[0]!, userId);
}

/** All instruction profiles for the owner (owner-scoped), newest first. */
export async function listPaInstructionProfilesForOwner(userId: string): Promise<PaInstructionProfileRow[]> {
  const rows = await db
    .select()
    .from(paInstructionProfiles)
    .where(ownerScope(paInstructionProfiles.userId, userId))
    .orderBy(desc(paInstructionProfiles.createdAt));
  return rows.map((r) => parseRow(r, userId));
}
