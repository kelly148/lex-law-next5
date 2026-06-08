/**
 * UpcomingDeadlines — FOLD-PM-1 Increment 4: the MINIMAL cross-matter next-30-days surface + a minimal
 * health-check. Deliberately small (the full managing-attorney portfolio view is FOLD-PM-4 — this is not
 * that): a flat next-N-days list across the owner's matters, plus integrity counts so a coverage gap
 * (an active deadline due soon with NO tickler rows) is surfaced, never silent (G-C).
 *
 * Flag-gated: when DEADLINE_ENGINE_ENABLED is OFF the engine is dormant and this renders a quiet "engine
 * off" line (absence never reads as all-clear). Surfaces only; never acts (no egress).
 * Rules of Hooks: all hooks run every render before any early return.
 */
import React from 'react';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { trpc } from '../trpc.js';

const LIMITATION = 'In-app only — no email, push, or external calendar. You are responsible for monitoring these.';

export default function UpcomingDeadlines(): React.ReactElement | null {
  const enabledQ = trpc.deadline.isEnabled.useQuery();
  const enabled = enabledQ.data?.enabled === true;
  const upcoming = trpc.deadline.upcoming.useQuery({ withinDays: 30 }, { enabled });
  const integrity = trpc.deadline.integrity.useQuery({ withinDays: 30 }, { enabled });

  if (!enabled) {
    return (
      <div className="mb-4 text-[11px] text-ink-secondary" data-testid="upcoming-engine-off">
        Deadlines &amp; ticklers: engine off.
      </div>
    );
  }

  const items = upcoming.data ?? [];
  const h = integrity.data?.counts;
  const gaps = integrity.data?.missingTicklerDeadlineIds ?? [];

  return (
    <div className="mb-4 border border-line rounded-lg p-3" data-testid="upcoming-deadlines">
      <div className="flex items-center gap-2 mb-1.5">
        <CalendarClock className="w-4 h-4 text-ink" />
        <h2 className="text-sm font-semibold text-ink flex-1">Next 30 days</h2>
        {h && (
          <span className="text-[11px] text-ink-secondary" data-testid="deadline-health">
            {h.active} active · {h.pendingConfirm} unconfirmed · {h.overdueUnresolved} overdue · {h.dueNow} due now
          </span>
        )}
      </div>

      {gaps.length > 0 && (
        <p className="text-[11px] text-wa-alert flex items-center gap-1 mb-1.5" data-testid="integrity-warning">
          <AlertTriangle className="w-3 h-3" /> {gaps.length} active deadline(s) due soon have no reminder rows — open the matter to refresh.
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-[11px] text-ink-secondary" data-testid="upcoming-empty">Nothing due in the next 30 days.</p>
      ) : (
        <ul className="space-y-1" data-testid="upcoming-list">
          {items.map((x) => (
            <li key={x.deadline.id} className="text-[11px] text-ink-secondary flex items-center justify-between gap-2">
              <span className="text-ink truncate">{x.deadline.description}</span>
              <span className={x.deadline.status === 'expired_unresolved' ? 'text-wa-alert' : ''}>
                {x.effectiveDueDate}{x.deadline.status === 'expired_unresolved' ? ' · overdue' : x.deadline.status === 'pending_confirm' ? ' · unconfirmed' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-ink-secondary mt-1.5" data-testid="upcoming-limitation">{LIMITATION}</p>
    </div>
  );
}
