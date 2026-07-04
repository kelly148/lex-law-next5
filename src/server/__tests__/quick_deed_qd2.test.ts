/**
 * DEED-DRAFT-AGENT-1 QUICK DEED (QD-2) — the firm-level conflicts-enforcement toggle.
 *
 * QD-1 hard-coded quickDeed.generate's conflicts posture to bypass (default-OFF) and stamped "No conflicts
 * check performed (Quick Deed mode)." into the document notes. QD-2 wires that ONE boolean to a FIRM-LEVEL
 * admin toggle persisted SCHEMA-FREE on the existing firm_conflict_policy JSON blob (the defaulted Zod field
 * deedConflictsEnforced):
 *
 *   - quickDeed.generate reads the firm policy via the QUERY LAYER directly (getFirmConflictPolicy) — NOT the
 *     gated conflictPolicy router — so it works even when isConflictGateEnabled() is OFF. Toggle OFF (default)
 *     => conflicts BYPASSED + stamp (QD-1 behavior). Toggle ON => bypass withdrawn, the real conflicts gate
 *     runs => the unconflicted auto-matter is blocked CONFLICTS_NOT_CLEARED + NO stamp (fail-closed MVP).
 *   - quickDeed.getConflictsSetting / setConflictsEnforced — the deed-specific UNGATED read/write path: flag-
 *     gated (fail-closed on DEED_DRAFT_AGENT_ENABLED) but works regardless of isConflictGateEnabled(), and
 *     firm-scoped (firmOwnerUserId = ctx.userId). It does NOT relax the conflictPolicy router's own gating.
 *
 * Same DB/gate-leaf mocking style as quick_deed_qd1.test.ts; the conflictPolicy query layer is mocked so we
 * drive the firm toggle deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// ── mock the DB/gate leaves (the pure assembler modules are NOT mocked) ──
vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn(), insertMatter: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({
  insertDocument: vi.fn(),
  updateDocumentCurrentVersion: vi.fn(),
  updateDocumentNotes: vi.fn(),
  getDocumentById: vi.fn(),
}));
vi.mock('../db/queries/versions.js', () => ({
  getNextVersionNumber: vi.fn(),
  insertVersion: vi.fn(),
  getLatestVersionForDocument: vi.fn(),
}));
vi.mock('../conflicts/postureGate.js', () => ({ resolvePostureDraftingGate: vi.fn() }));
vi.mock('../db/queries/conflicts.js', () => ({ hasUndispositionedBlocker: vi.fn() }));
vi.mock('../db/queries/conflictPolicy.js', () => ({
  getFirmConflictPolicy: vi.fn(),
  setFirmConflictPolicy: vi.fn(),
}));

import { quickDeedRouter, QUICK_DEED_NO_CONFLICTS_NOTE } from '../procedures/deedDraftAgent.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';
import { getFirmConflictPolicy, setFirmConflictPolicy } from '../db/queries/conflictPolicy.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const quick = () => quickDeedRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

const VESTING_DEED = [
  'THIS DEED, made this 2nd day of May, 2019, by and between Harold V. GREER, an unmarried man, (the "Grantor"), and Marcus T. ELLISON and',
  'Priya ELLISON, husband and wife, (the "Grantees"),',
  'WITNESSETH that the Grantor does hereby grant, bargain, sell and convey, with General Warranty, unto the said Grantees, in fee simple, as tenants by the entirety with the right of survivorship, all that parcel located in',
  'Prince William County, Commonwealth of Virginia, to wit:',
  '   Lot 12, Section 3, CEDAR RUN ESTATES, recorded in Deed Book 6011 at Page 244, among the Land Records of Prince William County, Virginia.',
  '   BEING the same property conveyed unto Harold V. Greer by Deed in Deed Book 3000 at Page 100.',
  'This conveyance is made subject to covenants of record.',
  'Tax I.D. Number: 7298-44-1201',
].join('\n');
const TAX_RECORD = 'REAL ESTATE ASSESSMENT\nParcel No: 7298-44-1201\nTotal Assessed Value: $588,400.00';
const MATERIAL_ROWS = [
  { id: 'mat-vesting', textContent: VESTING_DEED },
  { id: 'mat-tax', textContent: TAX_RECORD },
];

function fullGenerate(over: Record<string, unknown> = {}) {
  return {
    matterId: M1,
    deedType: 'deed_of_gift',
    grantors: [{ name: 'Marcus T. Ellison' }, { name: 'Priya Ellison', descriptor: 'husband and wife' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantors' daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    derivationReference: 'in Deed Book 5500 at Page 12',
    ...over,
  };
}

/** A firm policy with the deed toggle set (QD-2). Other fields are the safe defaults. */
function firmPolicy(deedConflictsEnforced: boolean) {
  return {
    policy: { schemaVersion: 1 as const, transactionalPosture: 'ENFORCED' as const, deedConflictsEnforced },
    source: deedConflictsEnforced ? ('persisted' as const) : ('default' as const),
  };
}

