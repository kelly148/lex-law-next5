/**
 * DeedGatePanel — FOLD-DEED-1 Inc 3 (the three-gate recordability UI).
 *
 * The per-deed-document surface for the three-gate recordability gate: it shows each gate's verdict
 * (Assembly → Legal-Review → Recordability) + its blocking reasons, lets the attorney record the affirmative
 * acts, and surfaces the verified VA KB allowlist (the vesting selection is a DROPDOWN of the verified
 * controlled list — never free text, so the model is never the source). Reads deedGate.get / referenceKb;
 * writes deedGate.recordState. Display + record only; the SERVER evaluator is authoritative.
 *
 * NON-NEGOTIABLE UI INVARIANTS (disposition item 2): "recordable" is presented ONLY as the all-three-gates
 * AND, and is NEVER labeled "legally correct". The standalone recordability-layer verdict is never surfaced
 * as correctness. Self-gates on deedGate.isEnabled (dark on prod until the gate is activated).
 */
import React, { useState } from 'react';
import { Scale, CheckCircle2, XCircle } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
// WHEREAS-POLISH-1 effect B (flag-gated; OFF → this header is byte-for-byte its current self).
import ShaderCanvas from './shader/ShaderCanvas.js';
import { GUILLOCHE_HEADER_FRAG } from './shader/shaders.js';
import { SHADER_POLISH, SHADER_POLISH_ENABLED } from '../config/shaderPolish.js';
import {
  DEED_PARCEL_SCOPE_VALUES,
  DEED_SPOUSAL_JOINDER_VALUES,
  DEED_FIDUCIARY_VALUES,
  DEED_EXECUTION_MODE_VALUES,
  type DeedGateState,
} from '../../shared/schemas/deedGate.js';

// Human-readable labels for the evaluator's blocking-reason codes.
const REASON_LABELS: Record<string, string> = {
  no_grantor_bound: 'No grantor party is bound to the deed',
  no_grantee_bound: 'No grantee party is bound to the deed',
  source_of_record_not_cited: 'The source-of-record instrument is not cited',
  recording_locality_unselected: 'The recording locality is not selected',
  deed_sub_type_unselected: 'The deed sub-type is not selected',
  deed_type_jurisdiction_locality_template_uncovered: 'No verified template for this deed sub-type × jurisdiction × recording locality',
  description_source_match_unconfirmed: 'Description not confirmed to match the source of record (prong a)',
  description_parcel_scope_unset: 'Parcel scope (whole / partial / with reservation) not set (prong b)',
  parcel_exception_text_missing: 'The excepted / reserved parcel is not described',
  description_provenance_missing: 'Description provenance (source instrument / book-page / plat ref) is missing',
  description_ocr_only_or_unreviewed: 'Description not affirmed as reviewed side-by-side against the source (not OCR-only)',
  description_bare_tax_id_no_plat_ref: 'Description lacks a recorded plat / subdivision reference (bare tax-ID)',
  description_not_locked: 'Description not confirmed + locked',
  vesting_not_selected: 'Vesting / tenancy not selected',
  vesting_not_kb_validated: 'Vesting selection not validated against the verified controlled list',
  marital_status_unconfirmed: 'Marital status not confirmed as of the conveyance date',
  spousal_joinder_undetermined: 'Spousal joinder not determined',
  grantor_not_reconciled_to_source: 'Grantor identity not reconciled to the source vesting',
  fiduciary_authority_undetermined: 'Fiduciary authority not determined',
  special_instrument_triggers_unreviewed: 'Special-instrument triggers not reviewed (the wrong-tool check)',
  preparer_return_grantee_address_missing: 'Preparer / return-to / grantee tax-bill address not confirmed',
  execution_acknowledgment_mode_unset: 'Execution / acknowledgment mode not selected',
  locality_e_recording_unavailable: 'This recording locality does not operate an eRecording System — an e-notary / RON deed cannot be submitted here',
  e_certificate_recitals_unaffirmed: 'The § 47.1-16 e-certificate recitals (notary VA location, in-person vs RON, tamper-evident e-seal) are not affirmed',
  locality_kb_unverified: 'This locality’s recordability KB is not verified — no deed can be recordable here yet',
};
const reasonText = (r: string): string => REASON_LABELS[r] ?? r;

type ReferenceKb = {
  vestingOptions: ReadonlyArray<{ key: string; language: string; appliesTo: string }>;
  deedTypes: ReadonlyArray<{ key: string; title: string }>;
  localities: ReadonlyArray<{ name: string; deedInstrumentRecordable: boolean }>;
  escalationTriggers: readonly string[];
  provenance: { sourceTitle: string; sourceOrg: string };
  ron?: { acknowledgmentForms: ReadonlyArray<{ key: string; citation: string; label: string }> };
};

