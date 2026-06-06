/**
 * R2-PRE-CONFLICT-1 Inc 5 — retroactive client-party migration + Conflicts Compliance Review queue
 * (constraint E / BLOCK #3).
 *
 * The per-matter decision is a PURE exported fn -> real behavioral coverage of the edge cases with no
 * test DB. The migration/queue orchestration (which hits the DB) is source-asserted (repo pattern) for
 * its safety invariants: dryRun writes nothing, inserts are source='migration' + confirmed=false, one
 * audit event per insert, idempotent, archived included, and the queue surfaces UNCONFIRMED clients.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { needsClientPartyMigration } from '../db/queries/conflictsMigration.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 5: needsClientPartyMigration (PURE per-matter decision)', () => {
  it('TRUE when a non-empty clientName has no existing client party', () => {
    expect(needsClientPartyMigration('Acme Corp', [])).toBe(true);
    expect(needsClientPartyMigration('Acme Corp', ['adverse', 'related'])).toBe(true);
  });

  it('FALSE (idempotent) when ANY existing party already has role=client (manual / prior-auto / prior-migration)', () => {
    expect(needsClientPartyMigration('Acme Corp', ['client'])).toBe(false);
    expect(needsClientPartyMigration('Acme Corp', ['adverse', 'client'])).toBe(false);
  });

  it('FALSE when clientName is empty / whitespace / null / undefined (skipped)', () => {
    expect(needsClientPartyMigration('', [])).toBe(false);
    expect(needsClientPartyMigration('   ', [])).toBe(false);
    expect(needsClientPartyMigration(null, [])).toBe(false);
    expect(needsClientPartyMigration(undefined, [])).toBe(false);
  });
});

describe('R2-PRE-CONFLICT-1 Inc 5: migration + queue safety invariants (source)', () => {
  const mig = read('src/server/db/queries/conflictsMigration.ts');
  const intake = read('src/server/procedures/matterIntake.ts');

  it('migration includes archived matters and gates writes on the pure decision', () => {
    const fn = mig.slice(mig.indexOf('export async function migrateClientPartiesForOwner'), mig.indexOf('export interface ComplianceQueueEntry'));
    expect(fn).toContain('listMatters(userId, { includeArchived: true })');
    expect(fn).toContain('needsClientPartyMigration(m.clientName, parties.map((p) => p.role))');
  });

  it('inserts are screened-but-not-vouched (source=migration, confirmed=false) and never auto-confirmed', () => {
    const fn = mig.slice(mig.indexOf('export async function migrateClientPartiesForOwner'), mig.indexOf('export interface ComplianceQueueEntry'));
    expect(fn).toContain("source: 'migration'");
    expect(fn).toContain('confirmed: false');
    // no auto-confirm anywhere in the module
    expect(mig).not.toContain('confirmed: true');
  });

  it('dryRun performs NO writes (insert/audit guarded behind !opts.dryRun) and one audit event per insert', () => {
    const fn = mig.slice(mig.indexOf('export async function migrateClientPartiesForOwner'), mig.indexOf('export interface ComplianceQueueEntry'));
    expect(fn).toContain('if (!opts.dryRun)');
    // insertMatterParty and recordAuditEvent both live inside the !dryRun block (after the guard)
    const applyBlock = fn.slice(fn.indexOf('if (!opts.dryRun)'));
    expect(applyBlock).toContain('insertMatterParty(');
    expect(applyBlock).toContain('recordAuditEvent(');
    expect(applyBlock).toContain("action: 'migrate_client_party'");
  });

  it('migration never mutates prior conflict checks/hits (insert-only; staleness handled by the Inc 4 predicate)', () => {
    expect(mig).not.toContain('conflictChecks');
    expect(mig).not.toContain('conflictHits');
    expect(mig).not.toContain('.update(');
    expect(mig).not.toContain('.delete(');
  });

  it('the compliance queue surfaces matters with an UNCONFIRMED client party', () => {
    const fn = mig.slice(mig.indexOf('export async function listConflictsComplianceQueue'));
    expect(fn).toContain("p.role === 'client' && p.confirmed !== true");
  });

  it('both procedures are exposed (migrateClientParties dryRun mutation + read-only queue)', () => {
    expect(intake).toContain('migrateClientParties: protectedProcedure');
    expect(intake).toContain('dryRun: z.boolean()');
    expect(intake).toContain('conflictsComplianceQueue: protectedProcedure');
  });
});
