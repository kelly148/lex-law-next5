/**
 * FOLD-GOV-1a — Audit-as-Matter-Record (schema + query-wrapper invariants).
 *
 * Validates the AuditEventRow Zod wall and asserts two structural invariants of
 * the query wrapper: (1) it is APPEND-ONLY (insert + read only; no update/delete),
 * and (2) owner scoping goes through the ownerScope() chokepoint (FOLD-AUTH-1 Inc 2),
 * not an inline eq(table.userId, ...). Static/source checks — no DB needed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AuditEventRowSchema } from '../../shared/schemas/auditEvents.js';

const QUERY_SRC = readFileSync(
  fileURLToPath(new URL('../db/queries/auditEvents.ts', import.meta.url)),
  'utf8',
);

describe('FOLD-GOV-1a — AuditEventRow Zod wall', () => {
  const valid = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    userId: '11111111-1111-1111-1111-111111111111',
    matterId: '22222222-2222-2222-2222-222222222222',
    documentId: null,
    eventType: 'model_output' as const,
    actor: 'model' as const,
    actorModel: 'anthropic:claude-opus-4-5',
    summary: 'Reviewer produced 3 suggestions.',
    payload: { count: 3 },
    reviewSessionId: null,
    sourceSuggestionId: null,
    versionId: null,
    createdAt: new Date('2026-06-02T00:00:00Z'),
  };

  it('parses a valid audit event row', () => {
    expect(AuditEventRowSchema.parse(valid)).toMatchObject({ eventType: 'model_output', actor: 'model' });
  });

  it('rejects an unknown eventType', () => {
    expect(() => AuditEventRowSchema.parse({ ...valid, eventType: 'bogus' })).toThrow();
  });

  it('rejects a missing summary', () => {
    const { summary: _omit, ...withoutSummary } = valid;
    expect(() => AuditEventRowSchema.parse(withoutSummary)).toThrow();
  });
});

describe('FOLD-GOV-1a — query wrapper invariants', () => {
  it('is append-only (exposes insert + list; no update/delete of audit_events)', () => {
    expect(QUERY_SRC).toMatch(/export async function insertAuditEvent/);
    expect(QUERY_SRC).toMatch(/export async function listAuditEventsForMatter/);
    expect(QUERY_SRC).not.toMatch(/db\.update\(auditEvents\)/);
    expect(QUERY_SRC).not.toMatch(/db\.delete\(auditEvents\)/);
  });

  it('owner-scopes via the ownerScope() chokepoint, not an inline eq(table.userId,...)', () => {
    expect(QUERY_SRC).toMatch(/ownerScope\(auditEvents\.userId,/);
    expect(QUERY_SRC).not.toMatch(/eq\(auditEvents\.userId/);
  });
});

describe('FOLD-GOV-1a Inc 2 — best-effort recorder + explicit-act instrumentation', () => {
  const REVIEW_SRC = readFileSync(
    fileURLToPath(new URL('../procedures/reviewSession.ts', import.meta.url)),
    'utf8',
  );

  it('recordAuditEvent is best-effort: wraps insertAuditEvent in try/catch (never rethrows)', () => {
    expect(QUERY_SRC).toMatch(/export async function recordAuditEvent/);
    const fn = QUERY_SRC.slice(QUERY_SRC.indexOf('function recordAuditEvent'));
    expect(fn).toMatch(/try\s*\{[\s\S]*insertAuditEvent\(data\)[\s\S]*\}\s*catch/);
  });

  it('lockDecision / unlockDecision record the locked / unlocked explicit acts', () => {
    expect(REVIEW_SRC).toMatch(/recordAuditEvent\(\{[\s\S]*?eventType: 'locked'/);
    expect(REVIEW_SRC).toMatch(/recordAuditEvent\(\{[\s\S]*?eventType: 'unlocked'/);
  });
});
