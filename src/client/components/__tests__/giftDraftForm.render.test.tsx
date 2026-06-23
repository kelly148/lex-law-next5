// @vitest-environment jsdom
/**
 * GiftDraftForm render + validation test (DEED-DRAFT-AGENT-1 Inc-1c-UI). The tRPC client is mocked; this
 * verifies the form renders, blocks submit without a grantor/grantee, and calls the createGiftDraft mutation
 * with the cleaned input + navigates (via onCreated) on success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mutateMock = vi.fn();

vi.mock('../../trpc.js', () => {
  const utils = {
    client: { deedDraftAgent: { createGiftDraft: { mutate: (...a: unknown[]) => mutateMock(...a) } } },
    document: { list: { invalidate: () => undefined } },
  };
  return { trpc: { useUtils: () => utils } };
});

// useGuardedMutation: run the thunk and route the result through onSuccess/onError (a faithful stand-in).
vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (
    fn: (input: unknown) => Promise<{ documentId: string }>,
    opts: { onSuccess?: (r: { documentId: string }) => void; onError?: (e: Error) => void },
  ) => ({
    isPending: false,
    mutate: (input: unknown) => {
      Promise.resolve(fn(input)).then((r) => opts.onSuccess?.(r)).catch((e) => opts.onError?.(e as Error));
    },
  }),
}));

import { GiftDraftForm } from '../GiftDraftForm.js';

describe('GiftDraftForm', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    mutateMock.mockResolvedValue({ documentId: 'doc-xyz' });
  });
  afterEach(() => cleanup());

  it('renders the gift-draft form heading + the grantor/grantee labels', () => {
    const { getByText } = render(<GiftDraftForm matterId="m1" onClose={() => undefined} onCreated={() => undefined} />);
    expect(getByText('Generate Deed of Gift draft')).toBeTruthy();
    expect(getByText(/Grantor\(s\)/)).toBeTruthy();
    expect(getByText(/Grantee\(s\)/)).toBeTruthy();
  });

  it('blocks submit with a validation error when no grantor name is entered (no mutation)', () => {
    const { getByText } = render(<GiftDraftForm matterId="m1" onClose={() => undefined} onCreated={() => undefined} />);
    fireEvent.click(getByText('Generate draft'));
    expect(getByText(/grantor \(donor\) name is required/i)).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('submits the cleaned input and fires onCreated(documentId) on success', async () => {
    const onCreated = vi.fn();
    const { getByText, getAllByPlaceholderText } = render(
      <GiftDraftForm matterId="m1" onClose={() => undefined} onCreated={onCreated} />,
    );
    const nameInputs = getAllByPlaceholderText('Full legal name');
    fireEvent.change(nameInputs[0]!, { target: { value: '  Marcus Ellison  ' } }); // grantor
    fireEvent.change(nameInputs[1]!, { target: { value: 'Hannah Ellison' } }); // grantee
    fireEvent.click(getByText('Generate draft'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]?.[0] as { matterId: string; grantors: { name: string }[]; grantees: { name: string }[]; title: string };
    expect(arg.matterId).toBe('m1');
    expect(arg.grantors).toEqual([{ name: 'Marcus Ellison' }]); // trimmed, no empty descriptor
    expect(arg.grantees).toEqual([{ name: 'Hannah Ellison' }]);
    expect(arg.title).toBe('Deed of Gift');

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('doc-xyz'));
  });
});
