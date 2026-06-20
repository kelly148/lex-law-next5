/**
 * MatterIntakePanel — FOLD-L0-1 Increment 2 (the Layer-0 intake / analysis surface).
 *
 * Surfaces: parties (thin), the conflicts-at-intake check + disposition, and the
 * assessment-and-plan with plan-lock. Fork A HARD ACCEPTANCE CRITERION: the false-negative
 * disclosure (CONFLICT_FALSE_NEGATIVE_DISCLOSURE) is shown AT the disposition surface, and
 * a BLOCKER-severity hit cannot be dispositioned without a recorded rationale. Mutations use
 * useGuardedMutation (Ch 35.13); no business logic in React (Ch 35.3) — the server enforces.
 *
 * Procedures: matterIntake.listParties / getLatestConflicts / getAnalysis (queries);
 * addParty / runConflictCheck / dispositionHit / generateAnalysis / lockPlan (mutations).
 */
import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, UserPlus, ScanSearch, Lock, BadgeCheck } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { CONFLICT_FALSE_NEGATIVE_DISCLOSURE } from '../../shared/schemas/layer0.js';
import { RecommendedInstances } from './RecommendedInstances.js';

interface MatterIntakePanelProps {
  matterId: string;
}

type Role = 'client' | 'adverse' | 'related' | 'other';
type Disposition = 'cleared' | 'screened' | 'declined';

