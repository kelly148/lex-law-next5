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
import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, CheckCircle, ChevronDown, ChevronUp, ChevronRight, AlertCircle, AlertTriangle, Lock, Unlock, Check, Info, Gavel, CircleDashed, History, GitCompare, ListChecks, Users, Settings, Clock, PanelLeftClose } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { deriveCompletionState } from '../utils/reviewState.js';
import { stripEmbeddedCardsJson, splitSuggestedRevisionPaths } from '../utils/feedbackCardDisplay.js';
import OrchestrationConsolidationPanel from './OrchestrationConsolidationPanel.js';
import ProvisionProvenancePanel from './ProvisionProvenancePanel.js';
import LddDiffPanel from './LddDiffPanel.js';
import VersionComparePanel from './VersionComparePanel.js';
import PanelErrorBoundary from './PanelErrorBoundary.js';
import DocumentReferencePane from './DocumentReferencePane.js';
import { AsyncLaneReviewView } from './AsyncLaneReviewView.js';
import ReviewToolOverlay from './ReviewToolOverlay.js';

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

// Parse SESSION_ALREADY_EXISTS:<uuid>: ... OR REVIEW_IN_PROGRESS:<uuid>: ... (TERMINAL-SESSION-SUPERSEDE-1)
// to extract the existing session ID, so a create blocked by a held OR a still-running review on the same
// draft RESUMES/opens that session instead of a dead-end error. (A TERMINAL session is auto-superseded
// server-side, so create just succeeds with a fresh session and never returns either of these.)
function parseExistingSessionId(message: string): string | null {
  const match = /^(?:SESSION_ALREADY_EXISTS|REVIEW_IN_PROGRESS):([0-9a-f-]{36}):/.exec(message);
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
  // REVIEW-SKIN-1: styling only — no change to reviewer-enablement logic, selection state, or
  // session creation. Calm hairline rows; ink (not blue) checkbox accent; the one oxblood primary
  // is "Start review (N)" with a live count, disabled at zero (the deliberate-act count echo).
  const reviewerCount = selectedReviewers.length;
  return (
    <div className="p-6 space-y-4" data-testid="reviewer-selection">
      <p className="text-sm text-ink-secondary">
        {multiReviewerEnabled
          ? 'Select one or more reviewers for the next review. Only enabled reviewers are shown.'
          : 'Select a reviewer for the next review. Only enabled reviewers are shown.'}
      </p>
      <div className="space-y-1.5">
        {enabledReviewerList.length === 0 ? (
          <p className="text-sm text-ink-secondary">No reviewers enabled. Enable reviewers in settings.</p>
        ) : (
          enabledReviewerList.flatMap((key) => {
            const liteKey = REVIEWER_LITE_KEY[key];
            const rows = [
              <label key={key} className="flex items-center gap-3 px-3 py-2 rounded border border-line hover:bg-surface cursor-pointer">
                <input
                  type={multiReviewerEnabled ? 'checkbox' : 'radio'}
                  name="reviewer-selection"
                  checked={selectedReviewerKeys.includes(key)}
                  onChange={() => toggleReviewer(key)}
                  className="rounded accent-ink"
                />
                <span className="text-sm text-ink">{REVIEWER_LABELS[key] ?? key}</span>
              </label>,
            ];
            // MR-LLM-LITE-1: render Lite sub-option indented below each full reviewer.
            if (liteKey) {
              rows.push(
                <label key={liteKey} className="flex items-center gap-3 px-3 py-2 ml-6 rounded border border-line hover:bg-surface cursor-pointer">
                  <input
                    type={multiReviewerEnabled ? 'checkbox' : 'radio'}
                    name="reviewer-selection"
                    checked={selectedReviewerKeys.includes(liteKey)}
                    onChange={() => toggleReviewer(liteKey)}
                    className="rounded accent-ink"
                  />
                  <span className="text-sm text-ink-secondary">{REVIEWER_LABELS[liteKey] ?? liteKey}</span>
                </label>
              );
            }
            return rows;
          })
        )}
      </div>
      {advisoryText && (
        <p className="text-xs text-ink-secondary italic">{advisoryText}</p>
      )}
      {error && <p className="text-danger text-sm">{error}</p>}
      <button
        onClick={handleCreate}
        disabled={createMutation.isPending || selectedReviewers.length === 0}
        className="w-full px-4 py-2 text-sm rounded font-medium bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50"
        data-testid="start-review"
      >
        {createMutation.isPending
          ? 'Creating Review Session…'
          : `Start review (${reviewerCount} reviewer${reviewerCount === 1 ? '' : 's'})`}
      </button>
    </div>
  );
}

// ============================================================
// SuggestionCard — REVIEW-UX-REDESIGN-1
// One card per suggestion (flattened from the per-reviewer feedback rows). Roomier layout —
// severity chip + serif title + muted metadata + Issue / Recommend / Revision rows with an
// oxblood-edged revision block — and the "Attorney decision required" signal kept prominent.
// THREE decision states: Accept into next draft / Decline (this iteration) / Decline & lock.
// No green anywhere: accepted reads as a check glyph + "Accepted for next draft" in oxblood ink.
// Accept (selections) and Decline & lock (locked_decisions) persist via the existing mutations;
// "Decline (this iteration)" is a within-session triage mark owned by the parent (non-permanent
// by design — it resets on reload; persisting it would need a schema migration, out of scope here).
// ============================================================
interface SuggestionForCard {
  suggestionId: string;
  title: string;
  body: string;
  severity?: string;
  // MR-CAL-4B: display-only native feedback cards extracted server-side from the embedded
  // STRUCTURED_FEEDBACK_CARDS. Optional; the narrative body renders when absent.
  nativeCards?: Array<{
    severity?: string;
    severity_subtype?: string | null;
    critique_type?: string;
    requires_attorney_decision?: boolean;
    audience_affected?: string[];
    suggested_revision?: string | null;
    issue?: string;
    recommendation?: string;
    // REVIEWER-LATENCY-1 Step 2b: jurisdiction / governing-law treatment (lean card).
    governing_law?: string | null;
  }>;
}

interface SuggestionCardProps {
  suggestion: SuggestionForCard;
  reviewerLabel: string;
  sessionId: string;
  documentId: string;
  // Canonical selection list (keyed by suggestionId). A suggestion is "accepted for next draft"
  // iff it appears here.
  selections: Array<{ suggestionId: string; note: string | null; adoptedText?: string }>;
  evalDisposition?: { disposition: 'adopt' | 'reject' | 'neutral'; synthesisBody?: string };
  locked: boolean;
  declined: boolean;
  onToggleDecline: (suggestionId: string) => void;
  onRefresh: () => void;
  // REVIEW-LOOP-UX-1 / R1: the latest RECORDED reject/defer disposition for this suggestion (from the
  // existing disposition audit stream), surfaced inline so the affordance reflects recorded state.
  recordedDisposition?: { action: 'reject' | 'defer'; rationale: string | null } | undefined;
  // REVIEW-LOOP-UX-1 / R1: whether this suggestion's adopted text is already in the cumulative
  // adopt ledger (committed by a prior regeneration). Surfaces the running ledger state inline.
  inLedger?: boolean;
}

// Severity chip palette — oxblood/neutral only (no green, no blue).
const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-danger-tint text-danger',
  major: 'bg-accent-tint text-accent',
  minor: 'bg-surface-2 text-ink-secondary',
};

