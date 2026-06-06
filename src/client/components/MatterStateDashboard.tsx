/**
 * MatterStateDashboard — FOLD-L1-5.
 *
 * The inspectable matter-state dashboard + the FIVE EXPLICIT ACTS as deliberate, visible,
 * confirmable commitments (never inferred from conversation):
 *   (1) lock a decision      — surfaced in ReviewPane (pre-existing); shown here read-only
 *   (2) tier a source        — explicit form (attorney designation)
 *   (3) disposition an item  — resolve / withdraw on an open item
 *   (4) send / withhold      — explicit, fail-visibly-audited commitment
 *   (5) matter identity      — always-visible anchor (header)
 *
 * Every act routes through a single explicit confirm step (no ambient inference). Reads use
 * matterState.dashboard; mutations use useGuardedMutation (Ch 35.13). No business logic in
 * React (Ch 35.3) — the server enforces the acts.
 *
 * Procedures: matterState.dashboard (query); matterState.dispositionItem / recordSend /
 * tierSource (mutations).
 */
import React, { useState } from 'react';
import ProvenanceBadge from './ProvenanceBadge.js';
import {
  LayoutDashboard,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  ScrollText,
  AlertCircle,
  FileStack,
} from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface MatterStateDashboardProps {
  matterId: string;
  documentId?: string;
}

type AuthorityOrigin = 'operative' | 'counterparty' | 'firm' | 'client' | 'model_derived' | 'reference';
type Lifecycle = 'current_draft' | 'operative' | 'superseded';

interface PendingAct {
  label: string;
  run: () => void;
}

