/**
 * KB-PROVENANCE-1 — additive provenance schema tests (no DB; pure Zod + source-file guards).
 *
 * Asserts the Zod Wall accepts the new practice_memos provenance fields (and stays
 * backward-compatible with rows lacking them — the migration-added .nullable().optional()
 * convention), the authority_source row contract, the authority-type enum lockstep across
 * shared/schema/migration, and that both migrations are ADDITIVE + idempotent + allowlisted.
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  PracticeMemoRowSchema,
  LawReliedOnEntrySchema,
} from '../../shared/schemas/practiceKb.js';
import { AuthoritySourceRowSchema, AUTHORITY_TYPE_VALUES } from '../../shared/schemas/authoritySource.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function baseMemo() {
  return {
    id: uuidv4(),
    userId: uuidv4(),
    originMatterId: null,
    sourceAnalysisId: null,
    sourceDocumentId: null,
    title: 'Memo',
    body: 'Body',
    practiceArea: null,
    jurisdiction: null,
    lawReliedOn: null,
    topicTags: null,
    writtenOn: null,
    verificationStatus: 'unverified' as const,
    lastVerifiedAt: null,
    verifiedThroughDate: null,
    verificationMethod: null,
    verificationNote: null,
    privilegeTag: 'client_confidential' as const,
    abstractionStatus: 'raw' as const,
    abstractionAttestedByEventId: null,
    abstractedAt: null,
    abstractedBy: null,
    reuseScope: 'matter_only' as const,
    abstractedFromMemoId: null,
    supersededById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function baseAuthority() {
  return {
    id: uuidv4(),
    userId: uuidv4(),
    jurisdiction: 'VA',
    authorityType: 'statute' as const,
    citationText: 'Va. Code Ann. § 55.1-345',
    pinpoint: null,
    sourceUrlOrLocation: null,
    sourceSnapshotHash: null,
    effectiveDate: null,
    lastCheckedDate: null,
    reviewByDate: null,
    checkedBy: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('KB-PROVENANCE-1 — practice_memos provenance fields (Zod Wall)', () => {
  it('accepts a memo WITHOUT the new fields (backward compatible — migration-added optional)', () => {
    expect(() => PracticeMemoRowSchema.parse(baseMemo())).not.toThrow();
  });

  it('accepts a memo WITH the new provenance fields set', () => {
    const m = {
      ...baseMemo(),
      effectiveDate: '2026-01-01',
      reviewBy: '2026-12-31',
      authoritySnapshotId: uuidv4(),
      negativeTreatmentFlag: true,
    };
    const parsed = PracticeMemoRowSchema.parse(m);
    expect(parsed.effectiveDate).toBe('2026-01-01');
    expect(parsed.negativeTreatmentFlag).toBe(true);
  });

  it('lawReliedOn entries accept the optional authoritySourceId link', () => {
    const entry = { jurisdiction: 'VA', citationOrSource: 'Va. Code § 1', sourceType: 'statute', authoritySourceId: uuidv4() };
    expect(() => LawReliedOnEntrySchema.parse(entry)).not.toThrow();
    // still valid without it
    expect(() => LawReliedOnEntrySchema.parse({ jurisdiction: 'VA', citationOrSource: 'X', sourceType: 'case' })).not.toThrow();
  });
});

describe('KB-PROVENANCE-1 — authority_source row contract (Zod Wall)', () => {
  it('parses a valid authority_source row (with and without dates)', () => {
    expect(() => AuthoritySourceRowSchema.parse(baseAuthority())).not.toThrow();
    const dated = { ...baseAuthority(), effectiveDate: '2020-07-01', lastCheckedDate: '2026-06-01', reviewByDate: '2027-06-01', checkedBy: 'KS', pinpoint: '§ 55.1-345(B)' };
    expect(() => AuthoritySourceRowSchema.parse(dated)).not.toThrow();
  });

  it('rejects a row missing the citation, with a bad authorityType, or a malformed date', () => {
    const { citationText: _omit, ...noCitation } = baseAuthority();
    expect(() => AuthoritySourceRowSchema.parse(noCitation)).toThrow(ZodError);
    expect(() => AuthoritySourceRowSchema.parse({ ...baseAuthority(), authorityType: 'blog_post' })).toThrow(ZodError);
    expect(() => AuthoritySourceRowSchema.parse({ ...baseAuthority(), effectiveDate: 'July 1, 2020' })).toThrow(ZodError);
  });
});

describe('KB-PROVENANCE-1 — authority-type enum lockstep (shared / schema.ts / migration)', () => {
  it('the enum literals match across all three sources', () => {
    expect([...AUTHORITY_TYPE_VALUES]).toEqual(['statute', 'regulation', 'case', 'constitutional', 'secondary', 'other']);
    const schemaTs = read('src/server/db/schema.ts');
    expect(schemaTs).toContain("mysqlEnum('authorityType', AUTHORITY_TYPE_VALUES)");
    const sql = read('src/server/db/migrations/0039_kb_provenance_1_authority_source.sql');
    expect(sql).toContain("ENUM('statute','regulation','case','constitutional','secondary','other')");
  });
});

describe('KB-PROVENANCE-1 — migrations are additive, idempotent, and allowlisted', () => {
  const DESTRUCTIVE = /\b(DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b/i;

  it('MIG1 (0038) is an idempotent additive ADD COLUMN on practice_memos', () => {
    const sql = read('src/server/db/migrations/0038_kb_provenance_1_practice_memo_provenance.sql').replace(/--[^\n]*/g, '');
    expect(sql).toMatch(/ALTER TABLE `practice_memos`/);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS `effectiveDate`');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS `negativeTreatmentFlag`');
    expect(sql).not.toMatch(DESTRUCTIVE);
    // verified_date intentionally NOT added (duplicate of verifiedThroughDate/lastVerifiedAt)
    expect(sql).not.toContain('verified_date');
  });

  it('MIG2 (0039) is an idempotent additive CREATE TABLE with no FK', () => {
    const sql = read('src/server/db/migrations/0039_kb_provenance_1_authority_source.sql').replace(/--[^\n]*/g, '');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `authority_source`');
    expect(sql).toContain('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    expect(sql).not.toMatch(DESTRUCTIVE);
  });

  it('both migrations are on the pre-deploy additive allowlist + authority_source is expected', () => {
    const runner = read('scripts/apply-prod-migrations.mjs');
    expect(runner).toContain("'0038_kb_provenance_1_practice_memo_provenance.sql'");
    expect(runner).toContain("'0039_kb_provenance_1_authority_source.sql'");
    expect(runner).toContain("'authority_source'");
  });
});
