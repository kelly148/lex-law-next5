/**
 * CAPACITY-ELECTION-UX — data-layer election marker (Option A) + injection-predicate closure (R3).
 *
 * Covers the parts not exercised by the per-role predicate suites (chat / outline / drafting):
 *   R1  migration 0032 is additive + idempotent; on the pre-deploy allowlist; schema.ts mirrors the
 *       nullable marker WITHOUT touching the existing engagementCapacity column; the Zod Wall reads it
 *       .nullable().optional() and round-trips a row with the marker present / null / ABSENT.
 *   R2  matter.create stamps the marker ONLY on an explicit election (NULL otherwise);
 *       setMatterEngagementCapacity ALWAYS stamps it (source-analysis — the repo's DB-wiring pattern,
 *       there is no test DB).
 *   R3  the shared isElectedRepresentationalLawFirm predicate: elected law_firm -> true; an UNELECTED
 *       law_firm (NULL marker) -> false (the residual closure); title / null / missing -> false.
 *   R7  flag-OFF stays byte-for-byte legacy — the marker is read only inside the (flag-gated) predicates,
 *       never on the OFF guard path (no new reads when OFF).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MatterRowSchema } from '../../shared/schemas/matters.js';
import { isElectedRepresentationalLawFirm, isRepresentationalLawFirmCapacity } from '../llm/masterCompositionPrimitives.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// R1 — migration / allowlist / schema / Zod Wall (additive, idempotent, no backfill)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPACITY-ELECTION-UX R1 — data layer is additive + idempotent', () => {
  it('migration 0032 adds engagementCapacityElectedAt additively (ADD COLUMN IF NOT EXISTS, TIMESTAMP NULL) and is non-destructive', () => {
    const mig = read('src/server/db/migrations/0032_capacity_election_marker.sql');
    expect(mig).toMatch(/ALTER TABLE\s+`matters`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`engagementCapacityElectedAt`\s+TIMESTAMP NULL/i);
    // Scan only the EXECUTABLE SQL (strip `--` comments) — the same way the pre-deploy runner's
    // additive guard does — so the explanatory prose ("no backfill", "not dropped") is not flagged.
    const sql = mig.replace(/--[^\n]*/g, '');
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    // The existing engagementCapacity column is NOT touched by this migration.
    expect(sql).not.toMatch(/`engagementCapacity`\s+ENUM/i);
  });

  it('the migration is on the additive pre-deploy allowlist (auto-applies on deploy)', () => {
    const runner = read('scripts/apply-prod-migrations.mjs');
    expect(runner).toContain("'0032_capacity_election_marker.sql'");
    // ordered after 0031 (the engagementCapacity column it depends on)
    expect(runner.indexOf("'0032_capacity_election_marker.sql'")).toBeGreaterThan(
      runner.indexOf("'0031_instr_2b_title_matter_engagement_capacity.sql'"),
    );
  });

  it('schema.ts declares the nullable marker WITHOUT retyping the existing engagementCapacity column', () => {
    const schema = read('src/server/db/schema.ts');
    expect(schema).toContain("engagementCapacityElectedAt: timestamp('engagementCapacityElectedAt')");
    // the existing column keeps its NOT NULL DEFAULT 'law_firm' (untouched).
    expect(schema).toContain("engagementCapacity: mysqlEnum('engagementCapacity', MATTER_ENGAGEMENT_CAPACITY_VALUES)");
    expect(schema).toContain(".default('law_firm')");
  });

  it('Zod Wall round-trips a matter row with the marker present, null, or ABSENT (pre-migration)', () => {
    const base = {
      id: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      title: 'Smith Matter',
      clientName: null,
      practiceArea: null,
      phase: 'intake' as const,
      engagementCapacity: 'law_firm' as const,
      archivedAt: null,
      completedAt: null,
      createdAt: new Date('2026-06-13T00:00:00Z'),
      updatedAt: new Date('2026-06-13T00:00:00Z'),
    };
    // marker present (an election happened)
    expect(MatterRowSchema.parse({ ...base, engagementCapacityElectedAt: new Date('2026-06-13T00:00:00Z') }).engagementCapacityElectedAt).toBeInstanceOf(Date);
    // marker explicitly null (unelected post-migration row)
    expect(MatterRowSchema.parse({ ...base, engagementCapacityElectedAt: null }).engagementCapacityElectedAt).toBeNull();
    // marker ABSENT (a pre-migration read / legacy fixture) still parses
    expect(MatterRowSchema.parse(base).engagementCapacityElectedAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2 — the marker is written on every affirmative election (source-analysis)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPACITY-ELECTION-UX R2 — marker writes', () => {
  it('matter.create stamps the marker ONLY on an explicit election (NULL otherwise) and passes it to insertMatter', () => {
    const proc = read('src/server/procedures/matters.ts');
    expect(proc).toContain('input.engagementCapacity !== undefined ? new Date() : null');
    expect(proc).toContain('engagementCapacityElectedAt,');
  });

  it('setMatterEngagementCapacity ALWAYS stamps the marker (every election sets it)', () => {
    const q = read('src/server/db/queries/matters.ts');
    expect(q).toContain('.set({ engagementCapacity, engagementCapacityElectedAt: new Date() })');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 — the shared elected-representational predicate (the residual closure)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPACITY-ELECTION-UX R3 — isElectedRepresentationalLawFirm', () => {
  const ELECTED = new Date('2026-06-13T00:00:00Z');

  it('an AFFIRMATIVELY-ELECTED law_firm seat -> true', () => {
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: 'law_firm', engagementCapacityElectedAt: ELECTED })).toBe(true);
    // also accepts a serialized-string marker (over-the-wire)
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: 'law_firm', engagementCapacityElectedAt: '2026-06-13T00:00:00Z' })).toBe(true);
  });

  it('an UNELECTED law_firm seat (NULL / absent marker) -> false (the residual closure)', () => {
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: 'law_firm', engagementCapacityElectedAt: null })).toBe(false);
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: 'law_firm' })).toBe(false);
  });

  it('a title / null / missing capacity -> false regardless of the marker', () => {
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: 'title_settlement_agent', engagementCapacityElectedAt: ELECTED })).toBe(false);
    expect(isElectedRepresentationalLawFirm({ engagementCapacity: null, engagementCapacityElectedAt: ELECTED })).toBe(false);
    expect(isElectedRepresentationalLawFirm({ engagementCapacityElectedAt: ELECTED })).toBe(false);
  });

  it('the value-only sub-check still recognizes the law_firm seat (capacity half of the predicate)', () => {
    expect(isRepresentationalLawFirmCapacity('law_firm')).toBe(true);
    expect(isRepresentationalLawFirmCapacity('title_settlement_agent')).toBe(false);
    expect(isRepresentationalLawFirmCapacity(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R7 — flag-OFF stays byte-for-byte legacy (the marker adds no OFF-path read)
// ─────────────────────────────────────────────────────────────────────────────
describe('CAPACITY-ELECTION-UX R7 — flag-OFF zero-read guard preserved', () => {
  it('assemblePrompt returns legacy BEFORE consulting capacity/marker when no flag is on', () => {
    const src = read('src/server/llm/assemblePrompt.ts');
    // the OFF guard returns legacy before the engagementCapacity/marker decision is reached.
    expect(src).toContain('if (!flagEnabled) return legacy;');
    expect(src).toContain('if (!anyComposableFlag) return legacy;');
    // the marker is only forwarded inside the (already flag-guarded) composition path.
    expect(src).toContain('engagementCapacityElectedAt: matter.engagementCapacityElectedAt ?? null');
  });
});
