/**
 * DeedIntake — DEED-INTAKE-REDESIGN-1 + DEED-EXPRESS-1 (inc1): the ONE shared gift-deed intake experience,
 * mounted on BOTH the standalone Quick Deed page and the matter-scoped "Gift Deed Draft" modal so there is no
 * drift.
 *
 * The EXPRESS flow (DEED-EXPRESS-1 inc1, Gift): drop the prior deed + tax record → describe the deal → Generate.
 *   (a) a PRIMARY drag-and-drop drop zone (MaterialsDropZone) — the vesting deed / tax record upload + OCR,
 *       front-and-center. Extraction fills the doc-derived facts (legal description, parcel, locality, situs) and
 *       AUTO-SEEDS the new-deed grantor from the prior deed's grantee of record (= the current owner = the donor),
 *       flagged "confirm grantor" — highlighted, never silently authoritative;
 *   (b) a FREE-ASSOCIATE box (Quick Deed Layer 2 / E3): the attorney describes the deal in one text box; the
 *       server `quickDeed.proposeIntake` PARSES → PROPOSES only the irreducible intake fields (donees, marital
 *       flag, an explicit vesting/override). It is PROPOSE-ONLY (it never drafts/records/sends) and NEVER authors
 *       a legal description. Fail-closed: an ambiguous/low-confidence parse returns clarifying questions; an egress
 *       hold returns a clean blocked notice — never a guessed proposal;
 *   (c) Generate: when the merged required set (≥1 grantor + ≥1 grantee + a non-withheld extracted legal) is
 *       satisfied, the structured form stays COLLAPSED and Generate submits in ONE CLICK (the attorney confirms by
 *       reading the resulting deed). When something required is missing, the form EXPANDS pre-filled with
 *       everything known and the missing required fields are HIGHLIGHTED — never blocked silently;
 *   (d) the full structured form is ALWAYS available as the fallback via "Fill in all fields manually".
 *
 * This component is CONTROLLED at the seams: it owns the form state but emits the validated gift payload via
 * onSubmit (the parent owns the mutation, the matterId injection, and the navigation). matterId is resolved
 * lazily via resolveMatterId so the Quick Deed lane persists nothing until a real interaction (spec §4).
 *
 * Flag-dark: it is only ever mounted inside an already-flag-guarded surface (the /deed page self-guards on
 * deedDraftAgent.isEnabled; the matter modal's entry button is flag-gated). Every server call it makes is
 * itself fail-closed when the flag is off. The model still NEVER authors the legal/property description
 * (extraction-only) and Generate never records or sends — unchanged.
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
  // The structured form is the collapsed Express fallback: drop zone + free-associate are primary. Under
  // DEED-EXPRESS-1 it stays COLLAPSED by default — it no longer force-expands on upload or on a proposal. It opens
  // only when (i) the attorney clicks "Fill in all fields manually", or (ii) Generate finds a required field
  // missing (then it opens pre-filled with the missing fields highlighted). It starts open only when there is
  // nothing above it to be the Express surface.
  const [formExpanded, setFormExpanded] = useState(!showUpload && !showFreeAssociate);
  // DEED-EXPRESS-1: the grantor was auto-seeded from the prior deed's grantee of record and the attorney has not
  // yet confirmed or edited it. It is surfaced (a visible "confirm grantor" banner + a highlighted grantor row) so
  // it is NEVER silently authoritative; it clears when the attorney confirms or edits the grantor.
  const [grantorNeedsConfirm, setGrantorNeedsConfirm] = useState(false);
  // DEED-EXPRESS-1: which required fields to highlight after a Generate attempt found them missing.
  const [missing, setMissing] = useState<{ grantor: boolean; grantee: boolean; legal: boolean }>({
    grantor: false,
    grantee: false,
    legal: false,
  });

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
  // Latest grantors, readable from the seed effect without re-subscribing it to grantor edits (so the seed never
  // re-fires on typing) and without a stale closure — lets us decide "never clobber attorney input" purely. Synced
  // in an effect (not during render) and declared BEFORE the seed effect so it is current when the seed reads it.
  const grantorsRef = useRef(grantors);
  useEffect(() => {
    grantorsRef.current = grantors;
  }, [grantors]);
  const prefilledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = previewFacts.data;
    if (!p || !p.hasMaterials) return;
    // DEED-EXPRESS-1: the uploads no longer FORCE the structured form open — the form stays collapsed behind the
    // Express surface (drop + describe + Generate). Pre-fills below populate the (collapsed) form state; the
    // attorney sees the Express banners, and Generate opens the form only if something required is missing.
    if (p.locality && !prefilledRef.current.has('locality')) {
      prefilledRef.current.add('locality');
      setLocality((cur) => (cur.trim() === '' ? p.locality! : cur));
    }
    if (p.granteeAddress && !prefilledRef.current.has('granteeAddress')) {
      prefilledRef.current.add('granteeAddress');
      setGranteeAddress((cur) => (cur.trim() === '' ? p.granteeAddress! : cur));
    }
    // DEED-EXPRESS-1: auto-seed the new-deed GRANTOR(s) from the prior deed's grantee(s) of record (= the current
    // owner(s) = the donor on a gift), flagged for confirmation. Use the NAMES array so a multi-owner prior deed
    // (e.g. a married couple → the canonical VA residential gift) seeds one grantor row per owner — granteeOfRecord
    // (the single value) is null for 2+ owners. Seed ONCE, and only when the attorney has not already typed a
    // grantor — never clobber attorney input. NEVER silently authoritative: it shows in the "confirm grantor"
    // banner + highlighted grantor row(s) until confirmed or edited.
    const priorGrantees = p.granteeOfRecordNames ?? [];
    if (priorGrantees.length > 0 && !prefilledRef.current.has('grantorSeed')) {
      prefilledRef.current.add('grantorSeed');
      const allEmpty = grantorsRef.current.every((r) => r.name.trim() === '' && r.descriptor.trim() === '');
      if (allEmpty) {
        setGrantors(priorGrantees.map((n) => ({ name: n, descriptor: '' })));
        setGrantorNeedsConfirm(true);
      }
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
      // A parse fills a grantee → clear any stale "grantee missing" highlight from a prior Generate attempt.
      if (p.grantees.length > 0) setMissing((m) => ({ ...m, grantee: false }));
      setProposeQuestions([]);
      setProposeBlockedReason(null);
      setProposeStatus('proposed');
      // DEED-EXPRESS-1: a proposal no longer force-expands the form. It pre-fills the (collapsed) form state and
      // surfaces a summary note; the attorney goes straight to Generate (one click when the required set is
      // complete) or opens the form manually to review.
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

  // PROPOSE-INTAKE-PARSE-FIX-1: a plain-English lead for the blocked-intake notice, per egress block
  // reason (the raw reason code is still shown in parens as a diagnostic tail). Honest + distinct:
  // an allowlist block ("not enabled in this deployment") reads differently from a matter hold.
  const proposeBlockedLead = (reason: string | null): string => {
    switch (reason) {
      case 'provider_not_allowlisted':
        return 'The AI describe-the-deal intake is not enabled in this deployment yet';
      case 'hold_no_external':
      case 'hold_uncertain':
        return 'The AI intake is unavailable because this matter has external communication on hold';
      default:
        return 'The AI intake is not available right now';
    }
  };

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

  // Grantor/grantee setters that also clear their stale "missing" highlight (and, for the grantor, the
  // "confirm" flag — editing the auto-seeded grantor is the attorney taking ownership of it).
  const updateGrantors = (next: PartyRow[]): void => {
    setGrantors(next);
    setMissing((m) => (m.grantor ? { ...m, grantor: false } : m));
    setGrantorNeedsConfirm(false);
  };
  const updateGrantees = (next: PartyRow[]): void => {
    setGrantees(next);
    setMissing((m) => (m.grantee ? { ...m, grantee: false } : m));
  };

  // Build the highlighted-missing-fields message for a failed Generate attempt. The legal-description message
  // depends on whether anything was uploaded — it is EXTRACTION-ONLY, so the remedy is to drop a (clearer) prior
  // deed, never to type it.
  const buildMissingMessage = (g: boolean, gr: boolean, legal: boolean, hasMaterials: boolean): string => {
    const parts: string[] = [];
    if (g) parts.push('At least one grantor (donor) name is required.');
    if (gr) parts.push('At least one grantee (donee) name is required.');
    if (legal) {
      parts.push(
        hasMaterials
          ? 'The legal description could not be read from your uploads — re-drop a clearer copy of the prior vesting deed (it is copied verbatim from your documents, never written by the system).'
          : 'Drop the prior vesting deed above so the legal description can be read from it (it is copied verbatim from your documents, never written by the system).',
      );
    }
    return parts.join(' ');
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = cleanParties(grantors);
    const cleanGrantees = cleanParties(grantees);
    const grantorMissing = cleanGrantors.length === 0;
    const granteeMissing = cleanGrantees.length === 0;
    const hasMaterials = previewFacts.data?.hasMaterials === true;
    // The legal/property description is EXTRACTION-ONLY (never typed, never model-authored). It counts as present
    // only when the packet supplied a non-withheld one (previewFacts.resolved.legalDescription). It is part of the
    // EXPRESS required set ONLY once a packet exists — with no uploads the attorney is doing manual entry and the
    // server honestly placeholders a missing legal (unchanged behavior); we do not block that.
    const legalResolved = previewFacts.data?.resolved?.legalDescription === true;
    const legalMissing = hasMaterials && !legalResolved;

    // DEED-EXPRESS-1 Generate gate:
    //  • EXPRESS (form collapsed): require the full merged set — grantor + grantee + (once a packet exists) a
    //    non-withheld extracted legal. If anything is missing, OPEN the form pre-filled and HIGHLIGHT only the
    //    missing required fields (never a silent block); the attorney supplies what's missing (or re-drops the
    //    deed) and Generates again. If complete, submit in ONE CLICK.
    //  • MANUAL (form already open, the fallback): keep the existing grantor+grantee gate. The legal is surfaced
    //    as a visible warning, NOT a hard block — so the attorney can still generate the skeleton draft (with a
    //    verbatim-legal placeholder the server emits honestly) as an INFORMED choice, preserving prior behavior.
    if (!formExpanded) {
      if (grantorMissing || granteeMissing || legalMissing) {
        setMissing({ grantor: grantorMissing, grantee: granteeMissing, legal: legalMissing });
        setError(buildMissingMessage(grantorMissing, granteeMissing, legalMissing, hasMaterials));
        setFormExpanded(true);
        return;
      }
    } else if (grantorMissing || granteeMissing) {
      setMissing({ grantor: grantorMissing, grantee: granteeMissing, legal: false });
      setError(buildMissingMessage(grantorMissing, granteeMissing, false, hasMaterials));
      return;
    }

    // Required set satisfied — clear flags and emit. The attorney's act of generating confirms the (surfaced)
    // auto-seeded grantor; the generated deed they read is the final confirmation. Nothing records or sends.
    setError(null);
    setMissing({ grantor: false, grantee: false, legal: false });
    setGrantorNeedsConfirm(false);
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
    nameBorderClass = 'border-gray-300',
  ): React.ReactElement => (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex gap-2">
          <input
            type="text"
            value={row.name}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
            className={`flex-1 border ${nameBorderClass} rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy`}
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
              Proposed from your description — the donee(s), tenancy, and any overrides you stated are filled in.
              Generate when you&apos;re ready, or open &ldquo;Fill in all fields manually&rdquo; to review and adjust first.
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
              {proposeBlockedLead(proposeBlockedReason)} ({proposeBlockedReason}). Fill the facts in manually below — the
              rest of the deed flow is unaffected.
            </p>
          )}
        </div>
      )}

      {/* DEED-EXPRESS-1: the grantor auto-seeded from the prior deed's grantee of record (= current owner = donor).
          Surfaced here even while the form is collapsed so it is NEVER silently authoritative — the attorney
          confirms it (or opens the form to edit it). Clears on confirm or on any edit to the grantor. */}
      {grantorNeedsConfirm && grantors.some((g) => g.name.trim()) && (
        <div
          data-testid="deed-intake-grantor-confirm"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start justify-between gap-3"
        >
          <p>
            Grantor(s) (donor) read from the prior deed:{' '}
            <span className="font-medium">{grantors.map((g) => g.name.trim()).filter(Boolean).join(', ')}</span>.{' '}
            {grantors.filter((g) => g.name.trim()).length > 1 ? 'Confirm these are the donors' : 'Confirm this is the donor'}, or
            open the form below to edit. It is a presumption from the prior deed&apos;s owner(s) of record — not used
            until you confirm or generate.
          </p>
          <button
            type="button"
            data-testid="deed-intake-grantor-confirm-ok"
            onClick={() => setGrantorNeedsConfirm(false)}
            className="shrink-0 px-2 py-1 text-xs border border-amber-400 rounded hover:bg-amber-100"
          >
            Confirm grantor(s)
          </button>
        </div>
      )}

      {/* (c) Structured gift form — the confirm surface + the collapsed "Fill in all fields manually" fallback. */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {(showUpload || showFreeAssociate) && (
          <button
            type="button"
            data-testid="deed-intake-form-toggle"
            onClick={() => setFormExpanded((v) => !v)}
            className="text-sm text-firm-navy hover:underline"
          >
            {formExpanded ? 'Hide the deed facts' : 'Fill in all fields manually'}
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

          {/* DEED-EXPRESS-1: the legal/property description is EXTRACTION-ONLY. If the packet did not yield a
              non-withheld one, warn (the remedy is to re-drop a clearer prior deed). Generating anyway leaves a
              verbatim-legal placeholder for the attorney to complete — never a fabricated description. */}
          {previewFacts.data?.hasMaterials && previewFacts.data.resolved?.legalDescription === false && (
            <div data-testid="deed-intake-legal-missing" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The legal/property description could not be read from your uploads. Re-drop a clearer copy of the prior
              vesting deed — otherwise the draft will contain a placeholder for the legal description that you must
              complete manually. It is copied verbatim from your documents and is never written by the system.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantor(s) — donor(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(
              grantors,
              updateGrantors,
              "Descriptor (e.g. 'husband and wife')",
              missing.grantor ? 'border-red-400 ring-1 ring-red-300' : grantorNeedsConfirm ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-300',
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantee(s) — donee(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(
              grantees,
              updateGrantees,
              "Relationship (e.g. “the Grantors’ daughter”)",
              missing.grantee ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300',
            )}
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
