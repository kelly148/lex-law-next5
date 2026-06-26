/**
 * ExpressReviewPane — EXPRESS-AUTO-REVIEW-LOOP-1 Part B: the auto-review CLIENT surface.
 *
 * Flag-dark client wiring over the BUILT Express engine (E1–E7). The parent (DocumentDetail) renders this ONLY
 * when `expressReviewLoop.isEnabled` returns enabled:true, so with AUTO_REVIEW_LOOP_ENABLED OFF nothing here
 * shows and behavior is unchanged. This pane:
 *   - runs the bounded anti-drift loop via the existing `expressReviewLoop.run` mutation (the ONLY engine entry;
 *     the client never reimplements routing/loop/ledger logic — it renders server truth);
 *   - discloses the NON-FINAL candidate behind the E7a <ExpressCandidateBanner> (canApprove comes straight from
 *     the server guard, never client-derived; the approve button is inert here — affirmative per-escalation
 *     sign-off is the deferred E7b);
 *   - shows the E4 DECISION LEDGER view: the risk-ranked decisions (route + risk bucket + before/after diff) and
 *     the cumulative v1->candidate REDLINE returned by the loop.
 *
 * NOT built here (surfaced, not silently dropped): interactive one-click UNWIND. The engine's pure `unwind`
 * needs a live DecisionLedger object, but the loop RETURNS the ledger and never persists it (durable persistence
 * is the explicitly DEFERRED E4b). A cross-request unwind therefore needs E4b (or new server machinery +
 * records-management), out of scope for this flag-dark client-wiring pass. The ledger view here is the read-only
 * audit (what auto-applied, what escalated, at what risk, total drift).
 *
 * Never finalizes, records, or sends; the candidate is structurally non-final (the banner re-asserts it).
 */
import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { ExpressCandidateBanner, type ExpressBannerEscalation } from './ExpressCandidateBanner.js';

/** The discriminated union the `expressReviewLoop.run` mutation resolves to (kept in sync with the server via
 *  the trpc client type — no hand-maintained shape). */
type RunResult = Awaited<
  ReturnType<ReturnType<typeof trpc.useUtils>['client']['expressReviewLoop']['run']['mutate']>
>;
type CompletedRun = Extract<RunResult, { status: 'completed' }>;

interface ExpressReviewPaneProps {
  matterId: string;
  documentId: string;
  onClose: () => void;
}

const BUCKET_DOT: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-gray-400',
};

/** Render the cumulative v1->candidate redline (server-built word-level diff): equal plain, delete struck red,
 *  insert underlined green. Display only. */
function RedlineView({ redline }: { redline: CompletedRun['redline'] }): React.ReactElement {
  if (redline.unchanged) {
    return <p className="text-xs text-gray-500" data-testid="express-redline-unchanged">No change from the v1 draft.</p>;
  }
  return (
    <p data-testid="express-redline" className="whitespace-pre-wrap text-sm leading-relaxed">
      {redline.segments.map((seg, i) => {
        if (seg.op === 'equal') return <span key={i}>{seg.text}</span>;
        if (seg.op === 'delete') {
          return (
            <span key={i} className="bg-red-50 text-red-700 line-through" data-testid="express-redline-delete">
              {seg.text}
            </span>
          );
        }
        return (
          <span key={i} className="bg-green-50 text-green-800 underline" data-testid="express-redline-insert">
            {seg.text}
          </span>
        );
      })}
    </p>
  );
}

/** The risk-ranked E4 decision ledger: every recorded decision with its route, risk bucket, and before/after
 *  diff. Read-only audit (interactive unwind is the deferred E4b). */
