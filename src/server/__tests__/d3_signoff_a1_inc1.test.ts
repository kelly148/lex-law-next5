/**
 * D3-SIGNOFF A.1 Inc 1 — data core: the three-state gate flag, the stamped comparator/fork constants, and the
 * deed_signoff Zod Wall. Flag-dark (default OFF); no comparator/export/UI yet (Inc 2–4).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getD3SignoffMode } from '../config/featureFlags.js';
import { D3_COMPARATOR_VERSION, D3_FORK_PROVENANCE } from '../deed/d3Signoff.js';
import { DeedSignoffRowSchema } from '../../shared/schemas/d3Signoff.js';

const FLAG = 'D3_SIGNOFF_MODE';
let saved: string | undefined;
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  saved = undefined;
});
function setMode(v: string | undefined): void {
  saved ??= process.env[FLAG];
  if (v === undefined) delete process.env[FLAG];
  else process.env[FLAG] = v;
}

describe('A.1 Inc1 — D3_SIGNOFF_MODE three-state flag (NC-D3-7; default OFF)', () => {
  it('defaults OFF; only exact "observe"/"enforce" are honored', () => {
    setMode(undefined);
    expect(getD3SignoffMode()).toBe('off');
    setMode('observe');
    expect(getD3SignoffMode()).toBe('observe');
    setMode('enforce');
    expect(getD3SignoffMode()).toBe('enforce');
    for (const v of ['OFF', 'ENFORCE', 'true', '1', 'on', '']) {
      setMode(v);
      expect(getD3SignoffMode()).toBe('off');
    }
  });
});

describe('A.1 Inc1 — stamped comparator version + Fork-A provenance (NC-D3-4 / NC-D3-1)', () => {
  it('exposes stable constants', () => {
    expect(D3_COMPARATOR_VERSION).toBe('d3-comparator-v1');
    expect(D3_FORK_PROVENANCE).toBe('extracted_text_fork_a');
  });
});

describe('A.1 Inc1 — DeedSignoffRowSchema (Zod Wall)', () => {
  const UUID = '11111111-1111-1111-1111-111111111111';
  const validRow = {
    id: UUID, userId: UUID, matterId: UUID, documentId: UUID, documentVersionId: UUID,
    gateMode: 'observe', verdict: 'pass', comparatorPassed: true, comparatorVersion: 'd3-comparator-v1',
    assembledContentHash: 'abc', sourceFactsHash: 'def', forkProvenance: 'extracted_text_fork_a',
    attestations: { comparatorPassed: true, attorneyAttestedVsOriginal: true, notOcrOnly: true },
    comparison: {
      fields: [{ field: 'legal_description', status: 'match', sourceValueHash: 'h1', draftValueHash: 'h1', provenanceClass: 'extraction_verbatim', confirmed: true }],
      sourceMaterialIds: ['mat-1'],
      snapshotHash: 'snap',
    },
    override: null,
    attorneyUserId: UUID, createdAt: new Date('2026-07-03T00:00:00Z'),
  };

  it('parses a valid observe/pass record', () => {
    expect(DeedSignoffRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects gateMode "off" (never recorded) and a bad verdict', () => {
    expect(DeedSignoffRowSchema.safeParse({ ...validRow, gateMode: 'off' }).success).toBe(false);
    expect(DeedSignoffRowSchema.safeParse({ ...validRow, verdict: 'halt' }).success).toBe(false);
  });

  it('accepts an override record with a withheld/absent field result (NC-D3-3)', () => {
    const overridden = {
      ...validRow,
      verdict: 'overridden',
      override: { reasonCode: 'source_withheld', reasonText: 'no prior instrument on record' },
      comparison: {
        ...validRow.comparison,
        fields: [{ field: 'parcel_id', status: 'absent', sourceValueHash: null, draftValueHash: null, provenanceClass: 'withheld', confirmed: true }],
      },
    };
    expect(DeedSignoffRowSchema.safeParse(overridden).success).toBe(true);
  });
});
