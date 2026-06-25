/**
 * QuickDeedPage — DEED-DRAFT-AGENT-1 QUICK DEED (QD-1): the top-level, single-screen fast lane.
 *
 * The attorney ducks in and makes a deed without opening a matter (spec docs/deed/DEED_QUICK_MODE_spec.md):
 *   1. the lightweight owning matter is LAZILY created (behind the screen) on the FIRST real interaction —
 *      opening Materials or clicking Generate — NOT on mount, so merely viewing /deed accumulates nothing.
 *      It persists the document through the standard documents/versions path (retention/audit preserved, §4);
 *   2. a deed-type SELECTOR (the whole registry; only the Deed of Gift is enabled — others show "wiring
 *      pending"; registry-driven so they enable here as they ship);
 *   3. the existing matterId-keyed MaterialsDrawer for the vesting deed / tax record upload + OCR (spec §3.3);
 *   4. the structured gift fields (mirrors GiftDraftForm);
 *   5. Generate -> quickDeed.generate -> navigate to the existing document review/finalize/.docx export surface.
 *
 * Flag-dark: the page SELF-GUARDS on deedDraftAgent.isEnabled (default OFF -> redirects to /matters); the
 * server is the authority on every gate and the assembly. Conflicts-at-intake is BYPASSED for Quick Deed by
 * default (spec §5) — the server stamps a non-blocking "no conflicts check performed" note into the document.
 * This screen never finalizes, records, or sends.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import MaterialsDrawer from '../components/MaterialsDrawer.js';

const QUICK_DEED_GIFT_TYPE = 'deed_of_gift';
const QUICK_DEED_SELLER_TYPE = 'seller_side';

interface PartyRow {
  name: string;
  descriptor: string;
}

const emptyRow = (): PartyRow => ({ name: '', descriptor: '' });

/** The validated generate input MINUS matterId (the matterId is injected from the freshly-created/existing
 *  Quick Deed matter at dispatch time, never baked into the captured payload). */
type GeneratePayload = Omit<
  Parameters<ReturnType<typeof trpc.useUtils>['client']['quickDeed']['generate']['mutate']>[0],
  'matterId'
>;

