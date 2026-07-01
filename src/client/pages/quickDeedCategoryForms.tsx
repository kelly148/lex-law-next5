/**
 * quickDeedCategoryForms — DEED-DRAFT-AGENT-1 QUICK DEED multi-category dispatch (client).
 *
 * The structured input forms for the five non-gift / non-seller Quick-Deed categories now wired into
 * quickDeed.generate: Deed Into an LLC (C3), Deed Out of an LLC (C4), Transfer on Death (C5), Deed of
 * Confirmation (C1), Deed Into Trust (C2). Each mirrors the seller-side conditional form: the SAME primary
 * drop zone (the legal description / parcel / assessed value / locality are read from the uploads and default
 * SERVER-SIDE) + the attorney-supplied facts the prior document cannot supply, then a Generate button that
 * dispatches the nested category payload. The server is the authority on every gate + the assembly; a fail-
 * closed (WITHHELD) result never persists a void deed and surfaces as the form error (handled by the caller).
 *
 * Flag-dark: only reachable from QuickDeedPage, which self-guards on deedDraftAgent.isEnabled (default OFF).
 */
import React, { useEffect, useRef, useState } from 'react';
import { trpc } from '../trpc.js';
import MaterialsDropZone from '../components/MaterialsDropZone.js';
import { CategoryDescribeBox } from './CategoryDescribeBox.js';
import {
  intoLlcProposalToFields,
  outOfLlcProposalToFields,
  todProposalToFields,
  confirmationProposalToFields,
  intoTrustProposalToFields,
} from './quickDeedProposalApply.js';

const QUICK_DEED_INTO_LLC_TYPE = 'deed_into_llc';
const QUICK_DEED_OUT_OF_LLC_TYPE = 'deed_out_of_llc';
const QUICK_DEED_TOD_TYPE = 'deed_tod';
const QUICK_DEED_CONFIRMATION_TYPE = 'deed_of_confirmation';
const QUICK_DEED_INTO_TRUST_TYPE = 'deed_into_trust';

/** The validated generate input MINUS matterId (injected at dispatch time, never baked into the payload). */
type GeneratePayload = Omit<
  Parameters<ReturnType<typeof trpc.useUtils>['client']['quickDeed']['generate']['mutate']>[0],
  'matterId'
>;

const inputCls =
  'w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy';

interface CategoryFormProps {
  deedType: string;
  matterId: string | undefined;
  resolveMatterId: () => Promise<string>;
  onUploaded: () => void;
  hasMaterials: boolean;
  submitting: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
  onGenerate: (payload: GeneratePayload) => void;
}

// ── small shared field helpers (keep the per-category forms readable) ──────────────────────────────────────────

