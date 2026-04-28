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
import { X, RefreshCw, CheckCircle, XCircle, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

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
  // MR-0G: single-reviewer gate. Multi-reviewer path is structurally broken (MR-0 D1-D5).
  // State holds at most one reviewer key (empty string = none selected).
  const [selectedReviewer, setSelectedReviewer] = useState<string>(() => enabledReviewers[0] ?? '');
  // Derive the array form expected by the API (always length 0 or 1).
  const selectedReviewers = selectedReviewer ? [selectedReviewer] : [];

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
// ============================================================
interface FeedbackCardProps {
  feedback: {
    id: string;
    reviewerRole: string;
    reviewerTitle: string;
    suggestions: Array<{ suggestionId: string; title: string; body: string; severity?: string }>;
  };
  sessionId: string;
  selections: Array<{ feedbackId: string; note: string | null }>;
  evaluation: Array<{ suggestionId: string; disposition: 'adopt' | 'reject' | 'neutral'; synthesisBody?: string }> | null;
  onRefresh: () => void;
}

function FeedbackCard({ feedback, sessionId, selections, evaluation, onRefresh }: FeedbackCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();

  const isSelected = selections.some((s) => s.feedbackId === feedback.id);

  const updateSelectionMutation = useGuardedMutation(
    (input: { sessionId: string; selections: Array<{ feedbackId: string; note: string | null }> }) =>
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

  const toggleSelection = (): void => {
    const currentSelections = selections.filter((s) => s.feedbackId !== feedback.id);
    const newSelections = isSelected
      ? currentSelections
      : [...currentSelections, { feedbackId: feedback.id, note: noteInputs[feedback.id] ?? null }];
    updateSelectionMutation.mutate({ sessionId, selections: newSelections });
  };

  return (
    <div className={clsx(
      'border rounded-lg overflow-hidden',
      isSelected ? 'border-firm-navy' : 'border-gray-200'
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
          <button
            onClick={() => regenerateSingleMutation.mutate({ sessionId, reviewerRole: feedback.reviewerRole })}
            disabled={regenerateSingleMutation.isPending}
            title="Regenerate this reviewer"
            className="p-1 text-gray-400 hover:text-firm-navy disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleSelection}
            disabled={updateSelectionMutation.isPending}
            className={clsx(
              'px-2 py-1 text-xs rounded transition-colors disabled:opacity-50',
              isSelected
                ? 'bg-firm-navy text-white'
                : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
            )}
          >
            {isSelected ? 'Selected' : 'Select'}
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-gray-400 hover:text-firm-navy">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Suggestions */}
      {expanded && feedback.suggestions.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {feedback.suggestions.map((suggestion) => {
            const evalDisposition = evaluation?.find((e) => e.suggestionId === suggestion.suggestionId);
            return (
              <div key={suggestion.suggestionId} className="px-4 py-3 bg-gray-50">
                <div className="flex items-start gap-2">
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Note input for selected feedback */}
      {isSelected && (
        <div className="px-4 py-2 bg-firm-navy/5 border-t border-firm-navy/10">
          <input
            type="text"
            value={noteInputs[feedback.id] ?? ''}
            onChange={(e) => setNoteInputs((prev) => ({ ...prev, [feedback.id]: e.target.value }))}
            placeholder="Optional note for this selection…"
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// ActiveSessionView — shown when a session exists
// ============================================================
interface ActiveSessionViewProps {
  sessionId: string;
  onClose: () => void;
}

function ActiveSessionView({ sessionId, onClose }: ActiveSessionViewProps): React.ReactElement {
  const utils = trpc.useUtils();
  const [editingInstructions, setEditingInstructions] = useState(false);

  const { data, isLoading, refetch } = trpc.reviewSession.get.useQuery({ sessionId }, {
    // S5 (MR-1): Poll every 3s while session is active and feedback is empty.
    // Once feedback arrives or session leaves 'active', stop polling.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      const isActive = d.session?.state === 'active';
      const hasFeedback = (d.feedback?.length ?? 0) > 0;
      return isActive && !hasFeedback ? 3000 : false;
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
            {session.selections.length} selected
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

      {/* Feedback list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {feedback.length === 0 ? (
          <div className="text-center py-8">
            {session.state === 'active' ? (
              <>
                <RefreshCw className="w-6 h-6 text-gray-300 mx-auto mb-2 animate-spin" />
                <p className="text-sm text-gray-400">Review in progress…</p>
                <p className="text-xs text-gray-300 mt-1">Checking for results every few seconds.</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">No feedback recorded for this session.</p>
            )}
          </div>
        ) : (
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
      </div>

      {/* Footer actions */}
      {session.state === 'active' && (
        <div className="px-4 py-3 border-t border-gray-200 flex gap-2">
          <button
            onClick={() => abandonMutation.mutate({ sessionId })}
            disabled={abandonMutation.isPending}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Abandon
          </button>
          <button
            onClick={() => regenerateMutation.mutate({ sessionId })}
            disabled={regenerateMutation.isPending || session.selections.length === 0}
            className="flex-1 px-3 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
          >
            {regenerateMutation.isPending ? 'Regenerating…' : `Regenerate (${session.selections.length} selected)`}
          </button>
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-end z-50">
      <div className="w-full max-w-lg h-full max-h-screen bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-firm-navy">
          <h2 className="text-white font-semibold text-sm">Review Session</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {sessionId ? (
            <ActiveSessionView sessionId={sessionId} onClose={onClose} />
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
