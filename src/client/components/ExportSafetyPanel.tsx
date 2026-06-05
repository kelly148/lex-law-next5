/**
 * ExportSafetyPanel — FOLD-SEND-1 (Increment 4: export-safety / outbound-readiness UI).
 *
 * Document-scoped review-pane panel showing the deterministic export-safety gate result —
 * block / warn / pass with the specific findings — and the recorded-override action for a block.
 * User-facing copy says "export safety / outbound readiness" (the legacy code name sendability_* is
 * kept). DEFAULT-SAFE: in v1 the gate runs in SHADOW mode (advisory; never blocks export) unless the
 * operator has flipped SENDABILITY_GATE_ENABLED on — the panel labels which. An override is an
 * explicit attorney act: wrong_matter_id requires a typed confirmation; the server records it
 * append-only, content-hash-bound, audited. No business logic in React (Ch 35.3).
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 */
import React, { useState } from 'react';
import { ShieldCheck, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import type { SendabilityCheckCategory, SendabilityOverrideReason } from '../../shared/schemas/sendability.js';

interface ExportSafetyPanelProps {
  documentId: string;
}

const REASON_CODES: SendabilityOverrideReason[] = ['verified_correct', 'intentional_choice', 'will_correct_before_send', 'not_applicable', 'other'];
const CONFIRM_PHRASE = 'CONFIRM EXPORT';
// Categories that require a typed confirmation to override (mirrors the server: wrong_matter_id).
const CONFIRM_REQUIRED: SendabilityCheckCategory[] = ['wrong_matter_id'];

export default function ExportSafetyPanel({ documentId }: ExportSafetyPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [overriding, setOverriding] = useState<SendabilityCheckCategory | null>(null);
  const [reasonCode, setReasonCode] = useState<SendabilityOverrideReason>('verified_correct');
  const [reasonText, setReasonText] = useState('');
  const [typed, setTyped] = useState('');

  const utils = trpc.useUtils();
  const gate = trpc.sendabilityGate.getGate.useQuery({ documentId }, { enabled: open });
  const doc = trpc.document.get.useQuery({ documentId }, { enabled: open });

  const override = useGuardedMutation(
    (input: {
      documentId: string;
      versionId: string;
      category: SendabilityCheckCategory;
      reasonCode: SendabilityOverrideReason;
      reasonText?: string | null;
      typedConfirmation?: string | null;
    }) => utils.client.sendabilityGate.recordOverride.mutate(input),
    {
      onSuccess: () => {
        setOverriding(null);
        setReasonText('');
        setTyped('');
        void utils.sendabilityGate.getGate.invalidate({ documentId });
      },
    },
  );

  // Derivations + gating below — never via a conditional mount or a hook after an early return.
  const data = gate.data;
  const verdict = data?.verdict ?? 'pass';
  const blocks = data?.blocks ?? [];
  const warnings = data?.warnings ?? [];
  const enforced = data?.enforced ?? false;
  const inScope = data?.inScope ?? true;
  const versionId = doc.data?.currentVersionId ?? null;

  const confirmNeeded = overriding !== null && CONFIRM_REQUIRED.includes(overriding);
  const canSubmit =
    overriding !== null && versionId !== null && !override.isPending && (!confirmNeeded || typed.trim().toUpperCase() === CONFIRM_PHRASE);

  const submitOverride = (): void => {
    if (!canSubmit || overriding === null || versionId === null) return;
    override.mutate({
      documentId,
      versionId,
      category: overriding,
      reasonCode,
      reasonText: reasonText.trim() !== '' ? reasonText.trim() : null,
      typedConfirmation: confirmNeeded ? typed.trim() : null,
    });
  };

  const verdictBadge = (): React.ReactElement | null => {
    if (!open) return null;
    if (verdict === 'block') {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800">{enforced ? 'blocked' : 'would block'}</span>;
    }
    if (verdict === 'warn') {
      return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{warnings.length} to review</span>;
    }
    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">ready</span>;
  };

  return (
    <div className="border-t border-gray-200">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100">
        <ShieldCheck className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Export safety</h3>
        {verdictBadge()}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-gray-500">
            Outbound-readiness checks for this draft.{' '}
            {enforced
              ? 'Enforcing: a block stops the DOCX export until you resolve it or record an override.'
              : 'Advisory (shadow mode): nothing is blocked — the checks are surfaced for your review. You are always the decision-maker.'}
          </p>

          {gate.isLoading && <p className="text-xs text-gray-400">Checking export safety…</p>}
          {data && !inScope && <p className="text-[11px] text-gray-400">This document type is out of scope for jurisdiction execution checks.</p>}

          {data && blocks.length === 0 && warnings.length === 0 && (
            <p className="inline-flex items-center gap-1 text-[11px] text-green-700"><CheckCircle2 className="w-3 h-3" /> No export-safety issues found.</p>
          )}

          {/* Blocks */}
          {blocks.map((b, i) => (
            <div key={`b-${i}`} className="px-2 py-1.5 border border-red-200 bg-red-50 rounded text-[11px] text-gray-700">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 font-medium text-red-800"><AlertOctagon className="w-3 h-3" /> {b.category}</span>
                {overriding !== b.category && (
                  <button onClick={() => setOverriding(b.category)} className="text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-white">Record override</button>
                )}
              </div>
              <div className="text-gray-600 mt-0.5">{b.summary}{b.sourceTag ? ` — ${b.sourceTag}` : ''}</div>

              {overriding === b.category && (
                <div className="mt-2 space-y-1.5 border-t border-red-200 pt-2">
                  <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as SendabilityOverrideReason)} className="w-full text-xs border border-gray-300 rounded px-2 py-1">
                    {REASON_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Reason (optional)" className="w-full text-xs border border-gray-300 rounded px-2 py-1" />
                  {confirmNeeded && (
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type "${CONFIRM_PHRASE}" to confirm`} className="w-full text-xs border border-gray-300 rounded px-2 py-1" />
                  )}
                  <div className="flex gap-2">
                    <button onClick={submitOverride} disabled={!canSubmit} className="px-2.5 py-1 text-[11px] bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50">
                      {override.isPending ? 'Recording…' : 'Confirm override'}
                    </button>
                    <button onClick={() => { setOverriding(null); setTyped(''); }} className="px-2.5 py-1 text-[11px] border border-gray-300 rounded hover:bg-white">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Warnings */}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} className="px-2 py-1.5 border border-amber-200 bg-amber-50 rounded text-[11px] text-gray-700">
              <span className="inline-flex items-center gap-1 font-medium text-amber-800"><AlertTriangle className="w-3 h-3" /> {w.category}</span>
              <div className="text-gray-600 mt-0.5">{w.summary}{w.sourceTag ? ` — ${w.sourceTag}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
