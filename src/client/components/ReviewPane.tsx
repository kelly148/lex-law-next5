/**
 * ReviewPane — Lex Law Next v1
 *
 * Ch 30 — Review Pane
 *
 * Modal panel for managing AI review sessions.
 * Allows creating a review session, viewing reviewer feedback,
 * selecting suggestions, and regenerating with selected feedback.
 *
 * Procedures used:
 *   - reviewSession.create (mutation) — with selectedReviewers
 *   - reviewSession.get (query)
 *   - job.poll (query) — MR-3 §S2a: reviewer job status for FAILED state detection
 *   - reviewSession.updateSelection (mutation)
 *   - reviewSession.updateGlobalInstructions (mutation)
 *   - reviewSession.regenerate (mutation)
 *   - reviewSession.regenerateSingleReviewer (mutation)
 *   - reviewSession.abandon (mutation)
 *   - settings.get (query) — to know which reviewers are enabled
 *
 * IMPORTANT: Review cycle creation calls reviewSession.create with
 * selectedReviewers. document.requestReview does NOT exist.
 *
 * Ch 35.3 — No business logic in React.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState } from 'react';
import { X, RefreshCw, CheckCircle, XCircle, Minus, ChevronDown, ChevronUp, AlertCircle, Lock, Unlock } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { deriveCompletionState } from '../utils/reviewState.js';
import { stripEmbeddedCardsJson, splitSuggestedRevisionPaths } from '../utils/feedbackCardDisplay.js';
import OrchestrationConsolidationPanel from './OrchestrationConsolidationPanel.js';
import ProvisionProvenancePanel from './ProvisionProvenancePanel.js';
import LddDiffPanel from './LddDiffPanel.js';
import ExportSafetyPanel from './ExportSafetyPanel.js';
import PanelErrorBoundary from './PanelErrorBoundary.js';

const REVIEWER_LABELS: Record<string, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
  // MR-LLM-LITE-1: Lite reviewer labels
  claude_lite: 'Claude Lite',
  gpt_lite: 'GPT Lite',
  gemini_lite: 'Gemini Lite',
  grok_lite: 'Grok Lite',
};

// MR-LLM-LITE-1: Map from full reviewer key to its Lite counterpart.
const REVIEWER_LITE_KEY: Record<string, string> = {
  claude: 'claude_lite',
  gpt: 'gpt_lite',
  gemini: 'gemini_lite',
  grok: 'grok_lite',
};

interface ReviewPaneProps {
  documentId: string;
  iterationNumber: number;
  onClose: () => void;
}

// ============================================================
// CreateSessionView — shown when no active session exists
// ============================================================
interface CreateSessionViewProps {
  documentId: string;
  iterationNumber: number;
  onCreated: (sessionId: string) => void;
}

// Parse SESSION_ALREADY_EXISTS:<uuid>: ... error messages to extract the existing session ID.
function parseExistingSessionId(message: string): string | null {
  const match = /^SESSION_ALREADY_EXISTS:([0-9a-f-]{36}):/.exec(message);
  return match ? (match[1] ?? null) : null;
}

function CreateSessionView({ documentId, iterationNumber, onCreated }: CreateSessionViewProps): React.ReactElement {
  const { data: settings } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  // Derive enabled reviewers from settings; used as initial selection.
  // Component is remounted by parent when settings change via key prop.
  const enabledReviewers = React.useMemo(() => {
    if (!settings) return [];
    return Object.entries(settings.reviewerEnablement)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [settings]);

  // S3 (MR-2): Per-iteration reviewer default heuristic.
  // Fetch prior-iteration feedback to determine which reviewer was used last.
  const { data: historyData } = trpc.reviewSession.getDocumentHistory.useQuery({ documentId });

  // S3 Cases 1–4 per MR-2 §S3b (rotation heuristic):
  //   Case 1: Prior reviewer identified AND in enabledReviewers AND at least one other
  //           enabled reviewer exists → default to NEXT enabled reviewer (skip prior).
  //           Advisory: YES.
  //   Case 2: Prior reviewer identified BUT no longer in enabledReviewers → first enabled.
  //           Advisory: NO.
  //   Case 3: Prior reviewer identified AND is the ONLY enabled reviewer → that reviewer.
  //           Advisory: NO.
  //   Case 4: No prior reviewer identified (no prior iteration with feedback) → first enabled.
  //           Advisory: NO.
  //
  // Helper: find the most recent prior feedback row (highest iterationNumber < current).
  const mostRecentPriorRow = React.useMemo(() => {
    if (!historyData || historyData.feedback.length === 0) return null;
    const priorRows = historyData.feedback.filter((fb) => fb.iterationNumber < iterationNumber);
    if (priorRows.length === 0) return null;
    return priorRows.reduce((best, fb) =>
      fb.iterationNumber > best.iterationNumber ? fb : best
    );
  }, [historyData, iterationNumber]);

  const derivedDefault = React.useMemo((): string => {
    const fallback = enabledReviewers[0] ?? '';
    if (!mostRecentPriorRow) {
      // Case 4: no prior history.
      return fallback;
    }
    const priorRole = mostRecentPriorRow.reviewerRole;
    if (!enabledReviewers.includes(priorRole)) {
      // Case 2: prior reviewer no longer enabled.
      return fallback;
    }
    if (enabledReviewers.length === 1) {
      // Case 3: prior reviewer is the only enabled reviewer — repeat.
      return priorRole;
    }
    // Case 1: rotate — find the next enabled reviewer after the prior one.
    const idx = enabledReviewers.indexOf(priorRole);
    return enabledReviewers[(idx + 1) % enabledReviewers.length] ?? fallback;
  }, [enabledReviewers, mostRecentPriorRow]);

  // MR-CAL-5B: multi-reviewer is flag-gated (default OFF). When off, selection is
  // single (radio); when on, multiple reviewers may be selected (checkbox). The
  // server resolver remains the authoritative gate regardless of this client value.
  const multiReviewerEnabled = settings?.multiReviewerEnabled ?? false;
  // State holds the selected reviewer keys (length 0 or 1 while multi is off).
  // Initialise from derivedDefault once history data is available.
  const [selectedReviewerKeys, setSelectedReviewerKeys] = useState<string[]>([]);
  // Sync to derivedDefault when it resolves (once only).
  const defaultApplied = React.useRef(false);
  React.useEffect(() => {
    if (!defaultApplied.current && derivedDefault) {
      setSelectedReviewerKeys([derivedDefault]);
      defaultApplied.current = true;
    }
  }, [derivedDefault]);

  // Toggle a reviewer key, respecting the flag: single-select replaces the
  // selection; multi-select toggles membership.
  const toggleReviewer = React.useCallback(
    (key: string): void => {
      setSelectedReviewerKeys((prev) => {
        if (!multiReviewerEnabled) return [key];
        return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      });
    },
    [multiReviewerEnabled],
  );

  // Array form expected by the API.
  const selectedReviewers = selectedReviewerKeys;

  // Advisory text: Case 1 only — prior reviewer identified, rotation applied.
  // Shows prior reviewer label, suggested next reviewer label, and override invitation.
  const advisoryText = React.useMemo((): string | null => {
    if (!mostRecentPriorRow) return null;
    const priorRole = mostRecentPriorRow.reviewerRole;
    if (!enabledReviewers.includes(priorRole)) return null; // Case 2 — no advisory
    if (enabledReviewers.length === 1) return null; // Case 3 — no advisory
    // Case 1: rotation applied.
    const priorLabel = REVIEWER_LABELS[priorRole] ?? priorRole;
    const nextLabel = REVIEWER_LABELS[derivedDefault] ?? derivedDefault;
    return `Last reviewed by ${priorLabel}. Suggesting ${nextLabel} for fresh perspective. Override below.`;
  }, [mostRecentPriorRow, enabledReviewers, derivedDefault]);

  const createMutation = useGuardedMutation(
    (input: { documentId: string; iterationNumber: number; selectedReviewers: string[] }) =>
      utils.client.reviewSession.create.mutate(input),
    {
      onSuccess: (result) => {
        onCreated(result.sessionId);
      },
      onError: (err) => {
        // If an active session already exists, resume it instead of showing a dead-end error.
        const existingId = parseExistingSessionId(err.message);
        if (existingId) {
          onCreated(existingId);
          return;
        }
        setError(err.message);
      },
    }
  );

  const handleCreate = (): void => {
    if (selectedReviewers.length === 0) {
      setError('Select at least one reviewer.');
      return;
    }
    setError(null);
    createMutation.mutate({ documentId, iterationNumber, selectedReviewers });
  };

  const enabledReviewerList = settings
    ? Object.entries(settings.reviewerEnablement).filter(([, v]) => v).map(([k]) => k)
    : [];
  return (
    <div className="p-6 space-y-4">
      <p className="text-sm text-gray-600">
        {multiReviewerEnabled
          ? 'Select one or more reviewers for the next review. Only enabled reviewers are shown.'
          : 'Select a reviewer for the next review. Only enabled reviewers are shown.'}
      </p>
      <div className="space-y-2">
        {enabledReviewerList.length === 0 ? (
          <p className="text-sm text-gray-400">No reviewers enabled. Enable reviewers in Settings.</p>
        ) : (
          enabledReviewerList.flatMap((key) => {
            const liteKey = REVIEWER_LITE_KEY[key];
            const rows = [
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type={multiReviewerEnabled ? 'checkbox' : 'radio'}
                  name="reviewer-selection"
                  checked={selectedReviewerKeys.includes(key)}
                  onChange={() => toggleReviewer(key)}
                  className="rounded"
                />
                <span className="text-sm text-gray-800">{REVIEWER_LABELS[key] ?? key}</span>
              </label>,
            ];
            // MR-LLM-LITE-1: render Lite sub-option indented below each full reviewer.
            if (liteKey) {
              rows.push(
                <label key={liteKey} className="flex items-center gap-3 cursor-pointer pl-6">
                  <input
                    type={multiReviewerEnabled ? 'checkbox' : 'radio'}
                    name="reviewer-selection"
                    checked={selectedReviewerKeys.includes(liteKey)}
                    onChange={() => toggleReviewer(liteKey)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-500">{REVIEWER_LABELS[liteKey] ?? liteKey}</span>
                </label>
              );
            }
            return rows;
          })
        )}
      </div>
      {advisoryText && (
        <p className="text-xs text-gray-400 italic">{advisoryText}</p>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={createMutation.isPending || selectedReviewers.length === 0}
        className="w-full px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
      >
        {createMutation.isPending ? 'Creating Review Session…' : 'Start Review'}
      </button>
    </div>
  );
}

// ============================================================
// FeedbackCard — single reviewer's feedback
// MR-4 P2: per-suggestion selection model.
// ============================================================
interface FeedbackCardProps {
  feedback: {
    id: string;
    reviewerRole: string;
    reviewerTitle: string;
    reviewerModel: string;
    iterationNumber: number;
    suggestions: Array<{
      suggestionId: string;
      title: string;
      body: string;
      severity?: string;
      // MR-CAL-4B: display-only native feedback cards extracted server-side from
      // the embedded STRUCTURED_FEEDBACK_CARDS. Optional; legacy rendering when absent.
      nativeCards?: Array<{
        severity?: string;
        severity_subtype?: string | null;
        critique_type?: string;
        requires_attorney_decision?: boolean;
        audience_affected?: string[];
        suggested_revision?: string | null;
        issue?: string;
        recommendation?: string;
      }>;
    }>;
  };
  sessionId: string;
  // MR-4 P2: selections now keyed by suggestionId (canonical field after §3.3 normalization).
  selections: Array<{ suggestionId: string; note: string | null; adoptedText?: string }>;
  evaluation: Array<{ suggestionId: string; disposition: 'adopt' | 'reject' | 'neutral'; synthesisBody?: string }> | null;
  onRefresh: () => void;
  // MR-CAL-6B: documentId for locked-decision list invalidation; suggestionIds already
  // locked on this document (so the UI can show a "Locked" state and avoid duplicates).
  documentId: string;
  lockedSuggestionIds: Set<string>;
}

function FeedbackCard({ feedback, sessionId, selections, evaluation, onRefresh, documentId, lockedSuggestionIds }: FeedbackCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  // MR-4 P2: per-suggestion note inputs keyed by suggestionId.
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  // MR-CAL-7B: per-suggestion "edit before adopting" text keyed by suggestionId.
  // When present + different from the suggestion body, the adoption is recorded as
  // 'adopted_modified' in the adopt ledger; otherwise verbatim.
  const [adoptedTextInputs, setAdoptedTextInputs] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();

  // MR-4 P2: Build a Set of selected suggestionIds for O(1) lookup.
  const selectedSuggestionIds = new Set(selections.map((s) => s.suggestionId));
  // Count how many of this card's suggestions are currently selected.
  const selectedCount = feedback.suggestions.filter((sg) => selectedSuggestionIds.has(sg.suggestionId)).length;

  const updateSelectionMutation = useGuardedMutation(
    (input: { sessionId: string; selections: Array<{ suggestionId: string; note: string | null; adoptedText?: string }> }) =>
      utils.client.reviewSession.updateSelection.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        onRefresh();
      },
    }
  );

  // MR-CAL-7B: resolve the effective adopted text for a selection, preferring a
  // pending local edit, then the server-confirmed value. Returned only when set,
  // so verbatim adoptions stay { suggestionId, note } (backward-compatible).
  const effectiveAdoptedText = (
    suggestionId: string,
    serverVal: string | undefined,
  ): string | undefined => {
    const local = adoptedTextInputs[suggestionId];
    return local !== undefined ? local : serverVal;
  };

  const regenerateSingleMutation = useGuardedMutation(
    (input: { sessionId: string; reviewerRole: string }) =>
      utils.client.reviewSession.regenerateSingleReviewer.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        onRefresh();
      },
    }
  );

  // MR-CAL-6B: lock a decision from a suggestion (decline-&-lock or lock-on-adopt).
  const lockDecisionMutation = useGuardedMutation(
    (input: { sessionId: string; suggestionId: string; origin: 'declined' | 'adopted'; summary: string }) =>
      utils.client.reviewSession.lockDecision.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.listLockedDecisions.invalidate({ documentId });
        onRefresh();
      },
    }
  );

  const lockSuggestion = (suggestionId: string, title: string, origin: 'declined' | 'adopted'): void => {
    // Summary defaults to the suggestion title; the attorney can edit it later via the
    // Locked Decisions panel. (Phase A keeps the capture lightweight — title is the lock summary.)
    lockDecisionMutation.mutate({ sessionId, suggestionId, origin, summary: title });
  };

  // MR-4 P2: Toggle a single suggestion's selection state.
  // Latest-local-state merge: builds payload from server selections merged with
  // pending noteInputs state, so unsaved note edits are preserved on toggle.
  // MR-CAL-7B: build the canonical selection list from server state + pending local
  // note and adopted-text edits. Used by toggle/note/adopted-text handlers so no edit
  // is dropped on a concurrent change. adoptedText is included only when set.
  // This prevents the race where a note typed before a checkbox toggle is dropped.
  const buildLatestSelections = (): Array<{ suggestionId: string; note: string | null; adoptedText?: string }> =>
    selections.map((sel) => {
      const note = noteInputs[sel.suggestionId] !== undefined ? (noteInputs[sel.suggestionId] || null) : sel.note;
      const adoptedText = effectiveAdoptedText(sel.suggestionId, sel.adoptedText);
      return adoptedText !== undefined
        ? { suggestionId: sel.suggestionId, note, adoptedText }
        : { suggestionId: sel.suggestionId, note };
    });

  const toggleSuggestion = (suggestionId: string): void => {
    const isCurrentlySelected = selectedSuggestionIds.has(suggestionId);
    const latestSelections = buildLatestSelections();
    const adoptedText = adoptedTextInputs[suggestionId];
    const newSelections = isCurrentlySelected
      ? latestSelections.filter((s) => s.suggestionId !== suggestionId)
      : [...latestSelections, adoptedText !== undefined
          ? { suggestionId, note: noteInputs[suggestionId] ?? null, adoptedText }
          : { suggestionId, note: noteInputs[suggestionId] ?? null }];
    updateSelectionMutation.mutate({ sessionId, selections: newSelections });
  };

  // MR-4 P2: Update note for a single suggestion, preserving all other selections.
  const updateNote = (suggestionId: string, value: string): void => {
    setNoteInputs((prev) => ({ ...prev, [suggestionId]: value }));
    const latestSelections = buildLatestSelections().map((s) =>
      s.suggestionId === suggestionId ? { ...s, note: value || null } : s,
    );
    updateSelectionMutation.mutate({ sessionId, selections: latestSelections });
  };

  // MR-CAL-7B: update the adopted (edited) text for a selected suggestion.
  const updateAdoptedText = (suggestionId: string, value: string): void => {
    setAdoptedTextInputs((prev) => ({ ...prev, [suggestionId]: value }));
    const latestSelections = buildLatestSelections().map((s) =>
      s.suggestionId === suggestionId ? { ...s, adoptedText: value } : s,
    );
    updateSelectionMutation.mutate({ sessionId, selections: latestSelections });
  };

  return (
    <div className={clsx(
      'border rounded-lg overflow-hidden',
      selectedCount > 0 ? 'border-firm-navy' : 'border-gray-200'
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-firm-navy">{feedback.reviewerTitle}</span>
            <span className="text-xs text-gray-400">({feedback.reviewerRole})</span>
            <span className="text-xs text-gray-400">Iteration {feedback.iterationNumber}</span>
            <span className="text-xs text-gray-400">{feedback.reviewerModel}</span>
            <span className="text-xs text-gray-400">{feedback.suggestions.length} suggestion{feedback.suggestions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* MR-4 P2: count badge showing N / M selected for this card */}
          {feedback.suggestions.length > 0 && (
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded',
              selectedCount > 0
                ? 'bg-firm-navy text-white'
                : 'bg-gray-100 text-gray-500'
            )}>
              {selectedCount} / {feedback.suggestions.length} selected
            </span>
          )}
          <button
            onClick={() => regenerateSingleMutation.mutate({ sessionId, reviewerRole: feedback.reviewerRole })}
            disabled={regenerateSingleMutation.isPending}
            title="Regenerate this reviewer"
            className="p-1 text-gray-400 hover:text-firm-navy disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-gray-400 hover:text-firm-navy">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Suggestions — MR-4 P2: per-suggestion checkboxes and note inputs */}
      {expanded && feedback.suggestions.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {feedback.suggestions.map((suggestion) => {
            const evalDisposition = evaluation?.find((e) => e.suggestionId === suggestion.suggestionId);
            const isChecked = selectedSuggestionIds.has(suggestion.suggestionId);
            // LLN-FEEDBACK-CARD-UX-1: show only the clean narrative prose; the raw
            // STRUCTURED_FEEDBACK_CARDS JSON is stripped (structured fields render as
            // the itemized native card below).
            const narrativeMemo = stripEmbeddedCardsJson(suggestion.body);
            return (
              <div key={suggestion.suggestionId} className={clsx(
                'px-4 py-3',
                isChecked ? 'bg-firm-navy/5' : 'bg-gray-50'
              )}>
                <div className="flex items-start gap-2">
                  {/* MR-4 P2: per-suggestion checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSuggestion(suggestion.suggestionId)}
                    disabled={updateSelectionMutation.isPending}
                    className="mt-0.5 flex-shrink-0 cursor-pointer disabled:opacity-50"
                  />
                  {evalDisposition && (
                    <span className="flex-shrink-0 mt-0.5">
                      {evalDisposition.disposition === 'adopt' && <CheckCircle className="w-3.5 h-3.5 text-green-600" />}
                      {evalDisposition.disposition === 'reject' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      {evalDisposition.disposition === 'neutral' && <Minus className="w-3.5 h-3.5 text-gray-400" />}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800">{suggestion.title}</p>
                    {narrativeMemo && (
                      <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-line">{narrativeMemo}</p>
                    )}
                    {suggestion.severity && (
                      <span className={clsx(
                        'text-xs px-1 py-0.5 rounded mt-1 inline-block',
                        suggestion.severity === 'critical' && 'bg-red-100 text-red-700',
                        suggestion.severity === 'major' && 'bg-amber-100 text-amber-700',
                        suggestion.severity === 'minor' && 'bg-blue-100 text-blue-700',
                      )}>
                        {suggestion.severity}
                      </span>
                    )}
                    {/* MR-CAL-4B: native feedback-card fields, shown when present. */}
                    {suggestion.nativeCards && suggestion.nativeCards.length > 0 && (
                      <div className="mt-1.5 space-y-1.5">
                        {suggestion.nativeCards.map((card, idx) => (
                          <div key={idx} className="rounded border border-firm-navy/20 bg-firm-navy/5 px-2 py-1.5">
                            <div className="flex flex-wrap items-center gap-1">
                              {card.severity && (
                                <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-firm-navy text-white">
                                  {card.severity}{card.severity_subtype ? ` · ${card.severity_subtype}` : ''}
                                </span>
                              )}
                              {card.critique_type && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-700">{card.critique_type}</span>
                              )}
                              {card.requires_attorney_decision && (
                                <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-amber-200 text-amber-800">Attorney decision required</span>
                              )}
                              {card.audience_affected && card.audience_affected.length > 0 && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600">audience: {card.audience_affected.join(', ')}</span>
                              )}
                            </div>
                            {card.issue && (
                              <p className="text-[11px] text-gray-700 mt-1">
                                <span className="font-medium">Issue:</span> {card.issue}
                              </p>
                            )}
                            {card.recommendation && (
                              <p className="text-[11px] text-gray-700 mt-1">
                                <span className="font-medium">Recommendation:</span> {card.recommendation}
                              </p>
                            )}
                            {card.suggested_revision && (
                              <div className="text-[11px] text-gray-700 mt-1">
                                <span className="font-medium">Suggested revision:</span>
                                {splitSuggestedRevisionPaths(card.suggested_revision).length > 1 ? (
                                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                    {splitSuggestedRevisionPaths(card.suggested_revision).map((p, i) => (
                                      <li key={i}>{p}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="whitespace-pre-line"> {card.suggested_revision}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {evalDisposition?.synthesisBody && (
                      <p className="text-xs text-gray-500 italic mt-1">{evalDisposition.synthesisBody}</p>
                    )}
                    {/* MR-4 P2: per-suggestion note input, shown only when selected */}
                    {isChecked && (
                      <input
                        type="text"
                        value={noteInputs[suggestion.suggestionId] ?? (selections.find((s) => s.suggestionId === suggestion.suggestionId)?.note ?? '')}
                        onChange={(e) => updateNote(suggestion.suggestionId, e.target.value)}
                        placeholder="Optional note for this suggestion…"
                        className="mt-1.5 w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
                      />
                    )}
                    {/* MR-CAL-7B: optional "edit before adopting" — leave blank to adopt verbatim.
                        When edited, the adoption is recorded as 'modified' in the adopt ledger.
                        Note: adopted text is shared with the AI reviewers on later passes. */}
                    {isChecked && (
                      <textarea
                        value={adoptedTextInputs[suggestion.suggestionId] ?? (selections.find((s) => s.suggestionId === suggestion.suggestionId)?.adoptedText ?? '')}
                        onChange={(e) => updateAdoptedText(suggestion.suggestionId, e.target.value)}
                        placeholder="Optional: edit the adopted text (blank = adopt verbatim). Shared with reviewers on later passes."
                        rows={2}
                        className="mt-1.5 w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
                      />
                    )}
                    {/* MR-CAL-6B: lock controls — decline-&-lock or lock-on-adopt.
                        A lock tells future reviewers not to re-raise this absent a new fact. */}
                    {lockedSuggestionIds.has(suggestion.suggestionId) ? (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-firm-navy">
                        <Lock className="w-3 h-3" /> Locked — reviewers asked not to re-raise this (manage below)
                      </span>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          onClick={() => lockSuggestion(suggestion.suggestionId, suggestion.title, 'declined')}
                          disabled={lockDecisionMutation.isPending}
                          title="Record this as considered &amp; declined; reviewers should not re-raise it absent a new fact"
                          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
                        >
                          <Lock className="w-3 h-3" /> Decline &amp; lock
                        </button>
                        {isChecked && (
                          <button
                            onClick={() => lockSuggestion(suggestion.suggestionId, suggestion.title, 'adopted')}
                            disabled={lockDecisionMutation.isPending}
                            title="Remember this adopted decision; reviewers should not re-raise it absent a new fact"
                            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
                          >
                            <Lock className="w-3 h-3" /> Lock on adopt
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LockedDecisionsSection — MR-CAL-6B
// Per-document list of attorney-locked decisions with provenance + unlock/modify.
// ============================================================
interface LockedDecisionsSectionProps {
  documentId: string;
}

function LockedDecisionsSection({ documentId }: LockedDecisionsSectionProps): React.ReactElement | null {
  const utils = trpc.useUtils();
  const { data } = trpc.reviewSession.listLockedDecisions.useQuery({ documentId });
  const all = data?.lockedDecisions ?? [];
  const active = all.filter((d) => d.status === 'active');

  const unlockMutation = useGuardedMutation(
    (input: { lockedDecisionId: string }) =>
      utils.client.reviewSession.unlockDecision.mutate(input),
    { onSuccess: () => { void utils.reviewSession.listLockedDecisions.invalidate({ documentId }); } }
  );

  if (active.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="w-3.5 h-3.5 text-firm-navy" />
        <span className="text-xs font-semibold text-firm-navy">
          Locked decisions ({active.length}) — reviewers are asked not to re-raise these absent a new fact
        </span>
      </div>
      <div className="space-y-1.5">
        {active.map((d) => (
          <div key={d.id} className="flex items-start justify-between gap-2 rounded border border-gray-200 px-2 py-1.5">
            <div className="min-w-0">
              <p className="text-[11px] text-gray-800">{d.summary}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {d.origin === 'declined' ? 'Declined & locked' : 'Locked on adopt'}
                {d.sourceIterationNumber != null ? ` · from iteration ${d.sourceIterationNumber}` : ''}
              </p>
              {d.rationale && <p className="text-[10px] text-gray-500 mt-0.5 italic">{d.rationale}</p>}
            </div>
            <button
              onClick={() => unlockMutation.mutate({ lockedDecisionId: d.id })}
              disabled={unlockMutation.isPending}
              title="Unlock — reviewers may raise this topic again"
              className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
            >
              <Unlock className="w-3 h-3" /> Unlock
            </button>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Note: locked-decision text is shared with the AI reviewers. Avoid privileged side-notes here.
      </p>
    </div>
  );
}

// ============================================================
// AdoptLedgerSection — MR-CAL-7B
// Per-document cumulative adopt ledger: what was adopted (verbatim/modified),
// which version it targeted, and its status (active / unresolved / superseded /
// resolved). Survival status is ADVISORY (auto) and attorney-overridable.
// ============================================================
interface AdoptLedgerSectionProps {
  documentId: string;
}

const ADOPT_STATUS_LABELS: Record<string, string> = {
  active: 'Active (present)',
  unresolved: 'Adopted (pending regeneration)',
  superseded: 'Superseded (auto — verify)',
  resolved: 'Resolved',
};

function AdoptLedgerSection({ documentId }: AdoptLedgerSectionProps): React.ReactElement | null {
  const utils = trpc.useUtils();
  const { data } = trpc.reviewSession.listAdoptLedger.useQuery({ documentId });
  const entries = data?.adoptLedger ?? [];

  const statusMutation = useGuardedMutation(
    (input: { adoptLedgerId: string; status: 'active' | 'superseded' | 'resolved' | 'unresolved' }) =>
      utils.client.reviewSession.updateAdoptLedgerStatus.mutate(input),
    { onSuccess: () => { void utils.reviewSession.listAdoptLedger.invalidate({ documentId }); } }
  );

  if (entries.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle className="w-3.5 h-3.5 text-firm-navy" />
        <span className="text-xs font-semibold text-firm-navy">
          Adopted changes ({entries.length}) — carried into later reviews as intended state
        </span>
      </div>
      <div className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.id} className="rounded border border-gray-200 px-2 py-1.5">
            <p className="text-[11px] text-gray-800 whitespace-pre-line">{e.adoptedText}</p>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <p className="text-[10px] text-gray-400">
                {e.disposition === 'adopted_modified' ? 'Modified' : 'Verbatim'}
                {` · from iteration ${e.sourceIterationNumber}`}
                {` · ${ADOPT_STATUS_LABELS[e.status] ?? e.status}`}
                {e.statusSource === 'auto' ? ' · auto' : ' · attorney-set'}
              </p>
              <div className="flex-shrink-0 flex items-center gap-1">
                {e.status !== 'resolved' && (
                  <button
                    onClick={() => statusMutation.mutate({ adoptLedgerId: e.id, status: 'resolved' })}
                    disabled={statusMutation.isPending}
                    title="Mark resolved (handled/closed)"
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
                  >
                    Resolve
                  </button>
                )}
                {e.status === 'superseded' && (
                  <button
                    onClick={() => statusMutation.mutate({ adoptLedgerId: e.id, status: 'active' })}
                    disabled={statusMutation.isPending}
                    title="Override: this adopted change is still present"
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
                  >
                    Mark present
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        &quot;Superseded&quot; is an automatic best-effort guess (the drafter may paraphrase) — verify and
        override as needed. Adopted text is shared with the AI reviewers.
      </p>
    </div>
  );
}

// ============================================================
// SendabilitySection — MR-CAL-8B
// ADVISORY pre-send classifier verdict. On-demand (not auto-run): the attorney
// clicks "Check sendability". Advisory only — never blocks finalize/export.
// ============================================================
interface SendabilitySectionProps {
  documentId: string;
}

const SENDABILITY_CATEGORY_LABELS: Record<string, string> = {
  jurisdiction_mismatch: 'Jurisdiction mismatch',
  missing_material_terms: 'Missing material terms',
  unresolved_blanks: 'Unresolved blanks',
  missing_party_or_capacity: 'Missing party / capacity',
  conflicting_provisions: 'Conflicting provisions',
  business_decision_needed: 'Business decision needed',
  execution_signature_defect: 'Execution / signature defect',
  counterparty_over_disclosure: 'Counterparty over-disclosure',
  other: 'Other',
};

export function SendabilitySection({ documentId }: SendabilitySectionProps): React.ReactElement {
  // On-demand: enabled=false until the attorney triggers a check (avoids an Opus
  // call on every render). refetch() runs the classifier query.
  const { data, isFetching, refetch } = trpc.reviewSession.checkSendability.useQuery(
    { documentId },
    { enabled: false },
  );

  return (
    <div className="px-4 py-3 border-t border-gray-200">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-firm-navy">
          Sendability (advisory — does not block finalize)
        </span>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:text-firm-navy hover:border-firm-navy disabled:opacity-50"
        >
          {isFetching ? 'Checking…' : 'Check sendability'}
        </button>
      </div>

      {data && data.available === false && (
        <p className="text-[11px] text-gray-500 italic">
          Sendability check unavailable right now — proceed with attorney judgment.
        </p>
      )}

      {data && data.available === true && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            {data.verdict.sendable ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="text-xs font-medium text-gray-800">
              {data.verdict.sendable ? 'No blockers detected' : 'Potential blockers — review before sending'}
            </span>
          </div>
          {data.verdict.blockers.length > 0 && (
            <div className="space-y-1">
              {data.verdict.blockers.map((b, i) => (
                <div key={i} className="rounded border border-gray-200 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={clsx(
                      'text-[10px] font-semibold px-1 py-0.5 rounded',
                      b.severity === 'BLOCKER' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700',
                    )}>
                      {b.severity}
                    </span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600">
                      {SENDABILITY_CATEGORY_LABELS[b.category] ?? b.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-700 mt-0.5">{b.summary}</p>
                </div>
              ))}
            </div>
          )}
          {data.verdict.notes && (
            <p className="text-[10px] text-gray-500 italic">{data.verdict.notes}</p>
          )}
          <p className="text-[10px] text-gray-400">
            Advisory only — you decide. This does not block finalize/export. Document text is shared with the AI.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// HistorySection — MR-CAL-3C sequential comparison/provenance view
// Shows prior-iteration feedback grouped by iteration and reviewer/session.
// Historical rows are read-only; active-session selection controls remain above.
// ============================================================
interface HistorySectionProps {
  documentId: string;
  currentIterationNumber: number;
}

function formatReviewerLabel(role: string, title: string): string {
  const label = REVIEWER_LABELS[role] ?? role;
  return title && title !== role ? `${title} (${label})` : label;
}

function HistorySection({ documentId, currentIterationNumber }: HistorySectionProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  // MR-CAL-3C: read-only comparison query; current session feedback remains rendered above.
  const { data, isLoading, isError } = trpc.reviewSession.getDocumentHistory.useQuery({ documentId });

  const priorRows = React.useMemo(() => {
    if (!data) return [];
    return data.feedback.filter((fb) => fb.iterationNumber < currentIterationNumber);
  }, [data, currentIterationNumber]);

  const sessionById = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>['sessions'][number]>();
    for (const session of data?.sessions ?? []) {
      map.set(session.id, session);
    }
    return map;
  }, [data]);

  const selectionBySessionAndSuggestion = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>['selections'][number]>();
    for (const selection of data?.selections ?? []) {
      map.set(`${selection.reviewSessionId}:${selection.suggestionId}`, selection);
    }
    return map;
  }, [data]);

  const grouped = React.useMemo(() => {
    const map = new Map<number, typeof priorRows>();
    for (const fb of priorRows) {
      const arr = map.get(fb.iterationNumber) ?? [];
      arr.push(fb);
      map.set(fb.iterationNumber, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [priorRows]);

  const selectedCount = React.useMemo(() => {
    let count = 0;
    for (const fb of priorRows) {
      for (const suggestion of fb.suggestions) {
        if (fb.reviewSessionId && selectionBySessionAndSuggestion.has(`${fb.reviewSessionId}:${suggestion.suggestionId}`)) {
          count += 1;
        }
      }
    }
    return count;
  }, [priorRows, selectionBySessionAndSuggestion]);

  if (isLoading) {
    return (
      <div className="border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-gray-400">Loading history…</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-red-400">History unavailable. Reload to retry.</p>
      </div>
    );
  }
  if (priorRows.length === 0) return null;

  return (
    <div className="border-t border-gray-200 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500 hover:bg-gray-50"
      >
        <span>
          Prior Feedback ({priorRows.length} row{priorRows.length !== 1 ? 's' : ''} across {grouped.length} iteration{grouped.length !== 1 ? 's' : ''}) — Sequential Comparison ({selectedCount} selected suggestion{selectedCount !== 1 ? 's' : ''})
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-xs text-gray-400">
            Current session feedback and attorney selection controls are shown above. Prior reviewer feedback below is read-only provenance for comparison.
          </p>
          {grouped.map(([iterNum, rows]) => (
            <div key={iterNum} className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Prior iteration {iterNum}</p>
              {rows.map((fb) => {
                const session = fb.reviewSessionId ? sessionById.get(fb.reviewSessionId) : null;
                const sessionState = session?.state ?? 'historical';
                return (
                  <div key={fb.id} className="border border-gray-100 rounded p-3 bg-gray-50 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-700">{formatReviewerLabel(fb.reviewerRole, fb.reviewerTitle)}</p>
                        <p className="text-[10px] text-gray-400">Role: {fb.reviewerRole} • Model: {fb.reviewerModel}</p>
                        <p className="text-[10px] text-gray-400">Session: {fb.reviewSessionId ?? 'unattributed'} • Status: {sessionState}</p>
                      </div>
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide',
                        session?.state === 'regenerated' && 'bg-blue-100 text-blue-700',
                        session?.state === 'active' && 'bg-green-100 text-green-700',
                        !session && 'bg-gray-100 text-gray-500',
                      )}>
                        {session?.state === 'regenerated' ? 'regenerated' : 'prior'}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {fb.suggestions.map((s) => {
                        const selection = fb.reviewSessionId
                          ? selectionBySessionAndSuggestion.get(`${fb.reviewSessionId}:${s.suggestionId}`)
                          : undefined;
                        return (
                          <div key={s.suggestionId} className="border border-gray-100 rounded bg-white p-2">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-medium text-gray-700">{s.title}</p>
                              <span className={clsx(
                                'text-[10px] px-1.5 py-0.5 rounded',
                                selection ? 'bg-firm-navy text-white' : 'bg-gray-100 text-gray-500',
                              )}>
                                {selection ? 'selected' : 'not selected'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">{s.body}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-gray-400">
                              <span>Severity: {s.severity ?? 'unspecified'}</span>
                              <span>Suggestion ID: {s.suggestionId}</span>
                            </div>
                            {selection?.attorneyNote && (
                              <p className="text-xs text-gray-500 italic mt-1">Attorney note: {selection.attorneyNote}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CompletedWithoutFeedbackView — MR-3 §S3 / §S1b
// Shown when the reviewer job completed but returned zero suggestions.
// ============================================================
interface CompletedWithoutFeedbackViewProps {
  reviewerTitle: string;
  sessionId: string;
  onAbandon: () => void;
  abandonPending: boolean;
}
function CompletedWithoutFeedbackView({
  reviewerTitle,
  onAbandon,
  abandonPending,
}: CompletedWithoutFeedbackViewProps): React.ReactElement {
  return (
    <div className="text-center py-8 px-4 space-y-4">
      <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
      <div>
        <p className="text-sm font-medium text-gray-700">Review complete — no suggestions</p>
        <p className="text-xs text-gray-400 mt-1">
          {reviewerTitle} found no suggestions for this iteration.
        </p>
      </div>
      <div className="text-xs text-gray-500 space-y-1 text-left border border-gray-100 rounded p-3 bg-gray-50">
        <p className="font-medium text-gray-600">Paths forward:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Start the next review iteration via Regenerate.</li>
          <li>Try a different reviewer in a new session.</li>
          <li>Abandon this session if no further review is needed.</li>
        </ul>
      </div>
      <button
        onClick={onAbandon}
        disabled={abandonPending}
        className="px-4 py-2 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
      >
        {abandonPending ? 'Abandoning…' : 'Abandon session'}
      </button>
    </div>
  );
}

// ============================================================
// FailedReviewView — MR-3 §S2b / §S1b
// Shown when the reviewer job reached a terminal failure status.
// No retry button (Option 1 locked per operator decision).
// ============================================================
interface FailedReviewViewProps {
  reviewerTitle: string;
  sessionId: string;
  errorMessage: string | null;
  onAbandon: () => void;
  abandonPending: boolean;
}
function FailedReviewView({
  reviewerTitle,
  errorMessage,
  onAbandon,
  abandonPending,
}: FailedReviewViewProps): React.ReactElement {
  return (
    <div className="text-center py-8 px-4 space-y-4">
      <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
      <div>
        <p className="text-sm font-medium text-gray-700">Reviewer failed to return feedback</p>
        <p className="text-xs text-gray-400 mt-1">
          {reviewerTitle} — this may be a temporary LLM provider error or timeout.
        </p>
        {errorMessage && errorMessage.trim() !== '' && (
          <p className="text-xs text-gray-500 mt-1 font-mono">{errorMessage}</p>
        )}
      </div>
      <div className="text-xs text-gray-500 text-left border border-red-100 rounded p-3 bg-red-50">
        <p>Abandon this session and start a new review session to try again.</p>
      </div>
      <button
        onClick={onAbandon}
        disabled={abandonPending}
        className="px-4 py-2 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
      >
        {abandonPending ? 'Abandoning…' : 'Abandon and start a new review session'}
      </button>
    </div>
  );
}

// ============================================================
// ActiveSessionView — shown when a session exists
// ============================================================
interface ActiveSessionViewProps {
  sessionId: string;
  documentId: string;
  onClose: () => void;
}

// Exported for the full-tree render test (the review pane that crashed with React #310). Internal
// to ReviewPane otherwise.
export function ActiveSessionView({ sessionId, documentId, onClose }: ActiveSessionViewProps): React.ReactElement {
  const utils = trpc.useUtils();
  const [editingInstructions, setEditingInstructions] = useState(false);
  // MR-4 P2: regenError state for SUGGESTION_NOT_RESOLVED and other regenerate errors.
  const [regenError, setRegenError] = useState<string | null>(null);

  // MR-3 §S2a: Poll reviewer_feedback jobs for this document to detect FAILED state.
  // job.poll returns all jobs for the document; we filter to reviewer_feedback client-side.
  // Enabled only when session is active (no feedback yet); disabled once feedback arrives
  // or the session leaves 'active' state (aligned with reviewSession.get polling below).
  const { data: jobsData } = trpc.job.poll.useQuery(
    { documentId, statuses: ['queued', 'running', 'failed', 'timed_out', 'cancelled'] },
    {
      // Poll jobs at the same cadence as reviewSession.get while pending.
      // Once completion state is resolved, polling stops via refetchInterval.
      refetchInterval: (query) => {
        const jobs = query.state.data?.jobs ?? [];
        const reviewerJobs = jobs.filter((j) => j.jobType === 'reviewer_feedback');
        const hasTerminal = reviewerJobs.some(
          (j) => j.status === 'failed' || j.status === 'timed_out' || j.status === 'cancelled',
        );
        // Stop polling jobs once a terminal state is reached.
        return hasTerminal ? false : 3000;
      },
    },
  );

  const { data, isLoading, isError, refetch } = trpc.reviewSession.get.useQuery({ sessionId }, {
    // S1c (MR-3): Poll only when state is PENDING_OR_RUNNING.
    // Aligned with deriveCompletionState — stop polling on any terminal state.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      const jobs = jobsData?.jobs ?? [];
      const completionState = deriveCompletionState(d.feedback ?? [], jobs);
      return completionState === 'pending_or_running' ? 3000 : false;
    },
  });

  // Derive globalInstructions from server data; local edit state is separate.
  const serverInstructions = data?.session.globalInstructions ?? '';
  const [globalInstructions, setGlobalInstructions] = useState(serverInstructions);

  const regenerateMutation = useGuardedMutation(
    (input: { sessionId: string }) => utils.client.reviewSession.regenerate.mutate(input),
    {
      // MR-REGENERATE-REFRESH-1: invalidate document.get and version.list so the
      // newly regenerated version appears in Version History without a hard refresh.
      // executeCanonicalMutation is synchronous — the new version is already in the
      // DB by the time this onSuccess fires. JobBanner polling cannot be relied upon
      // because the job is already terminal when the mutation returns.
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        void utils.document.get.invalidate({ documentId });
        void utils.version.list.invalidate({ documentId });
        onClose();
      },
      // MR-4 P2: SUGGESTION_NOT_RESOLVED safe error display.
      // Sentinel detection via startsWith — never leaks raw UUIDs to the user.
      onError: (err) => {
        if (err.message.startsWith('SUGGESTION_NOT_RESOLVED')) {
          setRegenError('One or more selected suggestions could not be found. Please refresh and try again.');
        } else {
          setRegenError(err.message);
        }
      },
    }
  );

  const abandonMutation = useGuardedMutation(
    (input: { sessionId: string }) => utils.client.reviewSession.abandon.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        onClose();
      },
    }
  );

  const updateInstructionsMutation = useGuardedMutation(
    (input: { sessionId: string; globalInstructions: string }) =>
      utils.client.reviewSession.updateGlobalInstructions.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        setEditingInstructions(false);
      },
    }
  );

  // MR-CAL-6B: active locked decisions for this document, used to mark already-locked
  // suggestions in the cards and to render the Locked Decisions panel.
  // HOISTED ABOVE the isLoading/!data early returns below: calling this useQuery AFTER those
  // returns was a conditional-hook violation — when isLoading flips true->false the hook count
  // changes and React throws #310 (it blanked the whole review view; FOLD-ORCH-1 incident). All
  // hooks MUST run before any early return.
  const { data: lockedData } = trpc.reviewSession.listLockedDecisions.useQuery({ documentId });

  // R2-2 Inc A: the honest N-of-M denominator is computed server-side and is reused here from the
  // orchestration consolidation (React Query dedupes it with the panel's identical query — one
  // fetch). Surfaced in the session strip so "how many reviewers actually returned" is visible
  // without opening a panel. HOISTED above the early returns with the other hooks (stable order).
  const consolidationQuery = trpc.orchestration.getConsolidation.useQuery({ reviewSessionId: sessionId });

  // R2-2 Inc B: durable divergent open-items (origin='orchestration') for THIS document, read from
  // the PERSISTENT store via matterState.dashboard (the same query MatterStateDashboard uses) — so
  // recorded reviewer disagreements stay visible regardless of session / regenerate / close (they
  // never vanish). matterId comes from document.get; the dashboard query waits for it. Hoisted with
  // the other hooks (stable order, #310 discipline).
  const { data: docData } = trpc.document.get.useQuery({ documentId });
  const matterId = docData?.matterId ?? null;
  const dashboardQuery = trpc.matterState.dashboard.useQuery(
    { matterId: matterId ?? '', documentId },
    { enabled: matterId !== null },
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-ink-secondary">
        Loading review session…
      </div>
    );
  }

  // R2-1 survivability: distinguish a load FAILURE (retryable) from a session that is genuinely
  // GONE. Both name what is still intact so the attorney is never left with a blank or a bare
  // "not found". State transitions / acknowledgment mechanics are untouched (display only).
  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm font-medium text-ink">
          The review session could not be loaded — this may be a temporary connection issue.
        </p>
        <p className="text-sm text-ink-secondary mt-2 max-w-sm">
          Your draft and matter record are intact.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => void refetch()}
            className="px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface"
          >
            Try again
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm font-medium text-ink">
          This review session is no longer available — it may have been completed or abandoned.
        </p>
        <p className="text-sm text-ink-secondary mt-2 max-w-sm">
          Your draft and matter record are intact.
        </p>
        <button
          onClick={onClose}
          className="mt-5 px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface"
        >
          Close
        </button>
      </div>
    );
  }

  const { session, feedback, evaluation } = data;
  const evalDispositions = evaluation?.dispositions ?? null;

  const lockedSuggestionIds = new Set(
    (lockedData?.lockedDecisions ?? [])
      .filter((d) => d.status === 'active' && d.sourceSuggestionId)
      .map((d) => d.sourceSuggestionId as string),
  );

  // MR-3 §S1a: Derive completion state from feedback rows + job status.
  const jobs = jobsData?.jobs ?? [];
  const completionState = deriveCompletionState(feedback, jobs);

  // MR-4 P2: Count unique selected suggestionIds across all feedback cards.
  const totalSelected = session.selections.length;

  // R2-2 Inc A: denominator (only meaningful once the run is complete) + review-basis timestamp.
  const denominator = consolidationQuery.data?.denominator;
  const convergenceFloorMet = consolidationQuery.data?.convergenceFloorMet ?? true;
  // Show the denominator once reviewers have returned (feedback rows exist). Gated on feedback
  // presence rather than the completionState completed-with-feedback literal, so this does not
  // introduce an earlier copy of the marker that the source-scan tests slice the render block on.
  const showDenominator = denominator !== undefined && feedback.length > 0;
  const reviewedAt = ((): string | null => {
    const raw = session.createdAt as unknown;
    if (raw === null || raw === undefined) return null;
    const d = new Date(raw as string | number | Date);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  })();

  // R2-2 Inc B: the DURABLE divergent disagreements for this document — recorded open items, not
  // the ephemeral per-session consolidation. These are shown persistently (below) so they cannot
  // vanish on regenerate / session-close / locked-decision overlap.
  const persistentDivergent = (dashboardQuery.data?.full.openItems ?? []).filter(
    (i) => i.origin === 'orchestration' && i.status === 'open' && i.documentId === documentId,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Session-info strip — R2-2 Inc A: rethemed, with the honest N-of-M denominator and a
          "review basis" line (the anti-stale-review safeguard: WHICH draft this review judged
          and WHEN). Detail lives here; the matter-state header (R2 #3) carries only a rolled-up
          review-status chip, so the two never duplicate. */}
      <div className="px-4 py-3 bg-surface-2 border-b border-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-secondary">Iteration {session.iterationNumber}</span>
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded',
              session.state === 'active' && 'bg-success-tint text-success',
              session.state === 'regenerated' && 'bg-accent-tint text-accent',
              session.state === 'abandoned' && 'bg-surface text-ink-hint',
            )}>
              {session.state}
            </span>
          </div>
          <span className="text-xs text-ink-secondary">{totalSelected} selected</span>
        </div>

        {showDenominator && denominator && (
          <p className="mt-1.5 text-[11px] text-ink-secondary leading-snug">
            <span className="font-medium text-ink">{denominator.successful} of {denominator.intended}</span>{' '}
            configured reviewers returned substantive feedback
            {denominator.missing.length > 0 && (
              <> · no return: {denominator.missing.map((r) => REVIEWER_LABELS[r] ?? r).join(', ')}</>
            )}
            {!convergenceFloorMet && (
              <> · fewer than two returned, so nothing is treated as convergent</>
            )}.
          </p>
        )}

        {reviewedAt && (
          <p className="mt-0.5 text-[11px] text-ink-hint">
            Review basis: the draft at iteration {session.iterationNumber}, reviewed {reviewedAt}.
          </p>
        )}
      </div>

      {/* R2-2 Inc B — persistent reviewer disagreements. Read from the DURABLE open-items store
          (origin='orchestration'), so they show REGARDLESS of session/completion state and never
          vanish on regenerate / session-close. Read-only here; resolution lives on the matter page
          (one-click pointer). Boundary-wrapped so a render fault can't blank the review. */}
      {persistentDivergent.length > 0 && (
        <PanelErrorBoundary label="Unresolved disagreements">
          <div className="px-4 py-3 border-b border-line bg-warning-tint">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
              <h3 className="text-xs font-semibold text-ink">
                Unresolved reviewer disagreements ({persistentDivergent.length})
              </h3>
            </div>
            <p className="mt-1 text-[11px] text-ink-secondary">
              These persist until you resolve them — a later review pass never closes them.
            </p>
            <ul className="mt-2 space-y-2">
              {persistentDivergent.map((item) => {
                const detail = item.detail as
                  | { positions?: Array<{ reviewerRole: string; severity?: string | null; position: string }> }
                  | null
                  | undefined;
                const positions = detail?.positions ?? [];
                return (
                  <li key={item.id} className="rounded border border-line bg-surface p-2">
                    <p className="text-xs font-medium text-ink">{item.summary}</p>
                    {positions.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {positions.map((p, idx) => (
                          <li key={idx} className="text-[11px] text-ink-secondary">
                            <span className="font-medium">{REVIEWER_LABELS[p.reviewerRole] ?? p.reviewerRole}</span>
                            {p.severity ? ` [${p.severity}]` : ''}: {p.position}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {matterId && (
              <a
                href={`/matters/${matterId}`}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                Resolve on the matter page →
              </a>
            )}
          </div>
        </PanelErrorBoundary>
      )}

      {/* Global instructions */}
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-ink-secondary">Global Instructions</span>
          {!editingInstructions && (
            <button
              onClick={() => setEditingInstructions(true)}
              className="text-xs text-firm-navy hover:underline"
            >
              Edit
            </button>
          )}
        </div>
        {editingInstructions ? (
          <div className="space-y-2">
            <textarea
              value={globalInstructions}
              onChange={(e) => setGlobalInstructions(e.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy resize-none"
              placeholder="Global instructions for all reviewers…"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingInstructions(false)}
                className="px-2 py-1 text-xs text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => updateInstructionsMutation.mutate({ sessionId, globalInstructions })}
                disabled={updateInstructionsMutation.isPending}
                className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-secondary">
            {session.globalInstructions || <em className="text-ink-hint">No global instructions</em>}
          </p>
        )}
      </div>

      {/* Feedback area — MR-3 §S1b: render based on derived completion state */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {completionState === 'pending_or_running' && (
          // MR-UAT-PROGRESS-1: show reviewer-specific label when available.
          <div className="text-center py-8" aria-live="polite" aria-busy={true}>
            <RefreshCw className="w-6 h-6 text-ink-hint mx-auto mb-2 animate-spin" />
            <p className="text-sm text-ink-secondary">
              {session.selectedReviewers[0]
                ? `${REVIEWER_LABELS[session.selectedReviewers[0]] ?? session.selectedReviewers[0]} reviewer is analyzing…`
                : 'Review in progress…'}
            </p>
            <p className="text-xs text-ink-hint mt-1">Checking for results every few seconds.</p>
          </div>
        )}
        {completionState === 'completed_with_feedback' && (
          feedback.map((fb) => (
            <FeedbackCard
              key={fb.id}
              feedback={fb}
              sessionId={sessionId}
              selections={session.selections}
              evaluation={evalDispositions}
              onRefresh={() => void refetch()}
              documentId={documentId}
              lockedSuggestionIds={lockedSuggestionIds}
            />
          ))
        )}
        {completionState === 'completed_without_feedback' && (
          <CompletedWithoutFeedbackView
            reviewerTitle={feedback[0]?.reviewerTitle ?? session.selectedReviewers[0] ?? 'Reviewer'}
            sessionId={sessionId}
            onAbandon={() => abandonMutation.mutate({ sessionId })}
            abandonPending={abandonMutation.isPending}
          />
        )}
        {completionState === 'failed' && (
          <FailedReviewView
            reviewerTitle={
              jobs.find((j) => j.jobType === 'reviewer_feedback')?.modelId ??
              session.selectedReviewers[0] ??
              'Reviewer'
            }
            sessionId={sessionId}
            errorMessage={
              jobs.find((j) => j.jobType === 'reviewer_feedback')?.errorMessage ?? null
            }
            onAbandon={() => abandonMutation.mutate({ sessionId })}
            abandonPending={abandonMutation.isPending}
          />
        )}
      </div>

      {/* FOLD-ORCH-1 Inc3c: multi-model orchestration consolidation (only meaningful with >1
          reviewer). Mounted UNCONDITIONALLY and gated inside via `visible` (stable hook order),
          and wrapped in an error boundary so a panel bug can never blank the review view. */}
      <PanelErrorBoundary label="Multi-model orchestration">
        <OrchestrationConsolidationPanel
          reviewSessionId={sessionId}
          visible={session.selectedReviewers.length > 1 && completionState === 'completed_with_feedback'}
        />
      </PanelErrorBoundary>

      {/* MR-CAL-6B: locked decisions for this document */}
      <LockedDecisionsSection documentId={documentId} />

      {/* MR-CAL-7B: cumulative adopt ledger for this document */}
      <AdoptLedgerSection documentId={documentId} />

      {/* MR-CAL-8B: advisory sendability checkpoint */}
      <SendabilitySection documentId={documentId} />

      {/* FOLD-DRAFT-1: provision provenance (record + surface where each section came from) */}
      <PanelErrorBoundary label="Provision provenance">
        <ProvisionProvenancePanel documentId={documentId} />
      </PanelErrorBoundary>

      {/* FOLD-DRAFT-1 / LDD: LOI-vs-draft key-term check (flag value drift; never edits the draft) */}
      <PanelErrorBoundary label="LOI-vs-draft check">
        <LddDiffPanel documentId={documentId} />
      </PanelErrorBoundary>

      {/* FOLD-SEND-1: export-safety / outbound-readiness gate (advisory/shadow in v1; recorded override) */}
      <PanelErrorBoundary label="Export safety">
        <ExportSafetyPanel documentId={documentId} />
      </PanelErrorBoundary>

      {/* History section — MR-2 §S2c */}
      <HistorySection documentId={documentId} currentIterationNumber={session.iterationNumber} />

      {/* Footer actions */}
      {session.state === 'active' && (
        <div className="px-4 py-3 border-t border-gray-200 flex flex-col gap-2">
          {/* MR-4 P2: regenError inline display — same pattern as CreateSessionView */}
          {regenError && <p className="text-red-600 text-sm">{regenError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => abandonMutation.mutate({ sessionId })}
              disabled={abandonMutation.isPending}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Abandon
            </button>
            <button
              onClick={() => {
                setRegenError(null);
                regenerateMutation.mutate({ sessionId });
              }}
              disabled={regenerateMutation.isPending || totalSelected === 0}
              className="flex-1 px-3 py-2 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
            >
              {regenerateMutation.isPending ? 'Regenerating…' : `Regenerate (${totalSelected} selected)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ReviewPane — main export
// ============================================================
export default function ReviewPane({ documentId, iterationNumber, onClose }: ReviewPaneProps): React.ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Option A (MR-UX-1 bug fix): auto-abandon the active session when the user
  // closes the pane via the X button without explicitly abandoning.
  // If no session exists yet (CreateSessionView), close immediately.
  // Ch 35.13: uses useGuardedMutation.
  const autoAbandonMutation = useGuardedMutation(
    (input: { sessionId: string }) => utils.client.reviewSession.abandon.mutate(input),
    {
      onSuccess: () => {
        onClose();
      },
      onError: () => {
        // If abandon fails (e.g. session already terminal), close anyway.
        onClose();
      },
    }
  );

  const handleClose = (): void => {
    if (sessionId && !autoAbandonMutation.isPending) {
      autoAbandonMutation.mutate({ sessionId });
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-end z-50">
      <div className="w-full max-w-lg h-full max-h-screen bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-firm-navy">
          <h2 className="text-white font-semibold text-sm">Review Session</h2>
          <button onClick={handleClose} disabled={autoAbandonMutation.isPending} className="text-white/70 hover:text-white disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content — wrapped in a pane-level error boundary (R2-1 survivability): a render throw
            in the view body degrades to a designed full-pane notice that names what is intact and
            offers a way out, instead of white-screening the whole review (the #310 failure mode). */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <PanelErrorBoundary variant="pane" label="Review session" onClose={handleClose}>
            {sessionId ? (
              <ActiveSessionView sessionId={sessionId} documentId={documentId} onClose={onClose} />
            ) : (
              <CreateSessionView
                documentId={documentId}
                iterationNumber={iterationNumber}
                onCreated={(id) => setSessionId(id)}
              />
            )}
          </PanelErrorBoundary>
        </div>
      </div>
    </div>
  );
}