export function DeedGatePanel({ documentId }: { documentId: string }): React.ReactElement | null {
  const enabledQ = trpc.deedGate.isEnabled.useQuery();
  // Hook called unconditionally above; dark until the deed gate is enabled (prod default).
  if (!enabledQ.data?.enabled) return null;
  return <DeedGatePanelInner documentId={documentId} />;
}

function DeedGatePanelInner({ documentId }: { documentId: string }): React.ReactElement | null {
  const getQ = trpc.deedGate.get.useQuery({ documentId });
  const kbQ = trpc.deedGate.referenceKb.useQuery();
  // Not a deed document (or not found) → the gate doesn't apply; render nothing rather than an error box.
  if (getQ.error) return null;
  if (!getQ.data || !kbQ.data) {
    return <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-400">Loading deed gate…</div>;
  }
  return (
    <DeedGateForm
      key={JSON.stringify(getQ.data.state)}
      documentId={documentId}
      initial={getQ.data}
      kb={kbQ.data as ReferenceKb}
    />
  );
}

interface GetResult {
  state: DeedGateState;
  evaluation: {
    assembly: { passed: boolean; blockingReasons: string[] };
    legalReview: { passed: boolean; blockingReasons: string[] };
    recordability: { passed: boolean; blockingReasons: string[] };
    recordable: boolean;
  };
  parties: { grantorCount: number; granteeCount: number };
  kbSeeded: boolean;
}

