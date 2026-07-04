/**
 * ReviewerHealthView — REVIEWER-HEALTH-VIEW-1 (the 5C observability panel).
 *
 * READ-ONLY, owner-scoped operational view (the SUPERVISION-VIEW-1 pattern): reviewer_feedback job-status
 * counts over a window + active/stuck review sessions. Self-gates on reviewerHealth.isEnabled — redirects
 * to /matters when the flag is OFF. No mutations; informational only.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { trpc } from '../trpc.js';

const STATUS_ORDER = ['completed', 'running', 'queued', 'failed', 'timed_out', 'cancelled'] as const;

export default function ReviewerHealthView(): React.ReactElement {
  const enabledQ = trpc.reviewerHealth.isEnabled.useQuery();
  const enabled = enabledQ.data?.enabled === true;
  // W7 — request the 30-day window (720h) so the panel-composition decision sees the full window. The
  // underlying collection is always-on, so the window is already accumulating.
  const snapQ = trpc.reviewerHealth.snapshot.useQuery({ windowHours: 720 }, { enabled });

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
                <span className="ml-2 text-xs text-accent">· {snap.stuckSessionCount} possibly-stuck session(s)</span>
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
                    <span className="text-ink-hint whitespace-nowrap">
                      {s.lifecyclePhase ?? 'idle'} · {s.ageMinutes}m
                      {s.ageMinutes >= 10 && <span className="ml-1 text-accent" title="long-lived active session — possible stuck">⚠</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <p className="text-xs text-ink-hint">Generated {new Date(snap.generatedAt).toLocaleString()}.</p>
        </div>
      )}
    </div>
  );
}
