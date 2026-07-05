/**
 * GateOverridePanel — CONFLICT-GATE-OVERRIDE-1 (the block-point override action + persistent banner).
 *
 * Matter-level surface, mounted at the top of MatterDetail. It does two things, additively:
 *   1. Persistent "intake gate overridden" BANNER — shown while any attested override is ACTIVE, naming
 *      the precondition(s), the attestation time, and the reason. It clears automatically on re-arm
 *      (a material change makes the server's getGate stop returning the override as active).
 *   2. Inline "Proceed without clearance" ACTION — when the gate is enforced AND a precondition is
 *      currently blocking, offers a per-precondition attested override (reason quick-picks + free text).
 *
 * Renders NOTHING in the happy path (gate cleared, no overrides). No business logic in React (Ch 35.3):
 * the server decides what is blocking / overridden; this only renders it and records the attorney's act
 * via the guarded mutation. All hooks run unconditionally before any early return (#310).
 */
import React, { useState } from 'react';
import { AlertTriangle, ShieldOff, BadgeCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { type GateOverrideReasonCode } from '../../shared/schemas/gateOverride.js';

interface GateOverridePanelProps {
  matterId: string;
}

type Precondition = 'conflicts' | 'identity';

const REASON_CODES: ReadonlyArray<{ value: GateOverrideReasonCode; label: string }> = [
  { value: 'cleared_out_of_band', label: 'Conflicts cleared out-of-band' },
  { value: 'verified_out_of_band', label: 'Identity verified out-of-band' },
  { value: 'waived_professional_judgment', label: 'Waived — informed professional judgment' },
  { value: 'testing', label: 'Testing' },
  { value: 'other', label: 'Other (explain below)' },
];

const PRECONDITION_LABEL: Record<Precondition, string> = {
  conflicts: 'conflicts clearance',
  identity: 'identity verification',
};

export default function GateOverridePanel({ matterId }: GateOverridePanelProps): React.ReactElement | null {
  const utils = trpc.useUtils();
  const gate = trpc.gateOverride.getGate.useQuery({ matterId });
  const [draft, setDraft] = useState<Record<string, { reasonCode: GateOverrideReasonCode; reasonText: string }>>({});
  // UI-ATTORNEY-SWEEP-1 S4a: the recorded override collapses to a chip; expand reveals the byte-identical attestation record.
  const [overrideDetailOpen, setOverrideDetailOpen] = useState(false);

  const record = useGuardedMutation(
    (input: { matterId: string; precondition: Precondition; reasonCode: GateOverrideReasonCode; reasonText?: string | null }) =>
      utils.client.gateOverride.record.mutate(input),
    { onSuccess: () => void utils.gateOverride.getGate.invalidate({ matterId }) },
  );

  const data = gate.data;
  if (!data) return null;

  const active = data.activeOverrides ?? [];
  const activePreconditions = new Set(active.map((o) => o.precondition));
  // Only offer an override when the gate is actually enforced and the precondition is currently blocking
  // AND not already actively overridden. (When the gate is inert, an override is moot.)
  const offerable = (data.enforced ? (data.blockingPreconditions as Precondition[]) : []).filter(
    (pc) => !activePreconditions.has(pc),
  );

  if (active.length === 0 && offerable.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      {active.length > 0 && (
        <div className="text-[12px]">
          <button
            type="button"
            onClick={() => setOverrideDetailOpen((v) => !v)}
            title="Recorded attested override — expand to view the attestation record"
            className="flex items-center gap-1.5 text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1 hover:bg-amber-100"
          >
            <ShieldOff className="w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
            <span>
              Intake gate: overridden by attestation{' '}
              {active
                .map((o) => {
                  const label = PRECONDITION_LABEL[o.precondition as Precondition];
                  const reason = o.reasonText ? o.reasonText : o.reasonCode;
                  return `${new Date(o.createdAt).toLocaleDateString()} · ${label} (${reason})`;
                })
                .join('; ')}
            </span>
            {overrideDetailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {overrideDetailOpen && (
            <div className="mt-1 flex items-start gap-2 text-amber-900 bg-amber-50 border border-amber-300 rounded p-3">
              <ShieldOff className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <div className="font-semibold">Intake gate overridden</div>
                {active.map((o) => (
                  <div key={o.id} className="mt-0.5">
                    {PRECONDITION_LABEL[o.precondition as Precondition]} — attested by the attorney on{' '}
                    {new Date(o.createdAt).toLocaleString()}
                    {o.reasonText ? ` · ${o.reasonText}` : ` · ${o.reasonCode}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {offerable.map((pc) => {
        const d = draft[pc] ?? { reasonCode: REASON_CODES[0]!.value, reasonText: '' };
        const needsText = d.reasonCode === 'other' && d.reasonText.trim().length === 0;
        return (
          <div key={pc} className="text-[12px] text-gray-700 bg-white border border-amber-300 rounded p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <span className="font-semibold">Drafting blocked — {PRECONDITION_LABEL[pc]} not cleared.</span>{' '}
                You may proceed by recording an attested override. The gate stays fail-closed; your override
                is logged to the matter record and re-arms on a material change.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={d.reasonCode}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    [pc]: { reasonCode: e.target.value as GateOverrideReasonCode, reasonText: s[pc]?.reasonText ?? '' },
                  }))
                }
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                {REASON_CODES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input
                value={d.reasonText}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    [pc]: { reasonCode: s[pc]?.reasonCode ?? REASON_CODES[0]!.value, reasonText: e.target.value },
                  }))
                }
                placeholder="One-line reason (required for ‘Other’)"
                className="flex-1 min-w-[12rem] text-xs border border-gray-300 rounded px-2 py-1"
              />
              <button
                disabled={record.isPending || needsText}
                onClick={() =>
                  record.mutate({ matterId, precondition: pc, reasonCode: d.reasonCode, reasonText: d.reasonText.trim() || null })
                }
                title={needsText ? 'A one-line reason is required for ‘Other’' : `Proceed without ${PRECONDITION_LABEL[pc]}`}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-amber-400 text-amber-900 bg-amber-50 rounded hover:bg-amber-100 disabled:opacity-40"
              >
                <BadgeCheck className="w-3 h-3" /> Proceed without clearance
              </button>
            </div>
            {record.error && <p className="text-[11px] text-red-600">{record.error.message}</p>}
          </div>
        );
      })}
    </div>
  );
}