export default function MatterStateDashboard({ matterId, documentId }: MatterStateDashboardProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [showPacket, setShowPacket] = useState(false);
  const [pending, setPending] = useState<PendingAct | null>(null);

  // send-act form state
  const [sendDecision, setSendDecision] = useState<'sent' | 'withheld'>('withheld');
  const [sendSummary, setSendSummary] = useState('');
  // tier-act form state
  const [tierOrigin, setTierOrigin] = useState<AuthorityOrigin>('operative');
  const [tierLifecycle, setTierLifecycle] = useState<Lifecycle>('operative');

  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.matterState.dashboard.useQuery(
    { matterId, ...(documentId ? { documentId } : {}) },
    { enabled: open, staleTime: 15_000 },
  );

  const invalidate = () => {
    void utils.matterState.dashboard.invalidate();
  };

  const dispositionMutation = useGuardedMutation(
    (input: { openItemId: string; action: 'resolve' | 'withdraw'; rationale?: string | null }) =>
      utils.client.matterState.dispositionItem.mutate(input),
    { onSuccess: invalidate },
  );
  const sendMutation = useGuardedMutation(
    (input: { matterId: string; documentId?: string | null; decision: 'sent' | 'withheld'; summary: string }) =>
      utils.client.matterState.recordSend.mutate(input),
    { onSuccess: () => { setSendSummary(''); invalidate(); } },
  );
  const tierMutation = useGuardedMutation(
    (input: {
      matterId: string;
      subjectType: 'document';
      subjectId: string;
      authorityOrigin: AuthorityOrigin;
      lifecycle: Lifecycle;
    }) => utils.client.matterState.tierSource.mutate(input),
    { onSuccess: invalidate },
  );

  const full = data?.full;
  const openItems = (full?.openItems ?? []).filter((i) => i.status === 'open');

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
      {/* Header (always visible — the matter-identity anchor doubles as the toggle) */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100"
      >
        <LayoutDashboard className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Matter State</h3>
        {full && (
          <span
            className={clsx(
              'text-xs px-1.5 py-0.5 rounded',
              full.safeToSend.posture === 'blocked' && 'bg-red-100 text-red-700',
              full.safeToSend.posture === 'clear' && 'bg-green-100 text-green-700',
              full.safeToSend.posture === 'unknown' && 'bg-gray-200 text-gray-600',
            )}
          >
            {full.safeToSend.posture === 'blocked'
              ? `${full.safeToSend.openBlockerCount} blocker(s)`
              : full.safeToSend.posture}
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {isLoading && <p className="text-sm text-gray-400 text-center py-4">Loading matter state…</p>}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" /> Error: {error.message}
            </div>
          )}

          {/* Explicit-act confirmation bar */}
          {pending && (
            <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm">
              <span className="flex-1 text-amber-800">Confirm: {pending.label}</span>
              <button
                onClick={() => { pending.run(); setPending(null); }}
                className="px-2 py-1 text-xs bg-firm-navy text-white rounded"
              >
                Confirm
              </button>
              <button onClick={() => setPending(null)} className="px-2 py-1 text-xs border border-gray-300 rounded">
                Cancel
              </button>
            </div>
          )}

          {full && (
            <>
              {/* State summary */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-lg font-semibold text-gray-700">{full.counts.lockedDecisionsActive}</div>
                  <div className="text-xs text-gray-600">Locked</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-lg font-semibold text-gray-700">{full.counts.adoptionsActive}</div>
                  <div className="text-xs text-gray-600">Adopted</div>
                </div>
                <div className="bg-gray-50 rounded p-2">
                  <div className="text-lg font-semibold text-gray-700">{full.counts.openItemsOpen}</div>
                  <div className="text-xs text-gray-600">Open items</div>
                </div>
              </div>

              {/* Sendability + the SEND act */}
              <div className="border border-gray-200 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  {full.safeToSend.posture === 'blocked' ? (
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-green-600" />
                  )}
                  <span className="text-xs font-medium text-gray-700">
                    Sendability: {full.safeToSend.posture}
                    {full.safeToSend.posture === 'blocked' && ` (${full.safeToSend.openBlockerCount} open blocker(s))`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={sendDecision}
                    onChange={(e) => setSendDecision(e.target.value as 'sent' | 'withheld')}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="withheld">Withhold</option>
                    <option value="sent">Send</option>
                  </select>
                  <input
                    value={sendSummary}
                    onChange={(e) => setSendSummary(e.target.value)}
                    placeholder="Reason / summary (required)"
                    className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
                  />
                  <button
                    disabled={!sendSummary.trim() || sendMutation.isPending}
                    onClick={() =>
                      setPending({
                        label: `record "${sendDecision}" for this matter`,
                        run: () =>
                          sendMutation.mutate({
                            matterId,
                            documentId: documentId ?? null,
                            decision: sendDecision,
                            summary: sendSummary.trim(),
                          }),
                      })
                    }
                    className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-40"
                  >
                    Record
                  </button>
                </div>
              </div>

              {/* Open items + the DISPOSITION act */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  <span>Open items ({openItems.length})</span>
                </div>
                {openItems.length === 0 ? (
                  <p className="text-xs text-gray-400">No open items.</p>
                ) : (
                  <div className="space-y-1">
                    {openItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-gray-50 rounded">
                        <span
                          className={clsx(
                            'px-1 rounded text-[10px] uppercase',
                            item.severity === 'blocker' && 'bg-red-100 text-red-700',
                            item.severity === 'substantive' && 'bg-amber-100 text-amber-700',
                            item.severity === 'polish' && 'bg-gray-200 text-gray-600',
                          )}
                        >
                          {item.severity}
                        </span>
                        <span className="flex-1 truncate text-gray-700">{item.summary}</span>
                        <button
                          onClick={() =>
                            setPending({
                              label: `resolve open item "${item.summary.slice(0, 40)}"`,
                              run: () => dispositionMutation.mutate({ openItemId: item.id, action: 'resolve' }),
                            })
                          }
                          className="text-firm-navy hover:underline"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() =>
                            setPending({
                              label: `withdraw open item "${item.summary.slice(0, 40)}"`,
                              run: () => dispositionMutation.mutate({ openItemId: item.id, action: 'withdraw' }),
                            })
                          }
                          className="text-gray-500 hover:underline"
                        >
                          Withdraw
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Source authority + the TIER act (operative document) */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-2">
                  <FileStack className="w-3.5 h-3.5 text-firm-navy" />
                  <span>Source authority ({full.sourceAuthorities.length})</span>
                </div>
                {full.operativeDocument && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500 flex-1 truncate">
                      Tier operative document: {full.operativeDocument.title}
                    </span>
                    <select
                      value={tierOrigin}
                      onChange={(e) => setTierOrigin(e.target.value as AuthorityOrigin)}
                      className="text-xs border border-gray-300 rounded px-1 py-1"
                    >
                      {(['operative', 'counterparty', 'firm', 'client', 'model_derived', 'reference'] as const).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <select
                      value={tierLifecycle}
                      onChange={(e) => setTierLifecycle(e.target.value as Lifecycle)}
                      className="text-xs border border-gray-300 rounded px-1 py-1"
                    >
                      {(['current_draft', 'operative', 'superseded'] as const).map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <button
                      disabled={tierMutation.isPending}
                      onClick={() => {
                        const od = full.operativeDocument;
                        if (!od) return;
                        setPending({
                          label: `tier "${od.title}" as ${tierOrigin}/${tierLifecycle}`,
                          run: () =>
                            tierMutation.mutate({
                              matterId,
                              subjectType: 'document',
                              subjectId: od.documentId,
                              authorityOrigin: tierOrigin,
                              lifecycle: tierLifecycle,
                            }),
                        });
                      }}
                      className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-40"
                    >
                      Tier
                    </button>
                  </div>
                )}
                {full.sourceAuthorities.length > 0 && (
                  <div className="space-y-1">
                    {full.sourceAuthorities.slice(0, 10).map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-gray-50 rounded">
                        <ProvenanceBadge origin={s.authorityOrigin} verification={s.verificationStatus} currency={s.lifecycle} />
                        <span className="flex-1 truncate text-gray-700">{s.label ?? `${s.subjectType}:${s.subjectId.slice(0, 8)}…`}</span>
                        <span className="text-gray-400">{s.designationSource}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Decision log (audit / matter record) */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-2">
                  <ScrollText className="w-3.5 h-3.5 text-firm-navy" />
                  <span>Decision log ({full.auditEvents.length})</span>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {full.auditEvents.slice(0, 25).map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-gray-50 rounded">
                      <span className="text-gray-400 uppercase text-[10px]">{e.eventType}</span>
                      <span className="flex-1 truncate text-gray-700">{e.summary}</span>
                      <span className="text-gray-400">{e.actor}</span>
                    </div>
                  ))}
                  {full.auditEvents.length === 0 && <p className="text-xs text-gray-400">No recorded decisions yet.</p>}
                </div>
              </div>

              {/* Model-context-packet preview (the exact L1-2 block) */}
              <div>
                <button
                  onClick={() => setShowPacket(!showPacket)}
                  className="flex items-center gap-2 w-full text-xs font-medium text-gray-700 hover:text-firm-navy mb-2"
                >
                  <span>Model-context packet preview</span>
                  {showPacket ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </button>
                {showPacket && (
                  <pre className="text-[11px] whitespace-pre-wrap bg-gray-900 text-gray-100 rounded p-3 max-h-64 overflow-y-auto">
                    {data?.modelContextPacket || '(empty)'}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
