/**
 * FOLD-SEND-1 Increment 2 — pure export-safety engine.
 *
 * The engine (evaluateSendability), level resolution, the content satisfaction heuristic, and
 * jurisdiction detection are all PURE — exercised directly. The context assembler + read-only API
 * run live (no test DB) and follow the established owner-scoped reader pattern. v1 rule levels:
 * wrong_matter_id=block; everything else=warn (per the triad disposition).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateSendability,
  levelForCategory,
  requirementSatisfiedInContent,
  detectJurisdiction,
  type SendabilityContext,
  type RuleLevelLookup,
} from '../send/sendabilityEngine.js';

const V1_RULES: RuleLevelLookup[] = [
  { category: 'wrong_matter_id', documentType: null, level: 'block' },
  { category: 'stale_baseline', documentType: null, level: 'warn' },
  { category: 'missing_required_signer', documentType: null, level: 'warn' },
  { category: 'open_execution_item', documentType: null, level: 'warn' },
  { category: 'package_completeness', documentType: null, level: 'warn' },
];

const CLEAN: SendabilityContext = {
  documentId: 'd', versionId: 'v', matterId: 'm', documentType: 'Durable_poa', inScope: true,
  matterResolved: true, matterArchived: false, documentMatterLinkOk: true,
  hasAdoptions: false, currentIsLastAdopted: true, drewOnUnverifiedKb: false,
  jurisdictionRequirements: [], openExecutionItemCount: 0, packageComplete: null, degraded: [],
};

describe('FOLD-SEND-1 Inc2 — evaluateSendability (deterministic)', () => {
  it('a clean context passes (no blocks, no warnings)', () => {
    const r = evaluateSendability(CLEAN, V1_RULES);
    expect(r.verdict).toBe('pass');
    expect(r.blocks).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.degraded).toBe('none');
  });

  it('wrong_matter_id is the only v1 BLOCK (unresolved/archived/broken-link)', () => {
    expect(evaluateSendability({ ...CLEAN, matterResolved: false }, V1_RULES).verdict).toBe('block');
    expect(evaluateSendability({ ...CLEAN, matterArchived: true }, V1_RULES).verdict).toBe('block');
    const r = evaluateSendability({ ...CLEAN, documentMatterLinkOk: false }, V1_RULES);
    expect(r.verdict).toBe('block');
    expect(r.blocks[0]!.category).toBe('wrong_matter_id');
  });

  it('stale_baseline WARNS only when there are adoptions and the current version is not the adopted baseline', () => {
    expect(evaluateSendability({ ...CLEAN, hasAdoptions: false, currentIsLastAdopted: false }, V1_RULES).verdict).toBe('pass');
    const r = evaluateSendability({ ...CLEAN, hasAdoptions: true, currentIsLastAdopted: false }, V1_RULES);
    expect(r.verdict).toBe('warn');
    expect(r.warnings[0]!.category).toBe('stale_baseline');
  });

  it('missing_required_signer WARNS per unsatisfied jurisdiction requirement (carries sourceTag)', () => {
    const r = evaluateSendability({ ...CLEAN, jurisdictionRequirements: [
      { requirement: 'notary', sourceTag: 'Va. Code § 64.2-1603', satisfied: false },
      { requirement: 'two_witnesses', sourceTag: 'x', satisfied: true },
    ] }, V1_RULES);
    expect(r.verdict).toBe('warn');
    expect(r.warnings.filter((w) => w.category === 'missing_required_signer')).toHaveLength(1);
    expect(r.warnings[0]!.sourceTag).toBe('Va. Code § 64.2-1603');
  });

  it('open_execution_item and package_completeness WARN', () => {
    expect(evaluateSendability({ ...CLEAN, openExecutionItemCount: 2 }, V1_RULES).verdict).toBe('warn');
    expect(evaluateSendability({ ...CLEAN, packageComplete: false }, V1_RULES).verdict).toBe('warn');
    expect(evaluateSendability({ ...CLEAN, packageComplete: true }, V1_RULES).verdict).toBe('pass');
  });

  it('FAIL-TO-WARN: a degraded check becomes a warning (never a block) + degraded=partial', () => {
    const r = evaluateSendability({ ...CLEAN, degraded: ['stale_baseline'] }, V1_RULES);
    expect(r.verdict).toBe('warn');
    expect(r.degraded).toBe('partial');
    expect(r.warnings.some((w) => w.category === 'stale_baseline')).toBe(true);
    expect(r.blocks).toEqual([]);
  });

  it("an 'off' rule level suppresses a category entirely", () => {
    const rules: RuleLevelLookup[] = [{ category: 'wrong_matter_id', documentType: null, level: 'off' }];
    expect(evaluateSendability({ ...CLEAN, matterResolved: false }, rules).verdict).toBe('pass');
  });

  it('block takes precedence over warnings in the overall verdict', () => {
    const r = evaluateSendability({ ...CLEAN, matterResolved: false, openExecutionItemCount: 1 }, V1_RULES);
    expect(r.verdict).toBe('block');
    expect(r.blocks).toHaveLength(1);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FOLD-SEND-1 Inc2 — levelForCategory', () => {
  it('prefers a document-type-specific rule, then the all-types rule, then defaults to warn', () => {
    const rules: RuleLevelLookup[] = [
      { category: 'stale_baseline', documentType: null, level: 'warn' },
      { category: 'stale_baseline', documentType: 'Durable_poa', level: 'block' },
    ];
    expect(levelForCategory('stale_baseline', 'Durable_poa', rules)).toBe('block');
    expect(levelForCategory('stale_baseline', 'other', rules)).toBe('warn');
    expect(levelForCategory('tone', 'Durable_poa', rules)).toBe('warn'); // no rule -> default warn
  });
});

describe('FOLD-SEND-1 Inc2 — requirementSatisfiedInContent + detectJurisdiction', () => {
  it('detects formality markers conservatively', () => {
    expect(requirementSatisfiedInContent('notary', 'Notary Public, Commonwealth of Virginia')).toBe(true);
    expect(requirementSatisfiedInContent('notary', 'no marker here')).toBe(false);
    expect(requirementSatisfiedInContent('two_witnesses', 'Witness 1 ___ Witness 2 ___')).toBe(true);
    expect(requirementSatisfiedInContent('two_witnesses', 'Witness ___')).toBe(false);
    expect(requirementSatisfiedInContent('self_proving_affidavit', 'Self-Proving Affidavit')).toBe(true);
  });

  it('detects VA/MD from governing-law language, null when ambiguous', () => {
    expect(detectJurisdiction('governed by the Commonwealth of Virginia')).toBe('VA');
    expect(detectJurisdiction('the laws of Maryland')).toBe('MD');
    expect(detectJurisdiction('Virginia and Maryland both appear')).toBeNull();
    expect(detectJurisdiction('no jurisdiction stated')).toBeNull();
  });
});
