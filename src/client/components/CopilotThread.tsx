/**
 * CopilotThread — CHAT-COPILOT-1 (Copilot UI): the thread view for one persisted conversation.
 *
 * DISPLAY + WIRING of the already-built, triad-reviewed backend (Inc 1-4). Restores the persisted
 * thread on load (chatCopilot.messages), submits turns (chatCopilot.submitTurn), and renders the
 * signals the server already returns: the master/R4 "internal working draft" notice; the windowed /
 * scrubbed-master-turn count; reference-only citation chips (dormant until grounding is live); the
 * omitted / truncated / NPI-withheld counts (no silent truncation); the CONVERSATION_FROZEN state.
 * Wires the lifecycle controls to the EXISTING gated procedures (delete, legal-hold, export-to-matter-
 * file, per-conversation + per-turn do-not-persist / exclude-from-grounding, redactMessage).
 *
 * HARD EXCLUSION: there is NO "promote to draft", "send", "finalize", or "client-ready" affordance
 * anywhere here — promote-to-draft is a separate future FIRE engagement. This surface advises + drafts
 * internal work product only.
 *
 * Mounts ONLY inside CopilotPage, which is gated by CHAT_COPILOT_ENABLED (default OFF) — when that flag
 * is OFF the surface redirects and this never renders. Imperative mutation pattern (utils.client.<proc>)
 * like ChatComposer, so it is render-test-clean (no QueryClient at render).
 */
import React, { useRef, useState } from 'react';
import { ShieldAlert, Lock, Download, Trash2, EyeOff, Ban, Users } from 'lucide-react';
import { trpc } from '../trpc.js';
import ChatReviewPanel from './ChatReviewPanel.js';

export interface CopilotConversation {
  id: string;
  matterId: string;
  documentId: string | null;
  title: string | null;
  legalHold: boolean;
  doNotPersist: boolean;
  excludeFromGrounding: boolean;
  frozenAt: Date | string | null;
}

interface CopilotThreadProps {
  conversation: CopilotConversation;
  matterId: string;
  /** Refresh the parent's conversation list after a lifecycle mutation. */
  onRefetch: () => void;
  /** Called after the conversation is deleted so the parent can clear the selection. */
  onDeleted: () => void;
}

interface Citation { sourceId: string; locator?: string | null }
interface TurnSignals {
  notice: string | null;
  scrubbedMasterTurns: number;
  citations: Citation[];
  rejectedCitationCount: number;
  grounding: { grounded: boolean; omittedCount: number; truncated: boolean; npiWithheldCount: number };
}
interface ThreadMessage {
  id: string;
  role: 'attorney' | 'assistant';
  content: string | null;
  citations: Citation[] | null;
  doNotPersist: boolean;
  excludeFromGrounding: boolean;
}

// ── Inc 5 — guided modes + one-click refine ────────────────────────────────────────────────────────
export type GuidedMode = 'draft' | 'review' | 'analyze' | 'outline';
export const GUIDED_MODES: ReadonlyArray<{ key: GuidedMode; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'review', label: 'Review' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'outline', label: 'Outline' },
];

export interface GuidedInputs {
  audience: string;
  jurisdiction: string;
  documentRef: string;
  posture: string;
  deliverable: string;
  clientSendable: boolean;
}
const EMPTY_GUIDED: GuidedInputs = { audience: '', jurisdiction: '', documentRef: '', posture: '', deliverable: '', clientSendable: false };

/**
 * Build a STRUCTURED turn from a guided mode + the collected inputs (not just a prompt swap): the mode
 * and the answered fields are folded into the turn text, and the mode is ALSO passed to submitTurn (the
 * server already keys grounding budget on it). "Client-sendable language requested" is an INPUT to the
 * drafting register — it never makes the output client-ready (this surface produces internal work product
 * only; there is no send/finalize/promote affordance).
 */
