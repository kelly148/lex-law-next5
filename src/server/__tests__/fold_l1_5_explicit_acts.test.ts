/**
 * FOLD-L1-5 — the five explicit acts + matter-state dashboard.
 *
 * Behavioral (mocked DB) tests that each act is an EXPLICIT, owner-scoped commitment wired
 * to the right server primitive (never inferred), plus the dashboard read schema and
 * source-audits. No real DB; CI authoritative.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

// Mock only the query primitives the acts call; keep the rest real (importOriginal spread).
vi.mock('../db/queries/matters.js', async (io) => ({
  ...(await io<typeof import('../db/queries/matters.js')>()),
  getMatterById: vi.fn(),
}));
vi.mock('../db/queries/auditEvents.js', async (io) => ({
  ...(await io<typeof import('../db/queries/auditEvents.js')>()),
  insertAuditEvent: vi.fn(),
}));
vi.mock('../db/queries/openItems.js', async (io) => ({
  ...(await io<typeof import('../db/queries/openItems.js')>()),
  getOpenItemById: vi.fn(),
  resolveOpenItem: vi.fn(),
  withdrawOpenItem: vi.fn(),
}));
vi.mock('../db/queries/sourceAuthority.js', async (io) => ({
  ...(await io<typeof import('../db/queries/sourceAuthority.js')>()),
  insertSourceAuthority: vi.fn(),
}));

import { appRouter } from '../router.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';
import { getOpenItemById, resolveOpenItem, withdrawOpenItem } from '../db/queries/openItems.js';
import { insertSourceAuthority } from '../db/queries/sourceAuthority.js';
import { MatterStateDashboardSchema, type MatterIdentity } from '../../shared/schemas/matterState.js';
import { assembleMatterState } from '../matterState/index.js';
import { formatMatterStateBlock } from '../matterState/injection.js';
import type { MatterRow } from '../../shared/schemas/matters.js';
import type { OpenItemRow } from '../../shared/schemas/openItems.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';
const OPEN = '44444444-4444-4444-4444-444444444444';
const now = new Date('2026-06-03T00:00:00Z');

function caller() {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId: USER });
}

const matterRow: MatterRow = {
  id: MATTER,
  userId: USER,
  title: 'Acme lease',
  clientName: null,
  practiceArea: null,
  phase: 'drafting',
  archivedAt: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};

const openItemRow: OpenItemRow = {
  id: OPEN,
  userId: USER,
  matterId: MATTER,
  documentId: DOC,
  category: 'governing_law',
  severity: 'blocker',
  summary: 'Jurisdiction mismatch',
  status: 'open',
  statusSource: 'auto',
  origin: 'sendability',
  confidence: 'high',
  requiresAttorneyConfirmation: false,
  sourceSuggestionId: null,
  reviewSessionId: null,
  versionId: null,
  lastSeenAt: now,
  resolvedByEventId: null,
  resolutionRationale: null,
  createdAt: now,
  updatedAt: now,
};

afterEach(() => {
  vi.clearAllMocks();
});

// ── act (4): send / withhold ────────────────────────────────────────────────
describe('FOLD-L1-5 — recordSend (explicit send/withhold act)', () => {
  it('records a fail-visibly audit event with the chosen decision', async () => {
    vi.mocked(getMatterById).mockResolvedValue(matterRow);
    vi.mocked(insertAuditEvent).mockResolvedValue('event-id');
    const res = await caller().matterState.recordSend({
      matterId: MATTER,
      decision: 'sent',
      summary: 'Sent to client after blocker resolved.',
    });
    expect(res).toEqual({ eventId: 'event-id', decision: 'sent' });
    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertAuditEvent).mock.calls[0]![0]).toMatchObject({
      matterId: MATTER,
      eventType: 'sent',
      actor: 'attorney',
      action: 'sent',
    });
  });

  it('refuses when the matter is not owned (no audit written)', async () => {
    vi.mocked(getMatterById).mockResolvedValue(null);
    await expect(
      caller().matterState.recordSend({ matterId: MATTER, decision: 'withheld', summary: 'x' }),
    ).rejects.toMatchObject({ message: 'Matter not found' });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });
});

// ── act (3): disposition an open item ────────────────────────────────────────
describe('FOLD-L1-5 — dispositionItem (resolve | withdraw)', () => {
  it('routes resolve to resolveOpenItem with the item context', async () => {
    vi.mocked(getOpenItemById).mockResolvedValue(openItemRow);
    vi.mocked(resolveOpenItem).mockResolvedValue({ ...openItemRow, status: 'resolved', statusSource: 'attorney' });
    await caller().matterState.dispositionItem({ openItemId: OPEN, action: 'resolve', rationale: 'Resolved with client.' });
    expect(resolveOpenItem).toHaveBeenCalledTimes(1);
    expect(withdrawOpenItem).not.toHaveBeenCalled();
    expect(vi.mocked(resolveOpenItem).mock.calls[0]![0]).toMatchObject({
      id: OPEN,
      userId: USER,
      matterId: MATTER,
      documentId: DOC,
    });
  });

  it('routes withdraw to withdrawOpenItem', async () => {
    vi.mocked(getOpenItemById).mockResolvedValue(openItemRow);
    vi.mocked(withdrawOpenItem).mockResolvedValue({ ...openItemRow, status: 'withdrawn', statusSource: 'attorney' });
    await caller().matterState.dispositionItem({ openItemId: OPEN, action: 'withdraw' });
    expect(withdrawOpenItem).toHaveBeenCalledTimes(1);
    expect(resolveOpenItem).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND for an unknown/unowned item', async () => {
    vi.mocked(getOpenItemById).mockResolvedValue(null);
    await expect(
      caller().matterState.dispositionItem({ openItemId: OPEN, action: 'resolve' }),
    ).rejects.toMatchObject({ message: 'Open item not found' });
  });
});

// ── act (2): tier a source ───────────────────────────────────────────────────
describe('FOLD-L1-5 — tierSource (explicit attorney designation)', () => {
  it('inserts a source authority with designationSource attorney (never inferred)', async () => {
    vi.mocked(getMatterById).mockResolvedValue(matterRow);
    vi.mocked(insertSourceAuthority).mockResolvedValue({
      id: '55555555-5555-5555-5555-555555555555',
      userId: USER,
      matterId: MATTER,
      documentId: DOC,
      subjectType: 'document',
      subjectId: DOC,
      authorityOrigin: 'operative',
      lifecycle: 'operative',
      designationSource: 'attorney',
      label: null,
      notes: null,
      verificationStatus: 'unverified',
      lastVerifiedAt: null,
      stalenessReason: null,
      effectiveFrom: null,
      supersededAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    });
    await caller().matterState.tierSource({
      matterId: MATTER,
      subjectType: 'document',
      subjectId: DOC,
      authorityOrigin: 'operative',
      lifecycle: 'operative',
    });
    expect(insertSourceAuthority).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertSourceAuthority).mock.calls[0]![0]).toMatchObject({
      matterId: MATTER,
      subjectType: 'document',
      designationSource: 'attorney',
    });
  });
});

// ── dashboard read schema ────────────────────────────────────────────────────
describe('FOLD-L1-5 — MatterStateDashboard schema', () => {
  it('accepts a full + model_context + packet payload', () => {
    const matter: MatterIdentity = {
      matterId: MATTER,
      title: 'Acme lease',
      clientName: null,
      practiceArea: null,
      phase: 'drafting',
      archivedAt: null,
    };
    const common = {
      matterId: MATTER,
      userId: USER,
      matter,
      operativeDocument: null,
      documentsForFull: [],
      docsRaw: [],
      lockedDecisions: [],
      adoptions: [],
      openItems: [],
      sourceAuthorities: [],
      auditEvents: [],
      operativeSources: [],
      openBlockerCount: 0,
    };
    const full = assembleMatterState({ ...common, mode: 'full' });
    const modelContext = assembleMatterState({ ...common, mode: 'model_context' });
    if (modelContext.mode !== 'model_context') throw new Error('expected model_context');
    const dash = { full, modelContext, modelContextPacket: formatMatterStateBlock(modelContext) };
    expect(MatterStateDashboardSchema.safeParse(dash).success).toBe(true);
  });
});

// ── source audits ────────────────────────────────────────────────────────────
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L1-5 — wiring (source audit)', () => {
  const proc = readSrc('../procedures/matterState.ts');
  const dash = readSrc('../../client/components/MatterStateDashboard.tsx');
  const matterDetail = readSrc('../../client/pages/MatterDetail.tsx');

  it('the five-act procedures exist and are owner-scoped (ctx.userId, not input)', () => {
    for (const p of ['tierSource', 'dispositionItem', 'recordSend', 'dashboard']) {
      expect(proc).toContain(`${p}:`);
    }
    expect(proc).toMatch(/userId: ctx\.userId/);
    expect(proc).not.toMatch(/userId:\s*input\./);
  });

  it('tierSource designates designationSource attorney (explicit, never inferred)', () => {
    expect(proc).toMatch(/designationSource: 'attorney'/);
  });

  it('recordSend uses the fail-visibly insertAuditEvent (not best-effort recordAuditEvent)', () => {
    // insertAuditEvent is imported and used only by recordSend in this module.
    expect(proc).toMatch(/insertAuditEvent\(\{/);
    expect(proc).not.toMatch(/recordAuditEvent/);
  });

  it('the dashboard component routes mutations through useGuardedMutation and a confirm step', () => {
    expect(dash).toMatch(/useGuardedMutation/);
    expect(dash).toMatch(/Confirm:/);
  });

  it('MatterDetail renders the matter-state dashboard (visible surface)', () => {
    expect(matterDetail).toMatch(/<MatterStateDashboard matterId=\{matterId\} \/>/);
  });
});
