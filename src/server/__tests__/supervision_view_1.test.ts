/**
 * SUPERVISION-VIEW-1 — read-only egress supervision behavioral tests.
 *
 * DB-free: the egress read path runs against the injected in-memory egress store
 * (setEgressEventStore). Covers owner-scope isolation (a supervisor sees ONLY their
 * own egress), filter correctness (provider / kind / decision / date-range),
 * aggregate correctness, pagination, the read-only/no-mutation guarantee, and the
 * default-OFF flag gate. Authed callers use ctx.userId only (Ch 35.2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { appRouter } from '../router.js';
import { setEgressEventStore, type EgressEventStore } from '../db/queries/chatEgress.js';
import { createInMemoryEgressEventStore } from './inMemoryEgressStore.js';
import type { NewChatEgressEvent } from '../db/schema.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MATTER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const FLAG = 'SUPERVISION_VIEW_ENABLED';

function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}

function makeRow(
  o: Partial<NewChatEgressEvent> & { userId: string; matterId: string },
): NewChatEgressEvent {
  return {
    id: o.id ?? uuidv4(),
    userId: o.userId,
    matterId: o.matterId,
    kind: o.kind ?? 'chat_primary',
    decision: o.decision ?? 'allowed',
    provider: o.provider ?? 'anthropic',
    model: o.model ?? 'claude-x',
    correlationId: o.correlationId ?? uuidv4(),
    includedAttachmentCount: o.includedAttachmentCount ?? 0,
    npiWithheldCount: o.npiWithheldCount ?? 0,
    ...(o.blockReason ? { blockReason: o.blockReason } : {}),
  };
}

// Seed five U1 events (distinct createdAt) + one U2 event.
const SEED: Array<{ row: NewChatEgressEvent; at: string }> = [
  { row: makeRow({ userId: U1, matterId: MATTER_A, provider: 'anthropic', kind: 'chat_primary', decision: 'allowed', includedAttachmentCount: 2, npiWithheldCount: 1 }), at: '2026-06-10T12:00:00.000Z' },
  { row: makeRow({ userId: U1, matterId: MATTER_A, provider: 'anthropic', kind: 'chat_grounding', decision: 'allowed' }), at: '2026-06-11T12:00:00.000Z' },
  { row: makeRow({ userId: U1, matterId: MATTER_B, provider: 'openai', kind: 'chat_primary', decision: 'blocked', blockReason: 'not_allowlisted', includedAttachmentCount: 1, npiWithheldCount: 3 }), at: '2026-06-12T12:00:00.000Z' },
  { row: makeRow({ userId: U1, matterId: MATTER_A, provider: 'openai', kind: 'chat_panel', decision: 'allowed' }), at: '2026-06-13T12:00:00.000Z' },
  { row: makeRow({ userId: U1, matterId: MATTER_A, provider: 'google', kind: 'chat_primary', decision: 'blocked' }), at: '2026-06-14T12:00:00.000Z' },
  { row: makeRow({ userId: U2, matterId: MATTER_A, provider: 'anthropic', kind: 'chat_primary', decision: 'allowed' }), at: '2026-06-12T12:00:00.000Z' },
];

let savedFlag: string | undefined;
let store: EgressEventStore;

beforeEach(async () => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = 'true';
  const queue = SEED.map((s) => new Date(s.at));
  store = createInMemoryEgressEventStore(() => queue.shift() ?? new Date('2026-06-15T12:00:00.000Z'));
  setEgressEventStore(store);
  for (const s of SEED) await store.insert(s.row);
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  setEgressEventStore(null);
});

describe('SUPERVISION-VIEW-1 — owner-scope isolation', () => {
  it('a supervisor sees ONLY their own egress events', async () => {
    const u1 = await caller(U1).supervision.query({});
    expect(u1.total).toBe(5);
    expect(u1.events.every((e) => e.userId === U1)).toBe(true);

    const u2 = await caller(U2).supervision.query({});
    expect(u2.total).toBe(1);
    expect(u2.events[0]!.userId).toBe(U2);
    // U2 cannot see U1's events even by filtering on U1's matter.
    const u2OnAMatter = await caller(U2).supervision.query({ matterId: MATTER_B });
    expect(u2OnAMatter.total).toBe(0);
  });

  it('an unauthenticated caller is rejected (UNAUTHORIZED)', async () => {
    await expect(caller(undefined).supervision.query({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('SUPERVISION-VIEW-1 — filter correctness', () => {
  it('filters by provider / matter / kind / decision', async () => {
    expect((await caller(U1).supervision.query({ provider: 'anthropic' })).total).toBe(2);
    expect((await caller(U1).supervision.query({ provider: 'openai' })).total).toBe(2);
    expect((await caller(U1).supervision.query({ matterId: MATTER_A })).total).toBe(4);
    expect((await caller(U1).supervision.query({ matterId: MATTER_B })).total).toBe(1);
    expect((await caller(U1).supervision.query({ kind: 'chat_primary' })).total).toBe(3);
    expect((await caller(U1).supervision.query({ decision: 'blocked' })).total).toBe(2);
    expect((await caller(U1).supervision.query({ provider: 'anthropic', decision: 'blocked' })).total).toBe(0);
  });

  it('filters by inclusive date range', async () => {
    // since 06-12, until 06-13 -> the 06-12 and 06-13 events only.
    const r = await caller(U1).supervision.query({ sinceDate: '2026-06-12', untilDate: '2026-06-13' });
    expect(r.total).toBe(2);
    const days = r.events.map((e) => e.createdAt.toISOString().slice(0, 10)).sort();
    expect(days).toEqual(['2026-06-12', '2026-06-13']);
  });
});

describe('SUPERVISION-VIEW-1 — aggregates', () => {
  it('computes provider / kind / decision / count totals over the filtered set', async () => {
    const { aggregates } = await caller(U1).supervision.query({});
    expect(aggregates.total).toBe(5);
    expect(aggregates.allowedCount).toBe(3);
    expect(aggregates.blockedCount).toBe(2);
    expect(aggregates.includedAttachmentTotal).toBe(3);
    expect(aggregates.npiWithheldTotal).toBe(4);
    expect(aggregates.byProvider).toEqual(
      expect.arrayContaining([
        { provider: 'anthropic', count: 2 },
        { provider: 'openai', count: 2 },
        { provider: 'google', count: 1 },
      ]),
    );
    const primaries = aggregates.byKind.find((k) => k.kind === 'chat_primary');
    expect(primaries?.count).toBe(3);
  });

  it('aggregates reflect the active filter (not the whole log)', async () => {
    const { aggregates } = await caller(U1).supervision.query({ decision: 'blocked' });
    expect(aggregates.total).toBe(2);
    expect(aggregates.allowedCount).toBe(0);
    expect(aggregates.blockedCount).toBe(2);
  });
});

describe('SUPERVISION-VIEW-1 — pagination (newest-first)', () => {
  it('paginates with limit/offset while total reflects the full match', async () => {
    const page1 = await caller(U1).supervision.query({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.events).toHaveLength(2);
    // newest-first: 06-14 then 06-13
    expect(page1.events[0]!.createdAt.toISOString().slice(0, 10)).toBe('2026-06-14');
    expect(page1.events[1]!.createdAt.toISOString().slice(0, 10)).toBe('2026-06-13');

    const page3 = await caller(U1).supervision.query({ limit: 2, offset: 4 });
    expect(page3.events).toHaveLength(1); // the 5th (oldest)
    expect(page3.events[0]!.createdAt.toISOString().slice(0, 10)).toBe('2026-06-10');
  });
});

describe('SUPERVISION-VIEW-1 — read-only (no mutation path)', () => {
  it('the supervision query never writes to the egress log', async () => {
    // Wrap the seeded store so any write throws; reads delegate through.
    const guard: EgressEventStore = {
      get: (id, userId) => store.get(id, userId),
      list: (userId, filter) => store.list(userId, filter),
      insert: () => {
        throw new Error('supervision must not write (insert)');
      },
      complete: () => {
        throw new Error('supervision must not write (complete)');
      },
    };
    setEgressEventStore(guard);
    const r = await caller(U1).supervision.query({});
    expect(r.total).toBe(5); // reads succeed; no write attempted
  });
});

describe('SUPERVISION-VIEW-1 — flag gate (default OFF, fail-closed)', () => {
  it('with SUPERVISION_VIEW_ENABLED OFF, query refuses and never touches the store', async () => {
    delete process.env[FLAG];
    const throwingStore = new Proxy({} as EgressEventStore, {
      get() {
        return () => {
          throw new Error('store must not be touched when the flag is OFF');
        };
      },
    });
    setEgressEventStore(throwingStore);
    await expect(caller(U1).supervision.query({})).rejects.toThrow(/SUPERVISION_VIEW_DISABLED/);
  });

  it('isEnabled reports the flag state (ungated)', async () => {
    delete process.env[FLAG];
    expect(await caller(U1).supervision.isEnabled()).toEqual({ enabled: false });
    process.env[FLAG] = 'true';
    expect(await caller(U1).supervision.isEnabled()).toEqual({ enabled: true });
  });
});
