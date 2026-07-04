/**
 * QuickDeedPage — DEED-DRAFT-AGENT-1 QUICK DEED (QD-1): the top-level, single-screen fast lane.
 *
 * The attorney ducks in and makes a deed without opening a matter (spec docs/deed/DEED_QUICK_MODE_spec.md):
 *   1. the lightweight owning matter is LAZILY created (behind the screen) on the FIRST real interaction —
 *      dropping a file, proposing the facts, or clicking Generate — NOT on mount, so merely viewing /deed
 *      accumulates nothing. It persists the document through the standard documents/versions path (§4);
 *   2. a deed-type SELECTOR (the whole registry; only the Deed of Gift + seller-side generate today);
 *   3. DEED-INTAKE-REDESIGN-1: for the gift lane the page renders the shared <DeedIntake> — a primary
 *      drag-and-drop drop zone + an AI free-associate box + the structured form (the same component the matter
 *      "Gift Deed Draft" modal uses, so the two surfaces never drift). The seller-side lane keeps its own
 *      structured form (a distinct deed type) and the same primary drop zone;
 *   4. Generate -> quickDeed.generate -> navigate to the existing document review/finalize/.docx export surface.
 *
 * Flag-dark: the page SELF-GUARDS on deedDraftAgent.isEnabled (default OFF -> redirects to /matters); the
 * server is the authority on every gate and the assembly. Conflicts-at-intake is BYPASSED for Quick Deed by
 * default (spec §5). This screen never finalizes, records, or sends.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import MaterialsDropZone from '../components/MaterialsDropZone.js';
import DeedIntake, { type DeedGiftIntakePayload } from '../components/DeedIntake.js';
import QuickDeedCategoryForm from './quickDeedCategoryForms.js';
import { ManualFieldsToggle, MISSING_RING_CLASS } from './deedManualForm.js';
import { sellerProposalToFields, type SellerProposalInput } from './quickDeedProposalApply.js';

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
  // DEED-INTAKE-PARITY-1 Inc 2: the same page serves two routes. /deed = standalone (lazy auto-matter). The
  // matter-scoped route /matters/:matterId/deed binds to an EXISTING matter — no lazy create, and generation
  // honors that matter's conflicts gate (enforceConflicts) instead of the standalone bypass-and-stamp.
  const { matterId: routeMatterId } = useParams<{ matterId?: string }>();
  const matterScoped = typeof routeMatterId === 'string' && routeMatterId.length > 0;
  const { data: flag, isLoading: flagLoading } = trpc.deedDraftAgent.isEnabled.useQuery();
  const enabled = flag?.enabled === true;

  // LAZY auto-matter (spec §4): the owning matter is NOT created on mount — merely opening /deed and leaving
  // persists nothing. It is created (and its id returned) the FIRST time the attorney actually does something
  // (drops a file, proposes the facts, or clicks Generate). createPromiseRef dedupes concurrent callers (a drop
  // + a generate must not both create) and is cleared on error so a failed create can be retried.
  const [matterId, setMatterId] = useState<string | null>(routeMatterId ?? null);
  const [createError, setCreateError] = useState<string | null>(null);
  // UB1-W3b-2: plain-English cure cards from a fail-closed generate (S5 survivorship + every deed gate) — what's
  // missing/mismatched, which field to fix, and how to regenerate in place. Empty on success / no withhold.
  const [cureCards, setCureCards] = useState<Array<{ flag: string; field: string; problem: string; fix: string }>>([]);
  const [creating, setCreating] = useState(false);
  const createPromiseRef = useRef<Promise<string> | null>(null);

  const ensureMatterAsync = (): Promise<string> => {
    if (matterId) return Promise.resolve(matterId);
    if (createPromiseRef.current) return createPromiseRef.current;
    setCreateError(null);
    setCreating(true);
    const p = utils.client.quickDeed.create
      .mutate()
      .then((res) => {
        setMatterId(res.matterId);
        setCreating(false);
        return res.matterId;
      })
      .catch((err: unknown) => {
        // Clear the in-flight ref so the attorney can retry; surface an honest error (no dead-end).
        createPromiseRef.current = null;
        setCreating(false);
        setCreateError(err instanceof Error ? err.message : 'Could not start the deed record.');
        throw err;
      });
    createPromiseRef.current = p;
    return p;
  };

  // Retry a failed create (the next real interaction will also retry, but a banner button is friendlier).
  const handleRetryCreate = (): void => {
    void ensureMatterAsync().catch(() => { /* error already surfaced via createError */ });
  };

  const generate = useGuardedMutation(
    (input: Parameters<typeof utils.client.quickDeed.generate.mutate>[0]) =>
      utils.client.quickDeed.generate.mutate(input),
    {
      onSuccess: (res) => {
        if (res.documentId) {
          setCureCards([]);
          navigate(`/matters/${res.matterId}/documents/${res.documentId}`);
          return;
        }
        // Fail-closed (truncated legal / name bleed / incomplete S5 survivorship chain / etc.): no void deed is
        // persisted. UB1-W3b-2: prefer plain-English cure cards (which field to fix + regenerate) over raw codes;
        // fall back to the failures line only if the result predates cure cards.
        const cards = ('cureCards' in res && Array.isArray(res.cureCards) ? res.cureCards : []) as Array<{ flag: string; field: string; problem: string; fix: string }>;
        setCureCards(cards);
        setError(
          cards.length > 0
            ? null
            : res.failures && res.failures.length > 0
              ? `The deed could not be generated: ${res.failures.join('; ')}`
              : 'The deed could not be generated from the provided facts.',
        );
      },
      onError: (err) => setError(err.message),
    },
  );

  // Resolve the owning matter, then dispatch the validated generate payload against it (matterId injected here,
  // never baked into the captured payload).
  const runGenerate = (payload: GeneratePayload): void => {
    setCureCards([]); // clear any prior cure cards before a fresh attempt (fix-and-regenerate in place)
    void ensureMatterAsync()
      // DEED-INTAKE-PARITY-1 Inc 2: matter-scoped generation honors the matter's conflicts-at-intake gate.
      .then((id) => generate.mutate({ ...payload, matterId: id, ...(matterScoped ? { enforceConflicts: true } : {}) } as Parameters<typeof generate.mutate>[0]))
      .catch(() => { /* create error already surfaced via createError */ });
  };

  // The deed-type catalog (the whole registry; gift + seller generate). Enabled only when the flag is on.
  const deedTypesQuery = trpc.quickDeed.listDeedTypes.useQuery(undefined, { enabled });
  const deedTypes = deedTypesQuery.data ?? [];

  // W2d (QA-7 / run-sheet 0.9) — surface the conflicts waiver at GENERATE-TIME (not only in the output stamp).
  // Reuses the existing ungated getConflictsSetting; when enforced===false (the prod default) Quick Deed skips
  // the conflicts-at-intake check and stamps the deed, so the attorney is told BEFORE generating rather than
  // discovering it only in the output.
  const conflictsSetting = trpc.quickDeed.getConflictsSetting.useQuery(undefined, { enabled });

  const [deedType, setDeedType] = useState<string>(QUICK_DEED_GIFT_TYPE);
  // Seller-side state (the gift lane lives entirely inside <DeedIntake>). The shared party/locality/address
  // fields stay here for the seller form; the gift-only fields (married/derivation/vesting) moved to DeedIntake.
  const [grantors, setGrantors] = useState<PartyRow[]>([emptyRow()]);
  const [grantees, setGrantees] = useState<PartyRow[]>([emptyRow()]);
  const [fileNumber, setFileNumber] = useState('');
  const [granteeAddress, setGranteeAddress] = useState('');
  const [locality, setLocality] = useState('');
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
  // EXPRESS-FANOUT-1 (seller-side): the AI "describe the deal" box + proposal state (mirrors the gift DeedIntake).
  const [sellerFreeText, setSellerFreeText] = useState('');
  const [proposeStatus, setProposeStatus] = useState<'idle' | 'proposed' | 'needs_clarification' | 'blocked'>('idle');
  const [proposeQuestions, setProposeQuestions] = useState<string[]>([]);
  const [proposeBlockedReason, setProposeBlockedReason] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [grantorNeedsConfirm, setGrantorNeedsConfirm] = useState(false);
  // DEED-INTAKE-PARITY-1 (seller lane): intake-first — the confirm form + seller field wall start COLLAPSED behind
  // the shared toggle (parity with the gift DeedIntake); a generate attempt with gaps expands + red-rings them.
  const [sellerFormExpanded, setSellerFormExpanded] = useState(false);
  const [sellerMissing, setSellerMissing] = useState<{ grantor: boolean; grantee: boolean }>({ grantor: false, grantee: false });

  const isSeller = deedType === QUICK_DEED_SELLER_TYPE;

  // Quick Deed Layer 1 (E1b) for the SELLER lane: pre-fill the recording locality + grantee address from the
  // uploaded materials once the owning matter exists (override-safe, once-only). The gift lane runs the same
  // pre-fill inside <DeedIntake>; react-query dedupes the shared previewFacts query key.
  const previewFacts = trpc.quickDeed.previewFacts.useQuery(
    { matterId: matterId ?? '' },
    { enabled: !!matterId },
  );
  const prefilledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const p = previewFacts.data;
    if (!p || !p.hasMaterials) return;
    if (p.locality && !prefilledRef.current.has('locality')) {
      prefilledRef.current.add('locality');
      setLocality((cur) => (cur.trim() === '' ? p.locality! : cur));
    }
    if (p.granteeAddress && !prefilledRef.current.has('granteeAddress')) {
      prefilledRef.current.add('granteeAddress');
      setGranteeAddress((cur) => (cur.trim() === '' ? p.granteeAddress! : cur));
    }
    // EXPRESS-FANOUT-1 (seller-side): auto-seed the grantor(s) (= seller(s) = current owner(s)) from the prior
    // deed's grantee(s) of record, flagged for confirmation (mirrors the gift DeedIntake). Seed ONCE and only
    // when the attorney has not already typed a grantor — never clobber input.
    const priorGrantees = p.granteeOfRecordNames ?? [];
    if (priorGrantees.length > 0 && !prefilledRef.current.has('grantorSeed')) {
      prefilledRef.current.add('grantorSeed');
      setGrantors((cur) => {
        const allEmpty = cur.every((r) => r.name.trim() === '' && r.descriptor.trim() === '');
        return allEmpty ? priorGrantees.map((n) => ({ name: n, descriptor: '' })) : cur;
      });
      setGrantorNeedsConfirm(true);
    }
  }, [previewFacts.data]);

  // EXPRESS-FANOUT-1 (seller-side): apply a seller-side proposeIntake result to the form. PROPOSE-ONLY — this
  // only pre-fills the confirm form; nothing is generated. SAFETY: sellerProposalToFields never carries the
  // vesting recital or the legal description, so a proposal can never populate them.
  const applySellerProposal = (
    res:
      | { status: 'proposed'; proposal: SellerProposalInput }
      | { status: 'needs_clarification'; questions: string[] }
      | { status: 'blocked'; reason: string },
  ): void => {
    setProposeError(null);
    if (res.status === 'proposed') {
      const f = sellerProposalToFields(res.proposal);
      if (f.grantees) setGrantees(f.grantees);
      if (f.warrantyType) setWarrantyType(f.warrantyType);
      if (f.considerationFigs) setConsiderationFigs(f.considerationFigs);
      setProposeQuestions([]);
      setProposeBlockedReason(null);
      setProposeStatus('proposed');
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
    (input: { matterId: string; freeText: string }) => utils.client.quickDeed.proposeIntakeSellerSide.mutate(input),
    {
      onSuccess: (res) => applySellerProposal(res),
      onError: (err: Error) => setProposeError(err.message),
    },
  );

  if (flagLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-ink-hint text-sm">Loading…</span>
      </div>
    );
  }
  if (!enabled) return <Navigate to={matterScoped ? `/matters/${routeMatterId}` : '/matters'} replace />;

  const cleanParties = (rows: PartyRow[]): { name: string; descriptor?: string }[] =>
    rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => {
        const d = r.descriptor.trim();
        return d.length > 0 ? { name: r.name.trim(), descriptor: d } : { name: r.name.trim() };
      });

  // Gift lane: <DeedIntake> validated the gift facts and emits them; build the gift generate payload + dispatch.
  const handleGiftSubmit = (p: DeedGiftIntakePayload): void => {
    setError(null);
    runGenerate({
      deedType: QUICK_DEED_GIFT_TYPE,
      grantors: p.grantors,
      grantees: p.grantees,
      granteesAreMarriedCouple: p.granteesAreMarriedCouple,
      fileNumber: p.fileNumber,
      granteeAddress: p.granteeAddress,
      locality: p.locality,
      derivationReference: p.derivationReference,
      vestingOverride: p.vestingOverride,
      title: 'Deed of Gift',
    } as GeneratePayload);
  };

  // Seller lane: the "describe the deal" free-text → the category-aware seller-side proposeIntake. Resolves the
  // owning matter lazily, then parses. PROPOSE-ONLY (nothing generated).
  const handleSellerPropose = (): void => {
    const text = sellerFreeText.trim();
    if (!text) { setProposeError('Describe the deal first, then propose the facts.'); return; }
    setProposeError(null);
    void ensureMatterAsync()
      .then((id) => propose.mutate({ matterId: id, freeText: text }))
      .catch((err: unknown) => setProposeError(err instanceof Error ? err.message : 'Could not start the deed record.'));
  };

  // Seller lane: validate the seller-side facts here, then dispatch.
  const handleSellerSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = cleanParties(grantors);
    const cleanGrantees = cleanParties(grantees);
    const grantorMissing = cleanGrantors.length === 0;
    const granteeMissing = cleanGrantees.length === 0;
    if (grantorMissing || granteeMissing) {
      // DEED-INTAKE-PARITY-1: expand + ring the missing parties; never a silent block.
      setSellerMissing({ grantor: grantorMissing, grantee: granteeMissing });
      setError(grantorMissing ? 'At least one grantor (seller) name is required.' : 'At least one grantee (buyer) name is required.');
      if (!sellerFormExpanded) setSellerFormExpanded(true);
      return;
    }
    setSellerMissing({ grantor: false, grantee: false });
    setError(null);
    runGenerate({
      deedType: QUICK_DEED_SELLER_TYPE,
      grantors: cleanGrantors,
      grantees: cleanGrantees,
      granteeAddress: granteeAddress.trim() || null,
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
    } as GeneratePayload);
  };

  const renderPartyRows = (
    rows: PartyRow[],
    setRows: (next: PartyRow[]) => void,
    descriptorPlaceholder: string,
    nameInvalid = false,
  ): React.ReactElement => (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex gap-2">
          <input
            type="text"
            value={row.name}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
            className={`flex-1 border ${nameInvalid ? MISSING_RING_CLASS : 'border-gray-300'} rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy`}
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
          {matterScoped
            ? 'Draft a deed in this matter. Pick the type, drop in the prior vesting deed and tax record (or describe the deal), confirm the facts, and generate the house-style draft. The draft is created in this matter — this matter’s conflicts check applies — and is never auto-recorded or sent; you review and finalize it.'
            : 'Make a deed without opening a matter. Pick the type, drop in the prior vesting deed and tax record (or describe the deal), confirm the facts, and generate the house-style draft. The draft is never auto-recorded or sent — you review and finalize it.'}
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

      {/* Deed type selector — the whole registry; each option is enabled per its quickDeedGenerates flag (all registered types generate today). */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="quick-deed-type">
          Deed type <span className="text-red-500">*</span>
        </label>
        <select
          id="quick-deed-type"
          data-testid="quick-deed-type-select"
          value={deedType}
          onChange={(e) => { setError(null); setDeedType(e.target.value); }}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-firm-navy"
        >
          {deedTypes.length === 0 && <option value={QUICK_DEED_GIFT_TYPE}>Deed of Gift</option>}
          {deedTypes.map((t) => (
            <option key={t.key} value={t.key} disabled={!t.quickDeedGenerates}>
              {t.title}
              {t.quickDeedGenerates ? '' : ' — wiring pending'}
            </option>
          ))}
        </select>
      </div>

      {/* W2d — generate-time conflicts-waiver notice. Shown once above ALL three lanes (gift/seller/multi-cat)
          and every Generate button, driven by the live firm posture (getConflictsSetting.enforced === false =
          the bypass-and-stamp default). Purely informational — no behavior change. */}
      {/* DEED-INTAKE-PARITY-1 Inc 2: the bypass-and-stamp waiver is a STANDALONE-lane notice only. In a matter the
          Express intake honors that matter's conflicts gate (enforceConflicts), so the waiver never applies. */}
      {!matterScoped && conflictsSetting.data?.enforced === false && (
        <div
          data-testid="quick-deed-conflicts-waiver"
          role="note"
          className="mb-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-medium">No conflicts check will be run for this deed.</span> Quick Deed skips
          the conflicts-at-intake check and stamps the draft &ldquo;No conflicts check performed (Quick Deed
          mode).&rdquo; You can require a conflicts check for Quick Deed in Settings.
        </div>
      )}

      {/* UB1-W3b-2: when a generate fails closed (S5 survivorship gate/withhold, or any deed gate), surface
          plain-English CURE CARDS — what's wrong, which field to fix, how to regenerate — never a bare code and
          never a silent withhold. The form below stays populated, so the attorney fixes the field and regenerates
          in place. Nothing was drafted, so no incorrect recital was produced. */}
      {cureCards.length > 0 && (
        <div data-testid="deed-cure-cards" role="alert" className="mb-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-3">
          <p className="font-medium">The deed wasn&apos;t generated — nothing was drafted. Fix the item(s) below, then Generate again:</p>
          <ul className="space-y-2">
            {cureCards.map((c) => (
              <li key={c.flag} data-testid={`cure-card-${c.flag}`} className="rounded border border-amber-200 bg-white/70 px-3 py-2">
                <p className="font-medium text-ink">{c.field}</p>
                <p className="mt-0.5">{c.problem}</p>
                <p className="mt-0.5 text-ink-secondary">{c.fix}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {deedType !== QUICK_DEED_GIFT_TYPE && deedType !== QUICK_DEED_SELLER_TYPE ? (
        // ── Multi-category lane: into-LLC / out-of-LLC / TOD / confirmation / into-trust structured form. ──
        <QuickDeedCategoryForm
          deedType={deedType}
          matterId={matterId ?? undefined}
          resolveMatterId={ensureMatterAsync}
          onUploaded={() => { void previewFacts.refetch(); }}
          hasMaterials={previewFacts.data?.hasMaterials ?? false}
          submitting={generate.isPending || creating}
          error={error}
          setError={setError}
          onGenerate={runGenerate}
        />
      ) : isSeller ? (
        // ── Seller-side lane: the primary drop zone + the seller-side structured form. ──
        <form onSubmit={handleSellerSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Drop the prior vesting deed &amp; tax record</label>
            <MaterialsDropZone
              matterId={matterId ?? undefined}
              resolveMatterId={ensureMatterAsync}
              onUploaded={() => { void previewFacts.refetch(); }}
              autoCommit
            />
            <p className="text-xs text-ink-hint mt-1">
              The legal description, parcel, and assessed value are read from these uploads.
            </p>
          </div>

          {/* EXPRESS-FANOUT-1 (seller-side): the AI "describe the deal" box. Proposes the routine facts (buyer(s),
              warranty, price) for you to confirm. It NEVER writes the legal description or the vesting ("BEING")
              recital — those stay yours (extraction-only / attorney-verbatim). Flag-dark with the whole page. */}
          <div data-testid="seller-describe" className="rounded border border-firm-navy/20 bg-firm-navy/5 p-3 space-y-2">
            <label htmlFor="seller-free-text" className="block text-sm font-medium text-firm-navy">
              Describe the deal <span className="font-normal text-ink-hint">(optional)</span>
            </label>
            <textarea
              id="seller-free-text"
              data-testid="seller-free-text"
              value={sellerFreeText}
              onChange={(e) => setSellerFreeText(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g. Sale from the Bells to Marcus and Renee Vega for $612,000, general warranty."
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-hint">
                Proposes the buyer(s), warranty, and price for you to confirm. It never writes the legal
                description or the &ldquo;Being&rdquo; recital.
              </span>
              <button
                type="button"
                data-testid="seller-propose"
                onClick={handleSellerPropose}
                disabled={propose.isPending}
                className="px-3 py-1.5 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {propose.isPending ? 'Reading…' : 'Propose the facts'}
              </button>
            </div>
            {proposeError && <p data-testid="seller-propose-error" className="text-red-600 text-sm">{proposeError}</p>}
            {proposeStatus === 'proposed' && (
              <p data-testid="seller-proposed-note" className="text-xs text-ink-secondary">
                Proposed from your description — the buyer(s), warranty, and price you stated are filled in below.
                Review and confirm, then Generate.
              </p>
            )}
            {proposeStatus === 'needs_clarification' && (
              <div data-testid="seller-clarify" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                <p className="font-medium">A few things need clarifying before I can propose the facts:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {proposeQuestions.map((qn, i) => <li key={i}>{qn}</li>)}
                </ul>
                <p>Restate the deal with those details, or fill the fields in below.</p>
              </div>
            )}
            {proposeStatus === 'blocked' && (
              <p data-testid="seller-blocked" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                The AI describe-the-deal intake is not available right now ({proposeBlockedReason}). Fill the fields
                in below — the rest of the deed flow is unaffected.
              </p>
            )}
          </div>

          {previewFacts.data?.hasMaterials && (
            <div data-testid="quick-deed-prefill-note" className="rounded border border-firm-navy/20 bg-firm-navy/5 px-3 py-2 text-xs text-ink-secondary">
              Read from your uploads — the recording locality and the grantee&apos;s address are pre-filled below;
              confirm or override. The legal description, parcel, and assessed value resolve into the draft automatically.
            </div>
          )}

          {/* DEED-INTAKE-PARITY-1 (seller lane): surface the auto-seeded grantor ABOVE the collapse so it is never
              silently authoritative (parity with the gift lane), then the intake-first "manual fields" toggle. */}
          {grantorNeedsConfirm && (
            <p data-testid="seller-grantor-seed-note" className="text-xs text-amber-700">
              Read from the prior deed (the current owner(s) = seller(s)) — confirm or edit below.
            </p>
          )}
          <ManualFieldsToggle expanded={sellerFormExpanded} onToggle={() => setSellerFormExpanded((v) => !v)} testId="quick-deed-seller-form-toggle" />
          <div className={sellerFormExpanded ? 'space-y-6' : 'hidden'} data-testid="quick-deed-seller-form">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantor(s) — seller(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantors, setGrantors, "Descriptor (e.g. 'husband and wife')", sellerMissing.grantor)}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantee(s) — buyer(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantees, setGrantees, 'Descriptor (optional)', sellerMissing.grantee)}
          </div>

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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File number</label>
              <input type="text" value={fileNumber} onChange={(e) => setFileNumber(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="36-YYYY-NNNN" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recording locality</label>
              <input type="text" data-testid="quick-deed-locality" value={locality} onChange={(e) => setLocality(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="County / City (else read from the packet)" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grantee&apos;s address</label>
            <input type="text" data-testid="quick-deed-grantee-address" value={granteeAddress} onChange={(e) => setGranteeAddress(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="Mailing address for tax bills / notices" />
          </div>
          </div>{/* end DEED-INTAKE-PARITY-1 seller collapse (data-testid quick-deed-seller-form) */}

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
      ) : (
        // ── Gift lane: the shared intake experience (drop zone + free-associate + structured form). ──
        <DeedIntake
          matterId={matterId ?? undefined}
          resolveMatterId={ensureMatterAsync}
          onSubmit={handleGiftSubmit}
          submitting={generate.isPending || creating}
          submitError={error}
          submitLabel="Generate draft"
        />
      )}
    </div>
  );
}
