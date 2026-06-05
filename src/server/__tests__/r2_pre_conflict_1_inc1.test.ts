/**
 * R2-PRE-CONFLICT-1 Inc 1 — party confirmation lifecycle + check snapshot (source-analysis).
 *
 * Schema increment for the triad-dispositioned hybrid conflicts fix
 * (consolidated_disposition_2026-06-05 §3F / §3D). Backend-only, additive. No test DB, so the
 * wiring is verified by source analysis (the repo's established pattern).
 *
 * Later increments build on this: Inc 2 auto-creates an unconfirmed client party; Inc 3 the
 * affirmative-clearance gate (requires a confirmed role='client' party); Inc 4 the check snapshot;
 * Inc 5 the retroactive migration.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2-PRE-CONFLICT-1 Inc 1: confirmation lifecycle + check snapshot wiring', () => {
  it('migration 0020 adds the confirmation columns additively (matter_parties, default TRUE)', () => {
    const mig = read('src/server/db/migrations/0020_r2_pre_conflict_1_party_confirmation.sql');
    expect(mig).toMatch(/ALTER TABLE\s+`matter_parties`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`confirmed`\s+BOOLEAN NOT NULL DEFAULT TRUE/i);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`confirmedAt`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`confirmedByUserId`/);
  });

  it('migration 0020 adds conflict_checks.checkedPartyIds (the §3D snapshot) additively', () => {
    const mig = read('src/server/db/migrations/0020_r2_pre_conflict_1_party_confirmation.sql');
    expect(mig).toMatch(/ALTER TABLE\s+`conflict_checks`/);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS\s+`checkedPartyIds`\s+JSON/i);
  });

  it('schema.ts declares the confirmation columns + the check snapshot', () => {
    const schema = read('src/server/db/schema.ts');
    expect(schema).toContain("confirmed: boolean('confirmed').notNull().default(true)");
    expect(schema).toContain("confirmedAt: timestamp('confirmedAt')");
    expect(schema).toContain("confirmedByUserId: char('confirmedByUserId', { length: 36 })");
    expect(schema).toContain("checkedPartyIds: json('checkedPartyIds')");
  });

  it('MatterPartyRowSchema + ConflictCheckRowSchema carry the new fields (additive)', () => {
    const s = read('src/shared/schemas/layer0.ts');
    expect(s).toContain('confirmed: z.boolean().optional()');
    expect(s).toContain('confirmedByUserId: z.string().uuid().nullable().optional()');
    expect(s).toContain('checkedPartyIds: z.array(z.string().uuid()).nullable().optional()');
  });

  it('insertMatterParty defaults confirmed=true (manual adds confirmed) and records confirmedAt/By', () => {
    const q = read('src/server/db/queries/matterParties.ts');
    expect(q).toContain('const confirmed = data.confirmed ?? true');
    expect(q).toContain('confirmedAt: confirmed ? new Date() : null');
    expect(q).toContain('confirmedByUserId: confirmed ? (data.confirmedByUserId ?? data.userId) : null');
  });
});
