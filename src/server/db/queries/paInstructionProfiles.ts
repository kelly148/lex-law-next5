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
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import { paInstructionProfiles } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertKbEvent } from './kbEvents.js';
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

/**
 * Activate an instruction profile (Increment 3, Fork E — explicit attorney act). At most one
 * active profile per (userId, paKey): deactivates and supersedes any currently-active sibling,
 * then activates this one. Audited via kb_events (pa_profile_activated), transactionally.
 */
export async function activatePaProfile(params: { profileId: string; userId: string }): Promise<PaInstructionProfileRow> {
  const profile = await getPaInstructionProfileById(params.profileId, params.userId);
  if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Instruction profile not found' });
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    // Supersede the prior active profile for this paKey (at most one active per paKey).
    await tx
      .update(paInstructionProfiles)
      .set({ active: false, supersededById: profile.id })
      .where(and(ownerScope(paInstructionProfiles.userId, params.userId), eq(paInstructionProfiles.paKey, profile.paKey), eq(paInstructionProfiles.active, true)));
    await tx
      .update(paInstructionProfiles)
      .set({ active: true })
      .where(and(eq(paInstructionProfiles.id, profile.id), ownerScope(paInstructionProfiles.userId, params.userId)));
    await insertKbEvent(
      {
        id: eventId,
        userId: params.userId,
        action: 'pa_profile_activated',
        targetType: 'pa_instruction_profile',
        targetId: profile.id,
        summary: `Activated instruction profile "${profile.title}" (paKey=${profile.paKey}, v${profile.version})`,
        payload: { paKey: profile.paKey, version: profile.version },
      },
      tx,
    );
  });
  const updated = await getPaInstructionProfileById(profile.id, params.userId);
  if (!updated) throw new Error('activatePaProfile: row not found after activation');
  return updated;
}