function SuggestionCard({
  suggestion,
  reviewerLabel,
  sessionId,
  documentId,
  selections,
  evalDisposition,
  locked,
  declined,
  onToggleDecline,
  onRefresh,
  recordedDisposition,
  inLedger = false,
}: SuggestionCardProps): React.ReactElement {
  const utils = trpc.useUtils();
  const selection = selections.find((s) => s.suggestionId === suggestion.suggestionId);
  const accepted = selection !== undefined;
  // Local pending edits (null = "use the server value"). Only meaningful while accepted.
  const [noteInput, setNoteInput] = useState<string | null>(null);
  const [adoptedInput, setAdoptedInput] = useState<string | null>(null);

  const updateSelectionMutation = useGuardedMutation(
    (input: { sessionId: string; selections: Array<{ suggestionId: string; note: string | null; adoptedText?: string }> }) =>
      utils.client.reviewSession.updateSelection.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
        onRefresh();
      },
    },
  );

  // MR-CAL-6B: lock a decision (decline-&-lock). Tells future reviewers not to re-raise it.
  const lockDecisionMutation = useGuardedMutation(
    (input: { sessionId: string; suggestionId: string; origin: 'declined' | 'adopted'; summary: string }) =>
      utils.client.reviewSession.lockDecision.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.listLockedDecisions.invalidate({ documentId });
        onRefresh();
      },
    },
  );

  // REVIEW-LOOP-UX-1 / R1: record a reject/defer disposition on the EXISTING disposition audit
  // stream (recorded + auditable). Reuses reviewSession.dispositionSuggestion; the inline pane
  // re-reads listSuggestionDispositions on success so the recorded action reflects immediately.
  const dispositionMutation = useGuardedMutation(
    (input: { sessionId: string; suggestionId: string; action: 'reject' | 'defer'; rationale: string | null }) =>
      utils.client.reviewSession.dispositionSuggestion.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.listSuggestionDispositions.invalidate({ documentId });
        onRefresh();
      },
    },
  );

  // REVIEW-LOOP-UX-1 / R1: ADOPT is now an INSTANT, COMMITTED adopt-ledger write per click (it no
  // longer waits for regenerate to land the row). Reuses reviewSession.adoptSuggestion; on success we
  // invalidate listAdoptLedger so the inline "In adopt ledger" badge reflects IMMEDIATELY. The
  // selection-side state (the "Accepted for next draft" indicator) is still driven by updateSelection.
  const adoptSuggestionMutation = useGuardedMutation(
    (input: { sessionId: string; suggestionId: string; adoptedText?: string }) =>
      utils.client.reviewSession.adoptSuggestion.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.listAdoptLedger.invalidate({ documentId });
        onRefresh();
      },
    },
  );

  // Selections for every OTHER suggestion, verbatim (so a single-card change never drops them).
  const others = (): Array<{ suggestionId: string; note: string | null; adoptedText?: string }> =>
    selections
      .filter((s) => s.suggestionId !== suggestion.suggestionId)
      .map((s) =>
        s.adoptedText !== undefined
          ? { suggestionId: s.suggestionId, note: s.note, adoptedText: s.adoptedText }
          : { suggestionId: s.suggestionId, note: s.note },
      );

  // This suggestion's selection entry, carrying any pending local note/adopt edit.
  const thisSelection = (
    noteOverride?: string,
    adoptedOverride?: string,
  ): { suggestionId: string; note: string | null; adoptedText?: string } => {
    const rawNote = noteOverride !== undefined ? noteOverride : noteInput !== null ? noteInput : selection?.note ?? '';
    const note = rawNote ? rawNote : null;
    const adopted = adoptedOverride !== undefined ? adoptedOverride : adoptedInput !== null ? adoptedInput : selection?.adoptedText;
    return adopted !== undefined && adopted !== ''
      ? { suggestionId: suggestion.suggestionId, note, adoptedText: adopted }
      : { suggestionId: suggestion.suggestionId, note };
  };

  const acceptIntoNextDraft = (): void => {
    if (declined) onToggleDecline(suggestion.suggestionId);
    // Keep the selection list current (drives the "Accepted for next draft" UX + the regenerate input)…
    updateSelectionMutation.mutate({ sessionId, selections: [...others(), thisSelection()] });
    // …AND commit the adopt-ledger row instantly (REVIEW-LOOP-UX-1 R1): one click = one durable adopt.
    const pendingAdopted = adoptedInput !== null ? adoptedInput : selection?.adoptedText;
    adoptSuggestionMutation.mutate(
      pendingAdopted !== undefined && pendingAdopted !== ''
        ? { sessionId, suggestionId: suggestion.suggestionId, adoptedText: pendingAdopted }
        : { sessionId, suggestionId: suggestion.suggestionId },
    );
  };
  const removeAccept = (): void => {
    updateSelectionMutation.mutate({ sessionId, selections: others() });
  };
  const setNote = (v: string): void => {
    setNoteInput(v);
    updateSelectionMutation.mutate({ sessionId, selections: [...others(), thisSelection(v)] });
  };
  const setAdopted = (v: string): void => {
    setAdoptedInput(v);
    updateSelectionMutation.mutate({ sessionId, selections: [...others(), thisSelection(undefined, v)] });
  };
  const decline = (): void => {
    if (accepted) updateSelectionMutation.mutate({ sessionId, selections: others() });
    onToggleDecline(suggestion.suggestionId);
    // REVIEW-LOOP-UX-1 / R1: a decline is a REJECT — record it on the disposition audit stream so it
    // is auditable (the client-only mark above keeps the within-session UX; this makes it durable).
    dispositionMutation.mutate({ sessionId, suggestionId: suggestion.suggestionId, action: 'reject', rationale: null });
  };
  // REVIEW-LOOP-UX-1 / R1: DEFER — "decide later". Records a defer disposition (auditable) and marks
  // the card declined-this-iteration client-side (it is neither adopted nor a hard reject/lock).
  const defer = (): void => {
    if (accepted) updateSelectionMutation.mutate({ sessionId, selections: others() });
    if (!declined) onToggleDecline(suggestion.suggestionId);
    dispositionMutation.mutate({ sessionId, suggestionId: suggestion.suggestionId, action: 'defer', rationale: null });
  };
  const declineAndLock = (): void => {
    if (accepted) updateSelectionMutation.mutate({ sessionId, selections: others() });
    if (declined) onToggleDecline(suggestion.suggestionId);
    lockDecisionMutation.mutate({ sessionId, suggestionId: suggestion.suggestionId, origin: 'declined', summary: suggestion.title });
  };

  // Structured fields (native feedback card) drive the roomier layout; fall back to the narrative.
  const card0 = suggestion.nativeCards && suggestion.nativeCards.length > 0 ? suggestion.nativeCards[0] : undefined;
  const severity = (card0?.severity ?? suggestion.severity ?? '').toLowerCase();
  const severityLabel = severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : null;
  const requiresAttorney = card0?.requires_attorney_decision === true;
  const narrative = stripEmbeddedCardsJson(suggestion.body);
  const metaParts = [
    card0?.critique_type ?? null,
    card0?.audience_affected && card0.audience_affected.length > 0 ? `audience: ${card0.audience_affected.join(', ')}` : null,
    reviewerLabel ? `raised by ${reviewerLabel}` : null,
  ].filter((p): p is string => Boolean(p));

  // Locked suggestions render as a quiet, compact row (the decision is recorded; manage it in the
  // Locked decisions overlay).
  if (locked) {
    return (
      <div data-testid="suggestion-card" data-state="locked" className="rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-ink-hint flex-shrink-0" />
          <span className="font-serif text-sm text-ink">{suggestion.title}</span>
          <span className="ml-auto text-[11px] text-ink-hint">Declined &amp; locked</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-hint">Reviewers are asked not to re-raise this — manage it in Locked decisions.</p>
      </div>
    );
  }

  return (
    <div
      data-testid="suggestion-card"
      data-state={accepted ? 'accepted' : declined ? 'declined' : 'undecided'}
      className={clsx(
        'rounded-xl border bg-surface px-4 py-4',
        accepted ? 'border-line border-l-[3px] border-l-accent' : declined ? 'border-line opacity-75' : 'border-line',
      )}
    >
      {/* Chip row: severity + attorney-decision (highest-stakes signal) + accepted/declined status */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {/* UI-ATTORNEY-SWEEP-1 S6/G4: the always-escalate "Attorney decision required" pill folds
            into the severity/escalation chip — the Gavel marker + a title tooltip carry the
            (unchanged) escalate semantic at the right altitude for a single-attorney product. */}
        {(severityLabel || requiresAttorney) && (
          <span
            title={requiresAttorney ? 'Attorney decision required' : undefined}
            className={clsx(
              'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full',
              severityLabel ? (SEVERITY_CHIP[severity] ?? 'bg-surface-2 text-ink-secondary') : 'bg-accent-tint text-accent',
            )}
          >
            {requiresAttorney && <Gavel className="w-3 h-3" />}
            {severityLabel ?? 'Attorney decision'}
          </span>
        )}
        {accepted && (
          <span data-testid="accepted-indicator" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent">
            <Check className="w-4 h-4" /> Accepted for next draft
          </span>
        )}
        {!accepted && recordedDisposition && (
          <span
            data-testid="recorded-disposition"
            data-action={recordedDisposition.action}
            className="ml-auto inline-flex items-center gap-1 text-xs text-ink-hint"
          >
            {recordedDisposition.action === 'reject' ? 'Rejected — recorded' : 'Deferred — recorded'}
          </span>
        )}
        {!accepted && !recordedDisposition && declined && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-hint">Declined this round</span>
        )}
        {/* REVIEW-LOOP-UX-1 / R1: inline running adopt-ledger state — this suggestion's adopted text
            is already in the cumulative ledger (carried into later reviews as intended state). */}
        {inLedger && (
          <span data-testid="in-ledger-indicator" className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-tint text-accent">
            <CheckCircle className="w-3 h-3" /> In adopt ledger
          </span>
        )}
      </div>

      <h4 className="font-serif text-[17px] font-medium text-ink leading-snug">{suggestion.title}</h4>
      {metaParts.length > 0 && <p className="mt-0.5 text-[11px] text-ink-hint">{metaParts.join(' · ')}</p>}

      {/* Issue / Recommend / Revision — labeled rows; revision in an oxblood-edged block. */}
      <div className="mt-3 space-y-3">
        {card0?.issue ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-hint mb-0.5">Issue</div>
            <p className="text-[13px] text-ink-secondary leading-relaxed">{card0.issue}</p>
          </div>
        ) : narrative ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-hint mb-0.5">Issue</div>
            <p className="text-[13px] text-ink-secondary leading-relaxed whitespace-pre-line">{narrative}</p>
          </div>
        ) : null}
        {/* REVIEWER-LATENCY-1 Step 2b: surface governing-law treatment when present (lean card). */}
        {card0?.governing_law && card0.governing_law.trim().toLowerCase() !== 'n/a' && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-hint mb-0.5">Governing law</div>
            <p className="text-[13px] text-ink-secondary leading-relaxed">{card0.governing_law}</p>
          </div>
        )}
        {card0?.recommendation && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-hint mb-0.5">Recommend</div>
            <p className="text-[13px] text-ink-secondary leading-relaxed">{card0.recommendation}</p>
          </div>
        )}
        {card0?.suggested_revision && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-hint mb-0.5">Revision</div>
            <div className="font-serif text-[13px] text-ink leading-relaxed bg-accent-tint border-l-[3px] border-accent px-3 py-2 rounded-r">
              {splitSuggestedRevisionPaths(card0.suggested_revision).length > 1 ? (
                <ul className="list-disc pl-4 space-y-0.5">
                  {splitSuggestedRevisionPaths(card0.suggested_revision).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              ) : (
                <span className="whitespace-pre-line">{card0.suggested_revision}</span>
              )}
            </div>
          </div>
        )}
        {evalDisposition?.synthesisBody && (
          <p className="text-[12px] text-ink-hint italic">{evalDisposition.synthesisBody}</p>
        )}
      </div>

      {/* Decision controls — adopt / reject / defer (REVIEW-LOOP-UX-1 R1), plus decline-&-lock.
          ADOPT writes the running adopt ledger via the existing selection→regenerate path (the
          "Accepted for next draft" indicator + the In-adopt-ledger badge reflect it inline). REJECT
          and DEFER record an auditable disposition on the existing disposition audit stream. The
          attorney is the final decision-maker — these only record the decision. */}
      <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid="suggestion-disposition-controls">
        {accepted ? (
          <button
            onClick={removeAccept}
            disabled={updateSelectionMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg btn-secondary"
          >
            Undo accept
          </button>
        ) : (
          <button
            onClick={acceptIntoNextDraft}
            disabled={updateSelectionMutation.isPending || adoptSuggestionMutation.isPending}
            data-testid="accept-into-next-draft"
            title="Adopt: write this into the running adopt ledger and apply it on the next draft"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent-tint disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Accept into next draft
          </button>
        )}
        {declined ? (
          <button
            onClick={() => onToggleDecline(suggestion.suggestionId)}
            className="text-xs px-3 py-1.5 rounded-lg btn-secondary"
          >
            Undo decline
          </button>
        ) : (
          <button
            onClick={decline}
            disabled={updateSelectionMutation.isPending || dispositionMutation.isPending}
            data-testid="reject-suggestion"
            title="Reject this suggestion for this iteration (recorded on the matter audit record)"
            className="text-xs px-3 py-1.5 rounded-lg btn-secondary"
          >
            Decline
          </button>
        )}
        <button
          onClick={defer}
          disabled={dispositionMutation.isPending}
          data-testid="defer-suggestion"
          title="Defer this suggestion (decide later) — recorded on the matter audit record"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg btn-secondary"
        >
          <CircleDashed className="w-3.5 h-3.5" /> Defer
        </button>
        <button
          onClick={declineAndLock}
          disabled={lockDecisionMutation.isPending}
          title="Record this as considered & declined; reviewers are asked not to re-raise it absent a new fact"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg btn-secondary"
        >
          <Lock className="w-3.5 h-3.5" /> Decline &amp; lock
        </button>
      </div>

      {/* When accepted: optional attorney note + edit-before-adopting (verbatim if blank). */}
      {accepted && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={noteInput !== null ? noteInput : selection?.note ?? ''}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for this suggestion…"
            aria-label="Optional note for this suggestion"
            className="w-full border border-line rounded-lg px-2 py-1 text-xs bg-paper focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={adoptedInput !== null ? adoptedInput : selection?.adoptedText ?? ''}
            onChange={(e) => setAdopted(e.target.value)}
            placeholder="Optional: edit the adopted text (blank = adopt verbatim). Shared with reviewers on later passes."
            aria-label="Edit the adopted text"
            rows={2}
            className="w-full border border-line rounded-lg px-2 py-1 text-xs bg-paper focus:outline-none focus:ring-1 focus:ring-accent"
          />
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
            {/* ME-5 (LEAK-PARITY-SWEEP-1): this is an ADVISORY check, not a send-clearance. Per the
                product's no-green-as-safe convention, the "no blockers" state uses a NEUTRAL info icon
                (not a success-green check) and copy that names it as the advisory check's finding, so it
                never reads as affirmative authorization to send. */}
            {data.verdict.sendable ? (
              <Info className="w-3.5 h-3.5 text-gray-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="text-xs font-medium text-gray-800">
              {data.verdict.sendable ? 'No blockers detected by the advisory check' : 'Potential blockers — review before sending'}
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
                            {/* CR-3 (LEAK-PARITY-SWEEP-1): the history body is the legacy suggestion
                                body that carries the embedded STRUCTURED_FEEDBACK_CARDS JSON. Render only
                                the clean narrative — same sanitizer the live/async lanes use — so the raw
                                internal plumbing never leaks into the Prior-Feedback overlay. */}
                            <p className="text-xs text-gray-600 mt-0.5">{stripEmbeddedCardsJson(s.body)}</p>
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
// Shown when the reviewer completed but returned ZERO suggestions. REVIEW-UX-REDESIGN-1: NEUTRAL
// treatment — no success crown, no green. A reviewer returning nothing is NOT a clean-bill
// guarantee, so the copy says so plainly (resolving the no-return vs no-suggestions ambiguity:
// this is "ran and flagged nothing", distinct from the warning FailedReviewView for "no response").
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
      <CircleDashed className="w-8 h-8 text-ink-hint mx-auto" />
      <div>
        <p className="text-sm font-medium text-ink">No suggestions returned</p>
        <p className="text-xs text-ink-secondary mt-1">
          {reviewerTitle} completed this pass and flagged nothing. This is not a clean-bill guarantee — treat it with your own judgment.
        </p>
      </div>
      <div className="text-xs text-ink-secondary space-y-1 text-left border border-line rounded-lg p-3 bg-surface-2">
        <p className="font-medium text-ink-secondary">Paths forward:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Generate a revised draft to start the next iteration.</li>
          <li>Run a different reviewer in a new session.</li>
          <li>Close this session if no further review is needed.</li>
        </ul>
      </div>
      <button
        onClick={onAbandon}
        disabled={abandonPending}
        className="px-4 py-2 text-xs rounded-lg border border-accent text-accent hover:bg-accent-tint disabled:opacity-50"
      >
        {abandonPending ? 'Closing…' : 'Close review session'}
      </button>
    </div>
  );
}

// ============================================================
// FailedReviewView — MR-3 §S2b / §S1b
// Shown when the reviewer job reached a terminal failure (the reviewer did NOT respond).
// REVIEW-UX-REDESIGN-1: WARNING treatment (warning palette, AlertTriangle) — distinct from the
// neutral empty state. No retry button (Option 1 locked per operator decision).
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
      <AlertTriangle className="w-8 h-8 text-warning mx-auto" />
      <div>
        <p className="text-sm font-medium text-ink">The reviewer did not respond</p>
        <p className="text-xs text-ink-secondary mt-1">
          {reviewerTitle} — this is usually a temporary provider error or timeout, not a verdict on the draft.
        </p>
        {errorMessage && errorMessage.trim() !== '' && (
          <p className="text-xs text-ink-hint mt-1 font-mono">{errorMessage}</p>
        )}
      </div>
      <div className="text-xs text-ink-secondary text-left border border-line rounded-lg p-3 bg-warning-tint">
        <p>Close this session and start a new review session to try again.</p>
      </div>
      <button
        onClick={onAbandon}
        disabled={abandonPending}
        className="px-4 py-2 text-xs rounded-lg border border-accent text-accent hover:bg-accent-tint disabled:opacity-50"
      >
        {abandonPending ? 'Closing…' : 'Close and start a new review session'}
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
  // REVIEW-UX-REDESIGN-1: reviewer instructions are edited in an on-demand overlay (uncontrolled
  // textarea seeded from the server value via defaultValue + this ref — no stale local copy).
  const instructionsRef = React.useRef<HTMLTextAreaElement>(null);
  // MR-4 P2: regenError state for SUGGESTION_NOT_RESOLVED and other regenerate errors.
  const [regenError, setRegenError] = useState<string | null>(null);
  // REVIEW-LOOP-UX-1 R2: re-run ONE reviewer on the CURRENT draft (a flaky/failed/timed-out/held lane).
  // The mutation lives HERE (the parent); AsyncLaneReviewView surfaces the affordance + calls back, staying
  // display-only. The #328 live-refresh poll then shows the lane Queued->Running->Returned; rerunningRole
  // disables that lane's button until the mutation settles.
  const [rerunningRole, setRerunningRole] = useState<string | null>(null);
  const rerunReviewerMutation = useGuardedMutation(
    (input: { sessionId: string; reviewerRole: string }) =>
      utils.client.reviewSession.rerunReviewer.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
      },
      onSettled: () => {
        setRerunningRole(null);
      },
    },
  );
  // REVIEW-UX-REDESIGN-1: "Decline (this iteration)" is a within-session triage mark — non-permanent
  // by design (it resets on reload; persisting it would need a schema migration, out of scope here).
  // Accept (selections) and Decline & lock (locked_decisions) persist via their existing mutations.
  const [declinedThisIteration, setDeclinedThisIteration] = useState<Set<string>>(() => new Set());
  const toggleDecline = useCallback((suggestionId: string): void => {
    setDeclinedThisIteration((prev) => {
      const next = new Set(prev);
      if (next.has(suggestionId)) next.delete(suggestionId);
      else next.add(suggestionId);
      return next;
    });
  }, []);
  // Which on-demand reference-tool overlay is open (null = none). Reference tools are NOT docked —
  // they float over the pane with zero permanent width (disposition §G).
  const [activeOverlay, setActiveOverlay] = useState<
    null | 'instructions' | 'provenance' | 'ldd' | 'compare' | 'adopt' | 'history' | 'convergence' | 'locked'
  >(null);

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
      // ASYNC-LANE-LIVE-REFRESH-1: keep this failure-detection poll firing while the pane is open even
      // when the tab is blurred/backgrounded (react-query v5 gates interval refetches behind tab focus
      // unless refetchIntervalInBackground is set) — aligned with the reviewSession.get poll below.
      refetchIntervalInBackground: true,
    },
  );

  const { data, isLoading, isError, refetch } = trpc.reviewSession.get.useQuery({ sessionId }, {
    // S1c (MR-3): Poll only when state is PENDING_OR_RUNNING.
    // Aligned with deriveCompletionState — stop polling on any terminal state.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      // REVIEWER-ASYNC-DISPLAY-1 (C-3): on the async path the server-owned lane contract is the single
      // poll gate — poll until EVERY expected lane is terminal (condition 1), never stopping at the
      // first. Sync path (lanes === null) keeps the byte-for-byte deriveCompletionState gate below.
      if (d.lanes) {
        return d.lanes.allTerminal ? false : 3000;
      }
      const jobs = jobsData?.jobs ?? [];
      const completionState = deriveCompletionState(d.feedback ?? [], jobs);
      return completionState === 'pending_or_running' ? 3000 : false;
    },
    // ASYNC-LANE-LIVE-REFRESH-1: keep the 3s poll firing while the pane is OPEN even when the tab is
    // blurred/backgrounded. react-query v5 gates interval refetches behind focusManager.isFocused()
    // UNLESS refetchIntervalInBackground is set; combined with the global staleTime:30s an unfocused
    // async pane otherwise froze on the first 'Queued' snapshot until a manual reload even though the
    // lanes kept transitioning server-side. Bounded — refetchInterval returns false once allTerminal,
    // so polling self-terminates; the SYNC path (data.lanes===null) keeps its deriveCompletionState
    // gate and, being already complete when the pane loads, does not poll.
    refetchIntervalInBackground: true,
  });

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
        // REVIEWER-BANNER-CLEAR-1 (F4): drop any now-terminal reviewer_feedback job from the document
        // JobBanner the instant the session is abandoned, so the "reviewer feedback in progress…"
        // indicator does not linger (U6). Without F1's background poll this stale indicator could sit for
        // a full poll cycle; this clears it immediately on close.
        void utils.job.listForDocument.invalidate({ documentId });
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
        setActiveOverlay(null);
      },
    }
  );

  // REVIEW-UX-REDESIGN-1: bulk "Accept all" writes every (unlocked) suggestion into the selection
  // set in one call. ("Decline remaining" is client-only — it marks the undecided ones declined.)
  const bulkSelectionMutation = useGuardedMutation(
    (input: { sessionId: string; selections: Array<{ suggestionId: string; note: string | null; adoptedText?: string }> }) =>
      utils.client.reviewSession.updateSelection.mutate(input),
    {
      onSuccess: () => {
        void utils.reviewSession.get.invalidate({ sessionId });
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

  // REVIEW-LOOP-UX-1 / R1: the running adopt-ledger state (committed entries) + recorded reject/defer
  // dispositions for THIS document — both surfaced inline on each card. HOISTED above the early returns
  // with the other hooks (stable hook order, #310 discipline). Both reuse EXISTING read procedures
  // (listAdoptLedger, and the new disposition projection over the existing audit stream).
  const { data: adoptLedgerData } = trpc.reviewSession.listAdoptLedger.useQuery({ documentId });
  const { data: dispositionData } = trpc.reviewSession.listSuggestionDispositions.useQuery({ documentId });

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

  // REVIEWER-ASYNC-DISPLAY-1 (Component C, C-3) + ASYNC-LANE-DISPLAY-PARITY-1: when the server provides the
  // per-reviewer lane contract (async path only), render off it and STOP using deriveCompletionState — the
  // contract is the single source of truth for render + "keep polling?" (condition 1). When data.lanes is
  // null (sync / REVIEWER_ASYNC_ENABLED OFF), the BYTE-FOR-BYTE unchanged sync display below renders (GUARD).
  // The async early-return is now MOVED below the shared setup (it sits just before the sync return) so the
  // async branch can REUSE the same SuggestionCard list + regenerate footer — see `if (data.lanes)` there.
  // Both returns sit after every hook + the loading/error early returns, so hook order is preserved (no #310).

  const evalDispositions = evaluation?.dispositions ?? null;

  const lockedSuggestionIds = new Set(
    (lockedData?.lockedDecisions ?? [])
      .filter((d) => d.status === 'active' && d.sourceSuggestionId)
      .map((d) => d.sourceSuggestionId as string),
  );

  // REVIEW-LOOP-UX-1 / R1: which suggestionIds are already in the cumulative adopt ledger (any
  // non-resolved status) — surfaced inline as the "In adopt ledger" badge. Plain derived data, not a
  // hook, computed after every hook + the early returns (no #310 risk).
  const ledgeredSuggestionIds = new Set(
    (adoptLedgerData?.adoptLedger ?? [])
      .filter((e) => e.status !== 'resolved')
      .map((e) => e.sourceSuggestionId),
  );
  // The latest recorded reject/defer disposition per suggestion (dispositions arrive newest-first;
  // the first occurrence wins). Surfaced as the "Rejected/Deferred — recorded" indicator.
  const dispositionBySuggestion = new Map<string, { action: 'reject' | 'defer'; rationale: string | null }>();
  for (const d of dispositionData?.dispositions ?? []) {
    if (!dispositionBySuggestion.has(d.suggestionId)) {
      dispositionBySuggestion.set(d.suggestionId, { action: d.action, rationale: d.rationale });
    }
  }

  // MR-3 §S1a: Derive completion state from feedback rows + job status.
  const jobs = jobsData?.jobs ?? [];
  const completionState = deriveCompletionState(feedback, jobs);

  // MR-4 P2: Count unique selected suggestionIds across all feedback cards.
  const totalSelected = session.selections.length;

  // R2-2 Inc A: denominator (only meaningful once the run is complete) + review-basis timestamp.
  const denominator = consolidationQuery.data?.denominator;
  const convergenceFloorMet = consolidationQuery.data?.convergenceFloorMet ?? true;
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

  // ── REVIEW-UX-REDESIGN-1: derived view state (declarations only; every hook ran above) ──
  // Flatten the per-reviewer feedback rows into one list of suggestion cards (one card per
  // suggestion; reviewer attribution becomes card metadata).
  const suggestionItems = feedback.flatMap((fb) =>
    fb.suggestions.map((s) => ({
      key: `${fb.id}:${s.suggestionId}`,
      suggestion: s,
      reviewerLabel: REVIEWER_LABELS[fb.reviewerRole] ?? fb.reviewerRole,
    })),
  );
  const isAccepted = (id: string): boolean => session.selections.some((sel) => sel.suggestionId === id);
  const acceptedCount = totalSelected;
  const declinedCount = suggestionItems.filter(
    (it) => declinedThisIteration.has(it.suggestion.suggestionId) && !isAccepted(it.suggestion.suggestionId),
  ).length;
  const activeLockedCount = (lockedData?.lockedDecisions ?? []).filter((d) => d.status === 'active').length;
  const multiReviewer = session.selectedReviewers.length > 1;

  // Apply button: always enabled; at zero accepted it still starts a fresh iteration.
  const applyLabel = acceptedCount > 0
    ? `Apply ${acceptedCount} accepted edit${acceptedCount === 1 ? '' : 's'} → new draft`
    : 'Generate revised draft (new iteration)';

  // Humanized status line; the N-of-M convergence detail moves to a tooltip (no jargon inline).
  const respondedCount = denominator?.successful ?? feedback.length;
  const statusLine = ((): string => {
    if (completionState === 'pending_or_running') return 'Review in progress — checking for results…';
    if (completionState === 'failed') return 'The reviewer did not respond';
    if (completionState === 'completed_without_feedback') return 'No suggestions returned';
    const base = `${respondedCount} reviewer${respondedCount === 1 ? '' : 's'} responded`;
    return respondedCount < 2 ? `${base} — treat as preliminary` : base;
  })();
  const convergenceTooltip = ((): string => {
    const parts: string[] = [];
    if (denominator) parts.push(`${denominator.successful} of ${denominator.intended} configured reviewers returned substantive feedback.`);
    // REVIEWER-NO-RETURN-RELABEL-1: a reviewer that COMPLETED with zero suggestions is "no suggestions"
    // (matches its per-lane chip), NOT a non-return; only an errored/timed-out/cancelled reviewer reads
    // "No return". (denominator.missing = completedEmpty ∪ noReturn — never conflate the two here.)
    if (denominator && denominator.completedEmpty.length > 0) parts.push(`No suggestions: ${denominator.completedEmpty.map((r) => REVIEWER_LABELS[r] ?? r).join(', ')}.`);
    if (denominator && denominator.noReturn.length > 0) parts.push(`No return: ${denominator.noReturn.map((r) => REVIEWER_LABELS[r] ?? r).join(', ')}.`);
    if (!convergenceFloorMet) parts.push('Fewer than two reviewers returned, so nothing is treated as convergent.');
    if (reviewedAt) parts.push(`Review basis: the draft at iteration ${session.iterationNumber}, reviewed ${reviewedAt}.`);
    return parts.join(' ');
  })();

  const acceptAll = (): void => {
    const sels = suggestionItems
      .filter((it) => !lockedSuggestionIds.has(it.suggestion.suggestionId))
      .map((it) => {
        const existing = session.selections.find((s) => s.suggestionId === it.suggestion.suggestionId);
        return existing?.adoptedText !== undefined
          ? { suggestionId: it.suggestion.suggestionId, note: existing.note, adoptedText: existing.adoptedText }
          : { suggestionId: it.suggestion.suggestionId, note: existing?.note ?? null };
      });
    bulkSelectionMutation.mutate({ sessionId, selections: sels });
  };
  const declineRemaining = (): void => {
    setDeclinedThisIteration((prev) => {
      const next = new Set(prev);
      for (const it of suggestionItems) {
        const id = it.suggestion.suggestionId;
        if (!isAccepted(id) && !lockedSuggestionIds.has(id)) next.add(id);
      }
      return next;
    });
  };
  const closeOverlay = (): void => setActiveOverlay(null);

  // Reference-tool header icon buttons (open floating overlays — zero docked width, disposition §G).
  const toolButtons: Array<{ key: 'instructions' | 'provenance' | 'ldd' | 'compare' | 'adopt' | 'history' | 'convergence' | 'locked'; label: string; icon: React.ReactNode; show: boolean }> = [
    { key: 'instructions', label: 'Reviewer instructions', icon: <Settings className="w-4 h-4" />, show: true },
    { key: 'provenance', label: 'Provision provenance', icon: <History className="w-4 h-4" />, show: true },
    { key: 'ldd', label: 'LOI vs draft', icon: <GitCompare className="w-4 h-4" />, show: true },
    { key: 'compare', label: 'Version compare', icon: <GitCompare className="w-4 h-4" />, show: true },
    { key: 'adopt', label: 'Adopted changes', icon: <ListChecks className="w-4 h-4" />, show: true },
    { key: 'history', label: 'Prior feedback', icon: <Clock className="w-4 h-4" />, show: true },
    { key: 'convergence', label: 'Reviewer convergence', icon: <Users className="w-4 h-4" />, show: multiReviewer },
  ];

  // ── ASYNC-LANE-DISPLAY-PARITY-1: shared render pieces, reused by BOTH the sync return below AND the async
  //    branch — the per-suggestion workspace (clean SuggestionCard list + bulk actions + locked strip) and
  //    the apply/regenerate footer. Sharing them brings the async lane to parity WITHOUT forking the
  //    card/selection/regenerate logic; the sync render output is unchanged (reviewUxRedesign1.render.test.tsx
  //    is the byte-for-byte guard). These are plain closures (NOT hooks), defined after every hook, so the
  //    #310 hook-order invariant is unaffected. ──
  const renderSuggestionWorkspace = (): React.ReactNode => (
    <>
      {/* Bulk actions — useful at 5–8 suggestions. */}
      {suggestionItems.length >= 2 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] text-ink-hint">{suggestionItems.length} suggestions</span>
          <div className="flex items-center gap-2">
            <button
              onClick={acceptAll}
              disabled={bulkSelectionMutation.isPending}
              className="text-[11px] px-2 py-1 rounded-lg border border-accent text-accent hover:bg-accent-tint disabled:opacity-50"
            >
              Accept all
            </button>
            <button
              onClick={declineRemaining}
              className="text-[11px] px-2 py-1 rounded-lg border border-line text-ink-secondary hover:bg-surface-2"
            >
              Decline remaining
            </button>
          </div>
        </div>
      )}
      {suggestionItems.map((it) => {
        const ev = evalDispositions?.find((e) => e.suggestionId === it.suggestion.suggestionId);
        const recorded = dispositionBySuggestion.get(it.suggestion.suggestionId);
        return (
          <SuggestionCard
            key={it.key}
            suggestion={it.suggestion}
            reviewerLabel={multiReviewer ? it.reviewerLabel : ''}
            sessionId={sessionId}
            documentId={documentId}
            selections={session.selections}
            locked={lockedSuggestionIds.has(it.suggestion.suggestionId)}
            declined={declinedThisIteration.has(it.suggestion.suggestionId)}
            inLedger={ledgeredSuggestionIds.has(it.suggestion.suggestionId)}
            onToggleDecline={toggleDecline}
            onRefresh={() => void refetch()}
            {...(ev ? { evalDisposition: ev } : {})}
            {...(recorded ? { recordedDisposition: recorded } : {})}
          />
        );
      })}
      {/* Compact locked-decisions strip — opens the management overlay. */}
      {activeLockedCount > 0 && (
        <button
          onClick={() => setActiveOverlay('locked')}
          className="w-full flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left hover:bg-surface"
        >
          <Lock className="w-3.5 h-3.5 text-ink-hint flex-shrink-0" />
          <span className="text-xs text-ink">
            <span className="font-medium">Locked decisions ({activeLockedCount})</span>
          </span>
          <span className="ml-auto text-[11px] text-accent">View / unlock</span>
        </button>
      )}
    </>
  );

  const renderApplyFooter = (): React.ReactNode =>
    session.state === 'active' ? (
      <div className="px-4 py-3 border-t border-line bg-surface-2 flex flex-col gap-2 flex-shrink-0">
        {regenError && <p className="text-danger text-sm">{regenError}</p>}
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-secondary">{acceptedCount} accepted · {declinedCount} declined</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => abandonMutation.mutate({ sessionId })}
              disabled={abandonMutation.isPending}
              className="px-3 py-2 text-sm rounded-lg border border-accent text-accent hover:bg-accent-tint disabled:opacity-50"
            >
              Close session
            </button>
            <button
              onClick={() => {
                setRegenError(null);
                regenerateMutation.mutate({ sessionId });
              }}
              disabled={regenerateMutation.isPending}
              data-testid="apply-accepted"
              className="px-4 py-2 text-sm rounded-lg bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {regenerateMutation.isPending ? 'Generating…' : applyLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  // ── ASYNC-LANE-DISPLAY-PARITY-1: the async branch — the lane HEADER (honest N-of-M + per-lane status strip
  //    + incomplete/send-blocked banner, owned by AsyncLaneReviewView) ABOVE the SHARED SuggestionCard list
  //    + regenerate footer. Sits here (after the setup + every hook) so it reuses the same pieces as the sync
  //    return; the SYNC path (data.lanes null) falls through to the BYTE-FOR-BYTE unchanged return below
  //    (GUARD). The incomplete/send-blocked banner stays visible while the run is partial — the regenerate
  //    affordance never reads as "the run is complete" (the banner + honest N-of-M are the gate). ──
  if (data.lanes) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <AsyncLaneReviewView
          lanes={data.lanes}
          onRerun={(reviewerRole) => {
            setRerunningRole(reviewerRole);
            rerunReviewerMutation.mutate({ sessionId, reviewerRole });
          }}
          rerunPendingRole={rerunningRole}
        />
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="review-scroll-body">
          <div className="p-4 space-y-3">
            {renderSuggestionWorkspace()}
            {data.lanes.allTerminal && data.lanes.aggregate.returned > 0 && data.lanes.totalSuggestions === 0 && (
              <p className="text-sm text-ink-secondary" data-testid="async-lane-no-suggestions">
                No reviewer raised any suggestions.
              </p>
            )}
          </div>
          <div aria-hidden="true" className="h-20" />
        </div>
        {renderApplyFooter()}
        {/* The one overlay reachable from the async branch's controls (the locked-decisions strip). */}
        {activeOverlay === 'locked' && (
          <ReviewToolOverlay title="Locked decisions" onClose={closeOverlay}>
            <LockedDecisionsSection documentId={documentId} />
          </ReviewToolOverlay>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — humanized status line + on-demand reference-tool icons (REVIEW-UX-REDESIGN-1).
          The honest N-of-M denominator / convergence floor / review-basis detail is preserved, but
          moved off the jargon line into the (i) tooltip. */}
      <div className="px-4 py-3 bg-surface-2 border-b border-line flex items-start justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Review session · Iteration {session.iterationNumber}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
            <span className="truncate">{statusLine}</span>
            {convergenceTooltip && (
              <span title={convergenceTooltip} aria-label={convergenceTooltip} className="text-ink-hint cursor-help flex-shrink-0">
                <Info className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {toolButtons.filter((t) => t.show).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveOverlay(t.key)}
              aria-label={t.label}
              title={t.label}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-line text-ink-secondary hover:text-ink hover:bg-surface"
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* R2-2 Inc B — persistent reviewer disagreements. Read from the DURABLE open-items store
          (origin='orchestration'), so they show REGARDLESS of session/completion state and never
          vanish on regenerate / session-close. Read-only here; resolution lives on the matter page
          (one-click pointer). Boundary-wrapped so a render fault can't blank the review. */}
      {persistentDivergent.length > 0 && (
        <PanelErrorBoundary label="Unresolved disagreements">
          <div className="px-4 py-3 border-b border-line bg-warning-tint flex-shrink-0">
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

      {/* SINGLE scroll body — the feedback list + bulk bar + compact locked strip live in this one
          scrollable container; the header above and footer below are fixed. Mirrors the document
          pane (a single overflow-y-auto body), so an expanded list never pushes the apply strip past
          an unreachable fold. The reference tools are NOT here — they open as floating overlays. */}
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="review-scroll-body">
        <div className="p-4 space-y-3">
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

          {completionState === 'completed_with_feedback' && renderSuggestionWorkspace()}

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
        {/* Spacer so the last control clears the fixed footer when fully scrolled. */}
        <div aria-hidden="true" className="h-20" />
      </div>

      {/* Footer — fixed apply strip (shared with the async branch via renderApplyFooter). Apply = solid
          oxblood primary (always enabled; at zero accepted it starts a fresh iteration); Close session =
          oxblood outline (destructive-secondary). Keyboard order: Apply follows the card list. */}
      {renderApplyFooter()}

      {/* On-demand reference-tool overlays — float over the pane, zero docked width (disposition §G). */}
      {activeOverlay === 'instructions' && (
        <ReviewToolOverlay title="Reviewer instructions" onClose={closeOverlay}>
          <div className="p-4 space-y-2">
            <p className="text-xs text-ink-secondary">Instructions shared with every reviewer on this session.</p>
            <textarea
              ref={instructionsRef}
              defaultValue={session.globalInstructions || ''}
              rows={6}
              maxLength={4000}
              placeholder="Global instructions for all reviewers…"
              aria-label="Reviewer instructions"
              className="w-full border border-line rounded-lg px-2 py-1.5 text-xs bg-paper focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={closeOverlay} className="px-2 py-1 text-xs text-ink-secondary">Cancel</button>
              <button
                onClick={() => updateInstructionsMutation.mutate({ sessionId, globalInstructions: instructionsRef.current?.value ?? '' })}
                disabled={updateInstructionsMutation.isPending}
                className="px-3 py-1.5 text-xs rounded-lg border border-line text-ink hover:bg-surface disabled:opacity-50"
              >
                {updateInstructionsMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'provenance' && (
        <ReviewToolOverlay title="Provision provenance" onClose={closeOverlay}>
          <PanelErrorBoundary label="Provision provenance"><ProvisionProvenancePanel documentId={documentId} /></PanelErrorBoundary>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'ldd' && (
        <ReviewToolOverlay title="LOI vs draft" onClose={closeOverlay}>
          <PanelErrorBoundary label="LOI-vs-draft check"><LddDiffPanel documentId={documentId} /></PanelErrorBoundary>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'compare' && (
        <ReviewToolOverlay title="Version compare" onClose={closeOverlay}>
          <PanelErrorBoundary label="Version compare"><VersionComparePanel documentId={documentId} /></PanelErrorBoundary>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'adopt' && (
        <ReviewToolOverlay title="Adopted changes" onClose={closeOverlay}>
          <AdoptLedgerSection documentId={documentId} />
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'history' && (
        <ReviewToolOverlay title="Prior feedback" onClose={closeOverlay}>
          {/* ME-6 (LEAK-PARITY-SWEEP-1): wrap the Prior-Feedback overlay in PanelErrorBoundary like its
              sibling overlays (provenance, LOI-diff, convergence) so a render fault here is contained. */}
          <PanelErrorBoundary label="Prior feedback"><HistorySection documentId={documentId} currentIterationNumber={session.iterationNumber} /></PanelErrorBoundary>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'convergence' && (
        <ReviewToolOverlay title="Reviewer convergence" onClose={closeOverlay}>
          <PanelErrorBoundary label="Multi-model orchestration"><OrchestrationConsolidationPanel reviewSessionId={sessionId} visible={true} /></PanelErrorBoundary>
        </ReviewToolOverlay>
      )}
      {activeOverlay === 'locked' && (
        <ReviewToolOverlay title="Locked decisions" onClose={closeOverlay}>
          <LockedDecisionsSection documentId={documentId} />
        </ReviewToolOverlay>
      )}
    </div>
  );
}

// ============================================================
// REVIEW-UX-REDESIGN-1: resizable + two-level-collapsible document pane (disposition §G).
// State is workspace-local and persisted to localStorage; seeded via lazy useState initializers
// (NOT a setState-in-effect) so there is no first-paint flash and no react-hooks lint hit.
// ============================================================
// REVIEW-UX-REDESIGN-1-FIX: two states only (show ↔ hide). The intermediate "rail" read as redundant
// with "hide" to users, so it was removed in favor of a single, obvious toggle.
type DocCollapse = 'expanded' | 'hidden';
const DOC_COLLAPSE_KEY = 'lln.review.docCollapse';
const DOC_WIDTH_KEY = 'lln.review.docWidthPct';
const DOC_MIN_PX = 520; // readable minimum (~50-60 char line) — the narrow read-only strip is rejected.
const DOC_WIDTH_DEFAULT = 48; // REVIEW-UX-REDESIGN-1-FIX: document more prominent (was 40). New state only —
//                               an already-dragged width persists in localStorage and is not overridden.

function clampPct(pct: number): number {
  if (Number.isNaN(pct)) return DOC_WIDTH_DEFAULT;
  return Math.min(60, Math.max(25, Math.round(pct)));
}
function readDocCollapse(): DocCollapse {
  if (typeof window === 'undefined') return 'expanded';
  try {
    // Any stored value other than 'hidden' (incl. the retired 'rail') resolves to 'expanded'.
    return window.localStorage.getItem(DOC_COLLAPSE_KEY) === 'hidden' ? 'hidden' : 'expanded';
  } catch {
    return 'expanded';
  }
}
function readDocWidthPct(): number {
  if (typeof window === 'undefined') return DOC_WIDTH_DEFAULT;
  try {
    const v = window.localStorage.getItem(DOC_WIDTH_KEY);
    return v === null ? DOC_WIDTH_DEFAULT : clampPct(Number(v));
  } catch {
    return DOC_WIDTH_DEFAULT;
  }
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
        // REVIEWER-BANNER-CLEAR-1 (F4): clear the abandoned session's cache and drop any stale
        // reviewer_feedback job from the document JobBanner so the "reviewer feedback in progress…"
        // indicator does not linger after the pane closes via the X (U6).
        if (sessionId) void utils.reviewSession.get.invalidate({ sessionId });
        void utils.job.listForDocument.invalidate({ documentId });
        onClose();
      },
      onError: () => {
        // If abandon fails (e.g. session already terminal), close anyway — but still clear the stale
        // job indicator (REVIEWER-BANNER-CLEAR-1, F4).
        void utils.job.listForDocument.invalidate({ documentId });
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

  // ── RELAYOUT-3: responsive review workspace (split at desktop width, full-page below) ──
  // G6 (hard gate): the review subtree below REFLOWS, never REMOUNTS, across the breakpoint —
  // it sits at one stable, keyed slot; only the document-reference pane mounts/unmounts. All
  // hooks run unconditionally before the single return (the #310 lesson).
  // RELAYOUT-3-FIX: 1376, not 1360 — the honest-fit floor (collapsed rail 56 + doc 620 + review 700
  // = 1376). Below this the review pane would compress under its 700px floor, so fall to full-page.
  const BREAKPOINT = '(min-width: 1376px)';
  const [isWide, setIsWide] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(BREAKPOINT).matches,
  );
  // Doc-pane-only anchoring target (verbatim quote of the focused feedback item). NEVER review state.
  const [anchorQuote, setAnchorQuote] = useState<string | null>(null);
  // Full-page "view in document" overlay (session-preserving: the review tree stays mounted beneath).
  const [showDocOverlay, setShowDocOverlay] = useState(false);

  // REVIEW-UX-REDESIGN-1: resizable + two-level-collapsible document pane (wide mode only). These
  // change ONLY the left doc column's width/existence — the keyed review slot below NEVER remounts
  // (G6). Seeded lazily from localStorage (no setState-in-effect); persisted in the handlers below.
  const [docCollapse, setDocCollapse] = useState<DocCollapse>(() => readDocCollapse());
  const [docWidthPct, setDocWidthPct] = useState<number>(() => readDocWidthPct());
  const containerRef = React.useRef<HTMLDivElement>(null);
  const docWidthPctRef = React.useRef<number>(docWidthPct);

  const setCollapse = (n: DocCollapse): void => {
    setDocCollapse(n);
    try { window.localStorage.setItem(DOC_COLLAPSE_KEY, n); } catch { /* ignore */ }
  };
  // Drag-to-resize via pointer capture on the handle itself — no window listener, no new effect, so
  // nothing perturbs the review slot's identity. The move updates state for live reflow; the up
  // persists the final width.
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = containerRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const pct = clampPct(((e.clientX - r.left) / r.width) * 100);
    docWidthPctRef.current = pct;
    setDocWidthPct(pct);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    try { window.localStorage.setItem(DOC_WIDTH_KEY, String(docWidthPctRef.current)); } catch { /* ignore */ }
  };

  // Reads for the read-only document-reference pane (the workspace owns them; presentational pane).
  const { data: workspaceDoc } = trpc.document.get.useQuery({ documentId });
  const { data: workspaceVersions, isLoading: workspaceVersionsLoading } = trpc.version.list.useQuery({ documentId });

  // Container-width breakpoint via matchMedia (stable; no measure feedback loop).
  useEffect(() => {
    // The lazy useState initializer above set the correct initial value; this only subscribes to
    // subsequent breakpoint changes (no setState in the effect body — react-hooks/set-state-in-effect).
    const mq = window.matchMedia(BREAKPOINT);
    const onChange = (e: MediaQueryListEvent): void => setIsWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Rail-collapse signal: AppShell collapses its rail to icons via this data-attribute. Cleared on
  // unmount so navigating away restores the full rail. Display side effect only.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.reviewLayout = isWide ? 'wide' : 'fullpage';
    return () => { delete el.dataset.reviewLayout; };
  }, [isWide]);

  // Anchoring: when a feedback item gains focus, hand its verbatim text to the doc pane to scroll +
  // highlight. Doc-pane-only — it reads the existing DOM (review tree byte-identical) and never
  // mutates review state. Active only in split mode (the doc pane exists).
  const handleReviewFocus = useCallback((e: React.FocusEvent<HTMLElement>): void => {
    let node: HTMLElement | null = e.target;
    let best = '';
    for (let i = 0; i < 5 && node && node !== e.currentTarget; i++) {
      const t = node.textContent ?? '';
      if (t.length > best.length) best = t;
      node = node.parentElement;
    }
    if (best.trim().length >= 16) setAnchorQuote(best.trim().slice(0, 240));
  }, []);

  const versionList = workspaceVersions ?? [];
  const currentVersion = versionList.find((v) => v.id === (workspaceDoc?.currentVersionId ?? null)) ?? versionList[0] ?? null;
  const docTitle = workspaceDoc?.title ?? null;

  // The review subtree — created ONCE and rendered at the single stable slot in BOTH modes.
  const reviewBody = (
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
  );

  return (
    <div
      ref={containerRef}
      className={clsx(
        'fixed z-40 bg-paper flex',
        isWide ? 'inset-y-0 right-0 left-14' : 'inset-0 flex-col',
      )}
      data-testid="review-workspace"
      data-mode={isWide ? 'split' : 'fullpage'}
    >
      {/* WIDE + expanded — the resizable read-only document reference. The doc column is the ONLY part
          that mounts/unmounts (G6); the review slot below never does. Width is a dynamic % (inline
          style, NOT a Tailwind class) with a readable px floor. */}
      {isWide && docCollapse === 'expanded' && (
        <div
          key="doc-ref"
          className="relative flex-shrink-0 h-full border-r border-line"
          style={{ width: `${docWidthPct}%`, minWidth: DOC_MIN_PX }}
          data-testid="review-doc-pane-wrap"
        >
          {/* REVIEW-UX-REDESIGN-1-FIX: a SINGLE, labeled hide control on the document, top-right —
              restoring is the "Show document" button at the review header's top-left. */}
          <div className="absolute top-2 right-2 z-10">
            <button
              onClick={() => setCollapse('hidden')}
              title="Hide the document (the review goes full-width)"
              aria-label="Hide document"
              data-testid="review-doc-hide"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-line bg-paper/95 text-ink hover:border-accent shadow-sm text-[11px] font-medium"
            >
              <PanelLeftClose className="w-4 h-4" /> Hide document
            </button>
          </div>
          <DocumentReferencePane
            documentId={documentId}
            anchorQuote={anchorQuote}
            version={currentVersion}
            hasAnyVersion={versionList.length > 0}
            isLoading={workspaceVersionsLoading}
          />
        </div>
      )}
      {/* Drag handle — a SEPARATE sibling; mounting/unmounting it never touches the review slot node. */}
      {isWide && docCollapse === 'expanded' && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize document pane"
          data-testid="review-doc-resize"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onLostPointerCapture={onHandleUp}
          title="Drag to resize the document"
          className="group w-3 flex-shrink-0 h-full cursor-col-resize bg-surface-2 hover:bg-accent-tint flex items-center justify-center"
        >
          <div className="w-1 h-12 rounded-full bg-line-strong group-hover:bg-accent transition-colors" />
        </div>
      )}
      {/* docCollapse === 'hidden': nothing on the left — restore is the "Show document" button at the
          review header's top-left (REVIEW-UX-REDESIGN-1-FIX: relocated from a left-edge tab). */}

      {/* REVIEW SLOT — STABLE keyed slot. Identical mounted subtree in both modes; only className
          changes (reflow). ActiveSessionView never remounts/re-inits/re-fetches across the breakpoint. */}
      <section
        key="review-slot"
        data-testid="review-slot"
        onFocusCapture={handleReviewFocus}
        className={clsx(
          'h-full flex flex-col bg-surface min-w-0',
          // REVIEW-UX-REDESIGN-1-FIX: the review fills its column (flex-1) in split mode — no more empty
          // right gap from a 760px cap. Card readability is held by centering the body content below.
          isWide ? 'flex-1' : 'w-full items-center',
        )}
      >
        <div className={clsx('flex flex-col h-full w-full', !isWide && 'max-w-[960px]')}>
          {/* Header — REVIEW-SKIN-1 reskins the tokens in commit 2. Full-page carries the session
              context line ("Reviewing: title · Iteration N") + the session-preserving doc jump. */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-surface-2 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {/* REVIEW-UX-REDESIGN-1-FIX: restore lives at the TOP-LEFT (was a left-edge tab / far-right
                  header button). When the document is hidden, "Show document" sits here; the title moves right. */}
              {isWide && docCollapse === 'hidden' && (
                <button
                  onClick={() => setCollapse('expanded')}
                  data-testid="review-show-document"
                  title="Show the document again"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-line text-ink hover:border-accent text-[11px] font-medium flex-shrink-0"
                >
                  <ChevronRight className="w-3.5 h-3.5" /> Show document
                </button>
              )}
              <h2 className="text-ink font-semibold text-sm truncate">
                {isWide
                  ? 'Review session'
                  : `Reviewing${docTitle ? `: ${docTitle}` : ''} · Iteration ${iterationNumber}`}
              </h2>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* REVIEW-UX-REDESIGN-1-FIX: ALL document controls live on the LEFT now — Collapse/Hide on the
                  document pane, and restore via the always-present left-edge "Show document" tab. The review
                  header no longer carries a far-right "Show document" (it read as disconnected from the doc). */}
              {!isWide && currentVersion && (
                <button
                  onClick={() => setShowDocOverlay(true)}
                  className="text-ink-secondary hover:text-ink text-xs underline-offset-2 hover:underline"
                  data-testid="view-in-document"
                >
                  View in document
                </button>
              )}
              <button onClick={handleClose} disabled={autoAbandonMutation.isPending} className="text-ink-secondary hover:text-ink disabled:opacity-50" aria-label="Close review">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content — pane-level error boundary (R2-1 survivability): a render throw degrades to a
              designed full-pane notice instead of white-screening the review (the #310 failure mode).
              REVIEW-UX-REDESIGN-1-FIX: the body is centered + capped so cards stay readable now that the
              section fills the column; the flex-1/min-h-0/overflow chain (the scroll fix) is preserved. */}
          <div className="flex-1 overflow-hidden flex flex-col items-center">
            <div className="w-full max-w-[860px] flex-1 min-h-0 flex flex-col">
              {reviewBody}
            </div>
          </div>
        </div>
      </section>

      {/* Full-page only: the session-preserving document overlay. The review tree stays mounted
          beneath (never unmounts) — this is a doc-pane-only peek, anchored to the focused provision. */}
      {!isWide && showDocOverlay && (
        <div className="fixed inset-0 z-50 bg-paper flex flex-col" data-testid="doc-overlay">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-2 flex-shrink-0">
            <h3 className="text-sm font-semibold text-ink truncate">{docTitle ?? 'Document'}</h3>
            <button onClick={() => setShowDocOverlay(false)} className="text-ink-secondary hover:text-ink" aria-label="Back to review">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <DocumentReferencePane
              documentId={documentId}
              anchorQuote={anchorQuote}
              version={currentVersion}
              hasAnyVersion={versionList.length > 0}
              isLoading={workspaceVersionsLoading}
            />
          </div>
        </div>
      )}
    </div>
  );
}
