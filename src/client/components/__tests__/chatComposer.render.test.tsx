// @vitest-environment jsdom
/**
 * ChatComposer render test — CHAT-COMPOSER-1 (ci-gotchas #10: tsc never renders React).
 *
 * Proves the functional composer: typing + Send invokes chatDispatch.submitTurn with the typed
 * text; the returned model text renders inline; the refuse/error path shows a visible, non-blocking
 * error (no crash). The trpc imperative client (utils.client.chatDispatch.submitTurn.mutate) is
 * mocked so the test is hermetic (no QueryClient / network) and drives success/error/empty cases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const submitTurnMock = vi.hoisted(() =>
  vi.fn(
    (_input: { matterId: string; turnText: string }): Promise<{
      jobId: string;
      status: string;
      response: string;
      master?: { applied: boolean; source: string; representational: boolean; notice: string | null };
    }> => Promise.resolve({ jobId: 'j1', status: 'completed', response: 'MODEL REPLY' }),
  ),
);

vi.mock('../../trpc.js', () => ({
  trpc: {
    useUtils: () => ({ client: { chatDispatch: { submitTurn: { mutate: submitTurnMock } } } }),
  },
}));

import ChatComposer from '../ChatComposer.js';

afterEach(() => {
  cleanup();
  submitTurnMock.mockReset();
  submitTurnMock.mockResolvedValue({ jobId: 'j1', status: 'completed', response: 'MODEL REPLY' });
});

function setup() {
  const r = render(<ChatComposer matterId="m-1" />);
  return {
    ...r,
    input: r.getByTestId('chat-input') as HTMLTextAreaElement,
    send: r.getByTestId('chat-send') as HTMLButtonElement,
  };
}

describe('ChatComposer — CHAT-COMPOSER-1', () => {
  it('submit invokes chatDispatch.submitTurn with the typed text', () => {
    const { input, send } = setup();
    fireEvent.change(input, { target: { value: 'What is the recording deadline?' } });
    fireEvent.click(send);
    expect(submitTurnMock).toHaveBeenCalledWith({
      matterId: 'm-1',
      turnText: 'What is the recording deadline?',
    });
  });

  it('renders the returned model text on success and clears the input', async () => {
    submitTurnMock.mockResolvedValueOnce({ jobId: 'j1', status: 'completed', response: 'MODEL REPLY' });
    const { input, send, findByText, getByTestId } = setup();
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(send);
    expect(await findByText('MODEL REPLY')).toBeTruthy();
    expect(getByTestId('chat-turn-user').textContent).toContain('hello');
    // The composer clears the input after a successful turn, ready for the next.
    expect((getByTestId('chat-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows a pending state (disabled Send / "Sending…") while the turn is in flight', () => {
    // A never-resolving call keeps the composer in the pending state.
    submitTurnMock.mockReturnValueOnce(new Promise(() => undefined));
    const { input, send, getByText, getByTestId } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(send);
    expect(getByText('Sending…')).toBeTruthy();
    expect((getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter (without Shift) submits; Shift+Enter does not (newline)', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'via enter' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitTurnMock).toHaveBeenCalledWith({ matterId: 'm-1', turnText: 'via enter' });

    submitTurnMock.mockClear();
    fireEvent.change(input, { target: { value: 'multi line' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(submitTurnMock).not.toHaveBeenCalled();
  });

  it('recovers after an error: a successful retry clears the error and renders the reply', async () => {
    submitTurnMock.mockRejectedValueOnce(new Error('CHAT_DISPATCH_DISABLED'));
    const { input, send, findByTestId, findByText, queryByTestId } = setup();
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(send);
    expect(await findByTestId('chat-error')).toBeTruthy();

    submitTurnMock.mockResolvedValueOnce({ jobId: 'j2', status: 'completed', response: 'RECOVERED' });
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.click(send);
    expect(await findByText('RECOVERED')).toBeTruthy();
    expect(queryByTestId('chat-error')).toBeNull(); // error cleared on the new submit
  });

  it('shows a visible, non-blocking error when submitTurn refuses (no crash)', async () => {
    submitTurnMock.mockRejectedValueOnce(new Error('CHAT_DISPATCH_DISABLED'));
    const { input, send, findByTestId, getByTestId } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(send);
    const err = await findByTestId('chat-error');
    expect(err.textContent).toContain('CHAT_DISPATCH_DISABLED');
    // Still mounted (no crash) — the composer input is still there.
    expect(getByTestId('chat-input')).toBeTruthy();
  });

  it('an empty model response renders a non-empty placeholder (no crash)', async () => {
    submitTurnMock.mockResolvedValueOnce({ jobId: 'j1', status: 'completed', response: '   ' });
    const { input, send, findByText } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(send);
    expect(await findByText('(the model returned no text)')).toBeTruthy();
  });

  it('whitespace-only input does not submit', () => {
    const { input, send } = setup();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(send);
    expect(submitTurnMock).not.toHaveBeenCalled();
  });

  it('CHAT-INJ-1 R4: renders the "internal working draft" notice when a master was injected', async () => {
    submitTurnMock.mockResolvedValueOnce({
      jobId: 'j1',
      status: 'completed',
      response: 'DRAFTED CLAUSE',
      master: {
        applied: true,
        source: 'master/claude/lawfirm',
        representational: true,
        notice: 'Internal working draft — attorney verification required.',
      },
    });
    const { input, send, findByTestId } = setup();
    fireEvent.change(input, { target: { value: 'draft a clause' } });
    fireEvent.click(send);
    const notice = await findByTestId('chat-turn-notice');
    expect(notice.textContent).toContain('attorney verification required');
  });

  it('CHAT-INJ-1 R4: no notice banner when no master was injected (substrate turn)', async () => {
    submitTurnMock.mockResolvedValueOnce({
      jobId: 'j1',
      status: 'completed',
      response: 'plain reply',
      master: { applied: false, source: 'neutral', representational: false, notice: null },
    });
    const { input, send, findByText, queryByTestId } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(send);
    await findByText('plain reply');
    expect(queryByTestId('chat-turn-notice')).toBeNull();
  });

  it('CHAT-INJ-1: a legacy response WITHOUT a master field still renders (no banner, no crash)', async () => {
    submitTurnMock.mockResolvedValueOnce({ jobId: 'j1', status: 'completed', response: 'legacy' });
    const { input, send, findByText, queryByTestId } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(send);
    await findByText('legacy');
    expect(queryByTestId('chat-turn-notice')).toBeNull();
  });
});
