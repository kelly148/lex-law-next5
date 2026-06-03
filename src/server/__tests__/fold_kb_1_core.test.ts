/**
 * FOLD-KB-1 Increment 1 — Practice Knowledge Base data core.
 *
 * Covers the PURE, load-bearing pieces (no DB):
 *   A. evaluateMemoAccess — the abstraction-required cross-matter gate (Fork B/F),
 *      exhaustively (every reason); surfacing and invocation share this gate.
 *   B. formatCurrencyWarning — a SPECIFIC staleness line from metadata, never age-derived (Fork C).
 *   C. Zod Wall — PracticeMemoRowSchema / PaInstructionProfileRowSchema parse valid rows.
 *   D. Constants — KB_DERIVED_DISCLOSURE + KB_AUDIT_ACTIONS contract.
 */

import { describe, it, expect } from 'vitest';
import { evaluateMemoAccess, formatCurrencyWarning } from '../practiceKb/gate.js';
import {
  PracticeMemoRowSchema,
  PaInstructionProfileRowSchema,
  KB_DERIVED_DISCLOSURE,
  KB_AUDIT_ACTIONS,
} from '../../shared/schemas/practiceKb.js';

const ORIGIN = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000b2';

// ============================================================
// A. evaluateMemoAccess (Fork B/F) — abstraction-required gate
// ============================================================
describe('FOLD-KB-1 — evaluateMemoAccess', () => {
  it('firm-level (originMatterId null) is allowed even into another matter', () => {
    const d = evaluateMemoAccess({ memo: { originMatterId: null, reuseScope: 'matter_only', abstractionStatus: 'raw' }, targetMatterId: OTHER });
    expect(d).toEqual({ allowed: true, crossMatter: false, reason: 'firm_level' });
  });

  it('same matter as origin is allowed (not cross-matter)', () => {
    const d = evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'matter_only', abstractionStatus: 'raw' }, targetMatterId: ORIGIN });
    expect(d).toEqual({ allowed: true, crossMatter: false, reason: 'origin_matter' });
  });

  it('matter_only memo is BLOCKED into a different matter', () => {
    const d = evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'matter_only', abstractionStatus: 'raw' }, targetMatterId: OTHER });
    expect(d).toEqual({ allowed: false, crossMatter: true, reason: 'blocked_matter_only' });
  });

  it('firm_wide but RAW is BLOCKED cross-matter (abstraction required, not opt-in)', () => {
    const d = evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'firm_wide', abstractionStatus: 'raw' }, targetMatterId: OTHER });
    expect(d).toEqual({ allowed: false, crossMatter: true, reason: 'blocked_not_abstracted' });
  });

  it('firm_wide AND abstracted is allowed cross-matter', () => {
    const d = evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'firm_wide', abstractionStatus: 'abstracted' }, targetMatterId: OTHER });
    expect(d).toEqual({ allowed: true, crossMatter: true, reason: 'firm_wide_abstracted' });
  });

  it('surfacing gate (targetMatterId null = firm-wide browse) is identical to invocation', () => {
    // matter_only never surfaces outside its origin.
    expect(evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'matter_only', abstractionStatus: 'raw' }, targetMatterId: null }))
      .toEqual({ allowed: false, crossMatter: true, reason: 'blocked_matter_only' });
    // abstracted firm_wide surfaces.
    expect(evaluateMemoAccess({ memo: { originMatterId: ORIGIN, reuseScope: 'firm_wide', abstractionStatus: 'abstracted' }, targetMatterId: null }))
      .toEqual({ allowed: true, crossMatter: true, reason: 'firm_wide_abstracted' });
    // firm-level always.
    expect(evaluateMemoAccess({ memo: { originMatterId: null, reuseScope: 'matter_only', abstractionStatus: 'raw' }, targetMatterId: null }))
      .toEqual({ allowed: true, crossMatter: false, reason: 'firm_level' });
  });
});

