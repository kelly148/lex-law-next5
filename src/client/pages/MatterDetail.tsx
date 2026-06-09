/**
 * MatterDetail — Lex Law Next v1
 *
 * Ch 26 — Matter Detail view
 *
 * Shows matter metadata, document list, and provides access to:
 *   - Materials Drawer (Ch 27)
 *   - Information Request (Ch 31)
 *   - Document creation
 *
 * Procedures used:
 *   - matter.get (query)
 *   - matter.updateMetadata (mutation)
 *   - document.list (query)
 *   - document.create (mutation)
 *
 * Ch 35.3 — No business logic in React.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit2, Plus, FileText, Layers, ChevronRight, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import MaterialsDrawer from '../components/MaterialsDrawer.js';
import MatterStateDashboard from '../components/MatterStateDashboard.js';
import MatterRecitalBand from '../components/MatterRecitalBand.js';
import MatterIntakePanel from '../components/MatterIntakePanel.js';
import ClosurePackagePanel from '../components/ClosurePackagePanel.js';
import DeadlinePanel from '../components/DeadlinePanel.js';
import MatterRecordLedger from '../components/MatterRecordLedger.js';
import KnowledgeBasePanel from '../components/KnowledgeBasePanel.js';

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  // Trusts & Estates
  { value: 'revocable_living_trust', label: 'Revocable Living Trust' },
  { value: 'pour_over_will', label: 'Pour-Over Will' },
  { value: 'last_will_testament', label: 'Last Will and Testament' },
  { value: 'durable_poa', label: 'Durable General Power of Attorney' },
  { value: 'advance_medical_directive', label: 'Advance Medical Directive' },
  { value: 'certificate_of_trust', label: 'Certificate of Trust' },
  { value: 'trust_amendment', label: 'Trust Amendment' },
  { value: 'trust_opinion_letter', label: 'Trust Opinion Letter' },

  // Real Estate
  { value: 'deed', label: 'Deed (general/special warranty, quitclaim, gift)' },
  { value: 'deed_of_trust', label: 'Deed of Trust' },
  { value: 'promissory_note', label: 'Promissory Note' },
  { value: 'residential_psa', label: 'Residential Purchase Agreement' },
  { value: 'commercial_psa', label: 'Commercial Purchase Agreement' },
  { value: 'lease_agreement', label: 'Lease Agreement' },
  { value: 'closing_instruction_letter', label: 'Closing Instruction Letter' },

  // Business Entity
  { value: 'operating_agreement', label: 'Operating Agreement' },
  { value: 'articles_of_organization', label: 'Articles of Organization' },
  { value: 'asset_purchase_agreement', label: 'Asset Purchase Agreement' },
  { value: 'mipa', label: 'Membership Interest Purchase Agreement' },
  { value: 'buy_sell_agreement', label: 'Buy-Sell Agreement' },

  // 1031 Exchange
  { value: 'qi_exchange_agreement', label: 'Qualified Intermediary Exchange Agreement' },
  { value: 'assignment_1031', label: 'Assignment of Contract (1031)' },
  { value: 'identification_notice_1031', label: '1031 Identification Notice' },

  // Cross-Practice
  { value: 'engagement_letter', label: 'Engagement Letter' },
  { value: 'memorandum', label: 'Memorandum' },
  { value: 'opinion_letter', label: 'Opinion Letter' },
  { value: 'demand_letter', label: 'Demand Letter' },
  { value: 'client_instruction_letter', label: 'Client Instruction Letter' },
  { value: 'conflict_waiver', label: 'Conflict Waiver / Joint Representation Letter' },

  // Custom escape hatch
  { value: 'custom', label: 'Other / Custom' },
];

const DRAFTING_MODES = [
  { value: 'template', label: 'Template-based' },
  { value: 'iterative', label: 'Iterative (AI draft)' },
] as const;

interface CreateDocumentFormProps {
  matterId: string;
  onClose: () => void;
  onCreated: (docId: string) => void;
}

// Exported for the DOC-CLIENT-TARGET-1 render test (the principal selector / mandatory-pick logic).
export function CreateDocumentForm({ matterId, onClose, onCreated }: CreateDocumentFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [customTypeLabel, setCustomTypeLabel] = useState('');
  const [draftingMode, setDraftingMode] = useState<'template' | 'iterative'>('iterative');
  // DOC-CLIENT-TARGET-1: the chosen principal for an individual document in a multi-client matter.
  const [subjectPartyId, setSubjectPartyId] = useState('');
  // DOC-CLIENT-TARGET-1: pair affordance — also create the matching instance for the other client(s).
  const [createPair, setCreatePair] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // DOC-CLIENT-TARGET-1: the matter's parties drive the principal selector. The targeting STRUCTURE +
  // role label are read from the shared doc-type config (the single accessor — never hardcoded here).
  const { data: parties } = trpc.matterIntake.listParties.useQuery({ matterId });
  const clientParties = (parties ?? []).filter((p) => p.role === 'client');
  const docTypeConfig = getDocTypeConfig(documentType);
  const isIndividualSubject = docTypeConfig?.targetStructure === 'individual_subject';
  // DOC-CLIENT-TARGET-1 Inc 3: party_set (joint) types -> no selector; the whole client set is bound.
  const isPartySet = docTypeConfig?.targetStructure === 'party_set';
  const principalLabel =
    docTypeConfig?.requiredRoles.find((r) => r.roleKey === 'subject')?.renderLabel ?? 'Principal';
  // Multi-client + individual type -> a mandatory affirmative pick (no pre-selection). Single client ->
  // shown read-only (auto-bound server-side). Non-individual types -> no selector.
  const needsPrincipalPick = isIndividualSubject && clientParties.length >= 2;
  const soleClient = isIndividualSubject && clientParties.length === 1 ? clientParties[0]! : null;

  // DOC-CLIENT-TARGET-1: pair affordance + duplicate guard. instancesForType tells us which clients
  // already have their own instance of this type. A pairable individual type in a multi-client matter,
  // once a principal is picked, offers to ALSO create the matching instance for each OTHER client who
  // does not have one; clients who DO have one are linked instead (duplicate guard). Pair trigger is
  // the config `pairable` flag (enumeration-gated pre-check from the assessment is a fast-follow).
  const { data: typeInstances } = trpc.document.instancesForType.useQuery(
    { matterId, documentType },
    { enabled: isIndividualSubject && documentType !== '' },
  );
  const typeLabel = DOCUMENT_TYPES.find((t) => t.value === documentType)?.label ?? 'document';
  const otherClients = clientParties.filter((c) => c.id !== subjectPartyId);
  const instanceIdFor = (partyId: string): string | null =>
    (typeInstances ?? []).find((i) => i.partyId === partyId)?.documentId ?? null;
  const pairableType = isIndividualSubject && (docTypeConfig?.pairable ?? false);
  const pairTargets = otherClients.filter((c) => instanceIdFor(c.id) === null);
  const existingOtherInstances = otherClients.filter((c) => instanceIdFor(c.id) !== null);
  const showPairOffer = pairableType && clientParties.length >= 2 && subjectPartyId !== '' && pairTargets.length > 0;

  const createMutation = useGuardedMutation(
    async (input: {
      primary: { matterId: string; title: string; documentType: string; customTypeLabel?: string | null; draftingMode: 'template' | 'iterative'; subjectPartyId?: string };
      pairTargetPartyIds: string[];
    }) => {
      const primaryDoc = await utils.client.document.create.mutate(input.primary);
      // The matching instances reuse type/structure/shared matter data (a fresh empty doc bound to the
      // other client) — NOT principal-specific fiduciary choices (there is no draft yet to copy).
      for (const partyId of input.pairTargetPartyIds) {
        await utils.client.document.create.mutate({ ...input.primary, subjectPartyId: partyId });
      }
      return primaryDoc;
    },
    {
      onSuccess: (doc) => {
        void utils.document.list.invalidate({ matterId });
        onCreated(doc.id);
      },
      onError: (err) => {
        setError(err.message);
      },
    }
  );

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!documentType) { setError('Document type is required.'); return; }
    if (documentType === 'custom' && !customTypeLabel.trim()) { setError('Custom document type label is required.'); return; }
    if (needsPrincipalPick && !subjectPartyId) { setError(`Choose the ${principalLabel.toLowerCase()} for this document.`); return; }
    setError(null);
    createMutation.mutate({
      primary: {
        matterId,
        title: title.trim(),
        documentType,
        customTypeLabel: documentType === 'custom' ? customTypeLabel.trim() : null,
        draftingMode,
        ...(subjectPartyId ? { subjectPartyId } : {}),
      },
      pairTargetPartyIds: showPairOffer && createPair ? pairTargets.map((c) => c.id) : [],
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-firm-navy mb-4">New Document</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g., Engagement Letter"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Document Type <span className="text-red-500">*</span>
            </label>
            <select
              value={documentType}
              onChange={(e) => { setDocumentType(e.target.value); setSubjectPartyId(''); }}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            >
              <option value="">— Select —</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {documentType === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Document Type <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customTypeLabel}
                onChange={(e) => setCustomTypeLabel(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="e.g., Certificate of Trust, Deed of Correction, Stock Purchase Agreement"
              />
            </div>
          )}
          {/* DOC-CLIENT-TARGET-1: multi-client + individual type -> mandatory principal pick, NO default
              (a pre-selected first client is how the wrong name reaches a POA). */}
          {needsPrincipalPick && (
            <div data-testid="principal-selector">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {principalLabel} <span className="text-red-500">*</span>
              </label>
              <select
                value={subjectPartyId}
                onChange={(e) => setSubjectPartyId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              >
                <option value="">— Select the {principalLabel.toLowerCase()} —</option>
                {clientParties.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                This is an individual document in a multi-client matter — choose which client it is for. No default is assumed.
              </p>
            </div>
          )}
          {soleClient && (
            <div data-testid="principal-sole" className="text-sm text-gray-700">
              <span className="font-medium">{principalLabel}:</span> {soleClient.displayName}
              <span className="text-xs text-gray-500"> (sole client — bound automatically)</span>
            </div>
          )}
          {/* DOC-CLIENT-TARGET-1 Inc 3: party_set (joint) -> no principal selector; the whole client set
              is bound at creation. "Change parties" is a noted fast-follow. */}
          {isPartySet && clientParties.length > 0 && (
            <div data-testid="party-set-applies" className="text-sm text-gray-700 rounded border border-line bg-surface px-3 py-2">
              <span className="font-medium">Applies to:</span> {clientParties.map((c) => c.displayName).join(' and ')}
              <span className="text-xs text-gray-500"> (joint document — all clients bound)</span>
            </div>
          )}
          {/* DOC-CLIENT-TARGET-1: pair affordance — also create the matching instance for the other
              client(s). One confirmation, not a second full flow. Duplicate-guarded below. */}
          {showPairOffer && (
            <label data-testid="pair-offer" className="flex items-start gap-2 text-sm cursor-pointer rounded border border-line bg-surface px-3 py-2">
              <input type="checkbox" checked={createPair} onChange={(e) => setCreatePair(e.target.checked)} className="mt-0.5" />
              <span>Also create a matching {typeLabel} for {pairTargets.map((c) => c.displayName).join(', ')}.</span>
            </label>
          )}
          {existingOtherInstances.length > 0 && (
            <div data-testid="pair-existing" className="text-xs text-gray-600 flex flex-wrap gap-x-3">
              {existingOtherInstances.map((c) => {
                const id = instanceIdFor(c.id);
                return id ? (
                  <Link key={c.id} to={`/matters/${matterId}/documents/${id}`} className="text-accent underline-offset-2 hover:underline">
                    Open {c.displayName}&apos;s existing {typeLabel}
                  </Link>
                ) : null;
              })}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Drafting Mode</label>
            <div className="flex gap-4">
              {DRAFTING_MODES.map((mode) => (
                <label key={mode.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="draftingMode"
                    value={mode.value}
                    checked={draftingMode === mode.value}
                    onChange={() => setDraftingMode(mode.value)}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || (documentType === 'custom' && !customTypeLabel.trim()) || (needsPrincipalPick && !subjectPartyId)}
              className="px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditMatterFormProps {
  matter: { id: string; title: string; clientName: string | null; practiceArea: string | null; jurisdiction?: string | null };
  onClose: () => void;
}

function EditMatterForm({ matter, onClose }: EditMatterFormProps): React.ReactElement {
  const [title, setTitle] = useState(matter.title);
  const [clientName, setClientName] = useState(matter.clientName ?? '');
  const [practiceArea, setPracticeArea] = useState(matter.practiceArea ?? '');
  // RELAYOUT-2: jurisdiction set/changed here (a deliberate act in its panel) since the recital
  // band is status-only and no longer carries the inline VA/MD editor.
  const [jurisdiction, setJurisdiction] = useState(matter.jurisdiction ?? '');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const updateMutation = useGuardedMutation(
    (input: { matterId: string; title?: string; clientName?: string | null; practiceArea?: string | null; jurisdiction?: string | null }) =>
      utils.client.matter.updateMetadata.mutate(input),
    {
      onSuccess: () => {
        void utils.matter.get.invalidate({ matterId: matter.id });
        onClose();
      },
      onError: (err) => setError(err.message),
    }
  );

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setError(null);
    updateMutation.mutate({
      matterId: matter.id,
      title: title.trim(),
      clientName: clientName.trim() || null,
      practiceArea: practiceArea || null,
      jurisdiction: jurisdiction || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-firm-navy mb-4">Edit Matter</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Area</label>
            <input
              type="text"
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Governing Jurisdiction</label>
            <select
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            >
              <option value="">— Not set —</option>
              <option value="VA">Virginia</option>
              <option value="MD">Maryland</option>
            </select>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MatterDetail(): React.ReactElement {
  const { matterId } = useParams<{ matterId: string }>();
  const navigate = useNavigate();
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [showEditMatter, setShowEditMatter] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [includeArchivedDocs, setIncludeArchivedDocs] = useState(false);

  const { data: matter, isLoading: matterLoading } = trpc.matter.get.useQuery(
    { matterId: matterId! },
    { enabled: !!matterId }
  );

  const { data: documents, isLoading: docsLoading } = trpc.document.list.useQuery(
    { matterId: matterId!, includeArchived: includeArchivedDocs },
    { enabled: !!matterId }
  );

  if (!matterId) return <div className="p-6 text-red-600">Invalid matter ID.</div>;

  if (matterLoading) {
    return <div className="p-6 text-gray-400 text-sm">Loading matter…</div>;
  }

  if (!matter) {
    return <div className="p-6 text-red-600 text-sm">Matter not found.</div>;
  }

  const docs = documents ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
        <Link to="/matters" className="hover:text-firm-navy flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Matters
        </Link>
        <span>/</span>
        <span className="text-firm-navy font-medium">{matter.title}</span>
      </div>

      {/* Matter header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-garamond font-medium text-firm-navy">{matter.title}</h1>
          <div className="flex items-center gap-3 mt-1">
            {matter.clientName && <span className="text-sm text-gray-600">{matter.clientName}</span>}
            {matter.practiceArea && <span className="text-sm text-gray-400">{matter.practiceArea}</span>}
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded capitalize',
              matter.phase === 'intake' && 'bg-blue-100 text-blue-700',
              matter.phase === 'drafting' && 'bg-amber-100 text-amber-700',
              matter.phase === 'complete' && 'bg-green-100 text-green-700',
            )}>
              {matter.phase}
            </span>
            {matter.archivedAt && (
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMaterials(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
          >
            <Layers className="w-4 h-4" />
            Materials
          </button>
          <Link
            to={`/matters/${matterId}/information-requests`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
          >
            <BookOpen className="w-4 h-4" />
            Info Request
          </Link>
          <button
            onClick={() => setShowEditMatter(true)}
            className="p-1.5 text-gray-400 hover:text-firm-navy rounded"
            title="Edit matter"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* RELAYOUT-2 — matter recital band v2 (the established record, read in one glance) */}
      <MatterRecitalBand matterId={matterId} />

      {/* Documents section */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-firm-navy">Documents</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includeArchivedDocs}
              onChange={(e) => setIncludeArchivedDocs(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
          {!matter.archivedAt && (
            <button
              onClick={() => setShowCreateDoc(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-line text-ink rounded hover:bg-surface"
            >
              <Plus className="w-4 h-4" />
              New Document
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {docsLoading ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading documents…</div>
        ) : docs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No documents yet.</p>
          </div>
        ) : (
          docs.map((doc) => (
            <div
              key={doc.id}
              className={clsx(
                'flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors',
                doc.archivedAt && 'opacity-60'
              )}
              onClick={() => navigate(`/matters/${matterId}/documents/${doc.id}`)}
            >
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-serif font-medium text-firm-navy text-sm truncate">{doc.title}</span>
                  {doc.archivedAt && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400 capitalize">{doc.documentType}</span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400 capitalize">{doc.draftingMode}</span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className={clsx(
                    'text-xs px-1.5 py-0.5 rounded capitalize',
                    doc.workflowState === 'drafting' && 'bg-amber-100 text-amber-700',
                    doc.workflowState === 'substantively_accepted' && 'bg-blue-100 text-blue-700',
                    doc.workflowState === 'finalizing' && 'bg-green-100 text-green-700',
                    doc.workflowState === 'complete' && 'bg-purple-100 text-purple-700',
                  )}>
                    {doc.workflowState.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </div>
          ))
        )}
      </div>

      {/* FOLD-L0-1 — Layer-0 matter intake & analysis (conflicts-at-intake + plan closure) */}
      <MatterIntakePanel matterId={matterId} />

      {/* FOLD-KB-1 — Practice Knowledge Base (surface-not-inject; adopt; memos; per-PA profile) */}
      <KnowledgeBasePanel matterId={matterId} />

      {/* FOLD-L1-5 — matter-state dashboard + the five explicit acts */}
      <MatterStateDashboard matterId={matterId} />

      {/* FOLD-DRAFT-1 / package — closing-package assembly + advisory completeness (never sends/locks) */}
      <ClosurePackagePanel matterId={matterId} />

      {/* FOLD-PM-1 — deadline/tickler surface (coverage chip + unconfirmed/overdue treatments; flag-gated,
          renders "engine off" when DEADLINE_ENGINE_ENABLED is OFF). Surfaces + records; never acts. */}
      <DeadlinePanel matterId={matterId} />

      {/* R2 #7 — Matter Record ledger (read-only projection of audit_events) */}
      <MatterRecordLedger matterId={matterId} />

      {/* Modals */}
      {showCreateDoc && (
        <CreateDocumentForm
          matterId={matterId}
          onClose={() => setShowCreateDoc(false)}
          onCreated={(docId) => {
            setShowCreateDoc(false);
            navigate(`/matters/${matterId}/documents/${docId}`);
          }}
        />
      )}
      {showEditMatter && (
        <EditMatterForm matter={matter} onClose={() => setShowEditMatter(false)} />
      )}
      {showMaterials && (
        <MaterialsDrawer
          matterId={matterId}
          matterTitle={matter?.title}
          clientName={matter?.clientName}
          onClose={() => setShowMaterials(false)}
        />
      )}
    </div>
  );
}
