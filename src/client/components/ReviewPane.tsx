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
import { X, RefreshCw, CheckCircle, XCircle, Minus, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { deriveCompletionState } from '../utils/reviewState.js';

const REVIEWER_LABELS: Record<string, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
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

  // MR-0G: single-reviewer gate. Multi-reviewer path is structurally broken (MR-0 D1-D5).
  // State holds at most one reviewer key (empty string = none selected).
  // Initialise from derivedDefault once history data is available.
  const [selectedReviewer, setSelectedReviewer] = useState<string>('');
  // Sync selectedReviewer to derivedDefault when it resolves (once only).
  const defaultApplied = React.useRef(false);
  React.useEffect(() => {
    if (!defaultApplied.current && derivedDefault) {
      setSelectedReviewer(derivedDefault);
      defaultApplied.current = true;
    }
  }, [derivedDefault]);

  // Derive the array form expected by the API (always length 0 or 1).
  const selectedReviewers = selectedReviewer ? [selectedReviewer] : [];

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
        Select a reviewer for iteration {iterationNumber}. Only enabled reviewers are shown.
      </p>
      <div className="space-y-2">
        {enabledReviewerList.length === 0 ? (
          <p className="text-sm text-gray-400">No reviewers enabled. Enable reviewers in Settings.</p>
        ) : (
          enabledReviewerList.map((key) => (
            <label key={key} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="reviewer-selection"
                checked={selectedReviewer === key}
                onChange={() => setSelectedReviewer(key)}
                className="rounded"
              />
              <span className="text-sm text-gray-800">{REVIEWER_LABELS[key] ?? key}</span>
            </label>
          ))
        )}
      </div>
      {advisoryText && (
        <p className="text-xs text-gray-400 italic">{advisoryText}</p>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={createMutation.isPending || selectedReviewers.length === 0}
        className="w-full px-4 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
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
    suggestions: Array<{ suggestionId: string; title: string; body: string; severity?: string }>;
  };
  sessionId: string;
  // MR-4 P2: selections now keyed by suggestionId (canonical field after §3.3 normalization).
  selections: Array<{ suggestionId: string; note: string | null }>;
  evaluation: Array<{ suggestionId: string; disposition: 'adopt' | 'reject' | 'neutral'; synthesisBody?: string }> | null;
  onRefresh: () => void;
}

function FeedbackCard({ feedback, sessionId, selections, evaluation, onRefresh }: FeedbackCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  // MR-4 P2: per-suggestion note inputs keyed by suggestionId.
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();

  // MR-4 P2: Build a Set of selected suggestionIds for O(1) lookup.
  const selectedSuggestionIds = new Set(selections.map((s) => s.suggestionId));
  // Count how many of this card's suggestions are currently selected.
  const selectedCount = feedback.suggestions.filter((sg) => selectedSuggestionIds.has(sg.suggestionId)).length;

  const updateSelectionMutation = useGuardedMutation(
    (input: { sessionId: string; selections: Array<{ suggestionId: string; note: string | null }> }) =>
      utils.client.reviewSession.updateSelection.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        onRefresh();
      },
    }
  );

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

  // MR-4 P2: Toggle a single suggestion's selection state.
  // Latest-local-state merge: builds payload from server selections merged with
  // pending noteInputs state, so unsaved note edits are preserved on toggle.
  const toggleSuggestion = (suggestionId: string): void => {
    const isCurrentlySelected = selectedSuggestionIds.has(suggestionId);
    // Derive latest canonical selections: server selections + any pending local note edits.
    // This prevents the race where a note typed before a checkbox toggle is dropped.
    const latestSelections: Array<{ suggestionId: string; note: string | null }> = selections.map((sel) => ({
      suggestionId: sel.suggestionId,
      // Prefer local pending note input if present; fall back to server-confirmed note.
      note: noteInputs[sel.suggestionId] !== undefined ? (noteInputs[sel.suggestionId] || null) : sel.note,
    }));
    const newSelections = isCurrentlySelected
      ? latestSelections.filter((s) => s.suggestionId !== suggestionId)
      : [...latestSelections, { suggestionId, note: noteInputs[suggestionId] ?? null }];
    updateSelectionMutation.mutate({ sessionId, selections: newSelections });
  };

  // MR-4 P2: Update note for a single suggestion, preserving all other selections.
  const updateNote = (suggestionId: string, value: string): void => {
    setNoteInputs((prev) => ({ ...prev, [suggestionId]: value }));
    // Build payload from latest local state: all current selections with updated note.
    const latestSelections: Array<{ suggestionId: string; note: string | null }> = selections.map((sel) => ({
      suggestionId: sel.suggestionId,
      note: sel.suggestionId === suggestionId
        ? (value || null)
        : (noteInputs[sel.suggestionId] !== undefined ? (noteInputs[sel.suggestionId] || null) : sel.note),
    }));
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
                    <p className="text-xs text-gray-600 mt-0.5">{suggestion.body}</p>
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
// HistorySection — MR-2 §S2c
// Shows prior-iteration feedback rows grouped by iterationNumber.
// Rendered below the active-session feedback list.
// ============================================================
interface HistorySectionProps {
  documentId: string;
  currentIterationNumber: number;
}

function HistorySection({ documentId, currentIterationNumber }: HistorySectionProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  // MR-3 §S5: Capture query error state for non-fatal error display.
  const { data, isLoading, isError } = trpc.reviewSession.getDocumentHistory.useQuery({ documentId });
  // Filter out current iteration rows — those are shown in the active session view.
  // NOTE: Both useMemo calls are unconditional (above early returns) per Rules of Hooks.
  const priorRows = React.useMemo(() => {
    if (!data) return [];
    return data.feedback.filter((fb) => fb.iterationNumber < currentIterationNumber);
  }, [data, currentIterationNumber]);
  // Group by iterationNumber ascending (oldest first).
  // Computed unconditionally here so no hook is called after an early return.
  const grouped = React.useMemo(() => {
    const map = new Map<number, typeof priorRows>();
    for (const fb of priorRows) {
      const arr = map.get(fb.iterationNumber) ?? [];
      arr.push(fb);
      map.set(fb.iterationNumber, arr);
    }
    // Sort iteration keys ascending (oldest first).
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [priorRows]);
  // MR-3 §S5: Loading state — show a minimal indicator rather than returning null.
  if (isLoading) {
    return (
      <div className="border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-gray-400">Loading history…</p>
      </div>
    );
  }
  // MR-3 §S5: Error state — non-fatal; show a minimal error message.
  if (isError) {
    return (
      <div className="border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-red-400">History unavailable. Reload to retry.</p>
      </div>
    );
  }
  // MR-3 §S5: Empty state — no prior iterations; render nothing (accordion would be empty).
  if (priorRows.length === 0) return null;

  return (
    <div className="border-t border-gray-200 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500 hover:bg-gray-50"
      >
        <span>Prior Feedback ({priorRows.length} row{priorRows.length !== 1 ? 's' : ''} across {grouped.length} iteration{grouped.length !== 1 ? 's' : ''})</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {grouped.map(([iterNum, rows]) => (
            <div key={iterNum}>
              <p className="text-xs font-medium text-gray-400 mb-1">Iteration {iterNum}</p>
              <div className="space-y-2">
                {rows.map((fb) => (
                  <div key={fb.id} className="border border-gray-100 rounded p-2 bg-gray-50">
                    <p className="text-xs font-semibold text-gray-700">{fb.reviewerTitle}</p>
                    <p className="text-xs text-gray-500">{fb.suggestions.length} suggestion{fb.suggestions.length !== 1 ? 's' : ''}</p>
                    <ul className="mt-1 space-y-0.5">
                      {fb.suggestions.map((s) => (
                        <li key={s.suggestionId} className="text-xs text-gray-600">• {s.title}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
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
  iterationNumber: number;
  onClose: () => void;
}

function ActiveSessionView({ sessionId, documentId, iterationNumber, onClose }: ActiveSessionViewProps): React.ReactElement {
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

  const { data, isLoading, refetch } = trpc.reviewSession.get.useQuery({ sessionId }, {
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
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
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

  if (isLoading) {
    return <div className="p-6 text-center text-gray-400 text-sm">Loading review session…</div>;
  }

  if (!data) {
    return <div className="p-6 text-center text-red-600 text-sm">Session not found.</div>;
  }

  const { session, feedback, evaluation } = data;
  const evalDispositions = evaluation?.dispositions ?? null;

  // MR-3 §S1a: Derive completion state from feedback rows + job status.
  const jobs = jobsData?.jobs ?? [];
  const completionState = deriveCompletionState(feedback, jobs);

  // MR-4 P2: Count unique selected suggestionIds across all feedback cards.
  const totalSelected = session.selections.length;

  return (
    <div className="flex flex-col h-full">
      {/* Session info */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div>
          <span className="text-xs text-gray-500">Iteration {session.iterationNumber}</span>
          <span className={clsx(
            'ml-2 text-xs px-1.5 py-0.5 rounded',
            session.state === 'active' && 'bg-green-100 text-green-700',
            session.state === 'regenerated' && 'bg-blue-100 text-blue-700',
            session.state === 'abandoned' && 'bg-gray-100 text-gray-600',
          )}>
            {session.state}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {totalSelected} selected
          </span>
        </div>
      </div>

      {/* Global instructions */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-600">Global Instructions</span>
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
                className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {session.globalInstructions || <em>No global instructions</em>}
          </p>
        )}
      </div>

      {/* Feedback area — MR-3 §S1b: render based on derived completion state */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {completionState === 'pending_or_running' && (
          <div className="text-center py-8">
            <RefreshCw className="w-6 h-6 text-gray-300 mx-auto mb-2 animate-spin" />
            <p className="text-sm text-gray-400">Review in progress…</p>
            <p className="text-xs text-gray-300 mt-1">Checking for results every few seconds.</p>
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

      {/* History section — MR-2 §S2c */}
      <HistorySection documentId={documentId} currentIterationNumber={iterationNumber} />

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
              className="flex-1 px-3 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
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

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {sessionId ? (
            <ActiveSessionView sessionId={sessionId} documentId={documentId} iterationNumber={iterationNumber} onClose={onClose} />
          ) : (
            <CreateSessionView
              documentId={documentId}
              iterationNumber={iterationNumber}
              onCreated={(id) => setSessionId(id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
