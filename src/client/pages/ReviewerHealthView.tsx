/**
 * ReviewerHealthView — REVIEWER-HEALTH-VIEW-1 (the 5C observability panel).
 *
 * READ-ONLY, owner-scoped operational view (the SUPERVISION-VIEW-1 pattern): reviewer_feedback job-status
 * counts over a window + active/stuck review sessions. Self-gates on reviewerHealth.isEnabled — redirects
 * to /matters when the flag is OFF.
 *
 * SESSION-UNSTICK-1: the ONE mutation on this page — a manual, per-session "Abandon session" for a
 * possibly-stuck session (server-flagged isPossiblyStuck), using the existing owner-scoped, fail-closed-
 * AUDITED reviewSession.abandon. NO bulk auto-reap (that stays the JOB_REAPER_ENABLED operator decision).
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

const STATUS_ORDER = ['completed', 'running', 'queued', 'failed', 'timed_out', 'cancelled'] as const;

export default function ReviewerHealthView(): React.ReactElement {
  const enabledQ = trpc.reviewerHealth.isEnabled.useQuery();
  const enabled = enabledQ.data?.enabled === true;
  // W7 — request the 30-day window (720h) so the panel-composition decision sees the full window. The
  // underlying collection is always-on, so the window is already accumulating.
  const snapQ = trpc.reviewerHealth.snapshot.useQuery({ windowHours: 720 }, { enabled });

  // SESSION-UNSTICK-1: manual abandon of a possibly-stuck session (hook before the early returns). On
  // success, re-read the snapshot so the abandoned session drops off the list.
  const utils = trpc.useUtils();
  const abandonMutation = useGuardedMutation(
    (input: { sessionId: string }) => utils.client.reviewSession.abandon.mutate(input),
    { onSuccess: () => { void utils.reviewerHealth.snapshot.invalidate(); } },
  );

  if (enabledQ.isLoading) return <div className="p-8 text-sm text-ink-hint">Loading…</div>;
  if (!enabled) return <Navigate to="/matters" replace />;

  const snap = snapQ.data;
  return (
    <div className="p-8 max-w-3xl" data-testid="reviewer-health">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-5 h-5 text-firm-navy" />
        <h1 className="text-xl font-semibold text-firm-navy">Reviewer health</h1>
      </div>
      <p className="text-sm text-ink-secondary mb-6">
        Read-only operational snapshot of your reviewer activity. Informational only — it never acts.
      </p>

      {snapQ.isLoading || !snap ? (
        <p className="text-sm text-ink-hint">Loading snapshot…</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-base font-semibold text-ink mb-2">
              Reviewer jobs — last {snap.windowHours}h ({snap.reviewerJobs.total})
            </h2>
            <div className="border border-line rounded-lg divide-y divide-line">
              {STATUS_ORDER.map((s) => (
                <div key={s} className="flex items-center justify-between px-3 py-2 text-sm" data-testid={`rh-status-${s}`}>
                  <span className="text-ink-secondary capitalize">{s.replace('_', ' ')}</span>
                  <span className="font-medium text-ink tabular-nums">{snap.reviewerJobs.byStatus[s] ?? 0}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink mb-2">
              Per-lane reviewer health — last {Math.round(snap.windowHours / 24)}d
              {snap.stuckSessionCount > 0 && (
                /* G7 (UI-ATTORNEY-SWEEP-1): not an action — neutral text, not accent (which reads as a
                   link). SESSION-UNSTICK-1 turns this into a real per-session list + abandon action. */
                <span className="ml-2 text-xs text-ink-secondary">· {snap.stuckSessionCount} possibly-stuck session(s)</span>
              )}
            </h2>
            {Object.keys(snap.perLane).length === 0 ? (
              <p className="text-sm text-ink-hint">No reviewer outputs in this window yet.</p>
            ) : (
              <div className="border border-line rounded-lg divide-y divide-line" data-testid="rh-per-lane">
                <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium text-ink-secondary">
                  <span>Lane</span>
                  <span className="text-right">Outputs</span>
                  <span className="text-right">Parse fail</span>
                  <span className="text-right">Empty</span>
                  <span className="text-right">Adopted</span>
                </div>
                {Object.entries(snap.perLane).map(([role, h]) => (
                  <div key={role} className="grid grid-cols-5 gap-2 px-3 py-2 text-sm tabular-nums" data-testid={`rh-lane-${role}`}>
                    <span className="text-ink capitalize">{role}</span>
                    <span className="text-right text-ink-secondary">{h.outputsCaptured}</span>
                    <span className="text-right text-ink-secondary">{h.parseFailures}</span>
                    <span className="text-right text-ink-secondary">{h.emptyReviews}</span>
                    <span className="text-right text-ink-secondary">{h.findingsAdopted}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink mb-2">
              Active review sessions ({snap.activeSessions.length})
            </h2>
            {snap.activeSessions.length === 0 ? (
              <p className="text-sm text-ink-hint">None active.</p>
            ) : (
              <div className="border border-line rounded-lg divide-y divide-line">
                {snap.activeSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid="rh-active-session">
                    <span className="font-mono text-xs text-ink-secondary truncate">{s.documentId}</span>
                    <div className="flex items-center gap-3 whitespace-nowrap">
                      <span className="text-ink-hint">
                        {s.lifecyclePhase ?? 'idle'} · {s.ageMinutes}m
                        {s.isPossiblyStuck && <span className="ml-1 text-warning" title="long-lived active session — possibly stuck">⚠</span>}
                      </span>
                      {/* SESSION-UNSTICK-1: manual abandon, only for a server-flagged possibly-stuck session. */}
                      {s.isPossiblyStuck && (
                        <button
                          data-testid="rh-abandon-session"
                          onClick={() => {
                            if (window.confirm('Abandon this possibly-stuck review session? This ends the session (an audited action) so the next review can start. It does not delete any recorded feedback.')) {
                              abandonMutation.mutate({ sessionId: s.id });
                            }
                          }}
                          disabled={abandonMutation.isPending}
                          className="text-xs text-danger hover:underline disabled:opacity-50"
                        >
                          Abandon session
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* G9: surface the abandon error instead of a silent failure. */}
            {abandonMutation.error && (
              <p data-testid="rh-abandon-error" className="mt-2 text-xs text-warning">
                Couldn’t abandon the session: {abandonMutation.error.message}
              </p>
            )}
          </section>
          <p className="text-xs text-ink-hint">Generated {new Date(snap.generatedAt).toLocaleString()}.</p>
        </div>
      )}
    </div>
  );
}
