/**
 * FOLD-L1-4 — Reusable-artifact registry (MM-8a) + cross-matter invocation gate (MM-8b).
 *
 * The heart is the PURE contamination gate (evaluateCrossMatterInvocation), tested
 * exhaustively. Plus the audited-invocation wiring (mocked DB), the Zod walls, and
 * source-audits (owner-scope, fail-visibly audit on cross-matter, default matter_only,
 * router registration). No-DB style; CI authoritative.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ReusableArtifactRowSchema,
  CrossMatterGateDecisionSchema,
  type ReusableArtifactRow,
} from '../../shared/schemas/reusableArtifacts.js';

// Mock the DB layer the gate service depends on.
vi.mock('../db/queries/reusableArtifacts.js', () => ({
  getReusableArtifactById: vi.fn(),
}));
vi.mock('../db/queries/auditEvents.js', () => ({
  insertAuditEvent: vi.fn(),
}));

import {
  evaluateCrossMatterInvocation,
  invokeReusableArtifact,
} from '../reusableArtifacts/index.js';
import { getReusableArtifactById } from '../db/queries/reusableArtifacts.js';
import { insertAuditEvent } from '../db/queries/auditEvents.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER_A = '22222222-2222-2222-2222-222222222222';
const MATTER_B = '33333333-3333-3333-3333-333333333333';
const ART = '44444444-4444-4444-4444-444444444444';
const now = new Date('2026-06-03T00:00:00Z');

function artifact(overrides: Partial<ReusableArtifactRow> = {}): ReusableArtifactRow {
  return {
    id: ART,
    userId: USER,
    originMatterId: MATTER_A,
    sourceDocumentId: null,
    kind: 'clause',
    title: 'Indemnity clause',
    body: 'The parties shall indemnify…',
    reusableScope: 'matter_only',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PURE gate — the contamination boundary
// ---------------------------------------------------------------------------

describe('FOLD-L1-4 — evaluateCrossMatterInvocation (pure contamination gate)', () => {
  it('firm-level artifact (originMatterId null) is allowed and not cross-matter', () => {
    const d = evaluateCrossMatterInvocation({
      artifact: { originMatterId: null, reusableScope: 'matter_only' },
      targetMatterId: MATTER_B,
      explicitOptIn: false,
    });
    expect(d).toEqual({ allowed: true, crossMatter: false, reason: 'firm_level' });
  });

  it('same-matter invocation is allowed and not cross-matter', () => {
    const d = evaluateCrossMatterInvocation({
      artifact: { originMatterId: MATTER_A, reusableScope: 'matter_only' },
      targetMatterId: MATTER_A,
      explicitOptIn: false,
    });
    expect(d).toEqual({ allowed: true, crossMatter: false, reason: 'same_matter' });
  });

  it('cross-matter is BLOCKED by the matter_only default even with an opt-in', () => {
    const d = evaluateCrossMatterInvocation({
      artifact: { originMatterId: MATTER_A, reusableScope: 'matter_only' },
      targetMatterId: MATTER_B,
      explicitOptIn: true,
    });
    expect(d).toEqual({ allowed: false, crossMatter: true, reason: 'blocked_scope_matter_only' });
  });

  it('cross-matter with cross_matter scope is BLOCKED without an explicit per-use opt-in', () => {
    const d = evaluateCrossMatterInvocation({
      artifact: { originMatterId: MATTER_A, reusableScope: 'cross_matter' },
      targetMatterId: MATTER_B,
      explicitOptIn: false,
    });
    expect(d).toEqual({ allowed: false, crossMatter: true, reason: 'blocked_no_opt_in' });
  });

  it('cross-matter is allowed ONLY with cross_matter scope AND explicit opt-in', () => {
    const d = evaluateCrossMatterInvocation({
      artifact: { originMatterId: MATTER_A, reusableScope: 'cross_matter' },
      targetMatterId: MATTER_B,
      explicitOptIn: true,
    });
    expect(d).toEqual({ allowed: true, crossMatter: true, reason: 'cross_matter_opt_in' });
    expect(CrossMatterGateDecisionSchema.safeParse(d).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audited invocation wiring
// ---------------------------------------------------------------------------

describe('FOLD-L1-4 — invokeReusableArtifact (gate + fail-visibly audit)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws NOT_FOUND when the artifact is not owned/known', async () => {
    vi.mocked(getReusableArtifactById).mockResolvedValue(null);
    await expect(
      invokeReusableArtifact({ artifactId: ART, targetMatterId: MATTER_B, userId: USER, explicitOptIn: true }),
    ).rejects.toMatchObject({ message: 'Reusable artifact not found' });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it('blocks a cross-matter invocation under the matter_only default (no audit written)', async () => {
    vi.mocked(getReusableArtifactById).mockResolvedValue(artifact({ reusableScope: 'matter_only' }));
    await expect(
      invokeReusableArtifact({ artifactId: ART, targetMatterId: MATTER_B, userId: USER, explicitOptIn: true }),
    ).rejects.toMatchObject({ message: 'CROSS_MATTER_BLOCKED' });
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it('allows same-matter invocation with no audit and no contamination warning', async () => {
    vi.mocked(getReusableArtifactById).mockResolvedValue(artifact({ originMatterId: MATTER_B }));
    const res = await invokeReusableArtifact({
      artifactId: ART,
      targetMatterId: MATTER_B,
      userId: USER,
      explicitOptIn: false,
    });
    expect(res.decision.crossMatter).toBe(false);
    expect(res.contaminationWarning).toBeUndefined();
    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it('allows an explicit, scoped, opted-in cross-matter invocation and FAIL-VISIBLY audits it', async () => {
    vi.mocked(getReusableArtifactById).mockResolvedValue(artifact({ reusableScope: 'cross_matter' }));
    vi.mocked(insertAuditEvent).mockResolvedValue('audit-id');
    const res = await invokeReusableArtifact({
      artifactId: ART,
      targetMatterId: MATTER_B,
      userId: USER,
      explicitOptIn: true,
      rationale: 'Standard indemnity, no client specifics.',
    });
    expect(res.decision).toMatchObject({ allowed: true, crossMatter: true, reason: 'cross_matter_opt_in' });
    expect(res.contaminationWarning).toContain('Cross-matter');
    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertAuditEvent).mock.calls[0]![0]).toMatchObject({
      matterId: MATTER_B,
      eventType: 'disposition',
      action: 'cross_matter_invoke',
      targetType: 'reusable_artifact',
      targetId: ART,
    });
  });

  it('refuses the invocation when the audit write fails (fail-visibly)', async () => {
    vi.mocked(getReusableArtifactById).mockResolvedValue(artifact({ reusableScope: 'cross_matter' }));
    vi.mocked(insertAuditEvent).mockRejectedValue(new Error('audit table unavailable'));
    await expect(
      invokeReusableArtifact({ artifactId: ART, targetMatterId: MATTER_B, userId: USER, explicitOptIn: true }),
    ).rejects.toThrow(/audit table unavailable/);
  });
});

// ---------------------------------------------------------------------------
// Zod walls
// ---------------------------------------------------------------------------

describe('FOLD-L1-4 — ReusableArtifactRow Zod wall', () => {
  it('accepts the canonical row and a null originMatterId (firm-level)', () => {
    expect(ReusableArtifactRowSchema.safeParse(artifact()).success).toBe(true);
    expect(ReusableArtifactRowSchema.safeParse(artifact({ originMatterId: null })).success).toBe(true);
  });
  it('rejects an unknown kind or scope', () => {
    expect(ReusableArtifactRowSchema.safeParse({ ...artifact(), kind: 'contract' }).success).toBe(false);
    expect(ReusableArtifactRowSchema.safeParse({ ...artifact(), reusableScope: 'public' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source audits of the wiring
// ---------------------------------------------------------------------------

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L1-4 — wiring (source audit)', () => {
  const schema = readSrc('../db/schema.ts');
  const migration = readSrc('../db/migrations/0006_fold_l1_4_reusable_artifacts.sql');
  const queries = readSrc('../db/queries/reusableArtifacts.ts');
  const gate = readSrc('../reusableArtifacts/index.ts');
  const router = readSrc('../router.ts');

  it('schema + migration: reusable_artifacts is additive with a matter_only default scope', () => {
    expect(schema).toMatch(/mysqlTable\(\s*'reusable_artifacts'/);
    expect(schema).toMatch(/\.default\('matter_only'\)/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS `reusable_artifacts`/);
    expect(migration).toMatch(/DEFAULT 'matter_only'/);
    expect(migration).not.toMatch(/DROP TABLE/i);
  });

  it('queries owner-filter via ownerScope(), never inline eq(table.userId,...)', () => {
    expect(queries).toMatch(/ownerScope\(reusableArtifacts\.userId,/);
    expect(queries).not.toMatch(/eq\(reusableArtifacts\.userId/);
  });

  it('the gate fail-visibly audits cross-matter invocations via insertAuditEvent', () => {
    expect(gate).toMatch(/insertAuditEvent\(/);
    expect(gate).toMatch(/action: 'cross_matter_invoke'/);
    // it uses the fail-visibly insertAuditEvent, not the best-effort recordAuditEvent
    expect(gate).not.toMatch(/recordAuditEvent/);
  });

  it('router registers the reusableArtifact router', () => {
    expect(router).toMatch(/reusableArtifact: reusableArtifactRouter/);
  });
});
