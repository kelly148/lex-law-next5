/**
 * FOLD-L1-1 — Layer-1 Matter-State Engine (data model + read contract).
 *
 * Pure-unit + behavioral (no DB): the new Zod walls (source_authority, open_items,
 * extended audit_events, the MatterState read contract), the pure assembler
 * (assembleMatterState) covering counts / safe-to-send / model_context curation, the
 * integrity invariant (assertMatterScoped), plus source-audits of the wiring (schema,
 * migration 0005, ownerScope discipline, router registration, owner-scoped read surface,
 * CI fold/** trigger). Matches the MR-CAL / FOLD no-DB test style (CI is authoritative).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SourceAuthorityRowSchema } from '../../shared/schemas/sourceAuthority.js';
import { OpenItemRowSchema } from '../../shared/schemas/openItems.js';
import { AuditEventRowSchema } from '../../shared/schemas/auditEvents.js';
import {
  MatterStateSchema,
  type MatterIdentity,
  type OperativeDocument,
} from '../../shared/schemas/matterState.js';
import {
  assembleMatterState,
  assertMatterScoped,
  deriveSafeToSend,
} from '../matterState/index.js';
import type { LockedDecisionRow, AdoptLedgerRow } from '../../shared/schemas/phase4b.js';
import type { OpenItemRow } from '../../shared/schemas/openItems.js';
import type { SourceAuthorityRow } from '../../shared/schemas/sourceAuthority.js';
import type { AuditEventRow } from '../../shared/schemas/auditEvents.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';
const VER = '44444444-4444-4444-4444-444444444444';
const SUBJ = '55555555-5555-5555-5555-555555555555';
const RS = '66666666-6666-6666-6666-666666666666';
const ID1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const now = new Date('2026-06-03T00:00:00Z');

// ---------------------------------------------------------------------------
// Zod walls for the new / extended tables
// ---------------------------------------------------------------------------

const SOURCE_AUTHORITY_ROW: SourceAuthorityRow = {
  id: ID1,
  userId: USER,
  matterId: MATTER,
  documentId: null,
  subjectType: 'material',
  subjectId: SUBJ,
  authorityOrigin: 'operative',
  lifecycle: 'operative',
  designationSource: 'attorney',
  label: 'Operative lease',
  notes: null,
  verificationStatus: 'verified',
  lastVerifiedAt: null,
  stalenessReason: null,
  effectiveFrom: null,
  supersededAt: null,
  supersededById: null,
  createdAt: now,
  updatedAt: now,
};

const OPEN_ITEM_ROW: OpenItemRow = {
  id: ID1,
  userId: USER,
  matterId: MATTER,
  documentId: null,
  category: 'governing_law',
  severity: 'blocker',
  summary: 'Governing-law mismatch must be resolved before send.',
  status: 'open',
  statusSource: 'auto',
  origin: 'sendability',
  confidence: 'high',
  requiresAttorneyConfirmation: false,
  sourceSuggestionId: null,
  reviewSessionId: null,
  versionId: null,
  lastSeenAt: now,
  resolvedByEventId: null,
  resolutionRationale: null,
  createdAt: now,
  updatedAt: now,
};

describe('FOLD-L1-1 — SourceAuthorityRow Zod wall', () => {
  it('accepts the canonical row', () => {
    expect(SourceAuthorityRowSchema.safeParse(SOURCE_AUTHORITY_ROW).success).toBe(true);
  });
  it('rejects an unknown authorityOrigin (tier vocabulary is closed)', () => {
    expect(
      SourceAuthorityRowSchema.safeParse({ ...SOURCE_AUTHORITY_ROW, authorityOrigin: 'pinned' }).success,
    ).toBe(false);
  });
  it('rejects an unknown lifecycle', () => {
    expect(
      SourceAuthorityRowSchema.safeParse({ ...SOURCE_AUTHORITY_ROW, lifecycle: 'recency' }).success,
    ).toBe(false);
  });
  it('allows a matter-level row (documentId null)', () => {
    expect(SourceAuthorityRowSchema.safeParse({ ...SOURCE_AUTHORITY_ROW, documentId: null }).success).toBe(true);
  });
});

describe('FOLD-L1-1 — OpenItemRow Zod wall', () => {
  it('accepts the canonical row', () => {
    expect(OpenItemRowSchema.safeParse(OPEN_ITEM_ROW).success).toBe(true);
  });
  it('accepts all three severities and statuses', () => {
    for (const severity of ['blocker', 'substantive', 'polish'] as const) {
      expect(OpenItemRowSchema.safeParse({ ...OPEN_ITEM_ROW, severity }).success).toBe(true);
    }
    for (const status of ['open', 'resolved', 'withdrawn'] as const) {
      expect(OpenItemRowSchema.safeParse({ ...OPEN_ITEM_ROW, status }).success).toBe(true);
    }
  });
  it('rejects an unknown severity', () => {
    expect(OpenItemRowSchema.safeParse({ ...OPEN_ITEM_ROW, severity: 'critical' }).success).toBe(false);
  });
});

describe('FOLD-L1-1 — extended AuditEventRow Zod wall (Fork C)', () => {
  const dispositionRow = {
    id: ID1,
    userId: USER,
    matterId: MATTER,
    documentId: null,
    eventType: 'disposition' as const,
    actor: 'attorney' as const,
    actorModel: null,
    summary: 'Open item resolved',
    payload: null,
    reviewSessionId: null,
    sourceSuggestionId: null,
    versionId: null,
    targetType: 'open_item',
    targetId: ID1,
    action: 'resolve',
    rationale: 'Client confirmed VA.',
    scope: 'matter',
    createdAt: now,
  };
  it('accepts the new disposition eventType with disposition-detail fields', () => {
    expect(AuditEventRowSchema.safeParse(dispositionRow).success).toBe(true);
  });
  it('still accepts a legacy row with the new fields null (additive/back-compatible)', () => {
    const legacy = {
      ...dispositionRow,
      eventType: 'model_output' as const,
      actor: 'model' as const,
      targetType: null,
      targetId: null,
      action: null,
      rationale: null,
      scope: null,
    };
    expect(AuditEventRowSchema.safeParse(legacy).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integrity invariant (operator disposition item 2)
// ---------------------------------------------------------------------------

describe('FOLD-L1-1 — integrity invariant (assertMatterScoped)', () => {
  it('passes when every row matches owner + matter', () => {
    expect(() =>
      assertMatterScoped([{ userId: USER, matterId: MATTER }], MATTER, USER, 'test'),
    ).not.toThrow();
  });
  it('throws on a cross-matter row (leakage guard)', () => {
    expect(() =>
      assertMatterScoped([{ userId: USER, matterId: 'other' }], MATTER, USER, 'test'),
    ).toThrow(/integrity invariant/);
  });
  it('throws on a cross-user row (leakage guard)', () => {
    expect(() =>
      assertMatterScoped([{ userId: 'other', matterId: MATTER }], MATTER, USER, 'test'),
    ).toThrow(/integrity invariant/);
  });
});

// ---------------------------------------------------------------------------
// safe-to-send derivation
// ---------------------------------------------------------------------------

describe('FOLD-L1-1 — deriveSafeToSend', () => {
  it('blocked when there is an open blocker', () => {
    expect(deriveSafeToSend(1, true).posture).toBe('blocked');
  });
  it('clear when the registry has items but no open blockers', () => {
    expect(deriveSafeToSend(0, true).posture).toBe('clear');
  });
  it('unknown when the registry is empty (no send-safety signal)', () => {
    expect(deriveSafeToSend(0, false).posture).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// assembleMatterState — counts, modes, curation
// ---------------------------------------------------------------------------

const MATTER_IDENTITY: MatterIdentity = {
  matterId: MATTER,
  title: 'Acme lease',
  clientName: null,
  practiceArea: null,
  phase: 'drafting',
  archivedAt: null,
};
const OPERATIVE_DOC: OperativeDocument = {
  documentId: DOC,
  title: 'Lease agreement',
  workflowState: 'drafting',
  currentVersionId: VER,
  currentVersionNumber: 2,
};

const lockedActive: LockedDecisionRow = {
  id: '77777777-7777-7777-7777-777777777777',
  userId: USER,
  documentId: DOC,
  matterId: MATTER,
  scope: 'document',
  origin: 'declined',
  sourceSuggestionId: null,
  sourceIterationNumber: null,
  reviewSessionId: null,
  summary: 'Governing law VA — do not re-raise.',
  rationale: null,
  status: 'active',
  createdAt: now,
  updatedAt: now,
};
const adoptionActive: AdoptLedgerRow = {
  id: '88888888-8888-8888-8888-888888888888',
  userId: USER,
  documentId: DOC,
  matterId: MATTER,
  sourceSuggestionId: 's1',
  sourceReviewerRole: 'gpt',
  sourceIterationNumber: 1,
  reviewSessionId: RS,
  disposition: 'adopted_verbatim',
  originalText: 'o',
  adoptedText: 'Carried clause text.',
  adoptedIntoVersionId: VER,
  producedVersionId: null,
  status: 'active',
  statusSource: 'attorney',
  createdAt: now,
  updatedAt: now,
};
const blockerMatterLevel: OpenItemRow = { ...OPEN_ITEM_ROW, documentId: null, severity: 'blocker' };
const substantiveDocLevel: OpenItemRow = {
  ...OPEN_ITEM_ROW,
  id: '99999999-9999-9999-9999-999999999999',
  documentId: DOC,
  severity: 'substantive',
};

function baseInput(overrides: Partial<Parameters<typeof assembleMatterState>[0]> = {}) {
  return {
    mode: 'summary' as const,
    matterId: MATTER,
    userId: USER,
    matter: MATTER_IDENTITY,
    operativeDocument: OPERATIVE_DOC,
    documentsForFull: [OPERATIVE_DOC],
    docsRaw: [{ userId: USER, matterId: MATTER }],
    lockedDecisions: [lockedActive],
    adoptions: [adoptionActive],
    openItems: [blockerMatterLevel, substantiveDocLevel],
    sourceAuthorities: [SOURCE_AUTHORITY_ROW],
    auditEvents: [] as AuditEventRow[],
    operativeSources: [SOURCE_AUTHORITY_ROW],
    openBlockerCount: 1,
    ...overrides,
  };
}

describe('FOLD-L1-1 — assembleMatterState (summary)', () => {
  it('produces valid summary state with correct counts and blocked posture', () => {
    const state = assembleMatterState(baseInput());
    expect(MatterStateSchema.safeParse(state).success).toBe(true);
    expect(state.mode).toBe('summary');
    if (state.mode !== 'summary') throw new Error('mode');
    expect(state.counts.lockedDecisionsActive).toBe(1);
    expect(state.counts.adoptionsActive).toBe(1);
    expect(state.counts.openItemsOpen).toBe(2);
    expect(state.counts.openBlockers).toBe(1);
    expect(state.safeToSend.posture).toBe('blocked');
    expect(state.operativeDocument?.documentId).toBe(DOC);
  });
});

describe('FOLD-L1-1 — assembleMatterState (full)', () => {
  it('includes every composed row', () => {
    const state = assembleMatterState(baseInput({ mode: 'full' }));
    expect(MatterStateSchema.safeParse(state).success).toBe(true);
    if (state.mode !== 'full') throw new Error('mode');
    expect(state.lockedDecisions).toHaveLength(1);
    expect(state.adoptions).toHaveLength(1);
    expect(state.openItems).toHaveLength(2);
    expect(state.sourceAuthorities).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
  });
});

describe('FOLD-L1-1 — assembleMatterState (model_context curation)', () => {
  it('splits open items by severity and surfaces matter-level items + operative sources', () => {
    const state = assembleMatterState(baseInput({ mode: 'model_context' }));
    expect(MatterStateSchema.safeParse(state).success).toBe(true);
    if (state.mode !== 'model_context') throw new Error('mode');
    expect(state.openBlockers).toHaveLength(1);
    expect(state.openBlockers[0]?.scope).toBe('matter');
    expect(state.openSubstantive).toHaveLength(1);
    expect(state.openSubstantive[0]?.scope).toBe('document');
    expect(state.matterLevelItems).toHaveLength(1); // only the documentId===null one
    expect(state.activeLockedDecisions).toHaveLength(1);
    expect(state.carriedAdoptions).toHaveLength(1);
    expect(state.operativeSources).toHaveLength(1);
  });
});

describe('FOLD-L1-1 — assembleMatterState enforces the integrity invariant', () => {
  it('throws when an aggregated row belongs to another matter', () => {
    const bad = baseInput({
      openItems: [{ ...blockerMatterLevel, matterId: 'deadbeef-dead-dead-dead-deaddeaddead' }],
    });
    expect(() => assembleMatterState(bad)).toThrow(/integrity invariant/);
  });
});

// ---------------------------------------------------------------------------
// Source audits of the wiring
// ---------------------------------------------------------------------------

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L1-1 — schema + migration wiring', () => {
  const schema = readSrc('../db/schema.ts');
  const migration = readSrc('../db/migrations/0005_fold_l1_1_matter_state_engine.sql');

  it('schema.ts defines source_authority and open_items tables', () => {
    expect(schema).toMatch(/mysqlTable\(\s*'source_authority'/);
    expect(schema).toMatch(/mysqlTable\(\s*'open_items'/);
  });
  it("schema.ts adds the 'disposition' audit eventType and disposition-detail columns", () => {
    expect(schema).toMatch(/'disposition'/);
    expect(schema).toMatch(/targetType: varchar\('targetType'/);
    expect(schema).toMatch(/action: varchar\('action'/);
  });
  it('migration 0005 is additive: creates new tables and ALTERs audit_events only by ADD/MODIFY', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS `source_authority`/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS `open_items`/);
    expect(migration).toMatch(/ALTER TABLE `audit_events`\s*\n\s*ADD COLUMN IF NOT EXISTS `targetType`/);
    // no destructive ops on existing tables
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration).not.toMatch(/DROP COLUMN/i);
  });
});

describe('FOLD-L1-1 — ownerScope discipline in new query layers', () => {
  const sa = readSrc('../db/queries/sourceAuthority.ts');
  const oi = readSrc('../db/queries/openItems.ts');
  it('source_authority owner-filters via ownerScope(), never inline eq(table.userId,...)', () => {
    expect(sa).toMatch(/ownerScope\(sourceAuthority\.userId,/);
    expect(sa).not.toMatch(/eq\(sourceAuthority\.userId/);
  });
  it('open_items owner-filters via ownerScope(), never inline eq(table.userId,...)', () => {
    expect(oi).toMatch(/ownerScope\(openItems\.userId,/);
    expect(oi).not.toMatch(/eq\(openItems\.userId/);
  });
  it('attorney close flows write a transactional audit-disposition row (item 5)', () => {
    expect(oi).toMatch(/db\.transaction\(/);
    expect(oi).toMatch(/eventType: 'disposition'/);
    expect(sa).toMatch(/db\.transaction\(/);
  });
  it('open_items has no auto-close path (default-safe): only attorney flows change status out of open', () => {
    // refreshOpenItemLastSeen only sets lastSeenAt, never status
    const refresh = oi.slice(oi.indexOf('function refreshOpenItemLastSeen'));
    expect(refresh.slice(0, refresh.indexOf('}'))).not.toMatch(/status:/);
  });
});

describe('FOLD-L1-1 — read surface wiring', () => {
  const router = readSrc('../router.ts');
  const proc = readSrc('../procedures/matterState.ts');
  it('router registers the matterState router', () => {
    expect(router).toMatch(/matterState: matterStateRouter/);
  });
  it('matterState.get is owner-scoped: userId comes from ctx, not input', () => {
    expect(proc).toMatch(/protectedProcedure/);
    expect(proc).toMatch(/userId: ctx\.userId/);
    expect(proc).not.toMatch(/userId:\s*input\./);
  });
});

describe('FOLD-L1-1 — CI covers the phase branch (Rule 17)', () => {
  const ci = readSrc('../../../.github/workflows/ci.yml');
  it("ci.yml triggers on fold/** push and PR", () => {
    expect(ci).toMatch(/'fold\/\*\*'/);
  });
});
