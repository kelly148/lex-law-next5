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
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import MaterialsDrawer from '../components/MaterialsDrawer.js';

const DOCUMENT_TYPES = [
  'contract',
  'motion',
  'brief',
  'memo',
  'letter',
  'agreement',
  'complaint',
  'answer',
  'discovery',
  'other',
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

function CreateDocumentForm({ matterId, onClose, onCreated }: CreateDocumentFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [draftingMode, setDraftingMode] = useState<'template' | 'iterative'>('iterative');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const createMutation = useGuardedMutation(
    (input: { matterId: string; title: string; documentType: string; draftingMode: 'template' | 'iterative' }) =>
      utils.client.document.create.mutate(input),
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
    setError(null);
    createMutation.mutate({ matterId, title: title.trim(), documentType, draftingMode });
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
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            >
              <option value="">— Select —</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
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
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
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
  matter: { id: string; title: string; clientName: string | null; practiceArea: string | null };
  onClose: () => void;
}

function EditMatterForm({ matter, onClose }: EditMatterFormProps): React.ReactElement {
  const [title, setTitle] = useState(matter.title);
  const [clientName, setClientName] = useState(matter.clientName ?? '');
  const [practiceArea, setPracticeArea] = useState(matter.practiceArea ?? '');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const updateMutation = useGuardedMutation(
    (input: { matterId: string; title?: string; clientName?: string | null; practiceArea?: string | null }) =>
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
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
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
          <h1 className="text-2xl font-garamond font-semibold text-firm-navy">{matter.title}</h1>
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90"
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
                  <span className="font-medium text-firm-navy text-sm truncate">{doc.title}</span>
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
        <MaterialsDrawer matterId={matterId} onClose={() => setShowMaterials(false)} />
      )}
    </div>
  );
}
