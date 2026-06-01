/**
 * MR-CAL-6B — Locked decisions (document-scoped)
 *
 * Covers: the LockedDecisionRow Zod contract, and source-audits of the wiring
 * (schema table, query functions, tRPC mutations, reviewer-prompt injection, the
 * narrowed mode-discipline line, the additive migration, and the default-safe
 * "no locks => no prompt section" property).
 *
 * These are pure-unit + source-audit tests (no DB), matching the MR-CAL-5C style,
 * so they run deterministically in CI (no local pnpm/vitest available).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LockedDecisionRowSchema } from '../../shared/schemas/phase4b.js';

const VALID_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  documentId: '33333333-3333-3333-3333-333333333333',
  matterId: '44444444-4444-4444-4444-444444444444',
  scope: 'document' as const,
  origin: 'declined' as const,
  sourceSuggestionId: 'sugg-1',
  sourceIterationNumber: 3,
  reviewSessionId: '55555555-5555-5555-5555-555555555555',
  summary: 'Governing law is Virginia; do not re-raise.',
  rationale: 'Client confirmed VA.',
  status: 'active' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MR-CAL-6B LockedDecisionRowSchema', () => {
  it('accepts the canonical row shape', () => {
    expect(LockedDecisionRowSchema.safeParse(VALID_ROW).success).toBe(true);
  });

  it('accepts a row with null provenance/rationale (direct/standing-style or no source)', () => {
    const row = {
      ...VALID_ROW,
      sourceSuggestionId: null,
      sourceIterationNumber: null,
      reviewSessionId: null,
      rationale: null,
    };
    expect(LockedDecisionRowSchema.safeParse(row).success).toBe(true);
  });

  it('accepts origin adopted and status unlocked', () => {
    expect(
      LockedDecisionRowSchema.safeParse({ ...VALID_ROW, origin: 'adopted', status: 'unlocked' }).success,
    ).toBe(true);
  });

  it('rejects an unknown origin', () => {
    expect(LockedDecisionRowSchema.safeParse({ ...VALID_ROW, origin: 'maybe' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(LockedDecisionRowSchema.safeParse({ ...VALID_ROW, status: 'archived' }).success).toBe(false);
  });

  it('rejects a non-document scope (Phase A is document-only)', () => {
    expect(LockedDecisionRowSchema.safeParse({ ...VALID_ROW, scope: 'matter' }).success).toBe(false);
  });

  it('requires a summary', () => {
    const { summary, ...noSummary } = VALID_ROW;
    void summary;
    expect(LockedDecisionRowSchema.safeParse(noSummary).success).toBe(false);
  });
});

describe('MR-CAL-6B schema wiring (source audit)', () => {
  const src = readFileSync(resolve('src/server/db/schema.ts'), 'utf8');

  it('declares the locked_decisions table with document scope + origin + status enums', () => {
    expect(src).toContain('export const lockedDecisions = mysqlTable(');
    expect(src).toContain("'locked_decisions'");
    expect(src).toContain("LOCKED_DECISION_SCOPE_VALUES = ['document']");
    expect(src).toContain("LOCKED_DECISION_ORIGIN_VALUES = ['declined', 'adopted']");
    expect(src).toContain("LOCKED_DECISION_STATUS_VALUES = ['active', 'unlocked']");
  });

  it('exports the LockedDecision row type', () => {
    expect(src).toContain('export type LockedDecision = typeof lockedDecisions.$inferSelect;');
  });

  it('indexes the document+status prompt-injection read path and a suggestion unique index', () => {
    expect(src).toContain("index('idx_locked_decisions_document')");
    expect(src).toContain("uniqueIndex('uniq_locked_decision_suggestion')");
  });
});

describe('MR-CAL-6B query layer (source audit)', () => {
  const src = readFileSync(resolve('src/server/db/queries/phase4b.ts'), 'utf8');

  it('passes locked_decisions rows through the Zod Wall', () => {
    expect(src).toContain('function parseLockedDecisionRow');
    expect(src).toContain('LockedDecisionRowSchema.parse');
  });

  it('exposes insert / list-all / list-active / get / unlock / update functions', () => {
    expect(src).toContain('export async function insertLockedDecision');
    expect(src).toContain('export async function listLockedDecisionsForDocument');
    expect(src).toContain('export async function listActiveLockedDecisionsForDocument');
    expect(src).toContain('export async function getLockedDecisionById');
    expect(src).toContain('export async function unlockLockedDecision');
    expect(src).toContain('export async function updateLockedDecision');
  });

  it('list-active filters on status=active and is userId-scoped', () => {
    const fnIdx = src.indexOf('export async function listActiveLockedDecisionsForDocument');
    const fnBlock = src.slice(fnIdx, fnIdx + 700);
    expect(fnBlock).toContain("eq(lockedDecisions.status, 'active')");
    expect(fnBlock).toContain('eq(lockedDecisions.userId, userId)');
  });

  it('unlock sets status unlocked rather than deleting (audit preservation)', () => {
    const fnIdx = src.indexOf('export async function unlockLockedDecision');
    const fnBlock = src.slice(fnIdx, fnIdx + 400);
    expect(fnBlock).toContain(".set({ status: 'unlocked' })");
    expect(fnBlock).not.toContain('.delete(');
  });
});

describe('MR-CAL-6B tRPC procedures (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('exposes lockDecision / listLockedDecisions / unlockDecision / updateDecision', () => {
    expect(src).toContain('lockDecision: protectedProcedure');
    expect(src).toContain('listLockedDecisions: protectedProcedure');
    expect(src).toContain('unlockDecision: protectedProcedure');
    expect(src).toContain('updateDecision: protectedProcedure');
  });

  it('lockDecision is a pure DB write (no executeCanonicalMutation / LLM job in its block)', () => {
    const start = src.indexOf('lockDecision: protectedProcedure');
    const block = src.slice(start, src.indexOf('listLockedDecisions: protectedProcedure'));
    expect(block).toContain('insertLockedDecision(');
    expect(block).not.toContain('executeCanonicalMutation');
  });

  it('lockDecision accepts both origins (decline-&-lock and lock-on-adopt)', () => {
    const start = src.indexOf('lockDecision: protectedProcedure');
    const block = src.slice(start, src.indexOf('listLockedDecisions: protectedProcedure'));
    expect(block).toContain("origin: z.enum(['declined', 'adopted'])");
  });

  it('emits locked-decision lifecycle telemetry', () => {
    expect(src).toContain("'locked_decision_created'");
    expect(src).toContain("'locked_decision_unlocked'");
    expect(src).toContain("'locked_decision_updated'");
  });
});

describe('MR-CAL-6B reviewer-prompt injection (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('loads active locked decisions before fanning out reviewers', () => {
    expect(src).toContain('listActiveLockedDecisionsForDocument(');
    expect(src).toContain('## Locked Decisions');
  });

  it('omits the locked-decisions section entirely when there are none (default-safe)', () => {
    // The userPrompt spreads the section only when non-empty, so a zero-lock review
    // is byte-identical to pre-6B behavior.
    expect(src).toContain('...(lockedDecisionsSection ? [lockedDecisionsSection] : [])');
  });

  it('bounds the injected locks for token safety', () => {
    expect(src).toContain('MAX_LOCKED_DECISIONS_IN_PROMPT');
    expect(src).toContain('LOCKED_RATIONALE_MAX_CHARS');
  });
});

describe('MR-CAL-6B reviewer prompt mode discipline (source audit)', () => {
  const src = readFileSync(resolve('src/server/llm/prompts/reviewerPrompts.ts'), 'utf8');

  it('retains the do-not-re-raise locked-decisions rule', () => {
    expect(src).toContain('do not re-raise previously resolved or locked decisions absent material change');
  });

  it('mode discipline now allows CONSUMING locked decisions but still excludes persistence/sendability/ledger', () => {
    expect(src).toContain('MAY consume any provided "Locked Decisions" context');
    expect(src).toContain('do not, however, implement evaluator mode, persistence storage, sendability gates, or cumulative adopt ledgers');
  });
});

describe('MR-CAL-6B migration (source audit)', () => {
  const sql = readFileSync(resolve('src/server/db/migrations/0002_mr_cal_6b_locked_decisions.sql'), 'utf8');

  it('creates the locked_decisions table additively (no ALTER/DROP of existing tables)', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `locked_decisions`');
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bALTER TABLE\b/);
  });

  it('declares the document+status index and the suggestion unique index', () => {
    expect(sql).toContain('`idx_locked_decisions_document` (`documentId`, `status`)');
    expect(sql).toContain('`uniq_locked_decision_suggestion` (`documentId`, `sourceSuggestionId`)');
  });
});
