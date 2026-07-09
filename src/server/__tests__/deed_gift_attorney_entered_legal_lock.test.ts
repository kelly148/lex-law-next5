/**
 * DEED-MANUAL-LEGAL-GIFT-1 (G10) — the attorney-entered legal is a NON-SKIPPABLE protected span (the
 * model-never-authors red line). When an affirmed attorney-entered VERBATIM legal is used, it must be registered
 * as a locked `legal_description` span so no Express revise/regenerate pass can touch it — always ESCALATE,
 * never auto-adopt, even when the model labels the edit "safe" (the model hint is additive-only, R5).
 *
 * Offsets are computed from the assembled draft at runtime (indexOf) so the test asserts the LOCK, not
 * hand-counted magic numbers, and breaks loudly if the assembler or the recognizers drift.
 */
import { describe, it, expect } from 'vitest';
import { consolidateDeedSourceFacts, type DeedMaterialInput } from '../deed/deedSourceFacts.js';
import { assembleGiftDeed, type GiftDeedInput, type GiftLegalAffirmation } from '../deed/deedGiftAssembler.js';
import {
  buildProtectedSpans,
  buildDeedProtectedSpans,
  attorneyEnteredLegalSpans,
} from '../express/protectedSpans.js';
import { evaluateLocus, type LocusSuggestion } from '../express/locusGate.js';
import { isSanctionedAgentDeed } from '../deed/deedDocTypeGuard.js';

// A packet WITHOUT a readable vesting-deed legal — the extracted legal is absent, so an affirmed paste is used.
const TAX_ONLY: DeedMaterialInput[] = [
  {
    materialId: 'mat-tax',
    textContent: ['REAL ESTATE ASSESSMENT', 'Parcel No: 7298-44-1201', 'Total Assessed Value: $588,400.00'].join('\n'),
  },
];
const absentLegalFacts = consolidateDeedSourceFacts(TAX_ONLY);

const fullAffirm: GiftLegalAffirmation = {
  verbatimFromSource: true,
  responsibleForAccuracy: true,
  describesSubjectProperty: true,
  affirmedAt: '2026-07-08T00:00:00Z',
};
const PASTED =
  'Lot 9, Block A, WILLOW GLEN, as recorded in Deed Book 4412 at Page 118, among the Land Records of Prince William County, Virginia.';

function giftInput(over: Partial<GiftDeedInput> = {}): GiftDeedInput {
  return {
    grantors: [{ name: 'Marcus T. Ellison' }],
    grantees: [{ name: 'Hannah R. Ellison', descriptor: "the Grantor's daughter" }],
    fileNumber: '36-2026-7777',
    granteeAddress: '123 Cedar Run Lane, Manassas, Virginia 20109',
    locality: 'Prince William County',
    derivationReference: 'in Deed Book 5500 at Page 12',
    ...over,
  };
}

/** A non-deletion replacement suggestion targeting [start,end). */
function edit(start: number, end: number, extra: Partial<LocusSuggestion> = {}): LocusSuggestion {
  return { targetStart: start, targetEnd: end, isDeletion: false, ...extra };
}

const draft = assembleGiftDeed(
  absentLegalFacts,
  giftInput({ legalDescription: PASTED, legalDescriptionSource: 'DB 4412 PG 118', legalDescriptionAffirmation: fullAffirm }),
);

describe('G10 — attorney-entered legal is a non-skippable protected span', () => {
  it('precondition: the affirmed attorney-entered legal is used verbatim', () => {
    expect(draft.legalDescriptionProvenance).toBe('attorney_entered');
    expect(draft.verbatimLegalUsed).toBe(PASTED);
    expect(draft.text).toContain(PASTED);
  });

  it('the recognizer already covers the attorney-entered legal in a well-formed deed (legal_description span)', () => {
    const spans = buildProtectedSpans('deed', draft.text);
    const legalIdx = draft.text.indexOf(PASTED);
    expect(legalIdx).toBeGreaterThanOrEqual(0);
    const covering = spans.find(
      (s) => s.label === 'legal_description' && s.start <= legalIdx && s.end >= legalIdx + PASTED.length,
    );
    expect(covering).toBeDefined();
  });

  it('attorneyEnteredLegalSpans registers the EXACT verbatim legal as a legal_description lock', () => {
    const legalIdx = draft.text.indexOf(PASTED);
    expect(attorneyEnteredLegalSpans(draft.text, draft.verbatimLegalUsed)).toEqual([
      { start: legalIdx, end: legalIdx + PASTED.length, label: 'legal_description' },
    ]);
  });

  it('attorneyEnteredLegalSpans is empty for an absent/empty legal or empty text (pure, safe)', () => {
    expect(attorneyEnteredLegalSpans(draft.text, null)).toEqual([]);
    expect(attorneyEnteredLegalSpans(draft.text, '   ')).toEqual([]);
    expect(attorneyEnteredLegalSpans('', PASTED)).toEqual([]);
  });

  it('buildDeedProtectedSpans is byte-identical to buildProtectedSpans when no attorney legal is supplied', () => {
    expect(buildDeedProtectedSpans(draft.text)).toEqual(buildProtectedSpans('deed', draft.text));
  });

  it('an edit intersecting the attorney-entered legal ALWAYS escalates — even when the model labels it safe', () => {
    const spans = buildDeedProtectedSpans(draft.text, draft.verbatimLegalUsed);
    const legalIdx = draft.text.indexOf(PASTED);
    // whole-span edit
    expect(evaluateLocus(edit(legalIdx, legalIdx + PASTED.length), spans, 'deed').decision).toBe('escalate');
    // a single character in the middle
    const mid = legalIdx + Math.floor(PASTED.length / 2);
    expect(evaluateLocus(edit(mid, mid + 1), spans, 'deed').decision).toBe('escalate');
    // the model says "safe" (modelEscalates:false) — additive-only, can NEVER lower an escalate (R5)
    expect(evaluateLocus(edit(mid, mid + 1, { modelEscalates: false }), spans, 'deed').decision).toBe('escalate');
  });
});

describe('G4/G12 — field-level attorney_entered provenance is DISTINCT from the LIVE-9 doc latch', () => {
  it('an attorney-entered legal sets FIELD provenance without touching the doc-level agent_assembled latch', () => {
    // Field-level provenance from the assembler (G4):
    expect(draft.legalDescriptionProvenance).toBe('attorney_entered');
    // The LIVE-9 document-level sanction latch is provenance='agent_assembled' for a deed. A gift deed persists as
    // agent_assembled regardless of the field-level legal provenance — the paste is a FIELD source, not a change
    // to document authorship. The assembler emits no document provenance; the doc latch stays intact.
    expect(isSanctionedAgentDeed('deed', 'agent_assembled')).toBe(true);
    // The two are DIFFERENT axes: the field provenance value is NOT a valid document provenance (using it as one
    // would break the latch — this locks that they are never conflated).
    expect(isSanctionedAgentDeed('deed', draft.legalDescriptionProvenance)).toBe(false);
  });
});
