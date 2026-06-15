/**
 * FOLD-PM-4 — matter_deliverable behavioral tests (CRUD + owner-scope isolation +
 * flag gate). DB-free: the deliverable query layer runs against an injected
 * in-memory store; the matters query module (matter-ownership check + portfolio
 * matters read) is vi.mocked. Authed callers are built off ctx.userId only
 * (Ch 35.2 — userId is NEVER a procedure input).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // owned by U1
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // owned by U2

// Owner-scoped matters stub: getMatterById returns a matter ONLY for its owner;
// listMatters returns only the caller's matters. This is what assertOwnsMatter and
// the portfolio read consult.
vi.mock('../db/queries/matters.js', () => {
  // Literals are inlined (NOT the outer consts) — vi.mock is hoisted above them.
  const matters = [
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: '11111111-1111-1111-1111-111111111111', title: 'Matter A', clientName: 'Client A', practiceArea: 'RE', phase: 'drafting' },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', userId: '22222222-2222-2222-2222-222222222222', title: 'Matter B', clientName: 'Client B', practiceArea: 'RE', phase: 'intake' },
  ];
  return {
    getMatterById: (id: string, userId: string) =>
      Promise.resolve(matters.find((m) => m.id === id && m.userId === userId) ?? null),
    listMatters: (userId: string) => Promise.resolve(matters.filter((m) => m.userId === userId)),
  };
});

import { appRouter } from '../router.js';
import {
  setMatterDeliverableStore,
  type MatterDeliverableStore,
} from '../db/queries/matterDeliverables.js';
import { createInMemoryMatterDeliverableStore } from './inMemoryMatterDeliverableStore.js';

const FLAG = 'MATTER_DELIVERABLE_ENABLED';

function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  setMatterDeliverableStore(createInMemoryMatterDeliverableStore());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setMatterDeliverableStore(null);
});

describe('FOLD-PM-4 — CRUD round-trip', () => {
  it('create -> listForMatter -> update -> complete -> portfolio', async () => {
    const u1 = caller(U1);

    const created = await u1.matterDeliverable.create({
      matterId: MATTER_A,
      title: 'Order title commitment',
      dueDate: '2026-07-01',
    });
    expect(created.status).toBe('open');
    expect(created.title).toBe('Order title commitment');
    expect(created.dueDate).toBe('2026-07-01');
    expect(created.userId).toBe(U1);
    expect(created.matterId).toBe(MATTER_A);

    const list = await u1.matterDeliverable.listForMatter({ matterId: MATTER_A });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(created.id);

    const updated = await u1.matterDeliverable.update({ id: created.id, title: 'Order & review commitment', notes: 'rush' });
    expect(updated.title).toBe('Order & review commitment');
    expect(updated.notes).toBe('rush');
    expect(updated.status).toBe('open');

    const done = await u1.matterDeliverable.complete({ id: created.id });
    expect(done.status).toBe('done');

    const portfolio = await u1.matterDeliverable.portfolio();
    const matterA = portfolio.find((p) => p.matterId === MATTER_A);
    expect(matterA).toBeDefined();
    expect(matterA!.openCount).toBe(0);
    expect(matterA!.doneCount).toBe(1);
    expect(matterA!.deliverables).toHaveLength(1);
  });

  it('portfolio lists the owner matters with open counts; only the caller matters appear', async () => {
    const u1 = caller(U1);
    await u1.matterDeliverable.create({ matterId: MATTER_A, title: 'A1' });
    await u1.matterDeliverable.create({ matterId: MATTER_A, title: 'A2' });

    const portfolio = await u1.matterDeliverable.portfolio();
    expect(portfolio.map((p) => p.matterId)).toEqual([MATTER_A]); // not MATTER_B (owned by U2)
    expect(portfolio[0]!.openCount).toBe(2);
  });
});

describe('FOLD-PM-4 — owner-scope isolation (cross-owner = NOT_FOUND, no existence leak)', () => {
  it('a deliverable created by U1 is invisible/untouchable to U2', async () => {
    const created = await caller(U1).matterDeliverable.create({ matterId: MATTER_A, title: 'private' });
    const u2 = caller(U2);

    // U2 cannot list U1's matter (matter not owned -> NOT_FOUND)
    await expect(u2.matterDeliverable.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/not found/i);
    // U2 cannot update U1's deliverable (owner-scoped patch -> null -> NOT_FOUND)
    await expect(u2.matterDeliverable.update({ id: created.id, title: 'hijack' })).rejects.toThrow(/not found/i);
    // U2 cannot complete U1's deliverable
    await expect(u2.matterDeliverable.complete({ id: created.id })).rejects.toThrow(/not found/i);
    // U2's portfolio never shows U1's matter/deliverable
    const u2Portfolio = await u2.matterDeliverable.portfolio();
    expect(u2Portfolio.some((p) => p.matterId === MATTER_A)).toBe(false);

    // U1 still sees it intact (the failed cross-owner writes did not mutate it)
    const u1List = await caller(U1).matterDeliverable.listForMatter({ matterId: MATTER_A });
    expect(u1List).toHaveLength(1);
    expect(u1List[0]!.title).toBe('private');
  });

  it('creating a deliverable on a matter you do not own is NOT_FOUND', async () => {
    // U1 tries to attach a deliverable to MATTER_B (owned by U2)
    await expect(caller(U1).matterDeliverable.create({ matterId: MATTER_B, title: 'x' })).rejects.toThrow(/not found/i);
  });

  it('an unauthenticated caller is rejected (UNAUTHORIZED)', async () => {
    await expect(caller(undefined).matterDeliverable.portfolio()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('FOLD-PM-4 — flag gate (default OFF, fail-closed, zero store I/O)', () => {
  it('with MATTER_DELIVERABLE_ENABLED OFF, every op refuses and never touches the store', async () => {
    delete process.env[FLAG];
    const throwingStore = new Proxy({} as MatterDeliverableStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setMatterDeliverableStore(throwingStore);
    const u1 = caller(U1);

    await expect(u1.matterDeliverable.portfolio()).rejects.toThrow(/MATTER_DELIVERABLE_DISABLED/);
    await expect(u1.matterDeliverable.listForMatter({ matterId: MATTER_A })).rejects.toThrow(/MATTER_DELIVERABLE_DISABLED/);
    await expect(u1.matterDeliverable.create({ matterId: MATTER_A, title: 'x' })).rejects.toThrow(/MATTER_DELIVERABLE_DISABLED/);
    await expect(u1.matterDeliverable.update({ id: MATTER_A, title: 'x' })).rejects.toThrow(/MATTER_DELIVERABLE_DISABLED/);
    await expect(u1.matterDeliverable.complete({ id: MATTER_A })).rejects.toThrow(/MATTER_DELIVERABLE_DISABLED/);
  });

  it('isEnabled reports the flag state (ungated)', async () => {
    delete process.env[FLAG];
    expect(await caller(U1).matterDeliverable.isEnabled()).toEqual({ enabled: false });
    process.env[FLAG] = 'true';
    expect(await caller(U1).matterDeliverable.isEnabled()).toEqual({ enabled: true });
  });
});
