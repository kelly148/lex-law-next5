/**
 * DeedSignoffPanel — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 4.
 *
 * The attorney's sign-off surface for a deed document: it shows the EXTRACTED source text/facts beside the
 * assembled deed, per field, with a match/mismatch status, and records the sign-off (dual-prong attestation +
 * high-friction override). Display + record only; the SERVER is authoritative.
 *
 * NON-NEGOTIABLE UI INVARIANTS:
 *  - NC-D3-1 honest labeling: the left value is "extracted source text / facts", NEVER "the source document";
 *    OCR-derived legal descriptions carry a stronger warning; the vs-original attestation is retained + required.
 *  - NC-1: the mismatch view NEVER offers "replace with this" — it shows both values + the status, nothing more.
 *  - NC-D3-3: a hard-block (legal/parcel MISMATCH) is non-overridable — no attestation form is shown; an
 *    absent/withheld source value needs the high-friction override.
 * Self-gates on deedSignoff.isEnabled (dark on prod until the operator activates the mode).
 */
import React, { useState } from 'react';
import { FileCheck2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

const OVERRIDE_REASONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'no_prior_instrument', label: 'No prior recorded instrument (first conveyance)' },
  { key: 'source_withheld', label: 'Source fact withheld by the extraction honesty floor' },
  { key: 'parcel_unavailable', label: 'Parcel / Tax-ID unavailable from the source' },
  { key: 'ocr_confidence', label: 'OCR-confidence problem on the source value' },
];

const STATUS_STYLE: Record<string, string> = {
  match: 'border-green-300 bg-green-50 text-green-800',
  mismatch: 'border-red-300 bg-red-50 text-red-800',
  absent: 'border-amber-300 bg-amber-50 text-amber-900',
  withheld: 'border-amber-300 bg-amber-50 text-amber-900',
  not_applicable: 'border-gray-200 bg-gray-50 text-gray-500',
};

interface ComparisonField {
  field: string;
  status: string;
  sourceValue: string | null;
  draftValue: string | null;
  provenanceClass: string | null;
}
interface Comparison {
  documentVersionId: string;
  tier: 'hard_block' | 'overridable_block' | 'pass';
  alreadySignedOff: boolean;
  partiesCompared: boolean;
  extractionNotes: string[];
  comparatorVersion: string;
  sourceLabel: string;
  fields: ComparisonField[];
}

export function DeedSignoffPanel({ documentId }: { documentId: string }): React.ReactElement | null {
  const enabledQ = trpc.deedSignoff.isEnabled.useQuery();
  // Hook called unconditionally; dark until the D3 mode is on (prod default OFF).
  if (enabledQ.data?.mode !== 'observe' && enabledQ.data?.mode !== 'enforce') return null;
  return <DeedSignoffPanelInner documentId={documentId} mode={enabledQ.data.mode} />;
}

function DeedSignoffPanelInner({ documentId, mode }: { documentId: string; mode: 'observe' | 'enforce' }): React.ReactElement | null {
  const getQ = trpc.deedSignoff.getComparison.useQuery({ documentId });
  if (getQ.error) return null; // not a deed / not found → the sign-off doesn't apply
  if (!getQ.data) {
    return <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-400">Loading deed sign-off…</div>;
  }
  return <SignoffForm key={getQ.data.documentVersionId} documentId={documentId} mode={mode} data={getQ.data as Comparison} />;
}

