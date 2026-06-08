/**
 * FOLD-PM-1 Increment 3 — foundations: injectable clock seam + audit-event-type extension + the
 * additive audit migration guard. (The lifecycle state machine + tickler materialization + recompute +
 * open_item projection + read API land in the same increment; these are the lower-risk foundation guards.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { systemClock, fixedClock } from '../deadline/clock.js';
import { AuditEventRowSchema } from '../../shared/schemas/auditEvents.js';
import { AUDIT_EVENT_TYPE_VALUES } from '../db/schema.js';

const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../db/migrations/0022_fold_pm_1_deadline_audit_events.sql', import.meta.url)),
  'utf8',
);

describe('FOLD-PM-1 Inc3 — clock seam', () => {
  it('fixedClock returns exactly the injected date (deterministic)', () => {
    expect(fixedClock('2026-06-08').today()).toBe('2026-06-08');
  });

  it('systemClock returns a well-formed America/New_York civil date', () => {
    expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('FOLD-PM-1 Inc3 — audit event-type extension (firing audited distinctly)', () => {
  it('deadline_fired + deadline_acknowledged are in the column enum AND the Zod Wall', () => {
    expect(AUDIT_EVENT_TYPE_VALUES).toContain('deadline_fired');
    expect(AUDIT_EVENT_TYPE_VALUES).toContain('deadline_acknowledged');
    const now = new Date('2026-06-08T00:00:00Z');
    const base = {
      id: '11111111-1111-1111-1111-111111111111', userId: '22222222-2222-2222-2222-222222222222',
      matterId: '33333333-3333-3333-3333-333333333333', documentId: null, actor: 'system',
      actorModel: null, summary: 'surfaced deadline', payload: null, reviewSessionId: null,
      sourceSuggestionId: null, versionId: null, createdAt: now,
    };
    expect(AuditEventRowSchema.safeParse({ ...base, eventType: 'deadline_fired' }).success).toBe(true);
    expect(AuditEventRowSchema.safeParse({ ...base, eventType: 'deadline_acknowledged', actor: 'attorney' }).success).toBe(true);
    expect(AuditEventRowSchema.safeParse({ ...base, eventType: 'deadline_exploded' }).success).toBe(false);
  });

  it('migration 0022 is additive (MODIFY enum; no destructive DDL) and keeps all prior values', () => {
    // Strip `--` comments before the destructive scan, exactly as the pre-deploy runner's assertAdditive does
    // (the header comment legitimately mentions DROP/TRUNCATE/RENAME while explaining it is NOT destructive).
    const ddl = MIGRATION_SQL.replace(/--[^\n]*/g, '');
    expect(/ALTER TABLE\s+`audit_events`/i.test(ddl)).toBe(true);
    expect(/MODIFY COLUMN\s+`eventType`/i.test(ddl)).toBe(true);
    expect(/\b(DROP|TRUNCATE|RENAME)\b/i.test(ddl)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(ddl)).toBe(false);
    for (const v of ['model_output', 'disposition', 'deadline_fired', 'deadline_acknowledged']) {
      expect(ddl).toContain(`'${v}'`);
    }
  });
});
