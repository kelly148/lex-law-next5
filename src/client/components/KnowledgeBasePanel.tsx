/**
 * KnowledgeBasePanel — FOLD-KB-1 Increment 5 (the Practice Knowledge Base surface).
 *
 * Matter-context KB: confirm the per-PA profile key (Fork E), see PROACTIVELY SURFACED memos
 * (deterministic, gated, currency-annotated — Fork F) and ADOPT them (the explicit authorize-use
 * act — Fork A), file/manage this matter's memos (capture stays most-private; abstraction +
 * promotion are explicit gated acts — Fork B/C/G), and capture the latest analysis as a memo.
 *
 * Memos are surfaced, never auto-injected (surface-not-inject). The KB_DERIVED_DISCLOSURE is
 * shown at the surface. All mutations route through useGuardedMutation (Ch 35.13); no business
 * logic in React (Ch 35.3) — the server enforces the gate, abstraction requirement, and audit.
 *
 * Whereas R2 #6 (KB / source-authority adoption surface) — DISPLAY-ONLY delta, no backend:
 *  (1) candidate-vs-adopted — surfaced candidates already adopted into this matter read as
 *      "Adopted" (snapshotted currency posture) instead of offering re-adoption (reads the
 *      existing practiceKb.listAdoptions provenance);
 *  (2) deliberate-commit + audit — the material KB acts (adopt / abstract / promote / mark-verified)
 *      use the standardized DeliberateActButton (the server kb_events audit is unchanged);
 *  (3) provenance/currency legibility — surfaced candidates carry the R2 #5 ProvenanceBadge;
 *  (4) show-ready states (definition of done) — loading skeleton + a designed inline error notice
 *      (never blank), and no blue on this surface (semantic --wa- tints only).
 */
import React, { useState } from 'react';
import { BookMarked, ChevronDown, ChevronUp, AlertTriangle, FilePlus, ShieldCheck, Lock, RefreshCw, CheckCircle2 } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { KB_DERIVED_DISCLOSURE } from '../../shared/schemas/practiceKb.js';
import ProvenanceBadge from './ProvenanceBadge.js';
import DeliberateActButton from './DeliberateActButton.js';

interface KnowledgeBasePanelProps {
  matterId: string;
}

