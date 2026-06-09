/**
 * DOC-CLIENT-TARGET-1 Increment 5 — error-prevention + migration (source-audit; no test DB).
 *
 * Confirms the §6 structural finalize validations hard-block the malpractice cases, and that the
 * retroactive targeting migration reuses the create resolvers, backfills only the safe single-client
 * case, FLAGS (never auto-assigns) multi-client individual docs, and gates all writes behind dryRun.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('DOC-CLIENT-TARGET-1 Inc 5: finalize structural validation (§6 hard blocks)', () => {
  it('validateTargetingForFinalize covers no-subject / >1-subject / inactive-client / missing-role-group', () => {
    const v = read('src/server/documents/targetingValidation.ts');
    expect(v).toContain('NO_SUBJECT');
    expect(v).toContain('MULTIPLE_SUBJECTS');
    expect(v).toContain('SUBJECT_NOT_ACTIVE_CLIENT');
    expect(v).toContain('MISSING_ROLE_GROUP');
  });

  it('finalize hard-blocks invalid targeting BEFORE the §6 text-consistency check', () => {
    const d4a = read('src/server/procedures/documents4a.ts');
    expect(d4a).toContain('validateTargetingForFinalize(doc, userId)');
    expect(d4a).toContain('TARGETING_INVALID');
    expect(d4a.indexOf('validateTargetingForFinalize(doc, userId)')).toBeLessThan(d4a.indexOf('evaluateTargetConsistency('));
  });
});

describe('DOC-CLIENT-TARGET-1 Inc 5: retroactive targeting migration (operator-gated)', () => {
  const mig = read('src/server/documents/targetingMigration.ts');

  it('reuses the pure CREATE resolvers (single source of truth)', () => {
    expect(mig).toContain('resolveIndividualSubject(');
    expect(mig).toContain('resolvePartySetBinding(');
  });

  it('single-client backfills; a multi-client individual doc is FLAGGED, never auto-assigned', () => {
    expect(mig).toContain('backfill_individual_subject');
    expect(mig).toContain('flag_unresolved_multi_client');
    // the multi-client (SUBJECT_REQUIRED) branch records a flag but performs NO binding
    const multiBranch = mig.slice(
      mig.indexOf("res.code === 'SUBJECT_REQUIRED'"),
      mig.indexOf("res.kind === 'none'"),
    );
    expect(multiBranch.length).toBeGreaterThan(0);
    expect(multiBranch).not.toContain('bindDocumentParty(');
  });

  it('dryRun guards all writes; applies record an audit event', () => {
    expect(mig).toContain('if (!opts.dryRun)');
    expect(mig).toContain('recordAuditEvent(');
  });

  it('document.migrateTargeting procedure is exposed with the dryRun flag (preview-then-apply)', () => {
    const docs = read('src/server/procedures/documents.ts');
    expect(docs).toContain('migrateTargeting: protectedProcedure');
    expect(docs).toContain('migrateDocumentTargetingForOwner(ctx.userId, { dryRun: input.dryRun })');
  });
});
