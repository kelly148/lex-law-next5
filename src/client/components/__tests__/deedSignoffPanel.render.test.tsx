// @vitest-environment jsdom
/**
 * D3-SIGNOFF A.1 Inc 4 — DeedSignoffPanel render test (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts: dark when the mode is off; the NC-D3-1 honest-labeling note + the per-field extracted-source-vs-deed
 * comparison; the dual-prong attestation gates the record button (NC-D3-1); a hard-block hides the form + shows
 * the non-overridable banner (NC-D3-3); and NC-1 (no "replace with this" affordance anywhere).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const recordMutate = vi.hoisted(() => vi.fn((input: unknown) => Promise.resolve(input)));
const mockState = vi.hoisted(() => ({
  enabled: { mode: 'observe' } as { mode: string },
  get: { data: undefined as unknown, error: null as unknown },
}));

vi.mock('../../trpc.js', async () => {
  const React = await import('react');
  return {
    trpc: {
      useUtils: () => ({
        deedSignoff: { getComparison: { invalidate: () => {} } },
        client: { deedSignoff: { record: { mutate: recordMutate } } },
      }),
      deedSignoff: {
        isEnabled: { useQuery: () => { React.useRef(null); return { data: mockState.enabled }; } },
        getComparison: { useQuery: () => { React.useRef(null); return mockState.get; } },
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

import { DeedSignoffPanel } from '../DeedSignoffPanel.js';

const DOC = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PASS = {
  documentVersionId: 'v1', tier: 'pass', alreadySignedOff: false, partiesCompared: false,
  extractionNotes: [], comparatorVersion: 'd3-comparator-v1', sourceLabel: 'extracted source text / facts',
  fields: [
    { field: 'legal_description', status: 'match', sourceValue: 'Lot 12, CEDAR RUN', draftValue: 'Lot 12, CEDAR RUN', provenanceClass: 'ocr_derived' },
    { field: 'parcel_id', status: 'match', sourceValue: '7298-44', draftValue: '7298-44', provenanceClass: 'extraction_verbatim' },
  ],
};
const HARDBLOCK = {
  ...PASS, tier: 'hard_block',
  fields: [{ field: 'legal_description', status: 'mismatch', sourceValue: 'Lot 12', draftValue: 'Lot 99', provenanceClass: 'ocr_derived' }],
};

afterEach(() => {
  cleanup();
  mockState.enabled = { mode: 'observe' };
  mockState.get = { data: undefined, error: null };
  recordMutate.mockClear();
});

describe('DeedSignoffPanel', () => {
  it('is dark when the mode is off', () => {
    mockState.enabled = { mode: 'off' };
    const { container } = render(<DeedSignoffPanel documentId={DOC} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the honest-labeling note + the per-field comparison, and gates record on the dual-prong attestation', () => {
    mockState.get = { data: PASS, error: null };
    const { getByTestId } = render(<DeedSignoffPanel documentId={DOC} />);

    // NC-D3-1 honest labeling.
    expect(getByTestId('deed-signoff-label').textContent).toContain('extracted source text / facts');
    expect(getByTestId('deed-signoff-label').textContent).toContain('original recorded instrument');
    // Per-field comparison rows.
    expect(getByTestId('deed-signoff-field-legal_description').textContent).toContain('CEDAR RUN');
    // OCR-derived warning on the legal.
    expect(getByTestId('deed-signoff-field-legal_description').textContent?.toLowerCase()).toContain('ocr-derived');

    // Record disabled until BOTH attestation prongs are checked.
    const btn = getByTestId('deed-signoff-record') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(getByTestId('deed-signoff-attest-original'));
    expect(btn.disabled).toBe(true); // still — only one prong
    fireEvent.click(getByTestId('deed-signoff-attest-notocr'));
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    expect(recordMutate).toHaveBeenCalledTimes(1);
    const [firstCall] = recordMutate.mock.calls;
    const arg = (firstCall?.[0] ?? {}) as { documentVersionId: string; attestations: { attorneyAttestedVsOriginal: boolean; notOcrOnly: boolean } };
    expect(arg.documentVersionId).toBe('v1');
    expect(arg.attestations).toEqual({ attorneyAttestedVsOriginal: true, notOcrOnly: true });
  });

  it('a hard-block hides the form + shows the non-overridable banner (NC-D3-3)', () => {
    mockState.get = { data: HARDBLOCK, error: null };
    const { getByTestId, queryByTestId } = render(<DeedSignoffPanel documentId={DOC} />);
    expect(getByTestId('deed-signoff-hardblock')).toBeTruthy();
    expect(queryByTestId('deed-signoff-record')).toBeNull(); // no sign-off form on a hard-block
  });

  it('NC-1: never offers a "replace with this" affordance', () => {
    mockState.get = { data: HARDBLOCK, error: null };
    const { container } = render(<DeedSignoffPanel documentId={DOC} />);
    expect(container.innerHTML.toLowerCase()).not.toContain('replace with');
  });
});