function mockGenerateHappyDeps() {
  (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue(MATERIAL_ROWS.map((m) => ({ ...m })));
  (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q', documentType: 'deed' });
  (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-q', versionNumber: 1 });
  (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-q' });
}

const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];
const origConflict = process.env['CONFLICT_GATE_ENABLED'];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['DEED_DRAFT_AGENT_ENABLED'];
  delete process.env['CONFLICT_GATE_ENABLED'];
  // Default: toggle OFF (QD-1 behavior) unless a test overrides.
  (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(false));
});
afterEach(() => {
  if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
  else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  if (origConflict === undefined) delete process.env['CONFLICT_GATE_ENABLED'];
  else process.env['CONFLICT_GATE_ENABLED'] = origConflict;
});

// ── the firm toggle drives quickDeed.generate's conflicts posture ──────────────────────────────────────────
describe('quickDeed.generate — the QD-2 firm toggle drives conflicts bypass vs enforce', () => {
  it('toggle OFF (default firm policy): conflicts BYPASSED + stamp written (QD-1 behavior preserved)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(false));
    mockGenerateHappyDeps();

    const res = await quick().generate(fullGenerate());

    // it read the firm policy via the QUERY LAYER (firm-scoped to ctx.userId):
    expect(getFirmConflictPolicy).toHaveBeenCalledWith(U1);
    // the conflicts gate was NOT consulted (bypassed), and the stamp is in the document notes:
    expect(resolvePostureDraftingGate).not.toHaveBeenCalled();
    expect(hasUndispositionedBlocker).not.toHaveBeenCalled();
    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(docArg.notes).toContain(QUICK_DEED_NO_CONFLICTS_NOTE);
    // LOCKSTEP: the return reports the actual outcome, and it matches the stamp.
    expect(res.conflictsBypassed).toBe(true);
    expect(res.conflictsChecked).toBe(false);
    expect(docArg.notes.includes(QUICK_DEED_NO_CONFLICTS_NOTE)).toBe(res.conflictsBypassed);
  });

  it('toggle ON, CONFLICT_GATE_ENABLED ON: conflicts ENFORCED — the unconflicted auto-matter is blocked, NO doc, NO stamp', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(true));
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    // the auto-matter has no confirmed client party -> the posture gate fails closed:
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });

    await expect(quick().generate(fullGenerate())).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    // the REAL gate ran (bypass withdrawn) and NO document was created:
    expect(resolvePostureDraftingGate).toHaveBeenCalled();
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('PROD-DEFAULT (toggle ON, CONFLICT_GATE_ENABLED UNSET): forces the AFFIRMATIVE gate — check-less auto-matter BLOCKED, NO legacy fall-through, NO doc, NO stamp', async () => {
    // The HONEST-ON root-cause guard: with the GLOBAL conflict gate OFF (the prod default), an "enforced" Quick
    // Deed must NOT fall through to the weak hasUndispositionedBlocker check (which a fresh check-less auto-matter
    // passes vacuously → would silently generate an unstamped deed). forceAffirmativeConflicts makes the real
    // posture gate run regardless of the global flag, so the auto-matter is honestly blocked.
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    delete process.env['CONFLICT_GATE_ENABLED']; // global gate OFF — the prod default
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(true));
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    // even if a legacy blocker would be absent (vacuous pass), the auto-matter has no confirmed client party:
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });

    await expect(quick().generate(fullGenerate())).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    // the AFFIRMATIVE posture gate ran (forced) — and the vacuous legacy-blocker path was NOT taken:
    expect(resolvePostureDraftingGate).toHaveBeenCalled();
    expect(hasUndispositionedBlocker).not.toHaveBeenCalled();
    // no silent unstamped deed:
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ── DEED-INTAKE-PARITY-1 Inc 2: enforceConflicts (the matter-scoped Express intake) honors the matter's gate ──
describe('quickDeed.generate — enforceConflicts routes through the matter conflicts gate (never bypass/stamp)', () => {
  it('enforceConflicts + a conflict-clear matter: generates, does NOT bypass/stamp, and does NOT consult the firm toggle', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    delete process.env['CONFLICT_GATE_ENABLED']; // prod default (global gate OFF)
    mockGenerateHappyDeps();
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false); // the matter is clear

    const res = await quick().generate(fullGenerate({ enforceConflicts: true }));

    // the matter-scoped path uses the SAME gate as document.create — NOT the standalone firm-toggle bypass path:
    expect(getFirmConflictPolicy).not.toHaveBeenCalled();
    expect(hasUndispositionedBlocker).toHaveBeenCalled();
    // never a bypass, never the "No conflicts check performed" stamp:
    expect(res.conflictsBypassed).toBe(false);
    const docArg = (insertDocument as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(docArg.notes).not.toContain(QUICK_DEED_NO_CONFLICTS_NOTE);
  });

  it('enforceConflicts + an undispositioned blocker: BLOCKED, NO document (fail-closed)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    delete process.env['CONFLICT_GATE_ENABLED'];
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await expect(quick().generate(fullGenerate({ enforceConflicts: true }))).rejects.toThrow(/CONFLICTS_BLOCKER_UNDISPOSITIONED/);
    expect(insertDocument).not.toHaveBeenCalled();
    expect(getFirmConflictPolicy).not.toHaveBeenCalled(); // never the standalone bypass-and-stamp path
  });

  it('enforceConflicts + CONFLICT_GATE_ENABLED on + not cleared: BLOCKED by the affirmative gate, NO document', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });

    await expect(quick().generate(fullGenerate({ enforceConflicts: true }))).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    expect(resolvePostureDraftingGate).toHaveBeenCalled();
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