export default function QuickDeedPage(): React.ReactElement {
  // All hooks run before any early return (Rules of Hooks).
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: flag, isLoading: flagLoading } = trpc.deedDraftAgent.isEnabled.useQuery();
  const enabled = flag?.enabled === true;

  // LAZY auto-matter (spec §4): the owning matter is NOT created on mount — merely opening /deed and leaving
  // persists nothing. It is created the FIRST time the attorney actually does something (opens Materials or
  // clicks Generate), then the intended action proceeds. createFiredRef guards a double-fire but is RESET on
  // error so a failed create can be retried (no permanent dead-end).
  const [matterId, setMatterId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const createFiredRef = useRef(false);
  // What to do once the matter exists: open the materials drawer, or run the (already-validated) generate.
  type PendingAction = { kind: 'materials' } | { kind: 'generate'; payload: GeneratePayload };
  const pendingActionRef = useRef<PendingAction | null>(null);

  const generate = useGuardedMutation(
    (input: Parameters<typeof utils.client.quickDeed.generate.mutate>[0]) =>
      utils.client.quickDeed.generate.mutate(input),
    {
      onSuccess: (res) => {
        if (res.documentId) {
          navigate(`/matters/${res.matterId}/documents/${res.documentId}`);
          return;
        }
        // Seller-side can fail closed (truncated legal / name bleed / estate scope): no void deed is persisted.
        setError(
          res.failures && res.failures.length > 0
            ? `The deed could not be generated: ${res.failures.join('; ')}`
            : 'The deed could not be generated from the provided facts.',
        );
      },
      onError: (err) => setError(err.message),
    },
  );

  // Run a pending action against a now-known matterId.
  const runPendingAction = (id: string): void => {
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    if (!pending) return;
    if (pending.kind === 'materials') {
      setMaterialsOpen(true);
    } else {
      generate.mutate({ ...pending.payload, matterId: id });
    }
  };

  const createMatter = useGuardedMutation(
    () => utils.client.quickDeed.create.mutate(),
    {
      onSuccess: (res) => {
        setMatterId(res.matterId);
        runPendingAction(res.matterId);
      },
      onError: (err) => {
        // Reset the guard so the attorney can retry. KEEP the pending action so Retry resumes what they were
        // doing (open materials / generate). Surface an honest error with a Retry affordance (no dead-end).
        createFiredRef.current = false;
        setCreateError(err.message);
      },
    },
  );

  // Retry a failed create, resuming the pending action (or just creating if none was recorded).
  const handleRetryCreate = (): void => {
    setCreateError(null);
    if (createFiredRef.current) return; // already retrying
    createFiredRef.current = true;
    createMatter.mutate(undefined);
  };

  // Ensure the owning matter exists, then perform `action`. If it already exists, act immediately; otherwise
  // record the intent and lazily fire create (guarded against double-fire; the guard resets on error).
  const ensureMatterThen = (action: PendingAction): void => {
    setCreateError(null);
    if (matterId) {
      pendingActionRef.current = action;
      runPendingAction(matterId);
      return;
    }
    pendingActionRef.current = action;
    if (createFiredRef.current) return; // a create is already in flight; the pending action will run on success
    createFiredRef.current = true;
    createMatter.mutate(undefined);
  };

  // The deed-type catalog (the whole registry; only gift generates). Enabled only when the flag is on.
  const deedTypesQuery = trpc.quickDeed.listDeedTypes.useQuery(undefined, { enabled });
  const deedTypes = deedTypesQuery.data ?? [];

  const [deedType, setDeedType] = useState<string>(QUICK_DEED_GIFT_TYPE);
  const [grantors, setGrantors] = useState<PartyRow[]>([emptyRow()]);
  const [grantees, setGrantees] = useState<PartyRow[]>([emptyRow()]);
  const [granteesAreMarriedCouple, setGranteesAreMarriedCouple] = useState(false);
  const [fileNumber, setFileNumber] = useState('');
  const [granteeAddress, setGranteeAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [derivationReference, setDerivationReference] = useState('');
  const [vestingOverride, setVestingOverride] = useState('');
  // Seller-side-only fields (the new-transaction facts the prior document cannot supply). Surfaced only when the
  // seller-side deed type is selected; the doc-derived legal/locality/taxId/assessedValue/grantee-address default
  // from extraction server-side (override-able via the shared inputs below).
  const [warrantyType, setWarrantyType] = useState('');
  const [considerationFigs, setConsiderationFigs] = useState('');
  const [amountWords, setAmountWords] = useState('');
  const [grantorDescriptor, setGrantorDescriptor] = useState('');
  const [granteeDescriptor, setGranteeDescriptor] = useState('');
  const [tenancy, setTenancy] = useState('');
  const [vestingRecital, setVestingRecital] = useState('');
  const [venue, setVenue] = useState('');
  const [returnTo, setReturnTo] = useState('');
  const [titleInsurer, setTitleInsurer] = useState('');
  const [sellerType, setSellerType] = useState<'individual' | 'estate'>('individual');
  const [error, setError] = useState<string | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  const isSeller = deedType === QUICK_DEED_SELLER_TYPE;

  // Quick Deed Layer 1 (E1b): once the owning matter exists, read the consolidated facts from the uploaded
  // materials and PRE-FILL the empty form fields (recording locality, grantee's address) so the attorney
  // confirms extracted values instead of re-typing. Override-safe: a field the attorney has typed is NEVER
  // clobbered, and each field is pre-filled at most once (prefilledRef) so a cleared field stays cleared.
  const previewFacts = trpc.quickDeed.previewFacts.useQuery(
    { matterId: matterId ?? '' },
    { enabled: !!matterId },
  );
  const prefilledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = previewFacts.data;
    if (!p || !p.hasMaterials) return;
    const loc = p.locality;
    if (loc && !prefilledRef.current.has('locality')) {
      prefilledRef.current.add('locality');
      setLocality((cur) => (cur.trim() === '' ? loc : cur));
    }
    const addr = p.granteeAddress;
    if (addr && !prefilledRef.current.has('granteeAddress')) {
      prefilledRef.current.add('granteeAddress');
      setGranteeAddress((cur) => (cur.trim() === '' ? addr : cur));
    }
  }, [previewFacts.data]);

  if (flagLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }
  if (!enabled) return <Navigate to="/matters" replace />;

  const creating = createMatter.isPending;

  const cleanParties = (rows: PartyRow[]): { name: string; descriptor?: string }[] =>
    rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => {
        const d = r.descriptor.trim();
        return d.length > 0 ? { name: r.name.trim(), descriptor: d } : { name: r.name.trim() };
      });

  const handleGenerate = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = cleanParties(grantors);
    const cleanGrantees = cleanParties(grantees);
    if (cleanGrantors.length === 0) {
      setError(`At least one ${isSeller ? 'grantor (seller)' : 'grantor (donor)'} name is required.`);
      return;
    }
    if (cleanGrantees.length === 0) {
      setError(`At least one ${isSeller ? 'grantee (buyer)' : 'grantee (donee)'} name is required.`);
      return;
    }
    setError(null);
    // Validate synchronously, then lazily ensure the owning matter exists and generate. The matterId is
    // injected from the freshly-created (or existing) matter — never baked into the captured payload. The
    // payload shape is the discriminated-union member for the selected deed type (the server validates the same).
    const payload: GeneratePayload = isSeller
      ? {
          deedType: QUICK_DEED_SELLER_TYPE,
          grantors: cleanGrantors,
          grantees: cleanGrantees,
          granteeAddress: granteeAddress.trim() || null,
          // Seller-only facts nested (the shared party/grantee-address fields stay at the top level).
          sellerSide: {
            warrantyType: warrantyType.trim() || undefined,
            considerationFigs: considerationFigs.trim(),
            amountWords: amountWords.trim(),
            titleInsurer: titleInsurer.trim(),
            grantorDescriptor: grantorDescriptor.trim() || undefined,
            granteeDescriptor: granteeDescriptor.trim() || undefined,
            tenancy: tenancy.trim(),
            vestingRecital: vestingRecital.trim(),
            venue: venue.trim(),
            returnTo: returnTo.trim(),
            sellerType,
            fileNumber: fileNumber.trim(),
            county: locality.trim() || null,
            title: 'Seller-Side Deed',
          },
        }
      : {
          deedType: QUICK_DEED_GIFT_TYPE,
          grantors: cleanGrantors,
          grantees: cleanGrantees,
          granteesAreMarriedCouple,
          fileNumber: fileNumber.trim() || null,
          granteeAddress: granteeAddress.trim() || null,
          locality: locality.trim() || null,
          derivationReference: derivationReference.trim() || null,
          vestingOverride: vestingOverride.trim() || null,
          title: 'Deed of Gift',
        };
    ensureMatterThen({ kind: 'generate', payload });
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
    <div data-testid="quick-deed-page" className="p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-serif font-medium text-ink">Deed</h1>
        <p className="text-sm text-ink-secondary mt-0.5">
          Make a deed without opening a matter. Pick the type, drop in the prior vesting deed and tax record,
          fill the party facts, and generate the house-style draft. The draft is never auto-recorded or sent —
          you review and finalize it.
        </p>
      </div>

      {createError && (
        <div data-testid="quick-deed-create-error" className="mb-4 flex items-center gap-3 text-sm">
          <span className="text-red-600">Couldn&apos;t start the deed record. {createError}</span>
          <button
            type="button"
            data-testid="quick-deed-create-retry"
            disabled={creating}
            onClick={handleRetryCreate}
            className="px-2 py-1 border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <form onSubmit={handleGenerate} className="space-y-6">
        {/* Deed type selector — the whole registry; only the Deed of Gift generates today. */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="quick-deed-type">
            Deed type <span className="text-red-500">*</span>
          </label>
          <select
            id="quick-deed-type"
            data-testid="quick-deed-type-select"
            value={deedType}
            onChange={(e) => setDeedType(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-firm-navy"
          >
            {deedTypes.length === 0 && (
              <option value={QUICK_DEED_GIFT_TYPE}>Deed of Gift</option>
            )}
            {deedTypes.map((t) => (
              <option key={t.key} value={t.key} disabled={!t.quickDeedGenerates}>
                {t.title}
                {t.quickDeedGenerates ? '' : ' — wiring pending'}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-hint mt-1">
            Other deed types are listed but not yet wired for Quick Deed generation.
          </p>
        </div>

        {/* Supporting documents — the existing matterId-keyed materials surface (upload + OCR). */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supporting documents</label>
          <button
            type="button"
            data-testid="quick-deed-materials-button"
            disabled={creating}
            onClick={() => ensureMatterThen({ kind: 'materials' })}
            className="px-3 py-1.5 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
          >
            {creating ? 'Preparing…' : 'Upload vesting deed / tax record…'}
          </button>
          <p className="text-xs text-ink-hint mt-1">
            The property facts (legal description, parcel, assessed value) are read from these uploads.
          </p>
        </div>

        {/* Quick Deed Layer 1 (E1b): once materials are uploaded, the doc-derived facts pre-fill the fields below. */}
        {previewFacts.data?.hasMaterials && (
          <div data-testid="quick-deed-prefill-note" className="rounded border border-firm-navy/20 bg-firm-navy/5 px-3 py-2 text-xs text-ink-secondary">
            Read from your uploads — the recording locality and the grantee&apos;s address (defaulted to the
            property) are pre-filled below; confirm or override. The legal description, parcel, and assessed value
            resolve into the draft automatically.
          </div>
        )}

        {/* Structured gift fields (mirror GiftDraftForm). */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {isSeller ? 'Grantor(s) — seller(s)' : 'Grantor(s) — donor(s)'} <span className="text-red-500">*</span>
          </label>
          {renderPartyRows(grantors, setGrantors, "Descriptor (e.g. 'husband and wife')")}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {isSeller ? 'Grantee(s) — buyer(s)' : 'Grantee(s) — donee(s)'} <span className="text-red-500">*</span>
          </label>
          {renderPartyRows(grantees, setGrantees, isSeller ? 'Descriptor (optional)' : "Relationship (e.g. “the Grantors’ daughter”)")}
        </div>
        {!isSeller && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={granteesAreMarriedCouple}
              onChange={(e) => setGranteesAreMarriedCouple(e.target.checked)}
              className="rounded"
            />
            Grantees are a married couple (&rarr; tenancy by the entirety)
          </label>
        )}

        {/* Seller-side new-transaction facts (only when the seller-side deed type is selected). */}
        {isSeller && (
          <div data-testid="quick-deed-seller-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
            <p className="text-xs text-ink-secondary">
              The conveyance facts the prior document can&apos;t supply. The legal description, parcel/tax id, and
              assessed value resolve from your uploads (override below if needed).
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Warranty</label>
                <input type="text" value={warrantyType} onChange={(e) => setWarrantyType(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="e.g. Special Warranty" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seller type</label>
                <select value={sellerType} onChange={(e) => setSellerType(e.target.value === 'estate' ? 'estate' : 'individual')}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-firm-navy">
                  <option value="individual">Individual</option>
                  <option value="estate">Estate / fiduciary</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Consideration (figures)</label>
                <input type="text" value={considerationFigs} onChange={(e) => setConsiderationFigs(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="$612,000.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Consideration (words)</label>
                <input type="text" value={amountWords} onChange={(e) => setAmountWords(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="SIX HUNDRED TWELVE THOUSAND AND 00/100" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grantor descriptor</label>
                <input type="text" value={grantorDescriptor} onChange={(e) => setGrantorDescriptor(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="e.g. a married couple" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grantee descriptor</label>
                <input type="text" value={granteeDescriptor} onChange={(e) => setGranteeDescriptor(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="e.g. a single man" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tenancy / vesting</label>
              <input type="text" value={tenancy} onChange={(e) => setTenancy(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="e.g. as tenants by the entirety with the right of survivorship" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vesting (&ldquo;Being&rdquo;) recital</label>
              <textarea value={vestingRecital} onChange={(e) => setVestingRecital(e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="BEING the same property conveyed unto … by Deed recorded in Deed Book … at Page …" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Venue (acknowledgment)</label>
                <input type="text" value={venue} onChange={(e) => setVenue(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="COUNTY OF PRINCE WILLIAM" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title insurer</label>
                <input type="text" value={titleInsurer} onChange={(e) => setTitleInsurer(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                  placeholder="e.g. Stewart Title Guaranty Company" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return to (after recording)</label>
              <input type="text" value={returnTo} onChange={(e) => setReturnTo(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="e.g. Universal Title, 1320 Old Chain Bridge Rd, McLean, VA 22101" />
            </div>
          </div>
        )}
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
        {!isSeller && (
          <>
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
          </>
        )}

        {error && <p data-testid="quick-deed-error" className="text-red-600 text-sm">{error}</p>}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            data-testid="quick-deed-generate"
            disabled={generate.isPending || creating}
            className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {generate.isPending ? 'Generating…' : creating ? 'Preparing…' : 'Generate draft'}
          </button>
        </div>
      </form>

      {materialsOpen && matterId && (
        <MaterialsDrawer
          matterId={matterId}
          onClose={() => {
            setMaterialsOpen(false);
            void previewFacts.refetch(); // re-read facts after an upload so the form pre-fills from extraction
          }}
        />
      )}
    </div>
  );
}
