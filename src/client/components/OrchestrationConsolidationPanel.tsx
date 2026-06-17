/**
 * OrchestrationConsolidationPanel — FOLD-ORCH-1 Increment 3c-1 (read-only consolidation surface).
 *
 * The attorney-facing view of multi-model orchestration consolidation for a review session. It
 * AUTOMATES THE LABOR (group + classify + surface) but NEVER THE JUDGMENT: it shows which
 * convergent, low-risk items are eligible for grouped confirmation (the actual expand-to-see
 * bulk-confirm + adopt wiring is Inc3c-2), which items remain per-item decisions, and the
 * divergent disagreements — content-preserving, never auto-closed. The only mutation here is the
 * idempotent registration of divergent items as open items (Fork E), which never adopts, never
 * regenerates, and never closes anything.
 *
 * No business logic in React (Ch 35.3): the server computes the consolidation (deterministically,
 * convergence = real successful-reviewer overlap, floor >= 2) and owns the registration + audit.
 */
import React, { useState } from 'react';
import { Layers, ChevronDown, ChevronUp, GitMerge, Users, AlertTriangle, ListChecks } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import DeliberateActButton from './DeliberateActButton.js';

interface OrchestrationConsolidationPanelProps {
  reviewSessionId: string;
  /** Orchestration is only meaningful for a completed multi-reviewer run. Gated AFTER hooks
   *  (never via a conditional mount) so the hook order is always stable. */
  visible: boolean;
}