function DeedGateForm({ documentId, initial, kb }: { documentId: string; initial: GetResult; kb: ReferenceKb }): React.ReactElement {
  const [state, setState] = useState<DeedGateState>(initial.state);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();

  const recordMutation = useGuardedMutation(
    (input: { documentId: string; state: DeedGateState }) => utils.client.deedGate.recordState.mutate(input),
    {
      onSuccess: () => {
        void utils.deedGate.get.invalidate();
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      },
      onError: (err) => {
        setSaved(false);
        setError(err.message);
      },
    },
  );

  const set = <K extends keyof DeedGateState>(k: K, v: DeedGateState[K]): void => setState((s) => ({ ...s, [k]: v }));
  const ev = initial.evaluation;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5" data-testid="deed-gate">
      {/* WHEREAS-POLISH-1 effect B: a guilloché header strip behind the deed section title (the form below
          stays flat per §6). Flag OFF → the plain inline title, byte-for-byte. */}
      {SHADER_POLISH_ENABLED ? (
        <div data-testid="deed-guilloche-header" className="relative -mx-6 -mt-6 mb-1 overflow-hidden rounded-t-lg px-6 py-3">
          <ShaderCanvas
            fragmentShader={GUILLOCHE_HEADER_FRAG}
            intensity={SHADER_POLISH.effects.guillocheHeader.intensity}
            className="absolute inset-0"
            fallbackVar="--wa-surface-2"
          />
          <div className="relative z-10 flex items-center gap-2">
            <Scale className="w-5 h-5 text-firm-navy" />
            <h2 className="text-base font-semibold text-firm-navy">Deed recordability</h2>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-firm-navy" />
          <h2 className="text-base font-semibold text-firm-navy">Deed recordability</h2>
        </div>
      )}

      {/* Overall verdict — recordable is the ALL-THREE-GATES AND; NEVER "legally correct" (item 2). */}
      <div
        data-testid="deed-recordable-verdict"
        className={`rounded border px-3 py-2 text-sm ${ev.recordable ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
      >
        <span className="font-semibold">{ev.recordable ? 'Recordable: YES' : 'Recordable: NO'}</span> — "recordable"
        means all three gates (Assembly, Legal-Review, Recordability) have passed. It does <span className="font-semibold">not</span> certify
        the deed is legally correct; it is the recording-acceptance readiness, not a correctness opinion.
      </div>

      {!initial.kbSeeded && (
        <div data-testid="deed-locality-unverified" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This locality’s recordability KB is not verified yet — per "no locality KB → no recordable", no deed can be
          marked recordable here until the locality is seeded from a verified source.
        </div>
      )}

      {/* The three gates. */}
      <div className="space-y-2">
        <GateRow label="Assembly" verdict={ev.assembly} testid="deed-gate-assembly" />
        <GateRow label="Legal review" verdict={ev.legalReview} testid="deed-gate-legal" />
        <GateRow label="Recordability" verdict={ev.recordability} testid="deed-gate-recordability" />
      </div>

      {/* Affirmative-act recording form. */}
      <div className="space-y-4 border-t border-gray-100 pt-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Record the attorney’s affirmative acts</p>

        <TextField label="Source-of-record instrument (book/page or instrument #)" value={state.sourceOfRecordInstrument} onChange={(v) => set('sourceOfRecordInstrument', v)} testid="deed-source-of-record" />

        {/* Recording locality — a DROPDOWN of the verified seeded localities (drives KB template coverage). */}
        <label className="block">
          <span className="text-sm text-gray-800">Recording locality (verified)</span>
          <select
            data-testid="deed-recording-locality"
            value={state.recordingLocality ?? ''}
            onChange={(e) => set('recordingLocality', e.target.value === '' ? null : e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            <option value="">— select —</option>
            {kb.localities.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>

        {/* Deed sub-type — the verified controlled list (drives template coverage + the exemption/granting rules). */}
        <label className="block">
          <span className="text-sm text-gray-800">Deed sub-type (verified controlled list)</span>
          <select
            data-testid="deed-sub-type"
            value={state.deedSubType ?? ''}
            onChange={(e) => set('deedSubType', e.target.value === '' ? null : e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            <option value="">— select —</option>
            {kb.deedTypes.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </label>

        <Tri label="Description matches the source of record (prong a)" value={state.descriptionSourceMatch} onChange={(v) => set('descriptionSourceMatch', v)} testid="deed-source-match" />
        <Sel label="Parcel scope (prong b)" options={DEED_PARCEL_SCOPE_VALUES} value={state.descriptionParcelScope} onChange={(v) => set('descriptionParcelScope', v as DeedGateState['descriptionParcelScope'])} testid="deed-parcel-scope" />
        {(state.descriptionParcelScope === 'partial' || state.descriptionParcelScope === 'with_reservation') && (
          <TextField label="What is excepted / reserved (required for partial / with-reservation)" value={state.descriptionExceptionText} onChange={(v) => set('descriptionExceptionText', v)} testid="deed-exception-text" />
        )}
        <TextField label="Description provenance (source instrument / book-page / plat ref)" value={state.descriptionProvenance} onChange={(v) => set('descriptionProvenance', v)} testid="deed-provenance" />
        <Tri label="Reviewed side-by-side against the source — NOT OCR-only" value={state.descriptionNotOcrOnly} onChange={(v) => set('descriptionNotOcrOnly', v)} testid="deed-not-ocr-only" />
        <Tri label="Carries a recorded plat / subdivision reference (not a bare tax-ID)" value={state.descriptionHasPlatOrSubdivisionRef} onChange={(v) => set('descriptionHasPlatOrSubdivisionRef', v)} testid="deed-plat-ref" />
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-gray-800">Description confirmed + locked</span>
          <button
            type="button"
            data-testid="deed-lock"
            onClick={() => set('descriptionConfirmedAt', state.descriptionConfirmedAt ? null : new Date().toISOString())}
            className={`px-3 py-1 text-sm rounded border ${state.descriptionConfirmedAt ? 'border-green-300 bg-green-50 text-green-800' : 'border-line text-ink hover:bg-surface'}`}
          >
            {state.descriptionConfirmedAt ? 'Locked — click to re-open' : 'Confirm + lock'}
          </button>
        </div>

        {/* Vesting — a DROPDOWN of the VERIFIED controlled list (never free text). */}
        <label className="block">
          <span className="text-sm text-gray-800">Vesting / tenancy (verified controlled list)</span>
          <select
            data-testid="deed-vesting"
            value={state.vestingSelection ?? ''}
            onChange={(e) => set('vestingSelection', e.target.value === '' ? null : e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            <option value="">— select —</option>
            {kb.vestingOptions.map((o) => (
              <option key={o.key} value={o.language}>{o.language}</option>
            ))}
          </select>
        </label>

        <Tri label="Marital status confirmed as of the conveyance date" value={state.maritalStatusConfirmed} onChange={(v) => set('maritalStatusConfirmed', v)} testid="deed-marital" />
        <Sel label="Spousal joinder" options={DEED_SPOUSAL_JOINDER_VALUES} value={state.spousalJoinder} onChange={(v) => set('spousalJoinder', v as DeedGateState['spousalJoinder'])} testid="deed-spousal" />
        <Tri label="Grantor identity reconciled to the source vesting" value={state.grantorReconciledToSource} onChange={(v) => set('grantorReconciledToSource', v)} testid="deed-grantor-reconciled" />
        <Sel label="Fiduciary authority" options={DEED_FIDUCIARY_VALUES} value={state.fiduciaryAuthority} onChange={(v) => set('fiduciaryAuthority', v as DeedGateState['fiduciaryAuthority'])} testid="deed-fiduciary" />

        {/* Special-instrument triggers — the wrong-tool seam; the verified escalation list is shown as guidance. */}
        <Tri label="Special-instrument triggers reviewed (escalate where present)" value={state.specialInstrumentTriggersReviewed} onChange={(v) => set('specialInstrumentTriggersReviewed', v)} testid="deed-special-instrument" />
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">Escalation triggers (verified VA KB)</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5" data-testid="deed-escalation-list">
            {kb.escalationTriggers.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>

        <Tri label="Preparer + return-to + grantee tax-bill address present" value={state.preparerReturnGranteeAddress} onChange={(v) => set('preparerReturnGranteeAddress', v)} testid="deed-preparer-address" />
        <Sel label="Execution / acknowledgment mode" options={DEED_EXECUTION_MODE_VALUES} value={state.executionMode} onChange={(v) => set('executionMode', v as DeedGateState['executionMode'])} testid="deed-execution-mode" />
        {state.executionMode && state.executionMode !== 'wet_sign' && (
          <div className="rounded border border-gray-200 px-3 py-2 space-y-2" data-testid="deed-ron-block">
            <p className="text-xs text-gray-600">
              e-notary / RON: a RON deed records on the same footing as paper (URPERA §§ 55.1-661–664) — but ONLY when
              the recording locality operates an eRecording System AND the § 47.1-16 e-certificate recitals are affirmed.
            </p>
            <Tri
              label="§ 47.1-16 e-certificate recitals affirmed (notary VA location · in-person vs RON · tamper-evident e-seal)"
              value={state.eCertificateRecitalsAffirmed}
              onChange={(v) => set('eCertificateRecitalsAffirmed', v)}
              testid="deed-ecert-recitals"
            />
            {kb.ron && (
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer">Verified acknowledgment forms (§§ 55.1-612 / 55.1-619)</summary>
                <ul className="list-disc pl-5 mt-1 space-y-0.5" data-testid="deed-ack-forms">
                  {kb.ron.acknowledgmentForms.map((f) => <li key={f.key}><span className="font-medium">{f.citation}</span>: {f.label}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {saved && <p className="text-green-600 text-sm">Recorded.</p>}

      <div className="flex items-center justify-between border-t border-gray-100 pt-4">
        <span className="text-xs text-gray-400">Verified VA KB: {kb.provenance.sourceTitle} ({kb.provenance.sourceOrg})</span>
        <button
          type="button"
          data-testid="deed-record"
          onClick={() => recordMutation.mutate({ documentId, state })}
          disabled={recordMutation.isPending}
          className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
        >
          {recordMutation.isPending ? 'Recording…' : 'Record affirmative acts'}
        </button>
      </div>
    </div>
  );
}

// ── small controls ───────────────────────────────────────────────────────────
function GateRow({ label, verdict, testid }: { label: string; verdict: { passed: boolean; blockingReasons: string[] }; testid: string }): React.ReactElement {
  return (
    <div data-testid={testid} className="rounded border border-gray-200 px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {verdict.passed ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-amber-600" />}
        <span className="text-gray-800">{label}</span>
        <span className={verdict.passed ? 'text-green-700' : 'text-amber-700'}>{verdict.passed ? 'passed' : 'blocked'}</span>
      </div>
      {!verdict.passed && verdict.blockingReasons.length > 0 && (
        <ul className="list-disc pl-6 mt-1 text-xs text-gray-600 space-y-0.5">
          {verdict.blockingReasons.map((r) => <li key={r}>{reasonText(r)}</li>)}
        </ul>
      )}
    </div>
  );
}

function Tri({ label, value, onChange, testid }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void; testid: string }): React.ReactElement {
  const opts: Array<{ k: string; v: boolean | null }> = [{ k: 'Yes', v: true }, { k: 'No', v: false }, { k: '—', v: null }];
  return (
    <div className="flex items-center justify-between py-1" data-testid={testid}>
      <span className="text-sm text-gray-800">{label}</span>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
            className={`px-2 py-0.5 text-xs rounded border ${value === o.v ? 'border-firm-navy bg-firm-navy/10 text-firm-navy' : 'border-line text-ink hover:bg-surface'}`}
          >
            {o.k}
          </button>
        ))}
      </div>
    </div>
  );
}

function Sel({ label, options, value, onChange, testid }: { label: string; options: readonly string[]; value: string | null; onChange: (v: string | null) => void; testid: string }): React.ReactElement {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-800">{label}</span>
      <select
        data-testid={testid}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange, testid }: { label: string; value: string | null; onChange: (v: string | null) => void; testid: string }): React.ReactElement {
  return (
    <label className="block">
      <span className="text-sm text-gray-800">{label}</span>
      <input
        data-testid={testid}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
      />
    </label>
  );
}