export function buildGuidedTurn(mode: GuidedMode, inputs: GuidedInputs, freeText: string): string {
  const lines: string[] = [`[Guided ${mode}]`];
  if (inputs.audience.trim()) lines.push(`Audience: ${inputs.audience.trim()}`);
  if (inputs.jurisdiction.trim()) lines.push(`Jurisdiction: ${inputs.jurisdiction.trim()}`);
  if (inputs.documentRef.trim()) lines.push(`Document/version: ${inputs.documentRef.trim()}`);
  if (inputs.posture.trim()) lines.push(`Posture: ${inputs.posture.trim()}`);
  if (inputs.deliverable.trim()) lines.push(`Deliverable: ${inputs.deliverable.trim()}`);
  lines.push(`Client-sendable language requested: ${inputs.clientSendable ? 'yes' : 'no'}`);
  lines.push('', freeText.trim());
  return lines.join('\n');
}

/** The one-click refine follow-up instructions. Each issues a follow-up turn (keeping the active mode). */
export const REFINE_ACTIONS: ReadonlyArray<{ key: string; label: string; instruction: string }> = [
  { key: 'expand', label: 'Expand', instruction: 'Refine the previous response: expand it with more detail and supporting analysis.' },
  { key: 'shorten', label: 'Shorten', instruction: 'Refine the previous response: make it more concise without losing any controlling point.' },
  { key: 'cite', label: 'Add citations', instruction: 'Refine the previous response: add a source citation for each factual claim that is grounded in the matter sources.' },
  { key: 'rephrase', label: 'Rephrase for audience', instruction: 'Refine the previous response: rephrase it for the stated audience and register.' },
];