function LedgerView({ ledger }: { ledger: CompletedRun['ledger'] }): React.ReactElement {
  // Display order = risk-ranked (highest score first); the recording order is preserved server-side. This is a
  // pure DISPLAY sort over server-supplied scores, not a re-derivation of risk.
  const ranked = [...ledger].sort((a, b) => b.riskScore - a.riskScore);
  if (ranked.length === 0) {
    return <p className="text-xs text-gray-500" data-testid="express-ledger-empty">No decisions were recorded.</p>;
  }
  return (
    <ul data-testid="express-ledger" className="space-y-2">
      {ranked.map((e) => (
        <li key={e.id} data-testid="express-ledger-entry" className="rounded border border-gray-200 p-2 text-xs">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${BUCKET_DOT[e.riskBucket]}`} />
            <span className="uppercase font-semibold tracking-wide">{e.riskBucket}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                e.route === 'escalate' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
              }`}
            >
              {e.route === 'escalate' ? 'escalated' : 'auto-adopted'}
            </span>
            <span className="text-gray-400">round {e.round}</span>
            {e.immutabilityForced && <span className="text-gray-400">· immutable-forced</span>}
          </div>
          <div className="mt-1 space-y-0.5">
            <div className="text-red-700 line-through break-words">{e.beforeText || '(empty)'}</div>
            <div className="text-green-800 break-words">{e.afterText || '(deleted)'}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ExpressReviewPane({ matterId, documentId, onClose }: ExpressReviewPaneProps): React.ReactElement {
  const utils = trpc.useUtils();
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useGuardedMutation(
    (input: { matterId: string; documentId: string; maxRounds?: number }) =>
      utils.client.expressReviewLoop.run.mutate(input),
    {
      onSuccess: (res) => { setResult(res); setError(null); },
      onError: (err) => { setError(err.message); setResult(null); },
    },
  );

  const completed = result && result.status === 'completed' ? result : null;
  const blocked = result && result.status === 'blocked' ? result : null;
  const escalations: ExpressBannerEscalation[] = completed
    ? completed.escalations.map((e) => ({ id: e.id, riskBucket: e.riskBucket, reason: e.reason }))
    : [];

  return (
    <div data-testid="express-review-pane" className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <ShieldAlert className="w-4 h-4 text-amber-700" aria-hidden="true" />
          Express auto-review
        </h2>
        <button type="button" data-testid="express-close" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-ink-hint">
        Runs a bounded, anti-drift auto-review loop on the current draft and proposes a NON-FINAL candidate. Every
        change is recorded in the decision ledger; higher-risk changes are escalated for your explicit decision.
        Nothing here is final, sendable, fileable, or recordable.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="express-run"
          disabled={run.isPending}
          onClick={() => run.mutate({ matterId, documentId })}
          className="px-3 py-1.5 text-xs bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50"
        >
          {run.isPending ? 'Running auto-review…' : result ? 'Re-run auto-review' : 'Run auto-review'}
        </button>
        {completed && (
          <span className="text-xs text-gray-500" data-testid="express-rounds">
            {completed.rounds} round{completed.rounds === 1 ? '' : 's'}
            {completed.converged ? ' · converged' : ''}
            {completed.hitCap ? ' · hit round cap' : ''}
          </span>
        )}
      </div>

      {error && <p data-testid="express-error" className="text-sm text-red-600">{error}</p>}

      {blocked && (
        <div data-testid="express-blocked" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Auto-review was blocked before any change was made: <span className="font-medium">{blocked.reason}</span>. No
          candidate was produced and nothing was adopted.
        </div>
      )}

      {completed && (
        <div className="space-y-4">
          <ExpressCandidateBanner canApprove={completed.canApprove} unresolvedEscalations={escalations} />

          <section data-testid="express-candidate" className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Candidate draft (non-final)</h3>
            <pre className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-sm">{completed.candidate}</pre>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Cumulative redline (v1 → candidate)</h3>
            <RedlineView redline={completed.redline} />
          </section>

          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Decision ledger (risk-ranked)</h3>
            </div>
            <LedgerView ledger={completed.ledger} />
            <p data-testid="express-unwind-deferred" className="text-[11px] text-ink-hint">
              One-click unwind of an individual adopted change requires the durable decision ledger (E4b), which is
              not yet persisted — the loop returns the ledger for this audit view but does not store it.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