export default function OrchestrationConsolidationPanel({
  reviewSessionId,
  visible,
}: OrchestrationConsolidationPanelProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // REVIEW-LOOP-UX-1 / R1: a convergent-bucket BULK-adopt requires at least a scroll-acknowledge — the
  // attorney must scroll the expanded member list to its end before "Confirm group" enables. This is
  // the FOLD-ORCH-1 control (the gate is bulk-eligibility, not the click), tightened from expand-to-see
  // to expand-AND-scroll-acknowledge. Per-item convergent-high-risk and DIVERGENT items never get a
  // bulk affordance (they are per-item by classification), so the gate only governs convergent_low_risk.
  const [scrollAcked, setScrollAcked] = useState<Record<string, boolean>>({});

  const utils = trpc.useUtils();
  const consolidation = trpc.orchestration.getConsolidation.useQuery({ reviewSessionId }, { enabled: open });
  // Current session selections — bulk-confirm MERGES into these (never clobbers per-item picks).
  const sessionQuery = trpc.reviewSession.get.useQuery({ sessionId: reviewSessionId }, { enabled: open });

  const registerDivergent = useGuardedMutation(
    (input: { reviewSessionId: string }) => utils.client.orchestration.registerDivergentItems.mutate(input),
    { onSuccess: () => { void utils.orchestration.getConsolidation.invalidate({ reviewSessionId }); } },
  );
  const updateSelection = useGuardedMutation(
    (input: {
      sessionId: string;
      selections: Array<{
        suggestionId: string;
        note: string | null;
        adoptedText?: string;
        confirmationMode?:
          | 'bulk_acknowledged_low_severity_convergent'
          | 'individually_adopted'
          | 'individually_rejected'
          | 'individually_deferred'
          | 'synthesis_adopted'
          | 'divergent_resolved';
      }>;
    }) => utils.client.reviewSession.updateSelection.mutate(input),
    { onSuccess: () => { void utils.reviewSession.get.invalidate({ sessionId: reviewSessionId }); } },
  );

  // All hooks above run every render (stable order). Gate visibility AFTER the hooks — never via a
  // conditional mount in the parent — so orchestration only shows for a completed multi-reviewer run.
  if (!visible) return null;

  const data = consolidation.data;
  const groups = data?.groups ?? [];
  const divergentItems = data?.divergentItems ?? [];
  const bulkEligibleGroups = data?.bulkEligibleGroups ?? [];
  const perItem = groups.filter((g) => g.bucket === 'per_item' && g.classification !== 'divergent');

  const currentSelections = sessionQuery.data?.session.selections ?? [];
  const selectedIds = new Set(currentSelections.map((s) => s.suggestionId));

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  // Mark a group scroll-acknowledged once its member list is scrolled to the bottom (or it is short
  // enough that there is nothing to scroll — handled below by acknowledging short lists on expand).
  const onMembersScroll = (id: string) => (e: React.UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      setScrollAcked((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    }
  };
  // When a group is short enough that the member list does not overflow (nothing to scroll), expanding
  // it IS the acknowledgment — record it via a callback ref the first time the list mounts. The
  // `scrollHeight > 0` guard means a not-yet-laid-out list (e.g. jsdom geometry of 0) does NOT auto-ack;
  // a genuinely short, laid-out list (scrollHeight <= clientHeight) does.
  const ackIfNotScrollable = (id: string) => (el: HTMLUListElement | null) => {
    if (el && el.scrollHeight > 0 && el.scrollHeight <= el.clientHeight + 4) {
      setScrollAcked((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    }
  };

  // Fork A: confirm a convergent+low-risk group ONLY after expand-to-see (never one-click). This
  // SELECTS its members for the next regeneration, tagged with the bulk confirmation mode; the
  // adoption itself (and the ledgered mode) lands at the existing Regenerate. The attorney is final.
  const confirmGroup = (members: Array<{ suggestionId: string }>) => {
    const existing = currentSelections.map((s) => ({
      suggestionId: s.suggestionId,
      note: s.note,
      ...(s.adoptedText !== undefined ? { adoptedText: s.adoptedText } : {}),
      ...(s.confirmationMode !== undefined ? { confirmationMode: s.confirmationMode } : {}),
    }));
    const additions = members
      .filter((m) => !selectedIds.has(m.suggestionId))
      .map((m) => ({ suggestionId: m.suggestionId, note: null, confirmationMode: 'bulk_acknowledged_low_severity_convergent' as const }));
    if (additions.length === 0) return;
    updateSelection.mutate({ sessionId: reviewSessionId, selections: [...existing, ...additions] });
  };

  return (
    <div className="border-t border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100"
      >
        <Layers className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Multi-model orchestration</h3>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {consolidation.isLoading && <p className="text-xs text-gray-400">Consolidating reviewer feedback…</p>}

          {data && (
            <>
              {/* Denominator — N successful of M intended (a failed lane is not a vote). */}
              <div className="flex items-start gap-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
                <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-500" />
                <span>
                  {data.denominator.successful} of {data.denominator.intended} configured reviewers returned substantive feedback
                  {data.denominator.missing.length > 0 && <> (no return: {data.denominator.missing.join(', ')})</>}.
                  {!data.convergenceFloorMet && (
                    <> Fewer than two reviewers returned — no items are treated as convergent (everything is a per-item decision).</>
                  )}
                </span>
              </div>

              {/* Convergent + low-risk — eligible for grouped confirmation (Fork A: expand-to-see). */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <GitMerge className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-xs font-semibold text-gray-700">
                    Convergent &amp; low-risk — eligible for grouped confirmation ({bulkEligibleGroups.length})
                  </h4>
                </div>
                {bulkEligibleGroups.length === 0 ? (
                  <p className="text-xs text-gray-400">None this run.</p>
                ) : (
                  <ul className="space-y-1">
                    {bulkEligibleGroups.map((g) => {
                      const allSelected = g.members.length > 0 && g.members.every((m) => selectedIds.has(m.suggestionId));
                      return (
                        <li key={g.issueId} className="border border-gray-200 rounded">
                          <button
                            onClick={() => toggle(g.issueId)}
                            className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-gray-50"
                          >
                            <span className="text-xs font-medium text-gray-700 flex-1">
                              {g.severity || 'unspecified'} · {g.agreedCount} reviewers agreed · {g.members.length} item{g.members.length === 1 ? '' : 's'}
                            </span>
                            {allSelected && <span className="text-[10px] text-emerald-700">selected</span>}
                            {expanded[g.issueId] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          {expanded[g.issueId] && (
                            <div className="px-2 pb-2 space-y-1">
                              <ul
                                ref={ackIfNotScrollable(g.issueId)}
                                onScroll={onMembersScroll(g.issueId)}
                                data-testid={`bulk-group-members-${g.issueId}`}
                                className="space-y-0.5 max-h-32 overflow-y-auto"
                              >
                                {g.members.map((m) => (
                                  <li key={m.suggestionId} className="text-[11px] text-gray-600">
                                    <span className="font-medium">{m.reviewerRole}</span>: {m.position}
                                  </li>
                                ))}
                              </ul>
                              {!allSelected && !scrollAcked[g.issueId] && (
                                <p className="text-[10px] text-amber-700" data-testid={`bulk-scroll-ack-hint-${g.issueId}`}>
                                  Scroll through all items above to enable grouped confirmation.
                                </p>
                              )}
                              <DeliberateActButton
                                onClick={() => confirmGroup(g.members)}
                                disabled={allSelected || updateSelection.isPending || !scrollAcked[g.issueId]}
                                size="sm"
                                tone="ghost"
                              >
                                {allSelected ? 'Selected for regeneration' : 'Confirm group'}
                              </DeliberateActButton>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  Confirmation appears only after you expand a group to see its items — never a one-click bulk adopt, no typed attestation. Confirming selects the items for your next regeneration (recorded as a grouped acknowledgment); the attorney is always the final decision-maker.
                </p>
              </section>

              {/* Per-item decisions — convergent-high-risk + single-reviewer. */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <ListChecks className="w-4 h-4 text-gray-500" />
                  <h4 className="text-xs font-semibold text-gray-700">Per-item decisions ({perItem.length})</h4>
                </div>
                {perItem.length === 0 ? (
                  <p className="text-xs text-gray-400">None this run.</p>
                ) : (
                  <ul className="space-y-1">
                    {perItem.map((g) => (
                      <li key={g.issueId} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600">
                        <span className="font-medium">{g.severity || 'unspecified'}</span> — {g.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Divergent disagreements — content-preserving, never auto-close (Fork E). */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <h4 className="text-xs font-semibold text-gray-700">Reviewer disagreements ({divergentItems.length})</h4>
                </div>
                {divergentItems.length === 0 ? (
                  <p className="text-xs text-gray-400">None this run.</p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {divergentItems.map((item) => (
                        <li key={item.issueId} className="border border-line bg-warning-tint rounded p-2">
                          <p className="text-xs font-medium text-ink">{item.summary}</p>
                          <ul className="mt-1 space-y-0.5">
                            {item.detail.positions.map((p) => (
                              <li key={p.suggestionId} className="text-[11px] text-ink-secondary">
                                <span className="font-medium">{p.reviewerRole}</span>
                                {p.severity ? ` [${p.severity}]` : ''}: {p.position}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    {/* R2-2 Inc B: prominent NON-PERSISTENCE flag. Until recorded, these divergent
                        items are ephemeral (per-session) and will disappear on the next regeneration
                        or session close. Recording is a deliberate act (✦) that makes them durable. */}
                    <p className="mt-2 text-[11px] font-medium text-warning">
                      Until you record them, these disagreements are not saved — they disappear on the next
                      regeneration or when this session closes.
                    </p>
                    <DeliberateActButton
                      onClick={() => registerDivergent.mutate({ reviewSessionId })}
                      disabled={registerDivergent.isPending}
                      size="sm"
                      className="mt-1.5"
                      tone="ghost"
                    >
                      {registerDivergent.isPending ? 'Recording…' : 'Record disagreements as open items'}
                    </DeliberateActButton>
                    <p className="mt-1 text-[11px] text-ink-hint">
                      Recorded disagreements become matter open items that only you can resolve — a later review pass never closes them automatically.
                    </p>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