export default function CopilotThread({ conversation, matterId, onRefetch, onDeleted }: CopilotThreadProps): React.ReactElement {
  const utils = trpc.useUtils();
  const conversationId = conversation.id;
  const messagesQuery = trpc.chatCopilot.messages.useQuery({ conversationId, matterId });
  const messages = (messagesQuery.data ?? []) as ThreadMessage[];
  // CHAT-COPILOT-2-INCB: the multi-model panel-review affordance is mounted ONLY when its flag is ON.
  // Flag OFF -> the affordance is entirely absent and this thread is otherwise unchanged. (Hook above any
  // early return — but this component has none; kept grouped with the other top-level hooks.)
  const panelFlagQuery = trpc.chatReviewPanel.isPanelEnabled.useQuery();
  const panelEnabled = panelFlagQuery.data?.enabled === true;
  // The assistant message currently open for panel review (null = none open).
  const [panelMessageId, setPanelMessageId] = useState<string | null>(null);

  const [turnText, setTurnText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<boolean>(conversation.frozenAt != null);
  const [signals, setSignals] = useState<TurnSignals | null>(null);
  // Inc 5: the active guided mode (null = freeform) + the collected inputs.
  const [mode, setMode] = useState<GuidedMode | null>(null);
  const [guided, setGuided] = useState<GuidedInputs>(EMPTY_GUIDED);
  const inFlight = useRef(false);

  /** Select/clear a guided mode. Review auto-binds the operative document when the conversation is doc-bound. */
  const chooseMode = (next: GuidedMode | null): void => {
    setMode(next);
    if (next === 'review' && conversation.documentId != null) {
      setGuided((g) => ({ ...g, documentRef: g.documentRef || 'operative document (current version)' }));
    }
  };

  const refreshMessages = (): void => {
    void utils.chatCopilot.messages.invalidate({ conversationId, matterId });
  };

  const handleSend = async (over?: { textOverride?: string }): Promise<void> => {
    const raw = (over?.textOverride ?? turnText).trim();
    if (!raw || inFlight.current || frozen) return;
    // A refine action passes textOverride (already a full instruction). A fresh guided turn folds the
    // collected inputs into a structured turn (Inc 5). The active mode is passed to submitTurn either way.
    const isRefine = over?.textOverride !== undefined;
    const text = mode !== null && !isRefine ? buildGuidedTurn(mode, guided, raw) : raw;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const data = await utils.client.chatCopilot.submitTurn.mutate({
        conversationId,
        matterId,
        turnText: text,
        ...(mode !== null ? { mode } : {}),
      });
      setSignals({
        notice: data.master?.notice ?? null,
        scrubbedMasterTurns: data.window?.scrubbedMasterTurns ?? 0,
        citations: (data.citations ?? []) as Citation[],
        rejectedCitationCount: data.rejectedCitationCount ?? 0,
        grounding: data.grounding ?? { grounded: false, omittedCount: 0, truncated: false, npiWithheldCount: 0 },
      });
      if (over?.textOverride === undefined) setTurnText('');
      refreshMessages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/CONVERSATION_FROZEN/.test(msg)) {
        setFrozen(true);
      } else {
        setError(msg);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const runLifecycle = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div data-testid="copilot-thread" className="flex h-full flex-col bg-surface">
      {/* Header — title + lifecycle controls (wired to the existing gated procedures). NO promote/send. */}
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="text-sm font-medium text-ink">{conversation.title ?? 'Conversation'}</h2>
        {conversation.legalHold && (
          <span data-testid="copilot-legalhold-badge" className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Legal hold</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            data-testid="copilot-legalhold"
            type="button"
            title={conversation.legalHold ? 'Release legal hold' : 'Place legal hold'}
            onClick={() => void runLifecycle(() => utils.client.chatCopilot.setLegalHold.mutate({ conversationId, on: !conversation.legalHold }))}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
          >
            <Lock className="h-3.5 w-3.5" /> {conversation.legalHold ? 'Hold on' : 'Hold'}
          </button>
          <button
            data-testid="copilot-donotpersist"
            type="button"
            title="Do not persist further turns in this conversation"
            onClick={() => void runLifecycle(() => utils.client.chatCopilot.setMark.mutate({ conversationId, doNotPersist: !conversation.doNotPersist }))}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
          >
            <Ban className="h-3.5 w-3.5" /> {conversation.doNotPersist ? "Don't persist: on" : "Don't persist"}
          </button>
          <button
            data-testid="copilot-exclude-grounding"
            type="button"
            title="Sensitivity: keep this conversation matter-state-only (exclude from grounding)"
            onClick={() => void runLifecycle(() => utils.client.chatCopilot.setMark.mutate({ conversationId, excludeFromGrounding: !conversation.excludeFromGrounding }))}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
          >
            <EyeOff className="h-3.5 w-3.5" /> {conversation.excludeFromGrounding ? 'High-sensitivity: on' : 'High-sensitivity'}
          </button>
          <button
            data-testid="copilot-export"
            type="button"
            title="Export the full thread + citations to the matter file"
            onClick={() => void runLifecycle(() => utils.client.chatCopilot.exportToMatterFile.mutate({ conversationId }))}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:bg-surface-2"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            data-testid="copilot-delete"
            type="button"
            title="Delete this conversation (blocked under legal hold)"
            onClick={() => void runLifecycle(async () => { await utils.client.chatCopilot.delete.mutate({ conversationId }); onDeleted(); })}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-danger hover:bg-surface-2"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </header>

      {frozen && (
        <div data-testid="copilot-frozen" className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <ShieldAlert className="h-4 w-4" />
          This conversation is frozen because the matter's capacity posture changed. Start a new conversation to continue.
        </div>
      )}

      {/* Thread — restored persisted turns. Each turn carries per-turn lifecycle controls. */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-hint">No turns yet. Ask the assistant about this matter below.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div key={m.id} data-testid="copilot-message" className="text-sm">
                <p className={m.role === 'attorney' ? 'text-ink' : 'mt-0.5 whitespace-pre-wrap text-ink-secondary'}>
                  <span className="text-ink-hint">{m.role === 'attorney' ? 'You: ' : 'Assistant: '}</span>
                  {m.content != null ? m.content : <em className="text-ink-hint">(redacted — not persisted)</em>}
                </p>
                {m.citations != null && m.citations.length > 0 && (
                  <div className="mt-1 flex flex-col gap-1">
                    {/* CHAT-COPILOT-2 Q4: a citation proves the source was PRESENT IN THE BUNDLE sent to the
                        model — it shows grounding, NOT legal correctness. The chip language is deliberately
                        framed as "present in the bundle" and never overstates the citation as vetted. */}
                    <span className="text-[11px] text-ink-hint">Sources present in the bundle (grounding, not legal correctness):</span>
                    <div className="flex flex-wrap gap-1">
                      {m.citations.map((c, i) => (
                        <span
                          key={i}
                          data-testid="copilot-citation"
                          title="Source present in the bundle sent to the model — this shows grounding, not legal correctness."
                          className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-hint"
                        >
                          in bundle: {c.sourceId}{c.locator ? ` · ${c.locator}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {m.content != null && (
                  <div className="mt-1 flex gap-2">
                    <button
                      data-testid="copilot-redact"
                      type="button"
                      onClick={() => void runLifecycle(() => { const p = utils.client.chatCopilot.redactMessage.mutate({ messageId: m.id, matterId }); refreshMessages(); return p; })}
                      className="text-xs text-ink-hint underline-offset-2 hover:underline"
                    >
                      Redact
                    </button>
                    <button
                      data-testid="copilot-msg-exclude"
                      type="button"
                      onClick={() => void runLifecycle(() => utils.client.chatCopilot.setMessageExcludeFromGrounding.mutate({ messageId: m.id, matterId, on: !m.excludeFromGrounding }))}
                      className="text-xs text-ink-hint underline-offset-2 hover:underline"
                    >
                      {m.excludeFromGrounding ? 'Re-include in grounding' : 'Exclude from grounding'}
                    </button>
                    {/* CHAT-COPILOT-2-INCB: panel review on an ASSISTANT message (the work product). Flag-gated. */}
                    {panelEnabled && m.role === 'assistant' && (
                      <button
                        data-testid="copilot-panel-review"
                        type="button"
                        onClick={() => setPanelMessageId((cur) => (cur === m.id ? null : m.id))}
                        className="flex items-center gap-1 text-xs text-ink-hint underline-offset-2 hover:underline"
                      >
                        <Users className="h-3 w-3" /> {panelMessageId === m.id ? 'Hide panel review' : 'Panel review'}
                      </button>
                    )}
                  </div>
                )}
                {panelEnabled && m.role === 'assistant' && panelMessageId === m.id && (
                  <ChatReviewPanel
                    conversation={{ id: conversationId, matterId }}
                    message={{ id: m.id, content: m.content }}
                    onClose={() => setPanelMessageId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Latest-turn server signals — the master/R4 notice + posture/grounding telemetry (no silent truncation). */}
        {signals !== null && (
          <div data-testid="copilot-signals" className="mt-4 space-y-1 border-t border-line pt-3">
            {signals.notice !== null && (
              <p data-testid="copilot-notice" className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">{signals.notice}</p>
            )}
            {signals.scrubbedMasterTurns > 0 && (
              <p data-testid="copilot-scrub" className="text-xs text-ink-hint">{signals.scrubbedMasterTurns} prior master-applied turn(s) scrubbed for the current posture.</p>
            )}
            {(signals.grounding.omittedCount > 0 || signals.grounding.truncated || signals.grounding.npiWithheldCount > 0) && (
              <p data-testid="copilot-grounding" className="text-xs text-ink-hint">
                Context: {signals.grounding.omittedCount} omitted{signals.grounding.truncated ? ', truncated' : ''}, {signals.grounding.npiWithheldCount} withheld (NPI — affirmatively select to include).
              </p>
            )}
            {signals.rejectedCitationCount > 0 && (
              <p data-testid="copilot-rejected-citations" className="text-xs text-ink-hint">{signals.rejectedCitationCount} unverifiable citation(s) dropped.</p>
            )}
          </div>
        )}
      </div>

      {error !== null && <p data-testid="copilot-error" className="px-4 pb-1 text-sm text-red-600">{error}</p>}

      {/* Composer */}
      <div className="border-t border-line px-4 py-3">
        {/* Inc 5 — guided modes: select a mode, collect inputs, and pass the mode to submitTurn (not just
            a prompt swap). Review auto-binds the operative document when the conversation is doc-bound. */}
        <div data-testid="copilot-modes" className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-xs text-ink-hint">Mode:</span>
          {GUIDED_MODES.map((gm) => (
            <button
              key={gm.key}
              data-testid={`copilot-mode-${gm.key}`}
              type="button"
              onClick={() => chooseMode(mode === gm.key ? null : gm.key)}
              className={`rounded border px-2 py-0.5 text-xs ${mode === gm.key ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink-secondary hover:bg-surface-2'}`}
            >
              {gm.label}
            </button>
          ))}
          {mode !== null && (
            <button data-testid="copilot-mode-clear" type="button" onClick={() => chooseMode(null)} className="ml-1 text-xs text-ink-hint underline-offset-2 hover:underline">
              freeform
            </button>
          )}
        </div>
        {mode !== null && (
          <div data-testid="copilot-guided-form" className="mb-2 grid grid-cols-2 gap-2">
            <input data-testid="copilot-guided-audience" value={guided.audience} onChange={(e) => setGuided((g) => ({ ...g, audience: e.target.value }))} placeholder="Audience (e.g. court, client)" className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            <input data-testid="copilot-guided-jurisdiction" value={guided.jurisdiction} onChange={(e) => setGuided((g) => ({ ...g, jurisdiction: e.target.value }))} placeholder="Jurisdiction (VA / MD)" className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            <input data-testid="copilot-guided-document" value={guided.documentRef} onChange={(e) => setGuided((g) => ({ ...g, documentRef: e.target.value }))} placeholder="Document / version" className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            <input data-testid="copilot-guided-deliverable" value={guided.deliverable} onChange={(e) => setGuided((g) => ({ ...g, deliverable: e.target.value }))} placeholder="Deliverable" className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            <input data-testid="copilot-guided-posture" value={guided.posture} onChange={(e) => setGuided((g) => ({ ...g, posture: e.target.value }))} placeholder="Posture" className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
              <input data-testid="copilot-guided-clientsendable" type="checkbox" checked={guided.clientSendable} onChange={(e) => setGuided((g) => ({ ...g, clientSendable: e.target.checked }))} />
              Client-sendable language requested
            </label>
          </div>
        )}
        {messages.length > 0 && !frozen && (
          <div data-testid="copilot-refine" className="mb-2 flex flex-wrap items-center gap-1">
            <span className="text-xs text-ink-hint">Refine:</span>
            {REFINE_ACTIONS.map((ra) => (
              <button
                key={ra.key}
                data-testid={`copilot-refine-${ra.key}`}
                type="button"
                disabled={pending}
                onClick={() => void handleSend({ textOverride: ra.instruction })}
                className="rounded btn-secondary px-2 py-0.5 text-xs"
              >
                {ra.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            data-testid="copilot-input"
            value={turnText}
            onChange={(e) => setTurnText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            rows={2}
            disabled={frozen}
            placeholder={frozen ? 'Conversation frozen — start a new one.' : 'Ask the assistant about this matter…'}
            className="flex-1 resize-none rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
          <button
            data-testid="copilot-send"
            type="button"
            onClick={() => void handleSend()}
            disabled={pending || frozen || turnText.trim().length === 0}
            className="rounded bg-accent px-4 py-2 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {/* "Ask" — never "Send"/"Promote"/"Finalize": this submits an internal chat turn to the
                assistant; there is no send/finalize/promote-to-draft affordance on this surface. */}
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-hint">Internal attorney work product — drafting/analysis only. Nothing here is sent, filed, or client-ready.</p>
      </div>
    </div>
  );
}
