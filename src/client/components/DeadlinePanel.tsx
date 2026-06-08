/**
 * DeadlinePanel — FOLD-PM-1 Increments 4 + 4b: the matter-scoped deadline/tickler surface.
 *
 * Surfaces the engine for one matter so a deadline can NEVER silently slip (G-C): a coverage chip whose
 * absence never reads as all-clear; an unconfirmed treatment (pending_confirm still shows + fires, with a
 * Confirm affordance); an unmissable overdue treatment (permanent until satisfy/waive); per-tickler
 * ack/snooze; attorney override; recompute propose-and-confirm (never silent); a no-blank path across
 * every state; and the permanent in-app-only limitation banner.
 *
 * DEFAULT-SAFE / ADVISORY: surfaces + records attorney acts; never sends, files, or notifies (no egress).
 * No business logic in React (Ch 35.3) — the server owns the engine/lifecycle/audit/coverage.
 * Rules of Hooks (the phase-3 #310 lesson): every row is its own component so its hooks are stable.
 */
import React, { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, Bell } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface DeadlinePanelProps {
  matterId: string;
}

const LIMITATION =
  'In-app ticklers only — no email, push, or external calendar. You are responsible for monitoring these panels.';

type DeadlineLike = {
  id: string;
  description: string;
  family: string;
  status: string;
  anchorDate: string;
  ruleRevisionId: string | null;
  computedDueDate: string | null;
  attorneyOverrideDate: string | null;
  constraints: unknown;
};

const effDue = (d: { attorneyOverrideDate: string | null; computedDueDate: string | null }): string | null =>
  d.attorneyOverrideDate ?? d.computedDueDate;

