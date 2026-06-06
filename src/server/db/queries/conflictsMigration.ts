/**
 * R2-PRE-CONFLICT-1 Inc 5 (constraint E / BLOCK #3) — retroactive client-party migration +
 * the Conflicts Compliance Review queue.
 *
 * EXISTING matters created before Inc 2 may have a non-empty matters.clientName but NO role='client'
 * party, so the client was never screened. This backfills a client party for each such matter —
 * ALWAYS confirmed=false (screened-but-not-vouched), source='migration' — so it is screened from the
 * next check yet CANNOT satisfy clearance until the attorney explicitly confirms it (the gate, Inc 3a/3b).
 *
 * Fail-safe by construction: nothing is auto-confirmed, no prior conflict_checks/hits are touched, and
 * the per-matter guard makes it idempotent (a matter that already has ANY role='client' party is skipped
 * — manual, prior-auto, or a prior migration row — so re-running never duplicates).
 *
 * EXECUTION IS OPERATOR-GATED: the migrateClientParties procedure runs dryRun=true first (preview:
 * count + sample, NO writes) for operator review/approval, then dryRun=false applies. The migration
 * runs BEFORE the CONFLICT_GATE_ENABLED flip (a separate operator gate).
 *
 * Composes the owner-scoped wrappers (listMatters / listPartiesForMatter / insertMatterParty); no new
 * owner-scope chokepoint (ci-gotchas #1). This module is imported only by the procedure layer (no
 * matters<->matterParties import cycle).
 */
import { listMatters } from './matters.js';
import { listPartiesForMatter, insertMatterParty } from './matterParties.js';
import { recordAuditEvent } from './auditEvents.js';

/**
 * PURE per-matter decision (unit-tested): does this matter need a migrated client party? TRUE iff the
 * clientName is non-empty (after trim) AND no existing party already has role='client'. Empty/whitespace
 * clientName is skipped; an existing client party (any source) makes it idempotent.
 */
export function needsClientPartyMigration(
  clientName: string | null | undefined,
  existingPartyRoles: readonly string[],
): boolean {
  if ((clientName ?? '').trim() === '') return false;
  return !existingPartyRoles.includes('client');
}

export interface ClientPartyMigrationCandidate {
  matterId: string;
  matterTitle: string;
  clientName: string;
  archived: boolean;
}

export interface ClientPartyMigrationResult {
  dryRun: boolean;
  scannedMatters: number;
  candidates: ClientPartyMigrationCandidate[];
  insertedCount: number; // always 0 when dryRun
}

/**
 * Backfill a confirmed=false role='client' party for every owned matter (incl. archived) that has a
 * non-empty clientName and no client party yet. dryRun=true performs NO writes (preview only).
 * dryRun=false inserts source='migration', confirmed=false, and records one immutable audit event per
 * insert. Never auto-confirms; never mutates prior checks. Idempotent.
 */
export async function migrateClientPartiesForOwner(
  userId: string,
  opts: { dryRun: boolean },
): Promise<ClientPartyMigrationResult> {
  const allMatters = await listMatters(userId, { includeArchived: true });
  const candidates: ClientPartyMigrationCandidate[] = [];
  let insertedCount = 0;

  for (const m of allMatters) {
    const parties = await listPartiesForMatter(m.id, userId);
    if (!needsClientPartyMigration(m.clientName, parties.map((p) => p.role))) continue;

    const clientName = (m.clientName ?? '').trim();
    candidates.push({ matterId: m.id, matterTitle: m.title, clientName, archived: m.archivedAt !== null });

    if (!opts.dryRun) {
      const party = await insertMatterParty({
        userId,
        matterId: m.id,
        role: 'client',
        displayName: clientName,
        source: 'migration',
        confirmed: false,
      });
      await recordAuditEvent({
        userId,
        matterId: m.id,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Retroactively created UNCONFIRMED client party from clientName: ${clientName}`,
        targetType: 'matter_party',
        targetId: party.id,
        action: 'migrate_client_party',
        scope: 'matter',
        payload: { source: 'migration', confirmed: false, clientName },
      });
      insertedCount++;
    }
  }

  return { dryRun: opts.dryRun, scannedMatters: allMatters.length, candidates, insertedCount };
}

export interface ComplianceQueueEntry {
  matterId: string;
  matterTitle: string;
  clientPartyId: string;
  clientName: string;
  source: string;
  archived: boolean;
}

/**
 * The Conflicts Compliance Review queue: every owned matter (incl. archived) that has an UNCONFIRMED
 * role='client' party awaiting the attorney's explicit confirmation (the Confirm act, Inc 3c). These
 * are the matters that cannot conflict-clear until confirmed — the work-list to clear before/while the
 * CONFLICT_GATE_ENABLED flip. Read-only.
 */
export async function listConflictsComplianceQueue(userId: string): Promise<ComplianceQueueEntry[]> {
  const allMatters = await listMatters(userId, { includeArchived: true });
  const out: ComplianceQueueEntry[] = [];
  for (const m of allMatters) {
    const parties = await listPartiesForMatter(m.id, userId);
    const unconfirmedClient = parties.find((p) => p.role === 'client' && p.confirmed !== true);
    if (unconfirmedClient) {
      out.push({
        matterId: m.id,
        matterTitle: m.title,
        clientPartyId: unconfirmedClient.id,
        clientName: unconfirmedClient.displayName,
        source: unconfirmedClient.source,
        archived: m.archivedAt !== null,
      });
    }
  }
  return out;
}