// ── the deed-specific UNGATED read/write path (works when isConflictGateEnabled() is OFF) ───────────────────
describe('quickDeed.getConflictsSetting / setConflictsEnforced — flag-gated, conflict-gate-independent, firm-scoped', () => {
  it('getConflictsSetting refuses when the deed flag is OFF', async () => {
    await expect(quick().getConflictsSetting()).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(getFirmConflictPolicy).not.toHaveBeenCalled();
  });

  it('setConflictsEnforced refuses when the deed flag is OFF', async () => {
    await expect(quick().setConflictsEnforced({ enforced: true })).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(setFirmConflictPolicy).not.toHaveBeenCalled();
  });

  it('getConflictsSetting WORKS when CONFLICT_GATE_ENABLED is OFF (the key nuance) and is firm-scoped to ctx.userId', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    delete process.env['CONFLICT_GATE_ENABLED']; // the global conflict gate is OFF — this path must still work
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(true));

    const res = await quick().getConflictsSetting();
    expect(res).toEqual({ enforced: true });
    expect(getFirmConflictPolicy).toHaveBeenCalledWith(U1); // firm scope, not per-user input
  });

  it('getConflictsSetting returns false on a default (old/absent) firm policy', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(false));
    expect(await quick().getConflictsSetting()).toEqual({ enforced: false });
  });

  it('setConflictsEnforced WORKS when CONFLICT_GATE_ENABLED is OFF; preserves other fields, flips ONLY the deed toggle, firm-scoped', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    delete process.env['CONFLICT_GATE_ENABLED'];
    // current firm policy carries an ADVISORY transactional posture — must be PRESERVED on the deed-toggle write.
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue({
      policy: { schemaVersion: 1, transactionalPosture: 'ADVISORY', deedConflictsEnforced: false },
      source: 'persisted',
    });
    (setFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue({
      policy: { schemaVersion: 1, transactionalPosture: 'ADVISORY', deedConflictsEnforced: true },
      source: 'persisted',
    });

    const res = await quick().setConflictsEnforced({ enforced: true });
    expect(res).toEqual({ enforced: true });
    const arg = (setFirmConflictPolicy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.firmOwnerUserId).toBe(U1); // firm-scoped (safeguard a)
    expect(arg.changedByUserId).toBe(U1);
    // only the deed toggle flipped; transactionalPosture (and schemaVersion) preserved:
    expect(arg.policy).toEqual({ schemaVersion: 1, transactionalPosture: 'ADVISORY', deedConflictsEnforced: true });
  });

  it('setConflictsEnforced(false) round-trips OFF (restores the QD-1 default-OFF behavior)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(true));
    (setFirmConflictPolicy as ReturnType<typeof vi.fn>).mockResolvedValue(firmPolicy(false));
    const res = await quick().setConflictsEnforced({ enforced: false });
    expect(res).toEqual({ enforced: false });
    const arg = (setFirmConflictPolicy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg.policy.deedConflictsEnforced).toBe(false);
  });
});
