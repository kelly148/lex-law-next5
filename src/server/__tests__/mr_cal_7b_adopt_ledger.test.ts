/**
 * MR-CAL-7B — Cumulative adopt ledger
 *
 * Covers: the AdoptLedgerRow Zod contract, the advisory survival heuristic, and
 * source-audits of the wiring (schema table, queries, capture-on-adopt,
 * regeneration apply, reviewer-prompt injection, tRPC procedures, migration,
 * and the default-safe "no ledger => no prompt section" property).
 *
 * Pure-unit + source-audit (no DB), matching the MR-CAL-6B style, so they run
 * deterministically in CI (no local pnpm/vitest available).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AdoptLedgerRowSchema } from '../../shared/schemas/phase4b.js';
import { survivalHeuristicPresent } from '../db/queries/phase4b.js';

const VALID_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  documentId: '33333333-3333-3333-3333-333333333333',
  matterId: '44444444-4444-4444-4444-444444444444',
  sourceSuggestionId: 'sugg-1',
  sourceReviewerRole: 'gpt_lite',
  sourceIterationNumber: 3,
  reviewSessionId: '55555555-5555-5555-5555-555555555555',
  disposition: 'adopted_verbatim' as const,
  originalText: 'Add a governing-law clause naming Virginia.',
  adoptedText: 'Add a governing-law clause naming Virginia.',
  adoptedIntoVersionId: '66666666-6666-6666-6666-666666666666',
  producedVersionId: null,
  status: 'unresolved' as const,
  statusSource: 'auto' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MR-CAL-7B AdoptLedgerRowSchema', () => {
  it('accepts the canonical row shape', () => {
    expect(AdoptLedgerRowSchema.safeParse(VALID_ROW).success).toBe(true);
  });

  it('accepts adopted_modified with a producedVersionId and active status', () => {
    const row = {
      ...VALID_ROW,
      disposition: 'adopted_modified',
      adoptedText: 'Add a Virginia governing-law clause and a severability clause.',
      producedVersionId: '77777777-7777-7777-7777-777777777777',
      status: 'active',
    };
    expect(AdoptLedgerRowSchema.safeParse(row).success).toBe(true);
  });

  it('accepts every status value and attorney statusSource', () => {
    for (const status of ['active', 'superseded', 'resolved', 'unresolved']) {
      expect(AdoptLedgerRowSchema.safeParse({ ...VALID_ROW, status, statusSource: 'attorney' }).success).toBe(true);
    }
  });

  it('rejects an unknown disposition', () => {
    expect(AdoptLedgerRowSchema.safeParse({ ...VALID_ROW, disposition: 'adopted_partial' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(AdoptLedgerRowSchema.safeParse({ ...VALID_ROW, status: 'pending' }).success).toBe(false);
  });

  it('rejects an unknown statusSource', () => {
    expect(AdoptLedgerRowSchema.safeParse({ ...VALID_ROW, statusSource: 'system' }).success).toBe(false);
  });

  it('requires originalText and adoptedText', () => {
    const { adoptedText, ...noAdopted } = VALID_ROW;
    void adoptedText;
    expect(AdoptLedgerRowSchema.safeParse(noAdopted).success).toBe(false);
  });
});

describe('MR-CAL-7B survival heuristic (advisory)', () => {
  it('treats exact adopted text present in the new content as present', () => {
    const content = 'Article X. The agreement is governed by Virginia law. Article Y.';
    expect(survivalHeuristicPresent('governed by Virginia law', content)).toBe(true);
  });

  it('treats clearly-absent adopted text as not present', () => {
    const content = 'Article X. The parties agree to arbitrate in Maryland. Article Y.';
    expect(survivalHeuristicPresent('a non-recourse seller financing carve-out for senior debt', content)).toBe(false);
  });

  it('tolerates light paraphrase via token overlap (advisory)', () => {
    // Most distinctive tokens survive even though wording shifts.
    const adopted = 'The Principal must initial exactly one delegation authorization option.';
    const content = 'Section 4.2: the Principal shall initial exactly one delegation authorization option below.';
    expect(survivalHeuristicPresent(adopted, content)).toBe(true);
  });

  it('does not flag empty adopted text as lost', () => {
    expect(survivalHeuristicPresent('', 'anything')).toBe(true);
  });
});

describe('MR-CAL-7B schema wiring (source audit)', () => {
  const src = readFileSync(resolve('src/server/db/schema.ts'), 'utf8');

  it('declares the adopt_ledger table with disposition/status/statusSource enums', () => {
    expect(src).toContain('export const adoptLedger = mysqlTable(');
    expect(src).toContain("'adopt_ledger'");
    expect(src).toContain("ADOPT_LEDGER_DISPOSITION_VALUES = ['adopted_verbatim', 'adopted_modified']");
    expect(src).toContain("ADOPT_LEDGER_STATUS_VALUES = ['active', 'superseded', 'resolved', 'unresolved']");
    expect(src).toContain("ADOPT_LEDGER_STATUS_SOURCE_VALUES = ['auto', 'attorney']");
  });

  it('stores adopted text + provenance + version anchors', () => {
    expect(src).toContain("originalText: text('originalText').notNull()");
    expect(src).toContain("adoptedText: text('adoptedText').notNull()");
    expect(src).toContain("adoptedIntoVersionId: char('adoptedIntoVersionId'");
    expect(src).toContain("producedVersionId: char('producedVersionId'");
  });

  it('exports the AdoptLedger row type and indexes the read path', () => {
    expect(src).toContain('export type AdoptLedger = typeof adoptLedger.$inferSelect;');
    expect(src).toContain("index('idx_adopt_ledger_document')");
    expect(src).toContain("uniqueIndex('uniq_adopt_ledger_session_suggestion')");
  });
});

describe('MR-CAL-7B query layer (source audit)', () => {
  const src = readFileSync(resolve('src/server/db/queries/phase4b.ts'), 'utf8');

  it('passes adopt_ledger rows through the Zod Wall', () => {
    expect(src).toContain('function parseAdoptLedgerRow');
    expect(src).toContain('AdoptLedgerRowSchema.parse');
  });

  it('exposes insert / list / list-for-prompt / get / apply-regen / status-update', () => {
    expect(src).toContain('export async function insertAdoptLedgerEntry');
    expect(src).toContain('export async function listAdoptLedgerForDocument');
    expect(src).toContain('export async function listAdoptLedgerForPrompt');
    expect(src).toContain('export async function getAdoptLedgerEntryById');
    expect(src).toContain('export async function applyRegenerationToAdoptLedger');
    expect(src).toContain('export async function updateAdoptLedgerStatus');
  });

  it('auto-detection never overwrites an attorney-set status', () => {
    const fnIdx = src.indexOf('export async function applyRegenerationToAdoptLedger');
    const block = src.slice(fnIdx, fnIdx + 1400);
    expect(block).toContain("eq(adoptLedger.statusSource, 'auto')");
  });

  it('attorney status override sets statusSource=attorney', () => {
    const fnIdx = src.indexOf('export async function updateAdoptLedgerStatus');
    const block = src.slice(fnIdx, fnIdx + 500);
    expect(block).toContain("statusSource: 'attorney'");
    expect(block).not.toContain('.delete(');
  });
});

describe('MR-CAL-7B capture + regen wiring (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('captures an adopt_ledger entry at the regenerate commit point', () => {
    expect(src).toContain('insertAdoptLedgerEntry(');
    expect(src).toContain("disposition: edited ? 'adopted_modified' : 'adopted_verbatim'");
  });

  it('applies regeneration to the ledger on commit (advisory survival)', () => {
    expect(src).toContain('applyRegenerationToAdoptLedger(');
  });

  it('exposes listAdoptLedger + updateAdoptLedgerStatus procedures', () => {
    expect(src).toContain('listAdoptLedger: protectedProcedure');
    expect(src).toContain('updateAdoptLedgerStatus: protectedProcedure');
  });
});

describe('MR-CAL-7B reviewer-prompt injection (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('loads adopt-ledger carryforward entries and builds a Previously Adopted section', () => {
    expect(src).toContain('listAdoptLedgerForPrompt(');
    expect(src).toContain('## Previously Adopted');
  });

  it('omits the Previously Adopted section entirely when the ledger is empty (default-safe)', () => {
    expect(src).toContain('...(previouslyAdoptedSection ? [previouslyAdoptedSection] : [])');
  });

  it('bounds the injected adopted items for token safety', () => {
    expect(src).toContain('MAX_ADOPTED_IN_PROMPT');
    expect(src).toContain('ADOPTED_TEXT_MAX_CHARS');
  });
});

describe('MR-CAL-7B migration (source audit)', () => {
  const sql = readFileSync(resolve('src/server/db/migrations/0003_mr_cal_7b_adopt_ledger.sql'), 'utf8');

  it('creates adopt_ledger additively (no ALTER/DROP of existing tables)', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `adopt_ledger`');
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bALTER TABLE\b/);
  });

  it('declares the document+status index and the session/suggestion unique index', () => {
    expect(sql).toContain('`idx_adopt_ledger_document` (`documentId`, `status`)');
    expect(sql).toContain('`uniq_adopt_ledger_session_suggestion` (`reviewSessionId`, `sourceSuggestionId`)');
  });
});
