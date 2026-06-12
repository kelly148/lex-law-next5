/**
 * ChatComposer — CHAT-COMPOSER-1: the functional chat composer for the CHAT-UI-1 surface.
 *
 * Replaces the inert W0 placeholder. Captures an attorney turn, submits it via
 * chatDispatch.submitTurn (CHAT-DISPATCH-1), and renders the returned model text inline.
 *
 * GATING: renders ONLY inside ChatSurface, which is gated by CHAT_UI_1_ENABLED — when that flag
 * is OFF (the default) the surface redirects and this component never mounts, so the existing app
 * is byte-for-byte unchanged. submitTurn is ITSELF gated by CHAT_DISPATCH_ENABLED on the server:
 * when that is OFF it refuses with PRECONDITION_FAILED 'CHAT_DISPATCH_DISABLED', which surfaces
 * here as a visible, non-blocking error (no crash). NO master injection — the chat turn stays
 * callRole 'other' -> legacy (master-into-chat is the triad-gated INSTR Phase D, not this).
 *
 * Follows the chat-surface imperative mutation pattern (utils.client.<proc>.mutate, like
 * ChatDeliverable) rather than the useMutation hook — no QueryClient at render, render-test-clean.
 * A synchronous in-flight ref guards against double-submit (the useGuardedMutation intent, Ch 24.1).
 */
import React, { useRef, useState } from 'react';
import { trpc } from '../trpc.js';

interface ChatTurn {
  id: number;
  user: string;
  model: string;
}

export default function ChatComposer({ matterId }: { matterId: string }): React.ReactElement {
  const utils = trpc.useUtils();
  const [turnText, setTurnText] = useState('');
  const [thread, setThread] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const handleSend = async (): Promise<void> => {
    const text = turnText.trim();
    if (!text || inFlight.current) return; // synchronous double-submit guard
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const data = await utils.client.chatDispatch.submitTurn.mutate({ matterId, turnText: text });
      const reply = data.response.trim();
      setThread((prev) => [...prev, { id: prev.length, user: text, model: reply }]);
      setTurnText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div data-testid="chat-composer" className="border-t border-line px-5 py-4">
      {thread.length > 0 && (
        <div data-testid="chat-thread" className="mb-3 max-h-60 space-y-3 overflow-auto">
          {thread.map((t) => (
            <div key={t.id} className="text-sm">
              <p data-testid="chat-turn-user" className="text-ink">
                <span className="text-ink-hint">You: </span>
                {t.user}
              </p>
              <p data-testid="chat-turn-model" className="mt-1 whitespace-pre-wrap text-ink-secondary">
                <span className="text-ink-hint">Assistant: </span>
                {t.model ? t.model : <em className="text-ink-hint">(the model returned no text)</em>}
              </p>
            </div>
          ))}
        </div>
      )}
      {error !== null && (
        <p data-testid="chat-error" className="mb-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          data-testid="chat-input"
          value={turnText}
          onChange={(e) => setTurnText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          placeholder="Message the assistant about this matter…"
          className="flex-1 resize-none rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          data-testid="chat-send"
          type="button"
          onClick={() => void handleSend()}
          disabled={pending || turnText.trim().length === 0}
          className="rounded bg-accent px-4 py-2 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
