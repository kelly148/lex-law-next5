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

interface OrchestrationConsolidationPanelProps {
  reviewSessionId: string;
}

export default function OrchestrationConsolidationPanel({
  reviewSessionId,
}: OrchestrationConsolidationPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const utils = trpc.useUtils();
  const consolidation = trpc.orchestration.getConsolidation.useQuery({ reviewSessionId }, { enabled: open });

  const registerDivergent = useGuardedMutation(
    (input: { reviewSessionId: string }) => utils.client.orchestration.registerDivergentItems.mutate(input),
    { onSuccess: () => { void utils.orchestration.getConsolidation.invalidate({ reviewSessionId }); } },
  );

  const data = consolidation.data;
  const groups = data?.groups ?? [];
  const divergentItems = data?.divergentItems ?? [];
  const bulkEligible = groups.filter((g) => g.classification === 'convergent_low_risk');
  const perItem = groups.filter((g) => g.bucket === 'per_item' && g.classification !== 'divergent');

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

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

              {/* Convergent + low-risk — eligible for grouped confirmation (Inc3c-2 wires the act). */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <GitMerge className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-xs font-semibold text-gray-700">
                    Convergent &amp; low-risk — eligible for grouped confirmation ({bulkEligible.length})
                  </h4>
                </div>
                {bulkEligible.length === 0 ? (
                  <p className="text-xs text-gray-400">None this run.</p>
                ) : (
                  <ul className="space-y-1">
                    {bulkEligible.map((g) => (
                      <li key={g.issueId} className="border border-gray-200 rounded">
                        <button
                          onClick={() => toggle(g.issueId)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-gray-50"
                        >
                          <span className="text-xs font-medium text-gray-700 flex-1">
                            {g.severity || 'unspecified'} · {g.agreedCount} reviewers agreed
                          </span>
                          {expanded[g.issueId] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {expanded[g.issueId] && (
                          <p className="px-2 pb-2 text-[11px] text-gray-500">{g.reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  Grouped confirmation requires expanding each item first; it is never a one-click bulk adopt. The attorney is always the final decision-maker.
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
                        <li key={item.issueId} className="border border-amber-200 bg-amber-50 rounded p-2">
                          <p className="text-xs font-medium text-amber-900">{item.summary}</p>
                          <ul className="mt-1 space-y-0.5">
                            {item.detail.positions.map((p) => (
                              <li key={p.suggestionId} className="text-[11px] text-amber-800">
                                <span className="font-medium">{p.reviewerRole}</span>
                                {p.severity ? ` [${p.severity}]` : ''}: {p.position}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => registerDivergent.mutate({ reviewSessionId })}
                      disabled={registerDivergent.isPending}
                      className="mt-2 px-3 py-1.5 text-xs border border-amber-300 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50"
                    >
                      {registerDivergent.isPending ? 'Recording…' : 'Record disagreements as open items'}
                    </button>
                    <p className="mt-1 text-[11px] text-gray-400">
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