function Text({
  label,
  value,
  onChange,
  placeholder,
  required,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
}): React.ReactElement {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={inputCls} placeholder={placeholder} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder={placeholder} />
      )}
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A simple editor for a list of plain string values (e.g. co-owners, beneficiaries, member names). */
function StringList({
  label,
  values,
  setValues,
  placeholder,
}: {
  label: string;
  values: string[];
  setValues: (next: string[]) => void;
  placeholder: string;
}): React.ReactElement {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="space-y-2">
        {values.map((v, idx) => (
          <div key={idx} className="flex gap-2">
            <input
              type="text"
              value={v}
              onChange={(e) => setValues(values.map((x, i) => (i === idx ? e.target.value : x)))}
              className={inputCls}
              placeholder={placeholder}
            />
            {values.length > 1 && (
              <button type="button" onClick={() => setValues(values.filter((_, i) => i !== idx))} className="px-2 text-gray-400 hover:text-red-600 text-sm" title="Remove">
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setValues([...values, ''])} className="text-sm text-firm-navy hover:underline">
          + Add another
        </button>
      </div>
    </div>
  );
}

/** The shared drop zone + "read from your uploads" note that every category lane shows above its fields. */
function UploadsHeader({ matterId, resolveMatterId, onUploaded, hasMaterials }: Pick<CategoryFormProps, 'matterId' | 'resolveMatterId' | 'onUploaded' | 'hasMaterials'>): React.ReactElement {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Drop the prior vesting deed &amp; tax record</label>
        <MaterialsDropZone matterId={matterId} resolveMatterId={resolveMatterId} onUploaded={onUploaded} autoCommit />
        <p className="text-xs text-ink-hint mt-1">The legal description, parcel, assessed value, and locality are read from these uploads.</p>
      </div>
      {hasMaterials && (
        <div data-testid="quick-deed-prefill-note" className="rounded border border-firm-navy/20 bg-firm-navy/5 px-3 py-2 text-xs text-ink-secondary">
          Read from your uploads — the legal description, parcel, assessed value, and locality resolve into the draft automatically. Override any of them below if needed.
        </div>
      )}
    </>
  );
}

function GenerateBar({ submitting, error }: { submitting: boolean; error: string | null }): React.ReactElement {
  return (
    <>
      {error && <p data-testid="quick-deed-error" className="text-red-600 text-sm">{error}</p>}
      <div className="flex justify-end pt-1">
        <button type="submit" data-testid="quick-deed-generate" disabled={submitting} className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Generating…' : 'Generate draft'}
        </button>
      </div>
    </>
  );
}

const trimOrUndef = (v: string): string | undefined => (v.trim().length > 0 ? v.trim() : undefined);

// ── C3: Deed Into an LLC ────────────────────────────────────────────────────────────────────────────────────────

function IntoLlcForm(props: CategoryFormProps): React.ReactElement {
  const [grantors, setGrantors] = useState<{ name: string; maritalStatus: string }[]>([{ name: '', maritalStatus: 'unmarried' }]);
  const [grantorCardinality, setGrantorCardinality] = useState<'single' | 'married_couple'>('single');
  const [granteeLlc, setGranteeLlc] = useState('');
  const [consideration, setConsideration] = useState('$0.00');
  const [instrumentDatePhrase, setInstrumentDatePhrase] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [derivationOfTitle, setDerivationOfTitle] = useState('');
  const [subjectTo, setSubjectTo] = useState('');
  const [notaryCommonwealth, setNotaryCommonwealth] = useState('COMMONWEALTH OF VIRGINIA');
  const [notaryLocality, setNotaryLocality] = useState('');
  const [grantorNeedsConfirm, setGrantorNeedsConfirm] = useState(false);
  const utils = trpc.useUtils();
  // EXPRESS-FANOUT-1: auto-seed the grantor(s) (= current owner(s)) from the prior deed's grantee(s) of record,
  // flagged for confirmation. Seed once, only when no grantor name has been typed — never clobber input.
  const previewFacts = trpc.quickDeed.previewFacts.useQuery({ matterId: props.matterId ?? '' }, { enabled: !!props.matterId });
  const seededRef = useRef(false);
  useEffect(() => {
    const priorGrantees = previewFacts.data?.granteeOfRecordNames ?? [];
    if (priorGrantees.length > 0 && !seededRef.current) {
      seededRef.current = true;
      setGrantors((cur) => {
        const allEmpty = cur.every((r) => r.name.trim() === '');
        return allEmpty ? priorGrantees.map((n) => ({ name: n, maritalStatus: 'unmarried' })) : cur;
      });
      setGrantorNeedsConfirm(true);
    }
  }, [previewFacts.data]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = grantors.filter((g) => g.name.trim().length > 0).map((g) => ({ name: g.name.trim(), maritalStatus: g.maritalStatus.trim() || 'unmarried' }));
    if (cleanGrantors.length === 0) return props.setError('At least one grantor name is required.');
    if (notaryLocality.trim().length === 0) return props.setError('The notary locality is required.');
    props.setError(null);
    props.onGenerate({
      deedType: QUICK_DEED_INTO_LLC_TYPE,
      intoLlc: {
        preparedBy: preparedBy.trim(),
        consideration: consideration.trim() || '$0.00',
        instrumentDatePhrase: instrumentDatePhrase.trim(),
        grantors: cleanGrantors,
        grantorCardinality,
        granteeLlc: trimOrUndef(granteeLlc),
        derivationOfTitle: derivationOfTitle.trim(),
        subjectTo: subjectTo.trim(),
        notaryJurisdiction: { commonwealth: notaryCommonwealth.trim(), locality: notaryLocality.trim() },
      },
    } as GeneratePayload);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <UploadsHeader {...props} />
      <CategoryDescribeBox
        resolveMatterId={props.resolveMatterId}
        proposeMutate={(input) => utils.client.quickDeed.proposeIntakeIntoLlc.mutate(input)}
        onApplyProposal={(p) => {
          const f = intoLlcProposalToFields(p);
          if (f.granteeLlc) setGranteeLlc(f.granteeLlc);
          if (f.grantors) setGrantors(f.grantors);
          if (f.consideration) setConsideration(f.consideration);
        }}
        placeholder="e.g. Dana Ortiz is transferring her home into Ridgeline Holdings LLC for $10."
        safetyNote="Proposes the LLC, grantor(s), and price. It never writes the legal description, the derivation, or the subject-to block."
      />
      <div data-testid="quick-deed-into_llc-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
        <p className="text-xs text-ink-secondary">QUITCLAIM into a Virginia LLC (no warranty; § 58.1-811(A)(10)). The grantee LLC name is read from the SCC/operating-agreement upload unless you enter it below.</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Grantor(s) — current owner(s) <span className="text-red-500">*</span></label>
          {grantorNeedsConfirm && (
            <p data-testid="into-llc-grantor-seed-note" className="text-xs text-amber-700 mb-1">
              Read from the prior deed (the current owner(s)) — confirm or edit.
            </p>
          )}
          <div className="space-y-2">
            {grantors.map((g, idx) => (
              <div key={idx} className="flex gap-2">
                <input type="text" value={g.name} onChange={(e) => setGrantors(grantors.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))} className={inputCls} placeholder="Full legal name" />
                <input type="text" value={g.maritalStatus} onChange={(e) => setGrantors(grantors.map((r, i) => (i === idx ? { ...r, maritalStatus: e.target.value } : r)))} className={inputCls} placeholder="Marital status (e.g. unmarried)" />
                {grantors.length > 1 && (
                  <button type="button" onClick={() => setGrantors(grantors.filter((_, i) => i !== idx))} className="px-2 text-gray-400 hover:text-red-600 text-sm" title="Remove">×</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setGrantors([...grantors, { name: '', maritalStatus: 'unmarried' }])} className="text-sm text-firm-navy hover:underline">+ Add another</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grantor cardinality</label>
            <select value={grantorCardinality} onChange={(e) => setGrantorCardinality(e.target.value === 'married_couple' ? 'married_couple' : 'single')} className={`${inputCls} bg-white`}>
              <option value="single">Single grantor</option>
              <option value="married_couple">Married couple</option>
            </select>
          </div>
          <Text label="Grantee LLC (else read from uploads)" value={granteeLlc} onChange={setGranteeLlc} placeholder="e.g. Marlowe Glen Holdings LLC" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Consideration" value={consideration} onChange={setConsideration} placeholder="$0.00" />
          <Text label="Instrument date phrase" value={instrumentDatePhrase} onChange={setInstrumentDatePhrase} placeholder="____ day of April, 2026" />
        </div>
        <Text label="Prepared by" value={preparedBy} onChange={setPreparedBy} placeholder="Preparer name, VSB #, firm" />
        <Text label="Derivation of title" value={derivationOfTitle} onChange={setDerivationOfTitle} placeholder="For derivation of title, see Deed recorded in Deed Book …" textarea />
        <Text label="Subject to" value={subjectTo} onChange={setSubjectTo} placeholder="This conveyance is made subject to the covenants, conditions … of record." textarea />
        <div className="grid grid-cols-2 gap-4">
          <Text label="Notary commonwealth" value={notaryCommonwealth} onChange={setNotaryCommonwealth} placeholder="COMMONWEALTH OF VIRGINIA" required />
          <Text label="Notary locality" value={notaryLocality} onChange={setNotaryLocality} placeholder="CITY OF ALEXANDRIA" required />
        </div>
      </div>
      <GenerateBar submitting={props.submitting} error={props.error} />
    </form>
  );
}

// ── C4: Deed Out of an LLC ──────────────────────────────────────────────────────────────────────────────────────

function OutOfLlcForm(props: CategoryFormProps): React.ReactElement {
  const [grantorLlc, setGrantorLlc] = useState('');
  const [members, setMembers] = useState<{ name: string; signatureTitle: string }[]>([{ name: '', signatureTitle: '' }]);
  const [fileNumber, setFileNumber] = useState('');
  const [consideration, setConsideration] = useState('0.00');
  const [executionMonth, setExecutionMonth] = useState('');
  const [executionYear, setExecutionYear] = useState('');
  const [localityType, setLocalityType] = useState('County');
  const [derivationInstrumentNumber, setDerivationInstrumentNumber] = useState('');
  const [notaryLocality, setNotaryLocality] = useState('');
  const [rtCompany, setRtCompany] = useState('');
  const [rtLine1, setRtLine1] = useState('');
  const [rtLine2, setRtLine2] = useState('');
  const [rtCityStateZip, setRtCityStateZip] = useState('');
  const [rtPhone, setRtPhone] = useState('');
  const utils = trpc.useUtils();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (rtCompany.trim().length === 0 || rtLine1.trim().length === 0 || rtCityStateZip.trim().length === 0 || rtPhone.trim().length === 0) {
      return props.setError('The return-to company, street, city/state/zip, and phone are required.');
    }
    const cleanMembers = members
      .filter((m) => m.name.trim().length > 0)
      .map((m) => ({ name: m.name.trim(), signatureTitle: trimOrUndef(m.signatureTitle) }));
    props.setError(null);
    props.onGenerate({
      deedType: QUICK_DEED_OUT_OF_LLC_TYPE,
      outOfLlc: {
        grantorLlc: trimOrUndef(grantorLlc),
        members: cleanMembers,
        fileNumber: fileNumber.trim(),
        consideration: consideration.trim() || '0.00',
        executionMonth: executionMonth.trim(),
        executionYear: executionYear.trim(),
        localityType: localityType.trim() || 'County',
        derivationInstrumentNumber: derivationInstrumentNumber.trim(),
        notaryLocality: notaryLocality.trim(),
        returnTo: {
          company: rtCompany.trim(),
          line1: rtLine1.trim(),
          line2: trimOrUndef(rtLine2),
          cityStateZip: rtCityStateZip.trim(),
          phone: rtPhone.trim(),
        },
      },
    } as GeneratePayload);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <UploadsHeader {...props} />
      <CategoryDescribeBox
        resolveMatterId={props.resolveMatterId}
        proposeMutate={(input) => utils.client.quickDeed.proposeIntakeOutOfLlc.mutate(input)}
        onApplyProposal={(p) => {
          const f = outOfLlcProposalToFields(p);
          if (f.members) setMembers(f.members);
          if (f.consideration) setConsideration(f.consideration);
          if (f.fileNumber) setFileNumber(f.fileNumber);
          if (f.executionMonth) setExecutionMonth(f.executionMonth);
          if (f.executionYear) setExecutionYear(f.executionYear);
        }}
        placeholder="e.g. Maplehurst Holdings LLC conveys out to Dana Ortiz; members Dana Ortiz and Sam Vance sign; $10; executed July 2026."
        safetyNote="Proposes the signing member(s), price, file no., and execution date. It never writes the return-to block, notary, derivation, or legal description."
      />
      <div data-testid="quick-deed-out_of_llc-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
        <p className="text-xs text-ink-secondary">Special Warranty out of a Virginia LLC (§ 58.1-811(A)(11)); the members sign. The grantor LLC name + member set are read from the LLC/operating-agreement upload unless you enter them below.</p>
        <Text label="Grantor LLC (else read from uploads)" value={grantorLlc} onChange={setGrantorLlc} placeholder="e.g. Maplehurst Holdings LLC" />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Signing member(s) (else read from uploads)</label>
          <div className="space-y-2">
            {members.map((m, idx) => (
              <div key={idx} className="flex gap-2">
                <input type="text" value={m.name} onChange={(e) => setMembers(members.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))} className={inputCls} placeholder="Member full name" />
                <input type="text" value={m.signatureTitle} onChange={(e) => setMembers(members.map((r, i) => (i === idx ? { ...r, signatureTitle: e.target.value } : r)))} className={inputCls} placeholder="Signature title (default: Member)" />
                {members.length > 1 && (
                  <button type="button" onClick={() => setMembers(members.filter((_, i) => i !== idx))} className="px-2 text-gray-400 hover:text-red-600 text-sm" title="Remove">×</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setMembers([...members, { name: '', signatureTitle: '' }])} className="text-sm text-firm-navy hover:underline">+ Add another</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="File number" value={fileNumber} onChange={setFileNumber} placeholder="41-YYYY-NNNN" />
          <Text label="Consideration" value={consideration} onChange={setConsideration} placeholder="0.00" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Text label="Execution month" value={executionMonth} onChange={setExecutionMonth} placeholder="July" />
          <Text label="Execution year" value={executionYear} onChange={setExecutionYear} placeholder="2026" />
          <Text label="Locality type" value={localityType} onChange={setLocalityType} placeholder="County" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Derivation instrument number" value={derivationInstrumentNumber} onChange={setDerivationInstrumentNumber} placeholder="202401090012744" />
          <Text label="Notary locality" value={notaryLocality} onChange={setNotaryLocality} placeholder="COUNTY OF LOUDOUN" />
        </div>
        <div className="rounded border border-line/60 p-3 space-y-3">
          <p className="text-xs font-medium text-gray-700">Return to (after recording) <span className="text-red-500">*</span></p>
          <div className="grid grid-cols-2 gap-4">
            <Text label="Company" value={rtCompany} onChange={setRtCompany} placeholder="Universal Title" required />
            <Text label="Phone" value={rtPhone} onChange={setRtPhone} placeholder="(703) 354-2100" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Text label="Street (line 1)" value={rtLine1} onChange={setRtLine1} placeholder="3031 Fairview Park Drive" required />
            <Text label="Suite / line 2" value={rtLine2} onChange={setRtLine2} placeholder="Suite 375" />
          </div>
          <Text label="City, State ZIP" value={rtCityStateZip} onChange={setRtCityStateZip} placeholder="Falls Church, VA 22042" required />
        </div>
      </div>
      <GenerateBar submitting={props.submitting} error={props.error} />
    </form>
  );
}

// ── C5: Transfer on Death Deed ──────────────────────────────────────────────────────────────────────────────────

function TodForm(props: CategoryFormProps): React.ReactElement {
  const [transferorName, setTransferorName] = useState('');
  const [transferorCapacity, setTransferorCapacity] = useState('');
  const [persons, setPersons] = useState<string[]>(['']);
  const [beneficiaryVesting, setBeneficiaryVesting] = useState('');
  const [preparer, setPreparer] = useState('');
  const [returnTo, setReturnTo] = useState('');
  const [deedDatePhrase, setDeedDatePhrase] = useState('');
  const [beingRecital, setBeingRecital] = useState('');
  const [acknowledgmentMonthYear, setAcknowledgmentMonthYear] = useState('');
  const [notaryCountyBlank, setNotaryCountyBlank] = useState(true);
  const [transferorNeedsConfirm, setTransferorNeedsConfirm] = useState(false);
  const utils = trpc.useUtils();
  // EXPRESS-FANOUT-1: a SINGLE current owner (from the prior deed) → the transferor, confirm-flagged. Multiple
  // owners are left for the attorney (a TOD by one of several owners is a decision, never presumed).
  const previewFacts = trpc.quickDeed.previewFacts.useQuery({ matterId: props.matterId ?? '' }, { enabled: !!props.matterId });
  const seededRef = useRef(false);
  useEffect(() => {
    const priorGrantees = previewFacts.data?.granteeOfRecordNames ?? [];
    if (priorGrantees.length === 1 && !seededRef.current) {
      seededRef.current = true;
      setTransferorName((cur) => (cur.trim() === '' ? (priorGrantees[0] ?? '') : cur));
      setTransferorNeedsConfirm(true);
    }
  }, [previewFacts.data]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (transferorName.trim().length === 0) return props.setError('The transferor (current owner) name is required.');
    const cleanPersons = persons.map((p) => p.trim()).filter((p) => p.length > 0);
    if (cleanPersons.length === 0) return props.setError('At least one beneficiary is required.');
    if (beneficiaryVesting.trim().length === 0) return props.setError('The beneficiary vesting (how they take) is required.');
    props.setError(null);
    props.onGenerate({
      deedType: QUICK_DEED_TOD_TYPE,
      tod: {
        preparer: preparer.trim(),
        returnTo: returnTo.trim(),
        deedDatePhrase: deedDatePhrase.trim(),
        transferor: { name: transferorName.trim(), capacity: transferorCapacity.trim() },
        primaryBeneficiaries: { persons: cleanPersons, vesting: beneficiaryVesting.trim(), relationship: null },
        beingRecital: trimOrUndef(beingRecital),
        acknowledgmentMonthYear: acknowledgmentMonthYear.trim(),
        notaryCountyBlank,
      },
    } as GeneratePayload);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <UploadsHeader {...props} />
      <CategoryDescribeBox
        resolveMatterId={props.resolveMatterId}
        proposeMutate={(input) => utils.client.quickDeed.proposeIntakeTod.mutate(input)}
        onApplyProposal={(p) => {
          const f = todProposalToFields(p);
          if (f.persons) setPersons(f.persons);
          if (f.beneficiaryVesting) setBeneficiaryVesting(f.beneficiaryVesting);
        }}
        placeholder="e.g. On my death, my home goes to my children Ivy and Noah Chen, as joint tenants with the right of survivorship."
        safetyNote="Proposes the beneficiary(ies) and how they take. It never writes the revocation block, the transferor's capacity, the being recital, or the legal description."
      />
      <div data-testid="quick-deed-tod-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
        <p className="text-xs text-ink-secondary">A Revocable Transfer on Death Deed (§ 58.1-811(J); death-effective, no consideration, no warranty). It is NOT effective unless recorded before the transferor&apos;s death.</p>
        {transferorNeedsConfirm && (
          <p data-testid="tod-transferor-seed-note" className="text-xs text-amber-700">
            Transferor read from the prior deed (the current owner) — confirm or edit.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Text label="Transferor (current owner)" value={transferorName} onChange={setTransferorName} placeholder="Full legal name" required />
          <Text label="Transferor capacity" value={transferorCapacity} onChange={setTransferorCapacity} placeholder="e.g. surviving joint tenant" />
        </div>
        <StringList label="Beneficiaries" values={persons} setValues={setPersons} placeholder="Beneficiary full name" />
        <Text label="Beneficiary vesting (how they take)" value={beneficiaryVesting} onChange={setBeneficiaryVesting} placeholder="e.g. joint tenants with the common law right of survivorship" required />
        <div className="grid grid-cols-2 gap-4">
          <Text label="Preparer" value={preparer} onChange={setPreparer} placeholder="Mason Law Firm, PLC" />
          <Text label="Deed date phrase" value={deedDatePhrase} onChange={setDeedDatePhrase} placeholder="October 2025" />
        </div>
        <Text label="Return to" value={returnTo} onChange={setReturnTo} placeholder="Universal Title, 1320 Old Chain Bridge Road, McLean, VA 22101" />
        <Text label="Being (vesting) recital" value={beingRecital} onChange={setBeingRecital} placeholder="BEING the same property conveyed unto … by Deed recorded in Deed Book … at Page …" textarea />
        <div className="grid grid-cols-2 gap-4 items-center">
          <Text label="Acknowledgment month/year" value={acknowledgmentMonthYear} onChange={setAcknowledgmentMonthYear} placeholder="October 2025" />
          <Checkbox label="Notary county left blank" checked={notaryCountyBlank} onChange={setNotaryCountyBlank} />
        </div>
      </div>
      <GenerateBar submitting={props.submitting} error={props.error} />
    </form>
  );
}

// ── C1: Deed of Confirmation ────────────────────────────────────────────────────────────────────────────────────

function ConfirmationForm(props: CategoryFormProps): React.ReactElement {
  const [archetype, setArchetype] = useState<'C1-a-survivorship' | 'C1-b-testate-devise'>('C1-a-survivorship');
  const [exemptionCode, setExemptionCode] = useState('58.1-810(1)');
  const [preparer, setPreparer] = useState('');
  const [preparedNote, setPreparedNote] = useState('Prepared without the benefit of a title examination.');
  const [consideration, setConsideration] = useState('$0.00 (confirmatory)');
  const [grantingDatePhrase, setGrantingDatePhrase] = useState('');
  const [partyName, setPartyName] = useState('');
  const [vesting, setVesting] = useState('sole owner');
  const [grantingVerb, setGrantingVerb] = useState('grant and convey');
  const [warranty, setWarranty] = useState('General Warranty and English Covenants of title');
  const [subjectTo, setSubjectTo] = useState('covenants, conditions, restrictions, easements and rights of way of record');

  // C1-a survivorship
  const [tookTitleAs, setTookTitleAs] = useState('joint tenants with the common law right of survivorship');
  const [coOwners, setCoOwners] = useState<string[]>(['', '']);
  const [vestingDeedDate, setVestingDeedDate] = useState('');
  const [vestingDeedRecorded, setVestingDeedRecorded] = useState('');
  const [vestingInstrumentNumber, setVestingInstrumentNumber] = useState('');
  const [recordsCounty, setRecordsCounty] = useState('');
  const [decedentName, setDecedentName] = useState('');
  const [decedentDod, setDecedentDod] = useState('');
  const [beingRecitalPriorInstrument, setBeingRecitalPriorInstrument] = useState('');

  // C1-b testate-devise
  const [originalGrantors, setOriginalGrantors] = useState('');
  const [originalDeedDate, setOriginalDeedDate] = useState('');
  const [originalDeedRecorded, setOriginalDeedRecorded] = useState('');
  const [originalDeedBookPage, setOriginalDeedBookPage] = useState('');
  const [originalGrantees, setOriginalGrantees] = useState('');
  const [originalGranteesTenancy, setOriginalGranteesTenancy] = useState('');
  const [fdName, setFdName] = useState('');
  const [fdDod, setFdDod] = useState('');
  const [fdSurvivor, setFdSurvivor] = useState('');
  const [tName, setTName] = useState('');
  const [tDiedTestateDate, setTDiedTestateDate] = useState('');
  const [tWillDate, setTWillDate] = useState('');
  const [tProbateCourt, setTProbateCourt] = useState('');
  const [tFiduciaryNumber, setTFiduciaryNumber] = useState('');
  const [tPossessive, setTPossessive] = useState('');
  const [tSubject, setTSubject] = useState('');
  const [dArticle, setDArticle] = useState('');
  const [dDevisee, setDDevisee] = useState('');
  const [dDeviseeStatus, setDDeviseeStatus] = useState('');
  const [dDeviseePossessive, setDDeviseePossessive] = useState('');
  const [dDeviseeObject, setDDeviseeObject] = useState('');
  const utils = trpc.useUtils();

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (partyName.trim().length === 0) return props.setError('The confirming party name is required.');
    props.setError(null);
    const base = {
      archetype,
      exemptionCode: exemptionCode.trim() || '58.1-810(1)',
      preparer: preparer.trim(),
      preparedNote: preparedNote.trim(),
      consideration: consideration.trim(),
      grantingDatePhrase: grantingDatePhrase.trim(),
      partyName: partyName.trim(),
      vesting: vesting.trim() || 'sole owner',
      grantingVerb: grantingVerb.trim(),
      warranty: warranty.trim(),
      subjectTo: subjectTo.trim(),
    };
    const confirmation =
      archetype === 'C1-a-survivorship'
        ? {
            ...base,
            chainSurvivorship: {
              tookTitleAs: tookTitleAs.trim(),
              coOwners: coOwners.map((c) => c.trim()).filter((c) => c.length > 0),
              vestingDeedDate: vestingDeedDate.trim(),
              vestingDeedRecorded: vestingDeedRecorded.trim(),
              vestingInstrumentNumber: vestingInstrumentNumber.trim(),
              recordsCounty: recordsCounty.trim(),
            },
            decedent: { name: decedentName.trim(), dateOfDeath: decedentDod.trim() },
            beingRecitalPriorInstrument: trimOrUndef(beingRecitalPriorInstrument),
          }
        : {
            ...base,
            chainTestate: {
              originalGrantors: originalGrantors.trim(),
              originalDeedDate: originalDeedDate.trim(),
              originalDeedRecorded: originalDeedRecorded.trim(),
              originalDeedBookPage: originalDeedBookPage.trim(),
              originalGrantees: originalGrantees.trim(),
              originalGranteesTenancy: originalGranteesTenancy.trim(),
            },
            firstDecedent: { name: fdName.trim(), dateOfDeath: fdDod.trim(), survivor: fdSurvivor.trim() },
            testator: {
              name: tName.trim(),
              diedTestateDate: tDiedTestateDate.trim(),
              willDate: tWillDate.trim(),
              probateCourt: tProbateCourt.trim(),
              fiduciaryNumber: tFiduciaryNumber.trim(),
              possessivePronoun: tPossessive.trim(),
              subjectPronoun: tSubject.trim(),
            },
            devise: {
              article: dArticle.trim(),
              devisee: dDevisee.trim(),
              deviseeStatus: dDeviseeStatus.trim(),
              deviseePossessive: dDeviseePossessive.trim(),
              deviseeObject: dDeviseeObject.trim(),
            },
          };
    props.onGenerate({ deedType: QUICK_DEED_CONFIRMATION_TYPE, confirmation } as GeneratePayload);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <UploadsHeader {...props} />
      <CategoryDescribeBox
        resolveMatterId={props.resolveMatterId}
        proposeMutate={(input) => utils.client.quickDeed.proposeIntakeConfirmation.mutate(input)}
        onApplyProposal={(p) => {
          const f = confirmationProposalToFields(p);
          if (f.archetype) setArchetype(f.archetype);
        }}
        placeholder="e.g. Confirming title already vested by survivorship — a co-owner has died. (or: a will devised the title.)"
        safetyNote="Proposes ONLY the archetype (survivorship vs testate-devise). Every chain-of-title fact stays yours to enter — the model never proposes any of them."
      />
      <div data-testid="quick-deed-confirmation-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
        <p className="text-xs text-ink-secondary">A Deed of Confirmation places of record a title already vested by operation of law; it does not transfer. The chain-of-title recitals are attorney-load-bearing — verify each link.</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Archetype <span className="text-red-500">*</span></label>
          <select value={archetype} onChange={(e) => setArchetype(e.target.value === 'C1-b-testate-devise' ? 'C1-b-testate-devise' : 'C1-a-survivorship')} className={`${inputCls} bg-white`}>
            <option value="C1-a-survivorship">C1-a — survivorship (a co-owner died)</option>
            <option value="C1-b-testate-devise">C1-b — testate devise (a will devised title)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Confirming party" value={partyName} onChange={setPartyName} placeholder="Marcus T. ELLISON" required />
          <Text label="Vesting" value={vesting} onChange={setVesting} placeholder="sole owner" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Granting verb" value={grantingVerb} onChange={setGrantingVerb} placeholder="grant and convey" />
          <Text label="Exemption code" value={exemptionCode} onChange={setExemptionCode} placeholder="58.1-810(1)" />
        </div>
        <Text label="Warranty" value={warranty} onChange={setWarranty} placeholder="General Warranty and English Covenants of title" />
        <div className="grid grid-cols-2 gap-4">
          <Text label="Consideration" value={consideration} onChange={setConsideration} placeholder="$0.00 (confirmatory)" />
          <Text label="Granting date phrase" value={grantingDatePhrase} onChange={setGrantingDatePhrase} placeholder="March, 2026" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Preparer" value={preparer} onChange={setPreparer} placeholder="Mason Law Firm, PLC" />
          <Text label="Prepared note" value={preparedNote} onChange={setPreparedNote} placeholder="Prepared without the benefit of a title examination." />
        </div>
        <Text label="Subject to" value={subjectTo} onChange={setSubjectTo} placeholder="covenants, conditions, restrictions, easements and rights of way of record" textarea />

        {archetype === 'C1-a-survivorship' ? (
          <div data-testid="quick-deed-confirmation-survivorship" className="rounded border border-line/60 p-3 space-y-3">
            <p className="text-xs font-medium text-gray-700">Survivorship chain (the surviving owner is derived; exactly one co-owner must match the decedent name)</p>
            <Text label="Took title as" value={tookTitleAs} onChange={setTookTitleAs} placeholder="joint tenants with the common law right of survivorship" />
            <StringList label="Co-owners (as they took title)" values={coOwners} setValues={setCoOwners} placeholder="Full legal name" />
            <div className="grid grid-cols-2 gap-4">
              <Text label="Vesting deed date" value={vestingDeedDate} onChange={setVestingDeedDate} placeholder="May 2, 2019" />
              <Text label="Vesting deed recorded" value={vestingDeedRecorded} onChange={setVestingDeedRecorded} placeholder="May 5, 2019" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Vesting instrument number" value={vestingInstrumentNumber} onChange={setVestingInstrumentNumber} placeholder="201905050012345" />
              <Text label="Records county" value={recordsCounty} onChange={setRecordsCounty} placeholder="Prince William County, Virginia" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Decedent name" value={decedentName} onChange={setDecedentName} placeholder="Priya ELLISON" />
              <Text label="Decedent date of death" value={decedentDod} onChange={setDecedentDod} placeholder="January 10, 2026" />
            </div>
            <Text label="Being recital — prior instrument" value={beingRecitalPriorInstrument} onChange={setBeingRecitalPriorInstrument} placeholder="201905050012345" />
          </div>
        ) : (
          <div data-testid="quick-deed-confirmation-testate" className="rounded border border-line/60 p-3 space-y-3">
            <p className="text-xs font-medium text-gray-700">Testate-devise chain (the original vesting deed, the testator, and the devise)</p>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Original grantors" value={originalGrantors} onChange={setOriginalGrantors} />
              <Text label="Original grantees" value={originalGrantees} onChange={setOriginalGrantees} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Original deed date" value={originalDeedDate} onChange={setOriginalDeedDate} />
              <Text label="Original deed recorded" value={originalDeedRecorded} onChange={setOriginalDeedRecorded} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Original deed book/page" value={originalDeedBookPage} onChange={setOriginalDeedBookPage} />
              <Text label="Original grantees' tenancy" value={originalGranteesTenancy} onChange={setOriginalGranteesTenancy} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Text label="First decedent name" value={fdName} onChange={setFdName} />
              <Text label="First decedent date of death" value={fdDod} onChange={setFdDod} />
              <Text label="Survivor" value={fdSurvivor} onChange={setFdSurvivor} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Testator name" value={tName} onChange={setTName} />
              <Text label="Died testate date" value={tDiedTestateDate} onChange={setTDiedTestateDate} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Will date" value={tWillDate} onChange={setTWillDate} />
              <Text label="Probate court" value={tProbateCourt} onChange={setTProbateCourt} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Text label="Fiduciary number" value={tFiduciaryNumber} onChange={setTFiduciaryNumber} />
              <Text label="Testator possessive pronoun" value={tPossessive} onChange={setTPossessive} placeholder="her / his" />
              <Text label="Testator subject pronoun" value={tSubject} onChange={setTSubject} placeholder="she / he" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Text label="Devise article" value={dArticle} onChange={setDArticle} placeholder="ARTICLE III" />
              <Text label="Devisee" value={dDevisee} onChange={setDDevisee} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Text label="Devisee status" value={dDeviseeStatus} onChange={setDDeviseeStatus} />
              <Text label="Devisee possessive" value={dDeviseePossessive} onChange={setDDeviseePossessive} placeholder="her / his" />
              <Text label="Devisee object" value={dDeviseeObject} onChange={setDDeviseeObject} placeholder="her / him" />
            </div>
          </div>
        )}
      </div>
      <GenerateBar submitting={props.submitting} error={props.error} />
    </form>
  );
}

// ── C2: Deed Into Trust ─────────────────────────────────────────────────────────────────────────────────────────

function IntoTrustForm(props: CategoryFormProps): React.ReactElement {
  const [exemplar, setExemplar] = useState<'A' | 'B' | 'C'>('A');
  const [exemptionBasis, setExemptionBasis] = useState('58.1-811(A)(12)');
  const [titleSearchPerformed, setTitleSearchPerformed] = useState(false);
  const [preparerName, setPreparerName] = useState('');
  const [preparerVsb, setPreparerVsb] = useState('');
  const [preparerFirm, setPreparerFirm] = useState('');
  const [consideration, setConsideration] = useState('$0.00');
  const [fileNumber, setFileNumber] = useState('');
  const [instrDay, setInstrDay] = useState('');
  const [instrMonth, setInstrMonth] = useState('');
  const [instrYear, setInstrYear] = useState('');
  const [grantors, setGrantors] = useState<string[]>(['']);
  const [grantorMaritalStatus, setGrantorMaritalStatus] = useState('');
  const [heldAs, setHeldAs] = useState('');
  const [trustStructure, setTrustStructure] = useState('');
  const [trusteesRecital, setTrusteesRecital] = useState('');
  const [granteeObjectPlurality, setGranteeObjectPlurality] = useState<'GRANTEE' | 'GRANTEES'>('GRANTEES');
  const [grantingVerb, setGrantingVerb] = useState('quitclaim, release and convey');
  const [lceIdentificationFootnote, setLceIdentificationFootnote] = useState(false);
  const [derivation, setDerivation] = useState('');
  const [tbeImmunityNote, setTbeImmunityNote] = useState('');
  const [notaryType, setNotaryType] = useState<'CITY' | 'COUNTY'>('CITY');
  const [notaryName, setNotaryName] = useState('');
  const [grantorNeedsConfirm, setGrantorNeedsConfirm] = useState(false);
  const utils = trpc.useUtils();
  // EXPRESS-FANOUT-1: auto-seed the grantor(s) (= current owner(s)) from the prior deed, confirm-flagged.
  const previewFacts = trpc.quickDeed.previewFacts.useQuery({ matterId: props.matterId ?? '' }, { enabled: !!props.matterId });
  const seededRef = useRef(false);
  useEffect(() => {
    const priorGrantees = previewFacts.data?.granteeOfRecordNames ?? [];
    if (priorGrantees.length > 0 && !seededRef.current) {
      seededRef.current = true;
      setGrantors((cur) => {
        const allEmpty = cur.every((g) => g.trim() === '');
        return allEmpty ? priorGrantees : cur;
      });
      setGrantorNeedsConfirm(true);
    }
  }, [previewFacts.data]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (trusteesRecital.trim().length === 0) return props.setError('The trustees recital is required (attorney-supplied; it is never auto-generated).');
    if (notaryName.trim().length === 0) return props.setError('The notary jurisdiction name is required.');
    const cleanGrantors = grantors.map((g) => g.trim()).filter((g) => g.length > 0).map((full) => ({ full }));
    if (cleanGrantors.length === 0) return props.setError('At least one grantor is required.');
    props.setError(null);
    props.onGenerate({
      deedType: QUICK_DEED_INTO_TRUST_TYPE,
      intoTrust: {
        exemplar,
        exemptionBasis: exemptionBasis.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
        titleSearchPerformed,
        preparer: { name: preparerName.trim(), vsb: preparerVsb.trim(), firm: preparerFirm.trim() },
        consideration: trimOrUndef(consideration),
        fileNumber: trimOrUndef(fileNumber),
        instrumentDate: { day: instrDay.trim(), month: instrMonth.trim(), year: instrYear.trim() },
        grantors: cleanGrantors,
        grantorMaritalStatus: grantorMaritalStatus.trim(),
        heldAs: heldAs.trim(),
        trustStructure: trustStructure.trim(),
        trusteesRecital: trusteesRecital.trim(),
        granteeObjectPlurality,
        grantingVerb: grantingVerb.trim(),
        lceIdentificationFootnote,
        derivation: trimOrUndef(derivation),
        tbeImmunityNote: tbeImmunityNote.trim().length > 0 ? tbeImmunityNote.trim() : null,
        notaryJurisdiction: { type: notaryType, name: notaryName.trim() },
      },
    } as GeneratePayload);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <UploadsHeader {...props} />
      <CategoryDescribeBox
        resolveMatterId={props.resolveMatterId}
        proposeMutate={(input) => utils.client.quickDeed.proposeIntakeIntoTrust.mutate(input)}
        onApplyProposal={(p) => {
          const f = intoTrustProposalToFields(p);
          if (f.exemplar) setExemplar(f.exemplar);
          if (f.grantors) setGrantors(f.grantors);
          if (f.grantorMaritalStatus) setGrantorMaritalStatus(f.grantorMaritalStatus);
          if (f.heldAs) setHeldAs(f.heldAs);
          if (f.trustStructure) setTrustStructure(f.trustStructure);
        }}
        placeholder="e.g. Harold and Nadia Whitmore, a married couple, are transferring their home into their joint revocable living trust."
        safetyNote="Proposes the exemplar, grantor(s), and trust structure. It never writes the trustees recital (you enter that verbatim), the being recital, the derivation, or the legal description."
      />
      <div data-testid="quick-deed-into_trust-fields" className="space-y-4 rounded border border-line/60 bg-surface/40 p-3">
        <p className="text-xs text-ink-secondary">Conveyance into a revocable living trust. The trustees recital is load-bearing and attorney-supplied verbatim — it is never auto-generated from the certificate of trust.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Exemplar</label>
            <select value={exemplar} onChange={(e) => setExemplar(e.target.value === 'B' ? 'B' : e.target.value === 'C' ? 'C' : 'A')} className={`${inputCls} bg-white`}>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </div>
          <Text label="Exemption basis (comma-separated)" value={exemptionBasis} onChange={setExemptionBasis} placeholder="58.1-811(A)(12)" />
        </div>
        <Text label="Trustees recital (attorney-supplied, verbatim)" value={trusteesRecital} onChange={setTrusteesRecital} placeholder="Rosalind A. WHITMORE and Desmond P. WHITMORE, Trustees of THE WHITMORE FAMILY REVOCABLE LIVING TRUST, dated August 14, 2021" required textarea />
        {grantorNeedsConfirm && (
          <p data-testid="into-trust-grantor-seed-note" className="text-xs text-amber-700">
            Grantor(s) read from the prior deed (the current owner(s)) — confirm or edit.
          </p>
        )}
        <StringList label="Grantor(s)" values={grantors} setValues={setGrantors} placeholder="Full legal name" />
        <div className="grid grid-cols-2 gap-4">
          <Text label="Grantor marital status" value={grantorMaritalStatus} onChange={setGrantorMaritalStatus} placeholder="a married couple" />
          <Text label="Held as" value={heldAs} onChange={setHeldAs} placeholder="tenants_by_entirety" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Trust structure" value={trustStructure} onChange={setTrustStructure} placeholder="single_joint_trust" />
          <Text label="Granting verb" value={grantingVerb} onChange={setGrantingVerb} placeholder="quitclaim, release and convey" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Text label="Instrument day" value={instrDay} onChange={setInstrDay} placeholder="9th" />
          <Text label="Instrument month" value={instrMonth} onChange={setInstrMonth} placeholder="April" />
          <Text label="Instrument year" value={instrYear} onChange={setInstrYear} placeholder="2026" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grantee object plurality</label>
            <select value={granteeObjectPlurality} onChange={(e) => setGranteeObjectPlurality(e.target.value === 'GRANTEE' ? 'GRANTEE' : 'GRANTEES')} className={`${inputCls} bg-white`}>
              <option value="GRANTEES">GRANTEES</option>
              <option value="GRANTEE">GRANTEE</option>
            </select>
          </div>
          <Text label="TBE immunity note (Exemplar-A / Exemplar-C, else blank)" value={tbeImmunityNote} onChange={setTbeImmunityNote} placeholder="Exemplar-A" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Text label="Preparer name" value={preparerName} onChange={setPreparerName} placeholder="Kelly Satterwhite, Esq." />
          <Text label="Preparer VSB" value={preparerVsb} onChange={setPreparerVsb} placeholder="91049" />
          <Text label="Preparer firm" value={preparerFirm} onChange={setPreparerFirm} placeholder="The Mason Law Firm, PLC" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Text label="Consideration" value={consideration} onChange={setConsideration} placeholder="$0.00" />
          <Text label="File number" value={fileNumber} onChange={setFileNumber} placeholder="optional" />
        </div>
        <Text label="Derivation" value={derivation} onChange={setDerivation} placeholder="For derivation of title, see Deed intended to be recorded immediately prior hereto …" textarea />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notary jurisdiction type</label>
            <select value={notaryType} onChange={(e) => setNotaryType(e.target.value === 'COUNTY' ? 'COUNTY' : 'CITY')} className={`${inputCls} bg-white`}>
              <option value="CITY">CITY</option>
              <option value="COUNTY">COUNTY</option>
            </select>
          </div>
          <Text label="Notary jurisdiction name" value={notaryName} onChange={setNotaryName} placeholder="ALEXANDRIA" required />
        </div>
        <Checkbox label="Include LCE identification footnote" checked={lceIdentificationFootnote} onChange={setLceIdentificationFootnote} />
        <Checkbox label="Title search performed" checked={titleSearchPerformed} onChange={setTitleSearchPerformed} />
      </div>
      <GenerateBar submitting={props.submitting} error={props.error} />
    </form>
  );
}

/** Dispatcher: renders the structured form for the selected multi-category Quick-Deed type. Returns null for the
 *  gift + seller-side lanes (those stay in QuickDeedPage). */
export default function QuickDeedCategoryForm(props: CategoryFormProps): React.ReactElement | null {
  switch (props.deedType) {
    case QUICK_DEED_INTO_LLC_TYPE:
      return <IntoLlcForm {...props} />;
    case QUICK_DEED_OUT_OF_LLC_TYPE:
      return <OutOfLlcForm {...props} />;
    case QUICK_DEED_TOD_TYPE:
      return <TodForm {...props} />;
    case QUICK_DEED_CONFIRMATION_TYPE:
      return <ConfirmationForm {...props} />;
    case QUICK_DEED_INTO_TRUST_TYPE:
      return <IntoTrustForm {...props} />;
    default:
      return null;
  }
}

export const QUICK_DEED_CATEGORY_TYPES = [
  QUICK_DEED_INTO_LLC_TYPE,
  QUICK_DEED_OUT_OF_LLC_TYPE,
  QUICK_DEED_TOD_TYPE,
  QUICK_DEED_CONFIRMATION_TYPE,
  QUICK_DEED_INTO_TRUST_TYPE,
];