export default function DeadlinePanel({ matterId }: DeadlinePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  const enabledQ = trpc.deadline.isEnabled.useQuery();
  const enabled = enabledQ.data?.enabled === true;

  const utils = trpc.useUtils();
  const list = trpc.deadline.listForMatter.useQuery({ matterId }, { enabled: open && enabled });
  const invalidate = (): void => void utils.deadline.listForMatter.invalidate({ matterId });

  // Hooks above run every render. Derivations below.
  const coverage = list.data?.coverage;
  const deadlines = (list.data?.deadlines ?? []) as DeadlineLike[];

  const chip = (): React.ReactElement => {
    if (!enabled) return <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-ink-secondary">engine off</span>;
    const s = coverage?.state;
    if (s === 'overdue_unresolved') return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-alert-bg text-wa-alert" data-testid="coverage-overdue">{coverage!.overdueUnresolved} overdue — unresolved</span>;
    if (s === 'unconfirmed') return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-attention-bg text-wa-attention">{coverage!.pendingConfirm} unconfirmed</span>;
    if (s === 'active') return <span className="text-xs px-1.5 py-0.5 rounded bg-wa-good-bg text-wa-good">{coverage!.active} active</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-ink-secondary">none created</span>;
  };

  return (
    <div className="border border-line rounded-lg overflow-hidden mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-surface hover:bg-surface-2">
        <CalendarClock className="w-4 h-4 text-ink" />
        <h3 className="text-sm font-semibold text-ink flex-1 text-left">Deadlines &amp; ticklers</h3>
        {chip()}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-ink-secondary" data-testid="deadline-limitation">{LIMITATION}</p>

          {!enabled && (
            <p className="text-xs text-ink-secondary" data-testid="deadline-engine-off">
              The deadline engine is turned off. No deadlines are computed or tracked yet.
            </p>
          )}
          {enabled && list.isLoading && <p className="text-xs text-ink-secondary">Loading deadlines…</p>}
          {enabled && !list.isLoading && deadlines.length === 0 && (
            <p className="text-xs text-ink-secondary" data-testid="deadline-empty">
              No deadlines created for this matter yet. Absence is not confirmation — add deadlines so they are tracked.
            </p>
          )}

          {enabled && deadlines.length > 0 && (
            <ul className="space-y-1.5" data-testid="deadline-list">
              {deadlines.map((d) => <DeadlineRow key={d.id} d={d} onChanged={invalidate} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function statusTreatment(status: string): { cls: string; icon: React.ReactElement; label: string } {
  if (status === 'expired_unresolved') return { cls: 'border-wa-alert bg-wa-alert-bg', icon: <AlertTriangle className="w-3.5 h-3.5 text-wa-alert" />, label: 'OVERDUE — unresolved' };
  if (status === 'pending_confirm') return { cls: 'border-wa-attention bg-wa-attention-bg', icon: <Clock className="w-3.5 h-3.5 text-wa-attention" />, label: 'unconfirmed' };
  if (status === 'active') return { cls: 'border-line', icon: <CheckCircle2 className="w-3.5 h-3.5 text-wa-good" />, label: 'active' };
  return { cls: 'border-line opacity-60', icon: <CheckCircle2 className="w-3.5 h-3.5 text-ink-secondary" />, label: status };
}

function DeadlineRow({ d, onChanged }: { d: DeadlineLike; onChanged: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState<null | 'satisfy' | 'waive'>(null);
  const [basis, setBasis] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [ovDate, setOvDate] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [recomputing, setRecomputing] = useState(false);
  const [newAnchor, setNewAnchor] = useState(d.anchorDate);
  const [proposal, setProposal] = useState<{ currentDueDate: string | null; proposedDueDate: string | null; deltaDays: number | null } | null>(null);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [snoozeReason, setSnoozeReason] = useState('');

  const utils = trpc.useUtils();
  const detail = trpc.deadline.getDeadline.useQuery({ id: d.id }, { enabled: expanded });
  const refetchDetail = (): void => { void detail.refetch?.(); };

  const after = (extra?: () => void): { onSuccess: () => void } => ({ onSuccess: () => { extra?.(); onChanged(); refetchDetail(); } });
  const confirm = useGuardedMutation((i: { id: string }) => utils.client.deadline.confirm.mutate(i), after());
  const satisfy = useGuardedMutation((i: { id: string; basis: string }) => utils.client.deadline.satisfy.mutate(i), after(() => { setResolving(null); setBasis(''); }));
  const waive = useGuardedMutation((i: { id: string; reason: string }) => utils.client.deadline.waive.mutate(i), after(() => { setResolving(null); setBasis(''); }));
  const override = useGuardedMutation((i: { id: string; overrideDate: string; reason: string }) => utils.client.deadline.override.mutate(i), after(() => { setOverriding(false); setOvDate(''); setOvReason(''); }));
  const confirmRecompute = useGuardedMutation((i: { id: string; newAnchorDate: string }) => utils.client.deadline.confirmRecompute.mutate(i), after(() => { setRecomputing(false); setProposal(null); }));
  const ack = useGuardedMutation((i: { ticklerId: string }) => utils.client.deadline.acknowledgeTickler.mutate(i), { onSuccess: refetchDetail });
  const snooze = useGuardedMutation((i: { ticklerId: string; snoozedUntil: string; reason: string }) => utils.client.deadline.snoozeTickler.mutate(i), { onSuccess: () => { setSnoozeId(null); setSnoozeUntil(''); setSnoozeReason(''); refetchDetail(); } });

  const t = statusTreatment(d.status);
  const due = effDue(d);
  const provisional = Array.isArray(d.constraints) && d.constraints.some((c) => (c as { status?: string }).status === 'unresolved');
  const ticklers = (detail.data?.ticklers ?? []) as Array<{ id: string; leadDays: number; fireAt: string; acknowledgedAt: string | Date | null; snoozedUntil: string | null }>;
  const submitResolve = (): void => {
    if (!resolving || basis.trim() === '') return;
    if (resolving === 'satisfy') satisfy.mutate({ id: d.id, basis: basis.trim() });
    else waive.mutate({ id: d.id, reason: basis.trim() });
  };
  const doPropose = (): void => {
    void utils.client.deadline.proposeRecompute.query({ id: d.id, newAnchorDate: newAnchor }).then((p) =>
      setProposal({ currentDueDate: p.currentDueDate, proposedDueDate: p.proposedDueDate, deltaDays: p.deltaDays }),
    );
  };

  return (
    <li className={`px-2.5 py-2 border rounded ${t.cls}`} data-testid="deadline-row" data-status={d.status}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setExpanded(!expanded)} className="text-xs font-medium text-ink text-left flex-1 hover:underline" data-testid="deadline-expand">{d.description}</button>
        <span className="inline-flex items-center gap-1 text-[10px] text-ink-secondary">{t.icon}{t.label}</span>
      </div>
      <div className="text-[11px] text-ink-secondary mt-0.5">
        {d.family} · due {due ?? '—'}{d.attorneyOverrideDate ? ' (override)' : ''}{provisional ? ' · provisional (unresolved constraint)' : ''}
      </div>

      {d.status === 'pending_confirm' && (
        <button onClick={() => confirm.mutate({ id: d.id })} disabled={confirm.isPending} className="mt-1.5 px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50" data-testid="deadline-confirm">
          {confirm.isPending ? 'Confirming…' : 'Confirm (rely on this date)'}
        </button>
      )}
      {d.status === 'expired_unresolved' && (
        <p className="mt-1 text-[11px] text-wa-alert" data-testid="deadline-overdue-note">
          This deadline passed without disposition. It will not clear on its own — satisfy or waive it (with a basis).
        </p>
      )}

      {(d.status === 'active' || d.status === 'expired_unresolved' || d.status === 'pending_confirm') && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(d.status === 'active' || d.status === 'expired_unresolved') && resolving === null && (
            <>
              <button onClick={() => { setResolving('satisfy'); setBasis(''); }} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface" data-testid="deadline-satisfy">Satisfy</button>
              <button onClick={() => { setResolving('waive'); setBasis(''); }} className="px-2 py-0.5 text-[11px] border border-line text-ink-secondary rounded hover:bg-surface" data-testid="deadline-waive">Waive</button>
            </>
          )}
          <button onClick={() => { setOverriding(!overriding); setOvDate(due ?? ''); setOvReason(''); }} className="px-2 py-0.5 text-[11px] border border-line text-ink-secondary rounded hover:bg-surface" data-testid="deadline-override-toggle">Override date</button>
          {d.ruleRevisionId && (
            <button onClick={() => { setRecomputing(!recomputing); setProposal(null); setNewAnchor(d.anchorDate); }} className="px-2 py-0.5 text-[11px] border border-line text-ink-secondary rounded hover:bg-surface" data-testid="deadline-recompute-toggle">Recompute</button>
          )}
        </div>
      )}

      {resolving !== null && (
        <div className="mt-1.5 space-y-1" data-testid="deadline-resolve-form">
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder={resolving === 'satisfy' ? 'Basis (how it was satisfied)' : 'Reason (why waived)'} className="w-full text-[11px] border border-line rounded px-2 py-1" />
          <div className="flex gap-2">
            <button onClick={submitResolve} disabled={basis.trim() === '' || satisfy.isPending || waive.isPending} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50" data-testid="deadline-resolve-submit">{resolving === 'satisfy' ? 'Mark satisfied' : 'Waive'}</button>
            <button onClick={() => { setResolving(null); setBasis(''); }} className="px-2 py-0.5 text-[11px] text-ink-secondary hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {overriding && (
        <div className="mt-1.5 space-y-1" data-testid="deadline-override-form">
          <input type="date" value={ovDate} onChange={(e) => setOvDate(e.target.value)} className="text-[11px] border border-line rounded px-2 py-1" />
          <input value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="Reason for override (required)" className="w-full text-[11px] border border-line rounded px-2 py-1" />
          <button onClick={() => { if (ovDate && ovReason.trim()) override.mutate({ id: d.id, overrideDate: ovDate, reason: ovReason.trim() }); }} disabled={!ovDate || ovReason.trim() === '' || override.isPending} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50" data-testid="deadline-override-submit">Set override date</button>
        </div>
      )}

      {recomputing && (
        <div className="mt-1.5 space-y-1" data-testid="deadline-recompute-form">
          <div className="flex gap-2 items-center">
            <input type="date" value={newAnchor} onChange={(e) => setNewAnchor(e.target.value)} className="text-[11px] border border-line rounded px-2 py-1" />
            <button onClick={doPropose} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface" data-testid="deadline-recompute-propose">Preview</button>
          </div>
          {proposal && (
            <div className="text-[11px] text-ink-secondary" data-testid="deadline-recompute-proposal">
              <div>current due {proposal.currentDueDate ?? '—'} → proposed {proposal.proposedDueDate ?? '—'}{proposal.deltaDays != null ? ` (${proposal.deltaDays >= 0 ? '+' : ''}${proposal.deltaDays}d)` : ''}</div>
              <button onClick={() => confirmRecompute.mutate({ id: d.id, newAnchorDate: newAnchor })} disabled={confirmRecompute.isPending} className="mt-1 px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50" data-testid="deadline-recompute-confirm">Confirm recompute</button>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-2 border-t border-line pt-2" data-testid="deadline-ticklers">
          {detail.isLoading && <p className="text-[11px] text-ink-secondary">Loading reminders…</p>}
          {!detail.isLoading && ticklers.length === 0 && <p className="text-[11px] text-ink-secondary" data-testid="tickler-empty">No reminders in the current 12-month window.</p>}
          {ticklers.map((tk) => (
            <div key={tk.id} className="text-[11px] text-ink-secondary flex items-center justify-between gap-2 py-0.5" data-testid="tickler-row">
              <span className="inline-flex items-center gap-1"><Bell className="w-3 h-3" /> T-{tk.leadDays} · fires {tk.fireAt}{tk.snoozedUntil ? ` · snoozed → ${tk.snoozedUntil}` : ''}</span>
              {tk.acknowledgedAt ? (
                <span className="text-wa-good">acknowledged</span>
              ) : (
                <span className="flex gap-2">
                  <button onClick={() => ack.mutate({ ticklerId: tk.id })} className="hover:underline text-ink" data-testid="tickler-ack">Ack</button>
                  <button onClick={() => { setSnoozeId(tk.id); setSnoozeUntil(''); setSnoozeReason(''); }} className="hover:underline" data-testid="tickler-snooze">Snooze</button>
                </span>
              )}
            </div>
          ))}
          {snoozeId && (
            <div className="mt-1 space-y-1" data-testid="tickler-snooze-form">
              <input type="date" value={snoozeUntil} onChange={(e) => setSnoozeUntil(e.target.value)} className="text-[11px] border border-line rounded px-2 py-1" />
              <input value={snoozeReason} onChange={(e) => setSnoozeReason(e.target.value)} placeholder="Snooze reason" className="w-full text-[11px] border border-line rounded px-2 py-1" />
              <button onClick={() => { if (snoozeUntil && snoozeReason.trim()) snooze.mutate({ ticklerId: snoozeId, snoozedUntil: snoozeUntil, reason: snoozeReason.trim() }); }} disabled={!snoozeUntil || snoozeReason.trim() === ''} className="px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-50" data-testid="tickler-snooze-submit">Snooze reminder</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