export default function KnowledgeBasePanel({ matterId }: KnowledgeBasePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [paKeyInput, setPaKeyInput] = useState('');
  const [memoTitle, setMemoTitle] = useState('');
  const [memoBody, setMemoBody] = useState('');
  const [abstractBody, setAbstractBody] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();
  const matter = trpc.matter.get.useQuery({ matterId }, { enabled: open });
  const candidates = trpc.practiceKb.surfaceCandidates.useQuery({ matterId }, { enabled: open });
  const memos = trpc.practiceKb.listMemosForMatter.useQuery({ matterId }, { enabled: open });
  const adoptions = trpc.practiceKb.listAdoptions.useQuery({ matterId }, { enabled: open });
  const analysis = trpc.matterIntake.getAnalysis.useQuery({ matterId }, { enabled: open });

  const invalidate = () => {
    void utils.practiceKb.surfaceCandidates.invalidate({ matterId });
    void utils.practiceKb.listMemosForMatter.invalidate({ matterId });
    void utils.practiceKb.listAdoptions.invalidate({ matterId });
    void utils.matter.get.invalidate({ matterId });
  };

  const confirmPaKey = useGuardedMutation(
    (input: { matterId: string; paKey: string | null }) => utils.client.practiceKb.confirmMatterPaKey.mutate(input),
    { onSuccess: invalidate },
  );
  const createMemo = useGuardedMutation(
    (input: { matterId: string; title: string; body: string; sourceAnalysisId?: string | null }) => utils.client.practiceKb.createMemo.mutate(input),
    { onSuccess: () => { setMemoTitle(''); setMemoBody(''); invalidate(); } },
  );
  const adoptMemo = useGuardedMutation(
    (input: { memoId: string; targetMatterId: string }) => utils.client.practiceKb.adoptMemo.mutate(input),
    { onSuccess: invalidate },
  );
  const abstractMemo = useGuardedMutation(
    (input: { rawMemoId: string; abstractedBody: string; abstractedBy: 'attorney' | 'system_assisted_attorney' }) => utils.client.practiceKb.abstractMemo.mutate(input),
    { onSuccess: invalidate },
  );
  const promoteMemo = useGuardedMutation(
    (input: { memoId: string }) => utils.client.practiceKb.promoteMemo.mutate(input),
    { onSuccess: invalidate },
  );
  const markReverified = useGuardedMutation(
    (input: { memoId: string; verificationStatus: 'attorney_verified_current' | 'stale' | 'superseded' | 'not_legal_authority' }) => utils.client.practiceKb.markReverified.mutate(input),
    { onSuccess: invalidate },
  );

  const surfaced = candidates.data ?? [];
  const myMemos = memos.data ?? [];
  const currentPaKey = matter.data?.paKey ?? null;
  const a = analysis.data;

  // R2 #6 — candidate-vs-adopted: a memo already adopted into THIS matter (durable
  // kb_adoptions provenance) reads as "Adopted" with its snapshotted currency posture,
  // rather than re-offering the adopt act.
  const adoptionByMemoId = new Map((adoptions.data ?? []).map((r) => [r.kbMemoId, r] as const));
  const candidatesLoading = candidates.isLoading || adoptions.isLoading;
  const candidatesError = candidates.isError || adoptions.isError;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100">
        <BookMarked className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Practice Knowledge Base</h3>
        {surfaced.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-surface text-ink-secondary border border-line">{surfaced.length} potentially relevant</span>}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-5">
          {/* Disclosure — KB is an accelerator, never a current source of law */}
          <div className="flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" />
            <span>{KB_DERIVED_DISCLOSURE}</span>
          </div>

          {/* Per-PA profile key (Fork E) */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">Practice-area profile</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Confirmed key:</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{currentPaKey ?? 'none (base prompt)'}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input value={paKeyInput} onChange={(e) => setPaKeyInput(e.target.value)} placeholder="e.g. real_estate" className="flex-1 text-xs border border-gray-300 rounded px-2 py-1" />
              <button disabled={!paKeyInput.trim() || confirmPaKey.isPending} onClick={() => confirmPaKey.mutate({ matterId, paKey: paKeyInput.trim() })} className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40">Confirm</button>
              {currentPaKey && <button disabled={confirmPaKey.isPending} onClick={() => confirmPaKey.mutate({ matterId, paKey: null })} className="px-2 py-1 text-xs border border-gray-300 rounded">Clear</button>}
            </div>
          </section>

          {/* Surfaced candidates (Fork F) + adopt (Fork A). R2 #6: candidate-vs-adopted, provenance, deliberate-commit. */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">Potentially relevant memos</div>
            {candidatesError ? (
              <div data-testid="kb-candidates-error" className="flex items-start gap-2 text-[11px] text-ink-secondary bg-surface border border-line rounded p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-warning" />
                <span>Couldn&apos;t load the knowledge base just now. Your matter and filed memos are intact — reopen this panel to retry.</span>
              </div>
            ) : candidatesLoading ? (
              <div data-testid="kb-candidates-loading" className="space-y-2" aria-hidden>
                <div className="h-9 rounded bg-surface border border-line animate-pulse" />
                <div className="h-9 rounded bg-surface border border-line animate-pulse" />
              </div>
            ) : surfaced.length === 0 ? (
              <p className="text-xs text-gray-400">No relevant memos surfaced for this matter.</p>
            ) : (
              <div className="space-y-2">
                {surfaced.map((c) => {
                  const adoption = adoptionByMemoId.get(c.memoId);
                  return (
                    <div key={c.memoId} className="text-xs rounded p-2 border border-gray-200 bg-gray-50">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="flex-1 font-medium text-gray-700">{c.title}</span>
                        {c.crossMatter && <span className="px-1 rounded text-[10px] bg-surface text-ink-secondary border border-line">cross-matter</span>}
                        <span className="px-1 rounded text-[10px] bg-gray-200 text-gray-600">{c.privilegeTag}</span>
                        <ProvenanceBadge verification={c.verificationStatus} />
                      </div>
                      <p className="text-[11px] text-amber-800 mb-1">{c.currencyWarning}</p>
                      {adoption ? (
                        <div data-testid="kb-candidate-adopted" className="flex items-center gap-1.5 text-[11px] text-success">
                          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                          <span>Adopted into this matter (recorded as <span className="font-medium">{adoption.verificationStatusAtAdoption.replace(/_/g, ' ')}</span>).</span>
                        </div>
                      ) : (
                        <DeliberateActButton size="sm" tone="ghost" disabled={adoptMemo.isPending} onClick={() => adoptMemo.mutate({ memoId: c.memoId, targetMatterId: matterId })} title="Authorize use of this memo in this matter (recorded)">
                          Adopt into this matter
                        </DeliberateActButton>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {adoptMemo.error && <p className="text-[11px] text-red-600 mt-1">{adoptMemo.error.message}</p>}
          </section>

          {/* This matter's memos + lifecycle acts (Fork B/C/G) */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">This matter&apos;s memos</div>
            <div className="space-y-2">
              {myMemos.map((m) => (
                <div key={m.id} className="text-xs rounded p-2 border border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex-1 font-medium text-gray-700">{m.title}</span>
                    <span className="px-1 rounded text-[10px] bg-gray-200 text-gray-600">{m.abstractionStatus}</span>
                    <span className="px-1 rounded text-[10px] bg-gray-200 text-gray-600">{m.reuseScope}</span>
                    <ProvenanceBadge verification={m.verificationStatus} />
                  </div>
                  {m.abstractionStatus === 'raw' ? (
                    <div className="space-y-1">
                      <textarea value={abstractBody[m.id] ?? ''} onChange={(e) => setAbstractBody((s) => ({ ...s, [m.id]: e.target.value }))} placeholder="Abstracted (de-identified) body — your certification that client specifics are removed" className="w-full text-[11px] border border-gray-300 rounded px-2 py-1" rows={2} />
                      {/* R2 #6: abstraction IS the attorney's de-identification certification — a deliberate, recorded act. */}
                      <DeliberateActButton size="sm" tone="ghost" disabled={!(abstractBody[m.id] ?? '').trim() || abstractMemo.isPending} onClick={() => abstractMemo.mutate({ rawMemoId: m.id, abstractedBody: (abstractBody[m.id] ?? '').trim(), abstractedBy: 'attorney' })}>Abstract (attorney-attested)</DeliberateActButton>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {/* R2 #6: promote + mark-verified change a memo's reuse/currency posture — deliberate-commit acts. */}
                      {m.reuseScope !== 'firm_wide' && <DeliberateActButton size="sm" tone="ghost" disabled={promoteMemo.isPending} onClick={() => promoteMemo.mutate({ memoId: m.id })}><Lock className="w-3 h-3" aria-hidden /> Promote to firm-wide</DeliberateActButton>}
                      <DeliberateActButton size="sm" tone="ghost" disabled={markReverified.isPending} onClick={() => markReverified.mutate({ memoId: m.id, verificationStatus: 'attorney_verified_current' })}><RefreshCw className="w-3 h-3" aria-hidden /> Mark verified current</DeliberateActButton>
                    </div>
                  )}
                </div>
              ))}
              {myMemos.length === 0 && <p className="text-xs text-gray-400">No memos filed from this matter yet.</p>}
            </div>
            {(promoteMemo.error || markReverified.error || abstractMemo.error) && (
              <p className="text-[11px] text-red-600 mt-1">{(promoteMemo.error || markReverified.error || abstractMemo.error)?.message}</p>
            )}
          </section>

          {/* File a memo (capture stays most-private) */}
          <section>
            <div className="text-xs font-medium text-gray-700 mb-2">File a practice memo</div>
            <input value={memoTitle} onChange={(e) => setMemoTitle(e.target.value)} placeholder="Memo title" className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-1" />
            <textarea value={memoBody} onChange={(e) => setMemoBody(e.target.value)} placeholder="Memo body (filed client-confidential / matter-only until you abstract it)" className="w-full text-xs border border-gray-300 rounded px-2 py-1" rows={3} />
            <div className="flex items-center gap-2 mt-1">
              <button disabled={!memoTitle.trim() || !memoBody.trim() || createMemo.isPending} onClick={() => createMemo.mutate({ matterId, title: memoTitle.trim(), body: memoBody.trim() })} className="flex items-center gap-1 px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40"><FilePlus className="w-3 h-3" /> File memo</button>
              {a != null && (
                <button disabled={createMemo.isPending} onClick={() => createMemo.mutate({ matterId, title: `Analysis memo`, body: typeof a.assessment === 'string' ? a.assessment : 'Filed from matter analysis.', sourceAnalysisId: a.id })} className="flex items-center gap-1 px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-40"><ShieldCheck className="w-3 h-3" /> File latest analysis as memo</button>
              )}
            </div>
            {createMemo.error && <p className="text-[11px] text-red-600 mt-1">{createMemo.error.message}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
