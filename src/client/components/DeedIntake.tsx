/**
 * DeedIntake — DEED-INTAKE-REDESIGN-1: the ONE shared gift-deed intake experience, mounted on BOTH the
 * standalone Quick Deed page and the matter-scoped "Gift Deed Draft" modal so there is no drift.
 *
 * Three layers, in priority order:
 *   (a) a PRIMARY drag-and-drop drop zone (MaterialsDropZone) — the vesting deed / tax record upload + OCR,
 *       front-and-center instead of a button that opens a modal;
 *   (b) a FREE-ASSOCIATE box (Quick Deed Layer 2 / E3): the attorney describes the deal in one text box; the
 *       server `quickDeed.proposeIntake` PARSES → PROPOSES only the irreducible intake fields (donees, marital
 *       flag, an explicit vesting/override) for the attorney to CONFIRM in the pre-filled form below. It is
 *       PROPOSE-ONLY (it never drafts/records/sends) and NEVER authors a legal description. Fail-closed: an
 *       ambiguous/low-confidence parse returns clarifying questions; an egress hold returns a clean blocked
 *       notice — never a guessed proposal;
 *   (c) the structured gift form + Layer-1 (previewFacts) pre-fill, kept as the confirm surface and the
 *       collapsed "fill it in manually" fallback.
 *
 * This component is CONTROLLED at the seams: it owns the form state but emits the validated gift payload via
 * onSubmit (the parent owns the mutation, the matterId injection, and the navigation). matterId is resolved
 * lazily via resolveMatterId so the Quick Deed lane persists nothing until a real interaction (spec §4).
 *
 * Flag-dark: it is only ever mounted inside an already-flag-guarded surface (the /deed page self-guards on
 * deedDraftAgent.isEnabled; the matter modal's entry button is flag-gated). Every server call it makes is
 * itself fail-closed when the flag is off.
 */
import React, { useEffect, useRef, useState } from 'react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import MaterialsDropZone from './MaterialsDropZone.js';

interface PartyRow {
  name: string;
  descriptor: string;
}

const emptyRow = (): PartyRow => ({ name: '', descriptor: '' });

/** The validated gift facts DeedIntake emits. Maps 1:1 onto the server gift input MINUS matterId + title (the
 *  parent injects the matterId and chooses the title / whether to createGiftDraft or quickDeed.generate). */
export interface DeedGiftIntakePayload {
  grantors: { name: string; descriptor?: string }[];
  grantees: { name: string; descriptor?: string }[];
  granteesAreMarriedCouple: boolean;
  fileNumber: string | null;
  granteeAddress: string | null;
  locality: string | null;
  derivationReference: string | null;
  vestingOverride: string | null;
}

/** The inferred proposeIntake result union (proposed | needs_clarification | blocked) straight off the client. */
type ProposeIntakeResult = Awaited<
  ReturnType<ReturnType<typeof trpc.useUtils>['client']['quickDeed']['proposeIntake']['mutate']>
>;

interface DeedIntakeProps {
  /** The owning matter, when it already exists (the matter modal). Omitted on the standalone Quick Deed lane. */
  matterId?: string | undefined;
  /** Lazily resolve (creating if needed) the owning matter id. The matter modal returns its id immediately; the
   *  Quick Deed page creates the lightweight matter on the first real interaction. */
  resolveMatterId: () => Promise<string>;
  /** Emits the validated gift facts; the parent injects matterId + title and runs the generate/create mutation. */
  onSubmit: (payload: DeedGiftIntakePayload) => void;
  /** True while the parent's generate/create mutation is in flight (disables submit). */
  submitting?: boolean;
  /** A server-side error from the parent's mutation, surfaced beneath the form. */
  submitError?: string | null;
  /** The submit button label (default "Generate draft"). */
  submitLabel?: string;
  /** Show the primary drop zone (default true). */
  showUpload?: boolean;
  /** Show the AI free-associate box (default true). */
  showFreeAssociate?: boolean;
}

