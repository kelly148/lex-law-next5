// @vitest-environment jsdom
/**
 * FOLD-DEED-1 Inc 3 — DeedGatePanel render test (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts: dark when the gate is disabled / the document is not a deed; the three-gate verdict + the
 * recordable-is-the-all-three-gates-AND framing (never "legally correct"); the locality-unverified
 * fail-closed banner; the vesting DROPDOWN sourced from the verified KB (not free text); and that recording
 * calls deedGate.recordState with the edited state. Mocked useQuery/useGuardedMutation call real hooks.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const recordMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));
const mockState = vi.hoisted(() => ({
  enabled: { enabled: true } as { enabled: boolean },
  get: { data: undefined as unknown, error: null as unknown },
  kb: { data: undefined as unknown },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        deedGate: { get: { invalidate: () => {} } },
        client: { deedGate: { recordState: { mutate: recordMutate } } },
      }),
      deedGate: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: mockState.enabled }; } },
        get: { useQuery: () => { React.useRef(null); return mockState.get; } },
        referenceKb: { useQuery: () => { React.useRef(null); return mockState.kb; } },
      },
    },
  };
});

vi.mock('../../hooks/useGuardedMutation.js', async () => {
  const React = await import('react');
  return {
    useGuardedMutation: (fn: (input: unknown) => unknown) => {
      React.useRef(false);
      return { mutate: (input: unknown) => { void fn(input); }, isPending: false, error: null };
    },
  };
});

import { DeedGatePanel } from '../DeedGatePanel.js';

const DOC = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DEFAULT_STATE = {
  schemaVersion: 1, sourceOfRecordInstrument: null, descriptionSourceMatch: null, descriptionParcelScope: null,
  descriptionExceptionText: null, descriptionProvenance: null, descriptionNotOcrOnly: null,
  descriptionHasPlatOrSubdivisionRef: null, descriptionConfirmedAt: null, vestingSelection: null,
  maritalStatusConfirmed: null, spousalJoinder: null, grantorReconciledToSource: null, fiduciaryAuthority: null,
  specialInstrumentTriggersReviewed: null, preparerReturnGranteeAddress: null, executionMode: null,
};
const GET_RESULT = {
  state: DEFAULT_STATE,
  evaluation: {
    assembly: { passed: false, blockingReasons: ['no_grantor_bound', 'deed_type_jurisdiction_locality_template_uncovered'] },
    legalReview: { passed: false, blockingReasons: ['description_source_match_unconfirmed'] },
    recordability: { passed: false, blockingReasons: ['locality_kb_unverified'] },
    recordable: false,
  },
  parties: { grantorCount: 0, granteeCount: 0 },
  kbSeeded: false,
};
const KB = {
  vestingOptions: [
    { key: 'jtwros', language: 'as joint tenants with right of survivorship and not as tenants in common', appliesTo: 'multiple grantees' },
    { key: 'tbe', language: 'as tenants by the entirety with the common-law right of survivorship', appliesTo: 'married grantees' },
  ],
  escalationTriggers: ['Deceased grantor without a clean survivorship path', 'Property titled in a trust, estate, LLC, partnership, or other entity'],
  provenance: { sourceTitle: 'Deed Drafting in Virginia — A Training Guide', sourceOrg: 'The Satterwhite Law Firm, PLLC' },
};

afterEach(() => cleanup());
beforeEach(() => {
  mockState.enabled = { enabled: true };
  mockState.get = { data: GET_RESULT, error: null };
  mockState.kb = { data: KB };
  recordMutate.mockClear();
});

describe('DeedGatePanel', () => {
  it('is dark when the deed gate is disabled', () => {
    mockState.enabled = { enabled: false };
    const { queryByTestId } = render(<DeedGatePanel documentId={DOC} />);
    expect(queryByTestId('deed-gate')).toBeNull();
  });

  it('renders nothing when the document is not a deed (get errors)', () => {
    mockState.get = { data: undefined, error: { message: 'DEED_GATE_NOT_A_DEED' } };
    const { queryByTestId } = render(<DeedGatePanel documentId={DOC} />);
    expect(queryByTestId('deed-gate')).toBeNull();
  });

  it('shows the recordable=NO verdict with the all-three-gates-AND framing (never "legally correct")', () => {
    const { getByTestId } = render(<DeedGatePanel documentId={DOC} />);
    const verdict = getByTestId('deed-recordable-verdict');
    expect(verdict.textContent).toContain('Recordable: NO');
    expect(verdict.textContent).toMatch(/all three gates/i);
    expect(verdict.textContent).toMatch(/not.*certify.*legally correct/i);
  });

  it('shows the three gates + the locality-unverified fail-closed banner', () => {
    const { getByTestId } = render(<DeedGatePanel documentId={DOC} />);
    expect(getByTestId('deed-gate-assembly').textContent).toContain('blocked');
    expect(getByTestId('deed-gate-legal').textContent).toContain('blocked');
    expect(getByTestId('deed-gate-recordability').textContent).toContain('blocked');
    expect(getByTestId('deed-locality-unverified')).toBeTruthy();
  });

  it('the vesting control is a dropdown of the VERIFIED controlled list (not free text)', () => {
    const { getByTestId } = render(<DeedGatePanel documentId={DOC} />);
    const sel = getByTestId('deed-vesting') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    const langs = Array.from(sel.options).map((o) => o.value);
    expect(langs).toContain('as joint tenants with right of survivorship and not as tenants in common');
    expect(langs).toContain('as tenants by the entirety with the common-law right of survivorship');
  });

  it('recording calls deedGate.recordState with the edited state (vesting from the KB)', () => {
    const { getByTestId } = render(<DeedGatePanel documentId={DOC} />);
    fireEvent.change(getByTestId('deed-vesting'), { target: { value: 'as tenants by the entirety with the common-law right of survivorship' } });
    fireEvent.click(getByTestId('deed-record'));
    expect(recordMutate).toHaveBeenCalledTimes(1);
    const arg = recordMutate.mock.calls[0]![0] as { documentId: string; state: { vestingSelection: string } };
    expect(arg.documentId).toBe(DOC);
    expect(arg.state.vestingSelection).toBe('as tenants by the entirety with the common-law right of survivorship');
  });
});
