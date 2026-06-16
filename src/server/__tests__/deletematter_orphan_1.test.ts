/**
 * DELETEMATTER-ORPHAN-1 — matter.delete cascades to matter-scoped child rows, but PRESERVES the
 * matter's permanent records (operator-affirmed posture, 2026-06-15).
 *
 * BUG fixed: matter.delete used to delete only the `matters` row, orphaning every matter-scoped child
 * (no DB FKs exist). The fix routes the everyday delete through the shared owner-scoped transactional
 * cascade (cascadeDeleteMatterChildren) — but, unlike the operator-gated purge, the everyday delete:
 *   (a) REFUSES when any of the matter's chat conversations is under legal hold (mirrors
 *       canDeleteConversation), and
 *   (b) PRESERVES the matter's permanent records — auditEvents (FOLD-GOV-1a), postureProvenance, and the
 *       GLBA chatEgressEvents log (EVERYDAY_DELETE_PRESERVE) — cleaning up only client work-product.
 * The operator-gated purgeMatter still destroys everything (passes no preserve set).
 *
 * NO test DB (repo standard — see lln_prod_cleanup_1_purge "source analysis; no test DB"). So cascade
 * behaviour (preserve vs full, ordering, dryRun, empty, atomicity) is exercised by driving the REAL
 * cascadeDeleteMatterChildren against a fake transaction; the procedure gates run through the real tRPC
 * caller with the query layer mocked; owner-scoping + the matters-row delete's transaction wrapper are
 * asserted structurally (matching lln_prod_cleanup_1_purge convention). Row-level zero-orphan +
 * cross-owner isolation against a live DB remain a Pattern-16 live-verify item.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getTableName } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response } from 'express';
import type { MatterRow, DocumentRow } from '../../shared/schemas/matters.js';

// Partial mocks: keep REAL cascadeDeleteMatterChildren + EVERYDAY_DELETE_PRESERVE; spy ONLY
// deleteMatterCascade so the procedure-gate tests can assert whether/with-what the delete invokes it.
vi.mock('../db/queries/matterPurge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matterPurge.js')>();
  return { ...actual, deleteMatterCascade: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, listDocumentsForMatter: vi.fn() };
});
vi.mock('../db/queries/chatCopilot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/chatCopilot.js')>();
  return { ...actual, matterHasLegalHold: vi.fn() };
});

import {
  cascadeDeleteMatterChildren,
  deleteMatterCascade,
  EVERYDAY_DELETE_PRESERVE,
} from '../db/queries/matterPurge.js';
import { getMatterById } from '../db/queries/matters.js';
import { listDocumentsForMatter } from '../db/queries/documents.js';
import { matterHasLegalHold } from '../db/queries/chatCopilot.js';
import { RETENTION_POLICY } from '../config/retentionPolicy.js';
import { appRouter } from '../router.js';
import {
  documents,
  versions,
  feedback,
  auditEvents,
  matterParties,
  postureProvenance,
  tickler,
  matterDeadline,
  documentParty,
  informationRequests,
  matterDeliverable,
  materialExtraction,
  chatConversations,
  chatMessages,
  chatSummaries,
  chatEgressEvents,
  chatAttachments,
  chatAttachmentParty,
} from '../db/schema.js';

const USER_ID = uuidv4();
const MATTER_ID = uuidv4();

// ── A fake transaction: records every tx.delete(table), feeds tx.select(...) seeded rows. No DB. ──
function makeFakeTx(opts: { idRows: { id: string }[]; count: number; throwOnDeleteIndex?: number }) {
  const deletedNames: string[] = [];
  const tx = {
    select(projection: Record<string, unknown>) {
      const isIdResolution = Object.prototype.hasOwnProperty.call(projection, 'id');
      return {
        from(_table: unknown) {
          return {
            where(_cond: unknown) {
              return Promise.resolve(isIdResolution ? opts.idRows : [{ n: opts.count }]);
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(_cond: unknown) {
          deletedNames.push(getTableName(table as Parameters<typeof getTableName>[0]));
          if (opts.throwOnDeleteIndex !== undefined && deletedNames.length === opts.throwOnDeleteIndex) {
            throw new Error('injected mid-cascade failure');
          }
          return Promise.resolve();
        },
      };
    },
  };
  return { tx, deletedNames };
}

// Drive the real cascade against the fake tx (cast away the drizzle tx type for the test double).
const runCascade = (
  tx: ReturnType<typeof makeFakeTx>['tx'],
  opts: { dryRun: boolean; preserve?: ReadonlySet<string> },
): Promise<{ counts: Record<string, number>; total: number }> =>
  cascadeDeleteMatterChildren(
    tx as unknown as Parameters<typeof cascadeDeleteMatterChildren>[0],
    MATTER_ID,
    USER_ID,
    opts,
  );

const name = (t: unknown) => getTableName(t as Parameters<typeof getTableName>[0]);

// ============================================================
// 0. The preserve set is exactly the three permanent-record classes
// ============================================================
describe('DELETEMATTER-ORPHAN-1 — EVERYDAY_DELETE_PRESERVE', () => {
  it('preserves exactly the permanent audit/posture Matter Record + the GLBA egress log', () => {
    expect([...EVERYDAY_DELETE_PRESERVE].sort()).toEqual(
      // EGRESS-CONTROL-PLANE-1: egress_events is a GLBA egress audit log, preserved by the everyday delete
      // exactly like chat_egress_events (only the operator-gated purge removes it).
      ['auditEvents', 'chatEgressEvents', 'egressEvents', 'postureProvenance'],
    );
  });

  it('every retentionPolicy class marked deletable:false is protected by the everyday delete (drift guard)', () => {
    // Maps a records-management DataClass to its cascade label (the matterPurge.ts step() label). A future
    // deletable:false class with no mapping fails here, forcing the author to map it AND protect it.
    const classToCascadeLabel: Record<string, string> = { audit_events: 'auditEvents' };
    for (const [dataClass, rule] of Object.entries(RETENTION_POLICY)) {
      if (rule.deletable === false) {
        const label = classToCascadeLabel[dataClass];
        expect(
          label,
          `retentionPolicy '${dataClass}' is deletable:false but has no mapped cascade label — map it and add to EVERYDAY_DELETE_PRESERVE`,
        ).toBeDefined();
        expect(EVERYDAY_DELETE_PRESERVE.has(label as string)).toBe(true);
      }
    }
  });
});

// ============================================================
// 1. Cascade behaviour (REAL cascadeDeleteMatterChildren, fake tx)
// ============================================================
describe('DELETEMATTER-ORPHAN-1 — cascade preserve vs full destruction', () => {
  it('everyday delete (preserve set): cleans up work-product but PRESERVES audit_events / postureProvenance / chat_egress_events', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [{ id: 'doc-1' }], count: 1 });
    await runCascade(tx, { dryRun: false, preserve: EVERYDAY_DELETE_PRESERVE });

    // The three permanent-record classes are left untouched (not even queried).
    expect(deletedNames).not.toContain(name(auditEvents));
    expect(deletedNames).not.toContain(name(postureProvenance));
    expect(deletedNames).not.toContain(name(chatEgressEvents));

    // ...but the matter's client work-product IS deleted (no orphans of working data).
    const workProduct = [
      documents, versions, feedback, documentParty,
      chatConversations, chatMessages, chatSummaries, chatAttachments, chatAttachmentParty,
      matterDeliverable, materialExtraction,
      matterParties, informationRequests, tickler, matterDeadline,
    ].map(name);
    expect(deletedNames).toEqual(expect.arrayContaining(workProduct));
  });

  it('operator purge cascade (no preserve) destroys EVERYTHING, including the permanent records', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [{ id: 'doc-1' }], count: 1 });
    await runCascade(tx, { dryRun: false });

    // purge is the only path that removes the permanent records
    expect(deletedNames).toContain(name(auditEvents));
    expect(deletedNames).toContain(name(postureProvenance));
    expect(deletedNames).toContain(name(chatEgressEvents));
    expect(deletedNames.length).toBeGreaterThanOrEqual(40); // broad, not a stub
  });

  it('children-before-parents ordering (no DB FKs — ordering is enforced in code)', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [{ id: 'doc-1' }], count: 1 });
    await runCascade(tx, { dryRun: false });
    const idx = (t: unknown) => deletedNames.indexOf(name(t));
    expect(idx(versions)).toBeLessThan(idx(documents));
    expect(idx(documentParty)).toBeLessThan(idx(documents));
    expect(idx(tickler)).toBeLessThan(idx(matterDeadline));
    expect(idx(chatMessages)).toBeLessThan(idx(chatConversations));
    expect(idx(chatSummaries)).toBeLessThan(idx(chatConversations));
    expect(idx(chatAttachmentParty)).toBeLessThan(idx(chatAttachments));
  });

  it('dryRun preview writes NOTHING but still counts', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [{ id: 'doc-1' }], count: 1 });
    const { total } = await runCascade(tx, { dryRun: true });
    expect(deletedNames).toHaveLength(0);
    expect(total).toBeGreaterThan(0);
  });

  it('empty matter (no children) deletes nothing (count-gated, side-effect free)', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [], count: 0 });
    const { total } = await runCascade(tx, { dryRun: false });
    expect(deletedNames).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('atomicity: a mid-cascade delete failure aborts and never reaches the documents/matters tail', async () => {
    const { tx, deletedNames } = makeFakeTx({ idRows: [{ id: 'doc-1' }], count: 1, throwOnDeleteIndex: 5 });
    await expect(runCascade(tx, { dryRun: false })).rejects.toThrow('injected mid-cascade failure');
    // Stopped at the failing delete; nothing ran after. In production the enclosing transaction rolls
    // back, so the matter + all children remain (no half-deleted state).
    expect(deletedNames).toHaveLength(5);
    expect(deletedNames).not.toContain(name(documents)); // documents is deleted last — never reached
  });
});

// ============================================================
// 2. matter.delete procedure gates (real tRPC caller; query layer mocked)
// ============================================================
const createCaller = (userId: string) =>
  appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

const aMatter = { id: MATTER_ID, userId: USER_ID } as unknown as MatterRow;

describe('DELETEMATTER-ORPHAN-1 — matter.delete gates + cascade dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks deletion of a matter WITH an active document and deletes nothing', async () => {
    vi.mocked(getMatterById).mockResolvedValue(aMatter);
    vi.mocked(listDocumentsForMatter).mockResolvedValue([{ id: 'doc-1' } as unknown as DocumentRow]);

    await expect(createCaller(USER_ID).matter.delete({ matterId: MATTER_ID })).rejects.toThrow(
      'MATTER_HAS_ACTIVE_DOCUMENTS',
    );
    expect(deleteMatterCascade).not.toHaveBeenCalled();
  });

  it('REFUSES to delete a matter that has a legal-held conversation and deletes nothing', async () => {
    vi.mocked(getMatterById).mockResolvedValue(aMatter);
    vi.mocked(listDocumentsForMatter).mockResolvedValue([]);
    vi.mocked(matterHasLegalHold).mockResolvedValue(true); // true even for a soft-deleted held conversation

    await expect(createCaller(USER_ID).matter.delete({ matterId: MATTER_ID })).rejects.toThrow(
      'MATTER_HAS_LEGAL_HOLD',
    );
    expect(deleteMatterCascade).not.toHaveBeenCalled();
  });

  it('on the clean path, cascades with the OWNER (ctx.userId, never input) and returns { deleted: true }', async () => {
    vi.mocked(getMatterById).mockResolvedValue(aMatter);
    vi.mocked(listDocumentsForMatter).mockResolvedValue([]);
    vi.mocked(matterHasLegalHold).mockResolvedValue(false);
    vi.mocked(deleteMatterCascade).mockResolvedValue(undefined);

    const res = await createCaller(USER_ID).matter.delete({ matterId: MATTER_ID });
    expect(res).toEqual({ deleted: true });
    expect(deleteMatterCascade).toHaveBeenCalledTimes(1);
    expect(deleteMatterCascade).toHaveBeenCalledWith(MATTER_ID, USER_ID); // owner-scoped on ctx.userId
  });

  it('a non-existent / non-owned matter is NOT_FOUND and deletes nothing', async () => {
    vi.mocked(getMatterById).mockResolvedValue(null);

    await expect(createCaller(USER_ID).matter.delete({ matterId: MATTER_ID })).rejects.toThrow(
      'Matter not found',
    );
    expect(deleteMatterCascade).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. Structure: shared cascade, preserve wiring, owner-scoping, gates (source scan; CRLF-safe)
// ============================================================
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('DELETEMATTER-ORPHAN-1 — shared cascade, preserve wiring, owner-scoping, gates', () => {
  const purge = read('src/server/db/queries/matterPurge.ts');
  const proc = read('src/server/procedures/matters.ts');

  it('ONE shared cascade: purge passes no preserve (full), the everyday delete passes EVERYDAY_DELETE_PRESERVE', () => {
    expect(purge).toContain('export async function cascadeDeleteMatterChildren(');
    expect(purge).toContain('export async function deleteMatterCascade(');
    expect(purge).toContain('await cascadeDeleteMatterChildren(tx, matterId, userId, { dryRun })'); // purge: full
    expect(purge).toContain('preserve: EVERYDAY_DELETE_PRESERVE'); // everyday delete: protected classes kept
    expect(purge).toContain('if (preserve?.has(label)) return;'); // a preserved class is skipped entirely
  });

  it('deleteMatterCascade is transactional and removes the matters row OWNER-SCOPED (never inline eq on userId)', () => {
    const body = purge.slice(purge.indexOf('export async function deleteMatterCascade'));
    expect(body).toContain('db.transaction');
    expect(body).toContain('ownerScope(matters.userId, userId)');
    // children cascade runs BEFORE the matters-row delete -> a cascade failure can't leave the row deleted
    expect(body.indexOf('cascadeDeleteMatterChildren')).toBeLessThan(body.indexOf('tx.delete(matters)'));
  });

  it('matter.delete keeps the active-documents gate, adds the legal-hold gate, routes to the cascade with ctx.userId, and no longer does a bare matters-row delete', () => {
    expect(proc).toContain('await deleteMatterCascade(input.matterId, ctx.userId)');
    expect(proc).toContain("message: 'MATTER_HAS_ACTIVE_DOCUMENTS'");
    expect(proc).toContain('includeArchived: false');
    expect(proc).toContain("message: 'MATTER_HAS_LEGAL_HOLD'");
    expect(proc).toContain('matterHasLegalHold(input.matterId, ctx.userId)');
    expect(proc).not.toContain('await deleteMatter(input.matterId');
  });

  it('the legal-hold gate sees SOFT-DELETED held conversations (matterHasLegalHold passes includeDeleted=true)', () => {
    const chat = read('src/server/db/queries/chatCopilot.ts');
    expect(chat).toContain('export async function matterHasLegalHold');
    // includeDeleted=true is the load-bearing bypass fix — a hold can be placed on already-soft-deleted
    // material, and the cascade deletes chat rows regardless of deletedAt.
    expect(chat).toContain('listConversationsForMatter(matterId, userId, true)');
    expect(chat).toContain('c.legalHold');
  });
});
