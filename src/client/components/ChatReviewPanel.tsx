/**
 * ChatReviewPanel — CHAT-COPILOT-2-INCB (sub-increment B3, CLIENT UX): the multi-model REVIEW PANEL.
 *
 * DISPLAY + WIRING of the already-built, server-side chatReviewPanel router. The attorney picks a panel
 * of OTHER models (GPT / Gemini / Grok — never Claude, the primary dispositioner) to critique ONE
 * assistant message (the work product under review). The flow is deliberately three steps:
 *
 *   1) PICK reviewers -> prepareReview (assemble + persist the panelConfirmId; nothing transmits yet).
 *   2) PANEL-CONFIRM: render the POST-minimization / POST-hold transmitting set (the exact sources by
 *      label + the NPI-withheld / omitted / attachment counts + the exact reviewer list) behind a
 *      deliberate "Confirm & send to panel" act (or Cancel). This is the egress consent gate.
 *   3) runReview -> the DISPOSITIONED-REVIEW view: every reviewer suggestion, the PRIMARY's (Claude's)
 *      disposition badge + reasoning, a citation chip, and per-item attorney Accept / Override controls.
 *
 * DEGRADED states render DISTINCTLY and never read as agreement: dispositionerStatus 'skipped' (no
 * reviewers available); 'failed' (suggestions shown but each marked "Not yet synthesized" —
 * primaryDisposition null — never raw third-party text presented as vetted); and absent reviewer lanes
 * (rawOutputs blocked/failed/timeout) surfaced so a partial run cannot be misread as a full panel.
 *
 * HARD EXCLUSION: there is NO send / finalize / promote / draft / client-ready affordance anywhere here.
 * A persistent ADVISORY banner makes it visually obvious that NOTHING is applied to the work product —
 * the primary is judging critiques of its OWN prior work, and the attorney makes the final call.
 *
 * Imperative mutation pattern (utils.client.chatReviewPanel.<proc>.mutate) like CopilotThread, so it is
 * render-test-clean (no QueryClient at render). React rules of hooks: ALL hooks run BEFORE any early
 * return.
 */