// ============================================================
// B. formatCurrencyWarning (Fork C) — specific, never age-derived
// ============================================================
describe('FOLD-KB-1 — formatCurrencyWarning', () => {
  it('names the authorities and the discrete status; never claims fresh/stale from age', () => {
    const w = formatCurrencyWarning({
      verificationStatus: 'unverified',
      verifiedThroughDate: null,
      jurisdiction: 'VA',
      lawReliedOn: [{ jurisdiction: 'VA', citationOrSource: 'Code § 55.1-345', sourceType: 'statute', effectiveDate: '2024-03' }],
    });
    expect(w).toContain('VA Code § 55.1-345');
    expect(w).toContain('as of 2024-03');
    expect(w).toContain('NOT re-verified');
    expect(w).toContain('Re-verify against current law');
    expect(w.toLowerCase()).not.toContain('fresh'); // no age-derived freshness claim
  });

  it('flags a conclusion memo with no recorded authority as uncheckable', () => {
    const w = formatCurrencyWarning({ verificationStatus: 'unverified', verifiedThroughDate: null, jurisdiction: null, lawReliedOn: null });
    expect(w).toContain('uncheckable');
  });

  it('marks secondary authority as never operative law', () => {
    const w = formatCurrencyWarning({ verificationStatus: 'not_legal_authority', verifiedThroughDate: null, jurisdiction: 'VA', lawReliedOn: [] });
    expect(w).toContain('never operative law');
  });

  it('renders verifiedThroughDate when present', () => {
    const w = formatCurrencyWarning({
      verificationStatus: 'attorney_verified_current',
      verifiedThroughDate: new Date('2026-01-15T00:00:00Z'),
      jurisdiction: 'MD',
      lawReliedOn: [{ jurisdiction: 'MD', citationOrSource: 'Code § 1-101', sourceType: 'statute' }],
    });
    expect(w).toContain('attorney-verified current');
    expect(w).toContain('verified through 2026-01-15');
  });
});

// ============================================================
// C. Zod Wall — row schemas parse valid rows
// ============================================================
describe('FOLD-KB-1 — Zod row schemas', () => {
  it('PracticeMemoRowSchema parses a most-private captured memo', () => {
    const row = {
      id: '00000000-0000-0000-0000-0000000000c3',
      userId: '00000000-0000-0000-0000-0000000000d4',
      originMatterId: ORIGIN,
      sourceAnalysisId: null,
      sourceDocumentId: null,
      title: '1031 related-party transfer',
      body: 'Analysis…',
      practiceArea: 'real_estate',
      jurisdiction: 'VA',
      lawReliedOn: [{ jurisdiction: 'VA', citationOrSource: 'IRC § 1031(f)', sourceType: 'statute', effectiveDate: null, ref: null }],
      topicTags: ['1031', 'related-party'],
      writtenOn: new Date('2025-09-01T00:00:00Z'),
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
    const parsed = PracticeMemoRowSchema.parse(row);
    expect(parsed.privilegeTag).toBe('client_confidential');
    expect(parsed.abstractionStatus).toBe('raw');
    expect(parsed.reuseScope).toBe('matter_only');
    expect(parsed.lawReliedOn?.[0]?.citationOrSource).toBe('IRC § 1031(f)');
  });

  it('PaInstructionProfileRowSchema parses a profile row', () => {
    const row = {
      id: '00000000-0000-0000-0000-0000000000e5',
      userId: '00000000-0000-0000-0000-0000000000d4',
      paKey: 'real_estate',
      title: 'RE master prompt',
      body: 'You are…',
      version: '1.0',
      active: true,
      supersededById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(PaInstructionProfileRowSchema.parse(row).paKey).toBe('real_estate');
  });
});

// ============================================================
// D. Constants — the disclosure + the audited-act contract
// ============================================================
describe('FOLD-KB-1 — constants', () => {
  it('KB_DERIVED_DISCLOSURE states not-current + re-verify-before-outbound', () => {
    expect(KB_DERIVED_DISCLOSURE).toMatch(/not verified as current/i);
    expect(KB_DERIVED_DISCLOSURE).toMatch(/re-verify/i);
  });

  it('KB_AUDIT_ACTIONS includes the high-risk acts', () => {
    for (const a of ['memo_abstracted', 'memo_promoted_to_reuse', 'memo_adopted_into_matter', 'pa_profile_loaded_for_job']) {
      expect(KB_AUDIT_ACTIONS).toContain(a);
    }
  });
});