export default function DeedIntake({
  matterId,
  resolveMatterId,
  onSubmit,
  submitting = false,
  submitError = null,
  submitLabel = 'Generate draft',
  showUpload = true,
  showFreeAssociate = true,
}: DeedIntakeProps): React.ReactElement {
  const utils = trpc.useUtils();

  // Gift form state (the confirm surface).
  const [grantors, setGrantors] = useState<PartyRow[]>([emptyRow()]);
  const [grantees, setGrantees] = useState<PartyRow[]>([emptyRow()]);
  const [granteesAreMarriedCouple, setGranteesAreMarriedCouple] = useState(false);
  const [fileNumber, setFileNumber] = useState('');
  const [granteeAddress, setGranteeAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [derivationReference, setDerivationReference] = useState('');
  const [vestingOverride, setVestingOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The structured form is the collapsed fallback: drop zone + free-associate are primary. It auto-expands once
  // a proposal pre-fills it (the attorney confirms in the open view) or when there is nothing above it.
  const [formExpanded, setFormExpanded] = useState(!showUpload && !showFreeAssociate);

  // Free-associate (Layer 2) state.
  const [freeText, setFreeText] = useState('');
  const [proposeStatus, setProposeStatus] = useState<'idle' | 'proposed' | 'needs_clarification' | 'blocked'>('idle');
  const [proposeQuestions, setProposeQuestions] = useState<string[]>([]);
  const [proposeBlockedReason, setProposeBlockedReason] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);

  // Layer 1 (E1b): read the matter's consolidated facts and pre-fill empty fields once the owning matter exists.
  const previewFacts = trpc.quickDeed.previewFacts.useQuery(
    { matterId: matterId ?? '' },
    { enabled: !!matterId },
  );
  const prefilledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = previewFacts.data;
    if (!p || !p.hasMaterials) return;
    // Once the uploads have yielded facts, open the form ONCE so the attorney SEES the "read from your uploads"
    // banner + the pre-filled values (parity with the original always-visible-after-upload behavior). Guarded so
    // a later manual collapse sticks; the form stays collapsed only while nothing has been read (drop-first).
    if (!prefilledRef.current.has('__autoExpanded')) {
      prefilledRef.current.add('__autoExpanded');
      setFormExpanded(true);
    }
    if (p.locality && !prefilledRef.current.has('locality')) {
      prefilledRef.current.add('locality');
      setLocality((cur) => (cur.trim() === '' ? p.locality! : cur));
    }
    if (p.granteeAddress && !prefilledRef.current.has('granteeAddress')) {
      prefilledRef.current.add('granteeAddress');
      setGranteeAddress((cur) => (cur.trim() === '' ? p.granteeAddress! : cur));
    }
  }, [previewFacts.data]);

  // Apply a proposeIntake result. PROPOSE-ONLY: this only pre-fills the confirm form — nothing is generated.
  const applyProposeResult = (res: ProposeIntakeResult): void => {
    setProposeError(null);
    if (res.status === 'proposed') {
      const p = res.proposal;
      if (p.grantees.length > 0) {
        // The relationship the model parsed maps onto the grantee "descriptor" field for the attorney to confirm.
        setGrantees(p.grantees.map((g) => ({ name: g.name, descriptor: g.relationship ?? '' })));
      }
      if (p.granteesAreMarriedCouple !== undefined) setGranteesAreMarriedCouple(p.granteesAreMarriedCouple);
      if (p.vestingOverride) setVestingOverride(p.vestingOverride);
      if (p.overrides.fileNumber) setFileNumber(p.overrides.fileNumber);
      if (p.overrides.derivationReference) setDerivationReference(p.overrides.derivationReference);
      if (p.overrides.locality) setLocality(p.overrides.locality);
      setProposeQuestions([]);
      setProposeBlockedReason(null);
      setProposeStatus('proposed');
      setFormExpanded(true); // the attorney confirms the proposed facts in the open form
    } else if (res.status === 'needs_clarification') {
      setProposeQuestions(res.questions);
      setProposeBlockedReason(null);
      setProposeStatus('needs_clarification');
    } else {
      setProposeQuestions([]);
      setProposeBlockedReason(res.reason);
      setProposeStatus('blocked');
    }
  };

  const propose = useGuardedMutation(
    (input: { matterId: string; freeText: string }) => utils.client.quickDeed.proposeIntake.mutate(input),
    {
      onSuccess: (res: ProposeIntakeResult) => applyProposeResult(res),
      onError: (err: Error) => setProposeError(err.message),
    },
  );

  const handlePropose = (): void => {
    const text = freeText.trim();
    if (!text) { setProposeError('Describe the deal first, then propose the facts.'); return; }
    setProposeError(null);
    // The parse needs an owning matter (it is matterId-scoped + ownership-gated). Resolve it lazily, then parse.
    void resolveMatterId()
      .then((id) => propose.mutate({ matterId: id, freeText: text }))
      .catch((err: unknown) => setProposeError(err instanceof Error ? err.message : 'Could not start the deed record.'));
  };

  const cleanParties = (rows: PartyRow[]): { name: string; descriptor?: string }[] =>
    rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => {
        const d = r.descriptor.trim();
        return d.length > 0 ? { name: r.name.trim(), descriptor: d } : { name: r.name.trim() };
      });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = cleanParties(grantors);
    const cleanGrantees = cleanParties(grantees);
    if (cleanGrantors.length === 0) {
      setError('At least one grantor (donor) name is required.');
      setFormExpanded(true);
      return;
    }
    if (cleanGrantees.length === 0) {
      setError('At least one grantee (donee) name is required.');
      setFormExpanded(true);
      return;
    }
    setError(null);
    onSubmit({
      grantors: cleanGrantors,
      grantees: cleanGrantees,
      granteesAreMarriedCouple,
      fileNumber: fileNumber.trim() || null,
      granteeAddress: granteeAddress.trim() || null,
      locality: locality.trim() || null,
      derivationReference: derivationReference.trim() || null,
      vestingOverride: vestingOverride.trim() || null,
    });
  };

  const renderPartyRows = (
    rows: PartyRow[],
    setRows: (next: PartyRow[]) => void,
    descriptorPlaceholder: string,
  ): React.ReactElement => (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex gap-2">
          <input
            type="text"
            value={row.name}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            placeholder="Full legal name"
          />
          <input
            type="text"
            value={row.descriptor}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, descriptor: e.target.value } : r)))}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            placeholder={descriptorPlaceholder}
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, i) => i !== idx))}
              className="px-2 text-gray-400 hover:text-red-600 text-sm"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, emptyRow()])}
        className="text-sm text-firm-navy hover:underline"
      >
        + Add another
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* (a) PRIMARY drop zone — the vesting deed / tax record upload + OCR, front-and-center. */}
      {showUpload && (
        <div data-testid="deed-intake-dropzone">
          <label className="block text-sm font-medium text-gray-700 mb-1">Drop the prior vesting deed &amp; tax record</label>
          <MaterialsDropZone
            matterId={matterId}
            resolveMatterId={resolveMatterId}
            onUploaded={() => { void previewFacts.refetch(); }}
            autoCommit
          />
          <p className="text-xs text-ink-hint mt-1">
            The property facts (legal description, parcel, assessed value) are read from these uploads. The draft
            is never auto-recorded or sent — you review and finalize it.
          </p>
        </div>
      )}

      {/* (b) FREE-ASSOCIATE — describe the deal; the AI proposes the intake fields for you to confirm. */}
      {showFreeAssociate && (
        <div data-testid="deed-intake-free-associate">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="deed-intake-freetext">
            Or describe the deal in plain words
          </label>
          <textarea
            id="deed-intake-freetext"
            data-testid="deed-intake-freetext"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            placeholder="e.g. Mom and Dad are gifting the house to our daughter Hannah; they hold it as tenants by the entirety…"
          />
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              data-testid="deed-intake-propose"
              disabled={propose.isPending}
              onClick={handlePropose}
              className="px-3 py-1.5 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
            >
              {propose.isPending ? 'Reading…' : 'Propose the facts'}
            </button>
            <span className="text-xs text-ink-hint">
              The AI only proposes donees, marital status, and any tenancy you stated — you confirm everything
              below. It never writes the legal description or generates the deed.
            </span>
          </div>
          {proposeError && <p data-testid="deed-intake-propose-error" className="text-red-600 text-sm mt-1">{proposeError}</p>}
          {proposeStatus === 'proposed' && (
            <p data-testid="deed-intake-proposed-note" className="mt-2 rounded border border-firm-navy/20 bg-firm-navy/5 px-3 py-2 text-xs text-ink-secondary">
              Proposed from your description — confirm or correct the facts below before you generate.
            </p>
          )}
          {proposeStatus === 'needs_clarification' && (
            <div data-testid="deed-intake-clarify" className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
              <p className="font-medium">A few things need clarifying before I can propose the facts:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {proposeQuestions.map((qn, i) => <li key={i}>{qn}</li>)}
              </ul>
              <p>Restate the deal with those details, or fill the facts in manually below.</p>
            </div>
          )}
          {proposeStatus === 'blocked' && (
            <p data-testid="deed-intake-blocked" className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The AI intake is not available right now ({proposeBlockedReason}). Fill the facts in manually below — the
              rest of the deed flow is unaffected.
            </p>
          )}
        </div>
      )}

      {/* (c) Structured gift form — the confirm surface + the collapsed "fill it in manually" fallback. */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {(showUpload || showFreeAssociate) && (
          <button
            type="button"
            data-testid="deed-intake-form-toggle"
            onClick={() => setFormExpanded((v) => !v)}
            className="text-sm text-firm-navy hover:underline"
          >
            {formExpanded ? 'Hide the deed facts' : 'Fill in the deed facts manually'}
          </button>
        )}

        <div className={formExpanded ? 'space-y-6' : 'hidden'} data-testid="deed-intake-fields">
          {/* Layer 1 (E1b) pre-fill note. */}
          {previewFacts.data?.hasMaterials && (
            <div data-testid="quick-deed-prefill-note" className="rounded border border-firm-navy/20 bg-firm-navy/5 px-3 py-2 text-xs text-ink-secondary">
              Read from your uploads — the recording locality and the grantee&apos;s address (defaulted to the
              property) are pre-filled below; confirm or override. The legal description, parcel, and assessed value
              resolve into the draft automatically.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantor(s) — donor(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantors, setGrantors, "Descriptor (e.g. 'husband and wife')")}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantee(s) — donee(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantees, setGrantees, "Relationship (e.g. “the Grantors’ daughter”)")}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={granteesAreMarriedCouple}
              onChange={(e) => setGranteesAreMarriedCouple(e.target.checked)}
              className="rounded"
            />
            Grantees are a married couple (&rarr; tenancy by the entirety)
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File number</label>
              <input
                type="text"
                value={fileNumber}
                onChange={(e) => setFileNumber(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="36-YYYY-NNNN"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recording locality</label>
              <input
                type="text"
                data-testid="quick-deed-locality"
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="County / City (else read from the packet)"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grantee&apos;s address</label>
            <input
              type="text"
              data-testid="quick-deed-grantee-address"
              value={granteeAddress}
              onChange={(e) => setGranteeAddress(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="Mailing address for tax bills / notices"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Derivation (&ldquo;Being&rdquo;) reference</label>
            <input
              type="text"
              value={derivationReference}
              onChange={(e) => setDerivationReference(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g. in Deed Book 5500 at Page 12 (where the prior deed is recorded)"
            />
            {previewFacts.data?.derivationCandidate && (
              <p data-testid="quick-deed-derivation-candidate" className="text-xs text-ink-hint mt-1">
                Candidate from your uploads (confirm before use): {previewFacts.data.derivationCandidate}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vesting override (optional)</label>
            <input
              type="text"
              value={vestingOverride}
              onChange={(e) => setVestingOverride(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="Defaults from grantee count + marital status"
            />
          </div>
        </div>

        {error && <p data-testid="quick-deed-error" className="text-red-600 text-sm">{error}</p>}
        {submitError && <p data-testid="deed-intake-submit-error" className="text-red-600 text-sm">{submitError}</p>}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            data-testid="quick-deed-generate"
            disabled={submitting}
            className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Generating…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