import React, { useState } from 'react';
import { X, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { trpc } from '../trpc.js';

// ── Server-contract shapes (mirror the chatReviewPanel router return types) ─────────────────────────
type Disposition = 'adopt' | 'reject' | 'modify_and_adopt';
type DispositionerStatus = 'pending' | 'success' | 'failed' | 'skipped';
type LaneStatus = 'pending' | 'success' | 'failed' | 'blocked' | 'timeout';

interface ReviewItem {
  id: string;
  reviewerModel: string;
  suggestion: string;
  primaryDisposition: Disposition | null;
  primaryReasoning: string | null;
  citationStatus: 'in_bundle' | 'unverified' | null;
  attorneyDecision: 'pending' | 'accept' | 'override';
  attorneyOverrideReason: string | null;
  laneStatus: string;
}
interface RawOutput {
  id: string;
  reviewerModel: string;
  rawText: string | null;
  laneStatus: LaneStatus;
  laneFailureReason: string | null;
}
interface TransmittingSet {
  includedSources: { sourceId: string; kind: string; label: string }[];
  npiWithheldCount: number;
  omittedCount: number;
  truncated: boolean;
  includedAttachmentCount: number;
}
interface PrepareResult {
  panelConfirmId: string;
  reviewers: string[];
  transmitting: TransmittingSet;
}
interface RunResult {
  runId: string;
  status: string;
  dispositionerStatus: DispositionerStatus;
  items: ReviewItem[];
  rawOutputs: RawOutput[];
}

export interface ChatReviewPanelProps {
  conversation: { id: string; matterId: string };
  /** The assistant message = the work product under review. */
  message: { id: string; content: string | null };
  onClose: () => void;
}

// Selectable reviewer models. Claude is DELIBERATELY absent — it is the primary dispositioner, and the
// server rejects it (SELF_REVIEW_EXCLUDED). Never offer Claude as a selectable panel reviewer.
const REVIEWER_OPTIONS: ReadonlyArray<{ key: 'gpt' | 'gemini' | 'grok'; label: string }> = [
  { key: 'gpt', label: 'GPT' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'grok', label: 'Grok' },
];

const DISPOSITION_LABEL: Record<Disposition, string> = {
  adopt: 'ADOPT',
  reject: 'REJECT',
  modify_and_adopt: 'MODIFY-AND-ADOPT',
};
const DISPOSITION_CLASS: Record<Disposition, string> = {
  adopt: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  reject: 'border-rose-300 bg-rose-50 text-rose-800',
  modify_and_adopt: 'border-amber-300 bg-amber-50 text-amber-800',
};

type Step = 'pick' | 'confirm' | 'review';

export default function ChatReviewPanel({ conversation, message, onClose }: ChatReviewPanelProps): React.ReactElement {
  const utils = trpc.useUtils();
  const flagQuery = trpc.chatReviewPanel.isPanelEnabled.useQuery();

  const [step, setStep] = useState<Step>('pick');
  const [selected, setSelected] = useState<Record<'gpt' | 'gemini' | 'grok', boolean>>({ gpt: false, gemini: false, grok: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  // Per-item: open override editor + its draft reason text.
  const [overrideOpen, setOverrideOpen] = useState<Record<string, boolean>>({});
  const [overrideText, setOverrideText] = useState<Record<string, string>>({});
  // Per-reviewer raw-feedback expander.
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});

  const enabled = flagQuery.data?.enabled === true;

  const chosenKeys = REVIEWER_OPTIONS.filter((o) => selected[o.key]).map((o) => o.key);

  const handlePrepare = async (): Promise<void> => {
    if (pending || chosenKeys.length === 0 || !message.id) return;
    setPending(true);
    setError(null);
    try {
      const data = (await utils.client.chatReviewPanel.prepareReview.mutate({
        conversationId: conversation.id,
        matterId: conversation.matterId,
        messageId: message.id,
        reviewerModels: chosenKeys,
      })) as PrepareResult;
      setPrepared(data);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (pending || prepared === null) return;
    setPending(true);
    setError(null);
    try {
      const data = (await utils.client.chatReviewPanel.runReview.mutate({
        panelConfirmId: prepared.panelConfirmId,
        matterId: conversation.matterId,
      })) as RunResult;
      setRun(data);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const handleCancelConfirm = (): void => {
    setPrepared(null);
    setStep('pick');
    setError(null);
  };

  const applyDecision = async (item: ReviewItem, decision: 'accept' | 'override'): Promise<void> => {
    if (pending) return;
    const reason = overrideText[item.id]?.trim() ?? '';
    if (decision === 'override' && reason.length === 0) {
      setError('An override needs a brief reason.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = (await utils.client.chatReviewPanel.recordAttorneyDecision.mutate({
        itemId: item.id,
        matterId: conversation.matterId,
        decision,
        ...(decision === 'override' ? { overrideReason: reason } : {}),
      })) as { item: ReviewItem };
      setRun((prev) =>
        prev === null ? prev : { ...prev, items: prev.items.map((it) => (it.id === res.item.id ? res.item : it)) },
      );
      setOverrideOpen((m) => ({ ...m, [item.id]: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  // ── Render — ALL hooks above this point; only now may we branch/early-return. ──────────────────────
  if (!enabled) {
    // Defensive: the parent only mounts this when the flag is ON, but never render the panel if a late
    // flag read says OFF. (Not an error state — just nothing.)
    return <div data-testid="chat-review-panel-disabled" />;
  }

  const absentLanes = (run?.rawOutputs ?? []).filter((r) => r.laneStatus !== 'success' && r.laneStatus !== 'pending');

  return (
    <div data-testid="chat-review-panel" className="mt-2 rounded border border-line bg-surface-2 p-3 text-sm">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-ink-secondary" />
        <h3 className="text-sm font-medium text-ink">Panel review</h3>
        <button
          data-testid="chat-review-close"
          type="button"
          onClick={onClose}
          title="Close panel review"
          className="ml-auto flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-secondary hover:bg-surface"
        >
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>

      {/* Persistent ADVISORY banner — nothing here is applied to the work product. Always visible. */}
      <div
        data-testid="chat-review-advisory"
        className="mb-3 flex items-start gap-2 rounded border border-sky-300 bg-sky-50 px-2 py-1.5 text-xs text-sky-900"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          <strong>Advisory only — nothing here is applied to your work product.</strong> The primary
          (Claude) is judging critiques of its OWN prior work; you make the final call.
        </span>
      </div>

      {error !== null && <p data-testid="chat-review-error" className="mb-2 text-xs text-red-600">{error}</p>}

      {/* STEP 1 — reviewer-model picker. */}
      {step === 'pick' && (
        <div data-testid="chat-review-pick">
          <p className="mb-1 text-xs text-ink-hint">Choose the models to review this assistant message:</p>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {REVIEWER_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                <input
                  data-testid={`chat-review-pick-${o.key}`}
                  type="checkbox"
                  checked={selected[o.key]}
                  onChange={(e) => setSelected((s) => ({ ...s, [o.key]: e.target.checked }))}
                />
                {o.label}
              </label>
            ))}
            <span className="text-[11px] text-ink-hint">(Claude is the primary reviewer and cannot review itself.)</span>
          </div>
          <button
            data-testid="chat-review-prepare"
            type="button"
            onClick={() => void handlePrepare()}
            disabled={pending || chosenKeys.length === 0}
            className="rounded bg-accent px-3 py-1.5 text-xs text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? 'Preparing…' : 'Prepare panel review'}
          </button>
        </div>
      )}

      {/* STEP 2 — PANEL-CONFIRM: the POST-minimization / POST-hold transmitting reality + the exact reviewers. */}
      {step === 'confirm' && prepared !== null && (
        <div data-testid="chat-review-confirm">
          <p className="mb-1 text-xs text-ink">
            Confirm what will transmit to the panel. This reflects the <strong>post-minimization, post-hold</strong> reality —
            sensitive material is already withheld and held conversations are excluded.
          </p>
          <div className="mb-2 rounded border border-line bg-surface px-2 py-2 text-xs">
            <p className="mb-1 text-ink-secondary">
              Reviewers: <span className="font-medium text-ink">{prepared.reviewers.map((k) => k.toUpperCase()).join(', ')}</span>
            </p>
            <p className="mb-1 text-ink-secondary">Sources included in the bundle:</p>
            {prepared.transmitting.includedSources.length === 0 ? (
              <p data-testid="chat-review-no-sources" className="text-ink-hint">No matter sources included — only the work product transmits.</p>
            ) : (
              <ul data-testid="chat-review-sources" className="mb-1 space-y-0.5">
                {prepared.transmitting.includedSources.map((s) => (
                  <li key={s.sourceId} className="flex items-center gap-1 text-ink">
                    <span className="rounded bg-surface-2 px-1 py-0.5 text-[10px] uppercase text-ink-hint">{s.kind}</span>
                    <span className="truncate">{s.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-ink-hint">
              Withheld (NPI): {prepared.transmitting.npiWithheldCount} · Omitted: {prepared.transmitting.omittedCount}
              {prepared.transmitting.truncated ? ' · truncated' : ''} · Attachments: {prepared.transmitting.includedAttachmentCount}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="chat-review-confirm-send"
              type="button"
              onClick={() => void handleConfirm()}
              disabled={pending}
              className="rounded bg-accent px-3 py-1.5 text-xs text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Confirm & send to panel'}
            </button>
            <button
              data-testid="chat-review-cancel"
              type="button"
              onClick={handleCancelConfirm}
              disabled={pending}
              className="rounded border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — DISPOSITIONED-REVIEW view + DEGRADED states. */}
      {step === 'review' && run !== null && (
        <div data-testid="chat-review-results">
          {/* DEGRADED: zero reviewers available — NEVER an empty result that reads as agreement. */}
          {run.dispositionerStatus === 'skipped' && (
            <div data-testid="chat-review-skipped" className="mb-2 flex items-start gap-2 rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>No reviewers available — check configuration or try again. (This is not agreement — no panel ran.)</span>
            </div>
          )}

          {/* DEGRADED: dispositioner failed — suggestions are shown but NOT vetted by the primary. */}
          {run.dispositionerStatus === 'failed' && run.items.length > 0 && (
            <div data-testid="chat-review-failed" className="mb-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>The primary could not synthesize these critiques. Each suggestion below is shown <strong>Not yet synthesized</strong> — raw reviewer text, not vetted.</span>
            </div>
          )}

          {/* PARTIAL: surface absent reviewer lanes so it cannot be misread as "the panel agreed". */}
          {absentLanes.length > 0 && (
            <div data-testid="chat-review-absent" className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              Some reviewers did not return feedback:{' '}
              {absentLanes.map((l) => `${l.reviewerModel.toUpperCase()} (${l.laneStatus})`).join(', ')}. This is a partial panel, not a consensus.
            </div>
          )}

          {/* The itemized, dispositioned suggestions. */}
          {run.items.length === 0 ? (
            run.dispositionerStatus !== 'skipped' && (
              <p data-testid="chat-review-empty-items" className="text-xs text-ink-hint">No suggestions returned by the available reviewers.</p>
            )
          ) : (
            <ul data-testid="chat-review-items" className="space-y-2">
              {run.items.map((item) => (
                <li key={item.id} data-testid="chat-review-item" className="rounded border border-line bg-surface px-2 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium uppercase text-ink-secondary">{item.reviewerModel}</span>
                    {item.primaryDisposition !== null ? (
                      <span
                        data-testid="chat-review-disposition"
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${DISPOSITION_CLASS[item.primaryDisposition]}`}
                      >
                        {DISPOSITION_LABEL[item.primaryDisposition]}
                      </span>
                    ) : (
                      <span data-testid="chat-review-unsynthesized" className="rounded border border-ink-hint/40 bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-hint">
                        Not yet synthesized
                      </span>
                    )}
                    {item.citationStatus === 'in_bundle' && (
                      <span data-testid="chat-review-citation" title="The cited source was present in the bundle (grounding, not legal correctness)." className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-hint">
                        in bundle
                      </span>
                    )}
                    {item.citationStatus === 'unverified' && (
                      <span data-testid="chat-review-citation" title="A cited source could not be matched to the bundle — verify before relying on it. Flagged, not rejected." className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                        unverified against bundle — verify
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-ink">{item.suggestion}</p>
                  {item.primaryReasoning !== null && item.primaryReasoning.trim().length > 0 && (
                    <p data-testid="chat-review-reasoning" className="mt-1 whitespace-pre-wrap text-xs text-ink-secondary">
                      <span className="text-ink-hint">Primary reasoning: </span>
                      {item.primaryReasoning}
                    </p>
                  )}

                  {/* Per-item attorney decision — the final, manual call. Nothing auto-applies. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {item.attorneyDecision === 'pending' ? (
                      <>
                        <button
                          data-testid="chat-review-accept"
                          type="button"
                          onClick={() => void applyDecision(item, 'accept')}
                          disabled={pending}
                          className="rounded border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          data-testid="chat-review-override"
                          type="button"
                          onClick={() => setOverrideOpen((m) => ({ ...m, [item.id]: !m[item.id] }))}
                          disabled={pending}
                          className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
                        >
                          Override
                        </button>
                      </>
                    ) : (
                      <span data-testid="chat-review-decided" className="text-[11px] text-ink-secondary">
                        Your decision: <span className="font-medium text-ink">{item.attorneyDecision === 'accept' ? 'Accepted' : 'Overridden'}</span>
                        {item.attorneyOverrideReason ? ` — ${item.attorneyOverrideReason}` : ''}
                      </span>
                    )}
                  </div>
                  {item.attorneyDecision === 'pending' && overrideOpen[item.id] === true && (
                    <div data-testid="chat-review-override-form" className="mt-2 flex flex-col gap-1">
                      <textarea
                        data-testid="chat-review-override-reason"
                        value={overrideText[item.id] ?? ''}
                        onChange={(e) => setOverrideText((m) => ({ ...m, [item.id]: e.target.value }))}
                        rows={2}
                        placeholder="Why are you overriding this disposition?"
                        className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        data-testid="chat-review-override-submit"
                        type="button"
                        onClick={() => void applyDecision(item, 'override')}
                        disabled={pending}
                        className="self-start rounded bg-accent px-2 py-0.5 text-[11px] text-on-accent hover:bg-accent-hover disabled:opacity-50"
                      >
                        Save override
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* DRILL-DOWN — per-reviewer verbatim raw feedback + lane status. */}
          {(run.rawOutputs ?? []).length > 0 && (
            <div data-testid="chat-review-raw" className="mt-3 border-t border-line pt-2">
              <p className="mb-1 text-[11px] text-ink-hint">Raw reviewer feedback (verbatim):</p>
              <ul className="space-y-1">
                {run.rawOutputs.map((raw) => (
                  <li key={raw.id} className="text-xs">
                    <button
                      data-testid="chat-review-raw-toggle"
                      type="button"
                      onClick={() => setRawOpen((m) => ({ ...m, [raw.id]: !m[raw.id] }))}
                      className="flex items-center gap-1 text-ink-secondary hover:text-ink"
                    >
                      {rawOpen[raw.id] === true ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      <span className="font-medium uppercase">{raw.reviewerModel}</span>
                      <span className={`rounded px-1 py-0.5 text-[10px] ${raw.laneStatus === 'success' ? 'bg-surface-2 text-ink-hint' : 'bg-amber-50 text-amber-800'}`}>
                        {raw.laneStatus}
                      </span>
                    </button>
                    {rawOpen[raw.id] === true && (
                      <div data-testid="chat-review-raw-body" className="mt-1 rounded border border-line bg-surface px-2 py-1">
                        {raw.rawText != null && raw.rawText.trim().length > 0 ? (
                          <pre className="whitespace-pre-wrap break-words text-[11px] text-ink-secondary">{raw.rawText}</pre>
                        ) : (
                          <p className="text-[11px] text-ink-hint">
                            No output{raw.laneFailureReason ? ` — ${raw.laneFailureReason}` : ' returned for this reviewer.'}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-hint">
        Internal attorney work product — advisory only. Nothing on this panel is sent, filed, applied, or client-ready.
      </p>
    </div>
  );
}