export default function MatterIntakePanel({ matterId }: MatterIntakePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [partyRole, setPartyRole] = useState<Role>('client');
  const [rationales, setRationales] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();
  const parties = trpc.matterIntake.listParties.useQuery({ matterId }, { enabled: open });
  const conflicts = trpc.matterIntake.getLatestConflicts.useQuery({ matterId }, { enabled: open });
  const analysis = trpc.matterIntake.getAnalysis.useQuery({ matterId }, { enabled: open });
  // R2-PRE-CONFLICT-1 Inc 3c: the matter's clientName feeds the constraint-B side-by-side
  // name advisory at confirm time. (All hooks run unconditionally, before any return — #310 guard.)
  const matter = trpc.matter.get.useQuery({ matterId }, { enabled: open });

  const invalidate = () => {
    void utils.matterIntake.listParties.invalidate({ matterId });
    void utils.matterIntake.getLatestConflicts.invalidate({ matterId });
    void utils.matterIntake.getAnalysis.invalidate({ matterId });
    // MATTERSTATE-LIVE-REFRESH-1 (F1-class, #355): the LEFT Matter State summary reads queries the intake
    // panel did not invalidate, so it lagged until a manual reload after an intake action (conflict
    // disposition, party confirm, plan lock). Refresh both sources so clearance reflects live:
    //   - matterState.dashboard -> the "Conflicts: …" summary (MatterRecitalBand)
    //   - gateOverride.getGate   -> the "Drafting blocked" banner (GateOverridePanel)
    // Cosmetic only — the gate logic is server-authoritative and unchanged.
    void utils.matterState.dashboard.invalidate();
    void utils.gateOverride.getGate.invalidate({ matterId });
  };

  const addParty = useGuardedMutation(
    (input: { matterId: string; role: Role; displayName: string }) => utils.client.matterIntake.addParty.mutate(input),
    { onSuccess: () => { setPartyName(''); invalidate(); } },
  );
  const runCheck = useGuardedMutation(
    (input: { matterId: string }) => utils.client.matterIntake.runConflictCheck.mutate(input),
    { onSuccess: invalidate },
  );
  const disposition = useGuardedMutation(
    (input: { hitId: string; disposition: Disposition; rationale?: string | null }) => utils.client.matterIntake.dispositionHit.mutate(input),
    { onSuccess: invalidate },
  );
  const generateAnalysis = useGuardedMutation(
    (input: { matterId: string }) => utils.client.matterIntake.generateAnalysis.mutate(input),
    { onSuccess: invalidate },
  );
  const lockPlan = useGuardedMutation(
    (input: { analysisId: string; rationale?: string | null }) => utils.client.matterIntake.lockPlan.mutate(input),
    { onSuccess: invalidate },
  );
  // R2-PRE-CONFLICT-1 Inc 3c (BLOCK #5): the first-class, immutably-logged confirm act. attestation=true
  // is the attorney's side-by-side clientName-vs-party acknowledgment (§3B). Server records the audit.
  const confirmParty = useGuardedMutation(
    (input: { partyId: string; attestation?: boolean }) => utils.client.matterIntake.confirmParty.mutate(input),
    { onSuccess: invalidate },
  );

  const hits = conflicts.data?.hits ?? [];
  const pendingHits = hits.filter((h) => h.disposition === 'pending');
  const a = analysis.data;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100">
        <ScanSearch className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Matter Intake &amp; Analysis (Layer 0)</h3>
        {pendingHits.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{pendingHits.length} conflict(s) to disposition</span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-5">
          {/* Parties */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">Parties</div>
            <div className="flex items-center gap-2 mb-2">
              <select value={partyRole} onChange={(e) => setPartyRole(e.target.value as Role)} className="text-xs border border-gray-300 rounded px-2 py-1">
                <option value="client">client</option>
                <option value="adverse">adverse</option>
                <option value="related">related</option>
                <option value="other">other</option>
              </select>
              <input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Party name" className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" />
              <button
                disabled={!partyName.trim() || addParty.isPending}
                onClick={() => addParty.mutate({ matterId, role: partyRole, displayName: partyName.trim() })}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40"
              >
                <UserPlus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-1">
              {(parties.data ?? []).map((p) => {
                // Treat ONLY an explicit confirmed===true as vouched (a pre-migration/undefined row is
                // unconfirmed — screened, not yet attorney-verified). Constraint G: an unconfirmed row is
                // never displayed as an attorney-asserted party.
                const isConfirmed = p.confirmed === true;
                const clientName = (matter.data?.clientName ?? '').trim();
                // Constraint B: SOFT, OVERRIDABLE name-mismatch advisory at confirm time (NEVER a gate).
                // Advisory-grade normalization — the canonical gate-grade normalizeName is server-side;
                // this display check is deliberately lenient (real legal names produce false-negatives, §3B).
                const advisoryNormalize = (s: string): string =>
                  s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
                const nameMismatch =
                  p.role === 'client' && clientName.length > 0 && advisoryNormalize(p.displayName) !== advisoryNormalize(clientName);
                return (
                  <div key={p.id} className="text-xs px-2 py-1 bg-gray-50 rounded">
                    <div className="flex items-center gap-2">
                      <span className="px-1 rounded bg-gray-200 text-gray-700">{p.role}</span>
                      <span className="flex-1 truncate text-gray-700">{p.displayName}</span>
                      <span
                        className={clsx(
                          'px-1 rounded text-[10px] flex items-center gap-1',
                          isConfirmed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800',
                        )}
                      >
                        {isConfirmed ? (<><BadgeCheck className="w-3 h-3" /> confirmed</>) : 'unconfirmed — screened, not yet verified'}
                      </span>
                      {!isConfirmed && (
                        <button
                          onClick={() => confirmParty.mutate({ partyId: p.id, attestation: true })}
                          disabled={confirmParty.isPending}
                          title="Confirm this party's identity — the explicit attorney judgment required before conflicts clearance"
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] border border-line text-ink rounded hover:bg-surface disabled:opacity-40"
                        >
                          <BadgeCheck className="w-3 h-3" /> Confirm
                        </button>
                      )}
                    </div>
                    {!isConfirmed && p.role === 'client' && clientName.length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        Matter client name: <span className="text-gray-700">{clientName}</span> · party: <span className="text-gray-700">{p.displayName}</span>
                        {nameMismatch && (
                          <span className="block text-amber-700">
                            Advisory: this party name differs from the matter client name. Confirm only if this party correctly represents the client — you may override.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(parties.data ?? []).length === 0 && <p className="text-xs text-gray-400">No parties yet — add the client and any adverse/related parties before the conflicts check.</p>}
            </div>
          </section>

          {/* Conflicts-at-intake */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-medium text-gray-700 flex-1">Conflicts check</div>
              <button onClick={() => runCheck.mutate({ matterId })} disabled={runCheck.isPending} className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40">
                Run conflicts check
              </button>
            </div>

            {/* HARD ACCEPTANCE CRITERION (Fork A): the false-negative disclosure, AT the disposition surface. */}
            <div className="flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" />
              <span>{CONFLICT_FALSE_NEGATIVE_DISCLOSURE}</span>
            </div>

            {conflicts.data?.check == null && <p className="text-xs text-gray-400">No conflicts check has run for this matter yet.</p>}
            {conflicts.data?.check != null && hits.length === 0 && (
              <p className="text-xs text-green-700 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> No conflict hits found (name-match only — see the disclosure above).</p>
            )}

            <div className="space-y-2">
              {hits.map((h) => (
                <div key={h.id} className={clsx('text-xs rounded p-2 border', h.severity === 'blocker' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx('px-1 rounded text-[10px] uppercase flex items-center gap-1', h.severity === 'blocker' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800')}>
                      {h.severity === 'blocker' ? <ShieldAlert className="w-3 h-3" /> : null}{h.severity}
                    </span>
                    <span className="flex-1 text-gray-700">{h.matchBasis}</span>
                    <span className={clsx('px-1 rounded text-[10px]', h.disposition === 'pending' ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-700')}>{h.disposition}</span>
                  </div>
                  {h.disposition === 'pending' ? (
                    <div className="space-y-1">
                      <textarea
                        value={rationales[h.id] ?? ''}
                        onChange={(e) => setRationales((r) => ({ ...r, [h.id]: e.target.value }))}
                        placeholder={h.severity === 'blocker' ? 'Rationale REQUIRED to disposition a blocker (recorded for the matter record)' : 'Rationale (optional)'}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        {(['cleared', 'screened', 'declined'] as const).map((d) => {
                          const rationale = (rationales[h.id] ?? '').trim();
                          const needRationale = h.severity === 'blocker' && rationale.length === 0;
                          return (
                            <button
                              key={d}
                              disabled={needRationale || disposition.isPending}
                              title={needRationale ? 'A blocker requires a recorded rationale' : ''}
                              onClick={() => disposition.mutate({ hitId: h.id, disposition: d, rationale: rationale || null })}
                              className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-white disabled:opacity-40"
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    h.dispositionRationale && <p className="text-[11px] text-gray-500">Rationale: {h.dispositionRationale}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Assessment & plan */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">Assessment &amp; plan</div>
            {a == null ? (
              <div className="space-y-1">
                <button onClick={() => generateAnalysis.mutate({ matterId })} disabled={generateAnalysis.isPending} className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40">
                  {generateAnalysis.isPending ? 'Generating analysis…' : 'Generate analysis (Claude, single-lane)'}
                </button>
                <p className="text-[11px] text-gray-400">Internal attorney work-product — not a client-facing or sendable document.</p>
                {generateAnalysis.error && <p className="text-[11px] text-red-600">{generateAnalysis.error.message}</p>}
              </div>
            ) : (
              <div className="text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className={clsx('px-1.5 py-0.5 rounded', a.status === 'locked' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700')}>plan: {a.status}</span>
                  <span className="text-gray-400">lane: {a.modelLane}</span>
                  <span className="text-gray-400">sendability: {a.sendabilityStatus}</span>
                </div>
                {typeof a.assessment === 'string' && a.assessment.trim().length > 0 && (
                  <div>
                    <div className="font-medium text-gray-600">Assessment</div>
                    <p className="text-gray-700 whitespace-pre-wrap">{a.assessment}</p>
                  </div>
                )}
                {typeof a.plan === 'string' && a.plan.trim().length > 0 && (
                  <div>
                    <div className="font-medium text-gray-600">Plan</div>
                    <p className="text-gray-700 whitespace-pre-wrap">{a.plan}</p>
                  </div>
                )}
                {Array.isArray(a.openQuestions) && a.openQuestions.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-600">Open questions</div>
                    <ul className="list-disc list-inside text-gray-700">
                      {(a.openQuestions as string[]).map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
                {Array.isArray(a.recommendedDocuments) && a.recommendedDocuments.length > 0 && (
                  <div>
                    <div className="font-medium text-gray-600">Recommended documents (attorney decides)</div>
                    {/* DOC-CLIENT-TARGET-1 Inc 4: enumerate per-client INSTANCES, not bare types
                        (two POAs / two wills for a multi-client matter; one joint trust). */}
                    <RecommendedInstances
                      matterId={matterId}
                      recommendedDocuments={a.recommendedDocuments as Array<{ documentType?: string; title?: string; rationale?: string }>}
                    />
                  </div>
                )}
                {a.status === 'draft' && (
                  <button
                    onClick={() => lockPlan.mutate({ analysisId: a.id, rationale: null })}
                    disabled={lockPlan.isPending || pendingHits.length > 0}
                    title={pendingHits.length > 0 ? 'Disposition all conflict hits before locking the plan' : ''}
                    className="flex items-center gap-1 px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40"
                  >
                    <Lock className="w-3 h-3" /> Lock plan (plan-only closure)
                  </button>
                )}
                {lockPlan.error && <p className="text-[11px] text-red-600">{lockPlan.error.message}</p>}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
