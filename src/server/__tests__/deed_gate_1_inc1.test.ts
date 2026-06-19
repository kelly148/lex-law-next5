/**
 * FOLD-DEED-1 Inc 1 foundation — the three-gate deed recordability gate (DORMANT, fail-closed).
 *
 * Covers the load-bearing ethics/land-records core: the PURE three-gate evaluator (fail-closed +
 * KB-mandatory — no KB → never recordable; the two-prong description control; the hard blocks), the schema
 * defaults, the procedure (flag-gated dark, deed-type-checked, the description-lock-integrity guard, the
 * Matter-Record audit), and the migration's additive guards. DB-free: the query layers are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import {
  evaluateDeedGate,
  DeedGateStateSchema,
  DEFAULT_DEED_GATE_STATE,
  type DeedGateState,
  type DeedKbAvailability,
} from '../../shared/schemas/deedGate.js';

const FULL_KB: DeedKbAvailability = { templateCoverage: true, vestingListValidated: true, localityVerified: true };
const NO_KB: DeedKbAvailability = { templateCoverage: false, vestingListValidated: false, localityVerified: false };
const GOOD_PARTIES = { grantorCount: 1, granteeCount: 1 };

function fullState(over: Partial<DeedGateState> = {}): DeedGateState {
  return {
    schemaVersion: 1,
    sourceOfRecordInstrument: 'Deed Book 1234, Page 56',
    descriptionSourceMatch: true,
    descriptionParcelScope: 'whole',
    descriptionExceptionText: null,
    descriptionProvenance: 'Deed Book 1234, Page 56; Plat Book 7, Page 12',
    descriptionNotOcrOnly: true,
    descriptionHasPlatOrSubdivisionRef: true,
    descriptionConfirmedAt: '2026-06-19T12:00:00Z',
    vestingSelection: 'tenants by the entirety with right of survivorship',
    maritalStatusConfirmed: true,
    spousalJoinder: 'present',
    grantorReconciledToSource: true,
    fiduciaryAuthority: 'not_applicable',
    specialInstrumentTriggersReviewed: true,
    preparerReturnGranteeAddress: true,
    executionMode: 'wet_sign',
    ...over,
  };
}

// ── the pure three-gate evaluator ───────────────────────────────────────────
describe('FOLD-DEED-1 Inc 1 — evaluateDeedGate (pure, fail-closed)', () => {
  it('the default (nothing affirmed) state with no KB blocks ALL three layers; not recordable', () => {
    const r = evaluateDeedGate({ state: DEFAULT_DEED_GATE_STATE, kb: NO_KB, parties: { grantorCount: 0, granteeCount: 0 } });
    expect(r.recordable).toBe(false);
    expect(r.assembly.passed).toBe(false);
    expect(r.legalReview.passed).toBe(false);
    expect(r.recordability.passed).toBe(false);
    expect(r.assembly.blockingReasons).toEqual(
      expect.arrayContaining(['no_grantor_bound', 'no_grantee_bound', 'source_of_record_not_cited', 'deed_type_jurisdiction_locality_template_uncovered']),
    );
  });

  it('KB-MANDATORY: a FULLY-affirmed deed with NO KB is still NOT recordable (no model-memory fill)', () => {
    const r = evaluateDeedGate({ state: fullState(), kb: NO_KB, parties: GOOD_PARTIES });
    expect(r.recordable).toBe(false);
    expect(r.assembly.blockingReasons).toContain('deed_type_jurisdiction_locality_template_uncovered');
    expect(r.legalReview.blockingReasons).toContain('vesting_not_kb_validated');
    expect(r.recordability.blockingReasons).toContain('locality_kb_unverified');
  });

  it('a fully-affirmed deed WITH full KB + bound parties is recordable (all three layers pass)', () => {
    const r = evaluateDeedGate({ state: fullState(), kb: FULL_KB, parties: GOOD_PARTIES });
    expect(r.recordable).toBe(true);
    expect(r.assembly.passed && r.legalReview.passed && r.recordability.passed).toBe(true);
  });

  it('two-prong description: OCR-only AND unaffirmed-OCR-review both BLOCK (fail-closed) even with full KB', () => {
    // explicitly OCR-only
    expect(evaluateDeedGate({ state: fullState({ descriptionNotOcrOnly: false }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('description_ocr_only_or_unreviewed');
    // NEVER affirmed (null) must ALSO block — the fail-OPEN the adversarial review caught
    expect(evaluateDeedGate({ state: fullState({ descriptionNotOcrOnly: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('description_ocr_only_or_unreviewed');
  });

  it('item-1 bare-tax-ID: a description without a recorded plat/subdivision reference is BLOCKED', () => {
    expect(evaluateDeedGate({ state: fullState({ descriptionHasPlatOrSubdivisionRef: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('description_bare_tax_id_no_plat_ref');
  });

  it('parcel scope partial/with-reservation requires captured exception text', () => {
    expect(evaluateDeedGate({ state: fullState({ descriptionParcelScope: 'partial', descriptionExceptionText: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('parcel_exception_text_missing');
    // with the exception captured, a with-reservation conveyance clears
    expect(evaluateDeedGate({ state: fullState({ descriptionParcelScope: 'with_reservation', descriptionExceptionText: 'Reserving a 20-ft easement along the north line' }), kb: FULL_KB, parties: GOOD_PARTIES }).recordable).toBe(true);
  });

  it('item-3 special-instrument triggers must be reviewed (the wrong-tool seam)', () => {
    expect(evaluateDeedGate({ state: fullState({ specialInstrumentTriggersReviewed: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('special_instrument_triggers_unreviewed');
  });

  it('recordability: e-notary / RON cannot clear in the foundation (no mode-specific acknowledgment form seeded)', () => {
    expect(evaluateDeedGate({ state: fullState({ executionMode: 'ron' }), kb: FULL_KB, parties: GOOD_PARTIES }).recordability.blockingReasons).toContain('execution_mode_acknowledgment_form_unavailable');
    expect(evaluateDeedGate({ state: fullState({ executionMode: 'e_notary' }), kb: FULL_KB, parties: GOOD_PARTIES }).recordability.blockingReasons).toContain('execution_mode_acknowledgment_form_unavailable');
    expect(evaluateDeedGate({ state: fullState({ executionMode: 'wet_sign' }), kb: FULL_KB, parties: GOOD_PARTIES }).recordability.passed).toBe(true);
  });

  it('two-prong description: an unlocked or scope-unset description blocks legal-review', () => {
    expect(evaluateDeedGate({ state: fullState({ descriptionConfirmedAt: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('description_not_locked');
    expect(evaluateDeedGate({ state: fullState({ descriptionParcelScope: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('description_parcel_scope_unset');
  });

  it('hard blocks: marital / grantor-reconciliation / fiduciary each block legal-review', () => {
    expect(evaluateDeedGate({ state: fullState({ maritalStatusConfirmed: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('marital_status_unconfirmed');
    expect(evaluateDeedGate({ state: fullState({ grantorReconciledToSource: false }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('grantor_not_reconciled_to_source');
    expect(evaluateDeedGate({ state: fullState({ fiduciaryAuthority: null }), kb: FULL_KB, parties: GOOD_PARTIES }).legalReview.blockingReasons).toContain('fiduciary_authority_undetermined');
  });

  it('assembly requires >=1 grantor and >=1 grantee bound', () => {
    expect(evaluateDeedGate({ state: fullState(), kb: FULL_KB, parties: { grantorCount: 1, granteeCount: 0 } }).assembly.blockingReasons).toContain('no_grantee_bound');
  });
});

// ── schema ──────────────────────────────────────────────────────────────────
describe('FOLD-DEED-1 Inc 1 — DeedGateStateSchema (default-safe)', () => {
  it('the default state is all "nothing affirmed"; an empty object parses to it', () => {
    expect(DEFAULT_DEED_GATE_STATE.descriptionSourceMatch).toBeNull();
    expect(DEFAULT_DEED_GATE_STATE.descriptionNotOcrOnly).toBeNull(); // fail-closed: unaffirmed OCR review BLOCKS
    expect(DEFAULT_DEED_GATE_STATE.specialInstrumentTriggersReviewed).toBeNull();
    expect(DeedGateStateSchema.parse({})).toEqual(DEFAULT_DEED_GATE_STATE);
  });
  it('rejects bad enums', () => {
    expect(DeedGateStateSchema.safeParse({ descriptionParcelScope: 'bogus' }).success).toBe(false);
    expect(DeedGateStateSchema.safeParse({ executionMode: 'carrier_pigeon' }).success).toBe(false);
  });
});

// ── the procedure ───────────────────────────────────────────────────────────
vi.mock('../db/queries/deedGate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/deedGate.js')>();
  return { ...actual, getDeedGateState: vi.fn(), upsertDeedGateState: vi.fn(), countDeedPartyBindings: vi.fn() };
});
vi.mock('../db/queries/documents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/documents.js')>();
  return { ...actual, getDocumentById: vi.fn() };
});
vi.mock('../db/queries/matters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/matters.js')>();
  return { ...actual, getMatterById: vi.fn() };
});
vi.mock('../db/queries/auditEvents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/auditEvents.js')>();
  return { ...actual, insertAuditEvent: vi.fn().mockResolvedValue('evt-1') };
});

import { appRouter } from '../router.js';
import * as deedGateQ from '../db/queries/deedGate.js';
import * as documentsQ from '../db/queries/documents.js';
import * as mattersQ from '../db/queries/matters.js';
import * as auditQ from '../db/queries/auditEvents.js';

const U = '11111111-1111-1111-1111-111111111111';
const DOC = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MATTER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FLAG = 'DEED_GATE_ENABLED';
function caller(userId: string | undefined) {
  return appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });
}
function setDoc(documentType: string) {
  vi.mocked(documentsQ.getDocumentById).mockResolvedValue({ id: DOC, userId: U, matterId: MATTER, documentType } as Awaited<ReturnType<typeof documentsQ.getDocumentById>>);
}

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  vi.clearAllMocks();
  setDoc('deed');
  vi.mocked(mattersQ.getMatterById).mockResolvedValue({ id: MATTER, userId: U, jurisdiction: 'VA' } as Awaited<ReturnType<typeof mattersQ.getMatterById>>);
  vi.mocked(deedGateQ.getDeedGateState).mockResolvedValue({ state: DEFAULT_DEED_GATE_STATE, exists: false });
  vi.mocked(deedGateQ.upsertDeedGateState).mockImplementation(async (a) => ({ state: a.state, exists: true }));
  vi.mocked(deedGateQ.countDeedPartyBindings).mockResolvedValue({ grantorCount: 1, granteeCount: 1 });
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

describe('FOLD-DEED-1 Inc 1 — deedGate router', () => {
  it('isEnabled is ungated; every other op refuses when the gate is OFF', async () => {
    delete process.env[FLAG];
    const u = caller(U);
    expect(await u.deedGate.isEnabled()).toEqual({ enabled: false });
    await expect(u.deedGate.get({ documentId: DOC })).rejects.toThrow(/DEED_GATE_DISABLED/);
    await expect(u.deedGate.recordState({ documentId: DOC, state: DEFAULT_DEED_GATE_STATE })).rejects.toThrow(/DEED_GATE_DISABLED/);
  });

  it('refuses a non-deed document', async () => {
    process.env[FLAG] = 'true';
    setDoc('durable_poa');
    await expect(caller(U).deedGate.get({ documentId: DOC })).rejects.toThrow(/DEED_GATE_NOT_A_DEED/);
  });

  it('get returns the fail-closed evaluation (no KB → not recordable) for a deed', async () => {
    process.env[FLAG] = 'true';
    const res = await caller(U).deedGate.get({ documentId: DOC });
    expect(documentsQ.getDocumentById).toHaveBeenCalledWith(DOC, U); // owner-scoped
    expect(res.evaluation.recordable).toBe(false);
    expect(res.kbSeeded).toBe(false);
  });

  it('recordState REFUSES locking the description without both prongs', async () => {
    process.env[FLAG] = 'true';
    const bad = { ...DEFAULT_DEED_GATE_STATE, descriptionConfirmedAt: '2026-06-19T00:00:00Z' }; // locked but prongs unset
    await expect(caller(U).deedGate.recordState({ documentId: DOC, state: bad })).rejects.toThrow(/DEED_DESCRIPTION_LOCK_REQUIRES_BOTH_PRONGS/);
    expect(deedGateQ.upsertDeedGateState).not.toHaveBeenCalled();
  });

  it('recordState persists a valid state + writes a Matter-Record audit event (owner-scoped)', async () => {
    process.env[FLAG] = 'true';
    await caller(U).deedGate.recordState({ documentId: DOC, state: fullState() });
    expect(deedGateQ.upsertDeedGateState).toHaveBeenCalledWith(expect.objectContaining({ userId: U, matterId: MATTER, documentId: DOC }));
    expect(auditQ.insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditQ.insertAuditEvent).mock.calls[0]![0]).toMatchObject({ matterId: MATTER, documentId: DOC, action: 'record_deed_gate', targetType: 'deed_gate' });
  });
});

// ── KB-source defense-in-depth (the all-false guarantee must not rest on a single caller) ──
describe('FOLD-DEED-1 Inc 1 — KB availability is sourced ONLY from the fail-closed resolver', () => {
  it('the procedure routes KB availability through resolveDeedKbAvailability and never hand-builds a verified kb', () => {
    const src = readFileSync(fileURLToPath(new URL('../procedures/deedGate.ts', import.meta.url)), 'utf8');
    expect(src).toContain('resolveDeedKbAvailability(');
    // a hand-constructed "verified" kb would bypass the fail-closed seam — it must never appear in the procedure
    expect(/templateCoverage\s*:\s*true/.test(src)).toBe(false);
    expect(/vestingListValidated\s*:\s*true/.test(src)).toBe(false);
    expect(/localityVerified\s*:\s*true/.test(src)).toBe(false);
  });
  it('the foundation KB resolver is hard fail-closed (returns all-false, never true)', () => {
    const src = readFileSync(fileURLToPath(new URL('../deed/deedKb.ts', import.meta.url)), 'utf8');
    expect(/templateCoverage:\s*false/.test(src)).toBe(true);
    expect(/localityVerified:\s*false/.test(src)).toBe(true);
    expect(/:\s*true/.test(src)).toBe(false); // no field is ever seeded true in the foundation resolver
  });
});

// ── migration ─────────────────────────────────────────────────────────────────
describe('FOLD-DEED-1 Inc 1 — migration 0049 additive guards', () => {
  const SQL = readFileSync(fileURLToPath(new URL('../db/migrations/0049_deed_1_deed_gate.sql', import.meta.url)), 'utf8');
  const DDL = SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  it('creates deed_gate idempotently, additive-only, INLINE indexes (no ALTER ... ADD INDEX)', () => {
    expect(/CREATE TABLE IF NOT EXISTS `deed_gate`/.test(SQL)).toBe(true);
    expect(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i.test(DDL)).toBe(false);
    expect(/\bTRUNCATE\b|\bDELETE\s+FROM\b|\bRENAME\b/i.test(DDL)).toBe(false);
    expect(/ALTER\s+TABLE[\s\S]*ADD\s+(UNIQUE\s+)?INDEX/i.test(DDL)).toBe(false);
    expect(/UNIQUE INDEX `ux_deed_gate_document`/.test(SQL)).toBe(true);
    expect(/INDEX `idx_deed_gate_matter`/.test(SQL)).toBe(true);
  });
});