function SignoffForm({ documentId, mode, data }: { documentId: string; mode: 'observe' | 'enforce'; data: Comparison }): React.ReactElement {
  const [attestedVsOriginal, setAttestedVsOriginal] = useState(false);
  const [notOcrOnly, setNotOcrOnly] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideText, setOverrideText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const utils = trpc.useUtils();

  const recordMutation = useGuardedMutation(
    (input: {
      documentId: string;
      documentVersionId: string;
      attestations: { attorneyAttestedVsOriginal: boolean; notOcrOnly: boolean };
      override?: { reasonCode: string; reasonText: string | null } | null;
    }) => utils.client.deedSignoff.record.mutate(input),
    {
      onSuccess: () => {
        void utils.deedSignoff.getComparison.invalidate();
        setError(null);
        setDone(true);
      },
      onError: (err) => {
        setDone(false);
        setError(err.message);
      },
    },
  );

  const isHardBlock = data.tier === 'hard_block';
  const isOverridable = data.tier === 'overridable_block';
  const attested = attestedVsOriginal && notOcrOnly;
  const overrideOk = !isOverridable || overrideReason !== '';
  const canSubmit = !isHardBlock && attested && overrideOk && !recordMutation.isPending;

  const submit = (): void => {
    recordMutation.mutate({
      documentId,
      documentVersionId: data.documentVersionId,
      attestations: { attorneyAttestedVsOriginal: attestedVsOriginal, notOcrOnly },
      override: isOverridable ? { reasonCode: overrideReason, reasonText: overrideText.trim() === '' ? null : overrideText.trim() } : null,
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5" data-testid="deed-signoff">
      <div className="flex items-center gap-2">
        <FileCheck2 className="w-5 h-5 text-firm-navy" />
        <h2 className="text-base font-semibold text-firm-navy">Source-extracted facts sign-off</h2>
        <span className="ml-auto text-xs text-gray-400">
          {mode === 'enforce' ? 'ENFORCE' : 'observe'} · {data.comparatorVersion}
        </span>
      </div>

      {/* NC-D3-1 honest labeling — this is the EXTRACTED source, not the source document. */}
      <p className="text-sm text-gray-600" data-testid="deed-signoff-label">
        This compares the assembled deed against the <span className="font-medium">{data.sourceLabel}</span> — <span className="font-semibold">not</span> the
        source document itself. You must still compare the deed against the <span className="font-medium">original recorded instrument</span> before signing off.
      </p>

      {data.alreadySignedOff && (
        <div data-testid="deed-signoff-done" className="flex items-center gap-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          <CheckCircle2 className="w-4 h-4" /> A current sign-off exists for this version.
        </div>
      )}

      {/* Per-field comparison — extracted source vs assembled deed. NC-1: values + status only, no "replace". */}
      <div className="space-y-2">
        {data.fields.map((f) => (
          <div key={f.field} data-testid={`deed-signoff-field-${f.field}`} className={`rounded border px-3 py-2 text-sm ${STATUS_STYLE[f.status] ?? STATUS_STYLE['not_applicable']}`}>
            <div className="flex items-center gap-2 font-medium">
              <span className="capitalize">{f.field.replace(/_/g, ' ')}</span>
              <span className="ml-auto uppercase text-xs tracking-wide">{f.status.replace(/_/g, ' ')}</span>
            </div>
            {(f.sourceValue !== null || f.draftValue !== null) && (
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-gray-700">
                <div>
                  <div className="text-gray-500">Extracted source{f.provenanceClass === 'ocr_derived' ? ' (OCR-derived — verify against the original)' : ''}</div>
                  <div className="font-mono break-words">{f.sourceValue ?? '—'}</div>
                </div>
                <div>
                  <div className="text-gray-500">Assembled deed</div>
                  <div className="font-mono break-words">{f.draftValue ?? '—'}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {!data.partiesCompared && (
        <p className="text-xs text-gray-400" data-testid="deed-signoff-parties-note">
          Party comparison is deferred in this release (legal description + parcel are compared here).
        </p>
      )}

      {isHardBlock ? (
        <div data-testid="deed-signoff-hardblock" className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            A field on the assembled deed does <span className="font-semibold">not match</span> the extracted source. This is not
            overridable — correct the deed so it matches the source, then re-check. Sign-off is unavailable.
          </span>
        </div>
      ) : (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          {isOverridable && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 space-y-2" data-testid="deed-signoff-override">
              <p className="text-xs text-amber-900">
                A source value is genuinely absent or withheld. Signing off requires a recorded reason (high-friction override).
              </p>
              <select
                data-testid="deed-signoff-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              >
                <option value="">— select a reason —</option>
                {OVERRIDE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <textarea
                data-testid="deed-signoff-override-text"
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                placeholder="Optional detail for the record"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                rows={2}
              />
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" data-testid="deed-signoff-attest-original" checked={attestedVsOriginal} onChange={(e) => setAttestedVsOriginal(e.target.checked)} className="mt-1" />
            <span>I have compared this deed against the <span className="font-medium">original recorded instrument</span> (not only the extracted text).</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" data-testid="deed-signoff-attest-notocr" checked={notOcrOnly} onChange={(e) => setNotOcrOnly(e.target.checked)} className="mt-1" />
            <span>This is <span className="font-medium">not</span> an OCR-only comparison — I reviewed the values against a reliable source.</span>
          </label>

          {error && <p className="text-red-600 text-sm" data-testid="deed-signoff-error">{error}</p>}
          {done && <p className="text-green-600 text-sm">Sign-off recorded.</p>}

          <button
            type="button"
            data-testid="deed-signoff-record"
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-accent text-on-accent rounded hover:bg-accent-hover disabled:opacity-50"
          >
            {recordMutation.isPending ? 'Recording…' : 'Record sign-off'}
          </button>
        </div>
      )}
    </div>
  );
}
