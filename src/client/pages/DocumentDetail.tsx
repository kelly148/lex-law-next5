/**
 * DocumentDetail — Lex Law Next v1
 *
 * Ch 29 — Document Detail Views
 *
 * Full document workflow view. Handles both iterative and template-based drafting modes.
 *
 * Procedures used:
 *   - document.get (query)
 *   - document.updateTitle (mutation)
 *   - document.setNotes (mutation)
 *   - document.archive / document.unarchive (mutation)
 *   - document.unfinalize (mutation)
 *   - document.generateDraft (mutation) — iterative mode
 *   - document.regenerate (mutation) — iterative mode
 *   - document.acceptSubstantive (mutation)
 *   - document.reopenSubstantive (mutation)
 *   - document.finalize (mutation)
 *   - document.extractVariables (mutation) — template mode
 *   - document.populateFromMatter (mutation) — template mode
 *   - document.updateVariableMap (mutation) — template mode
 *   - document.render (mutation) — template mode
 *   - version.list (query)
 *   - version.get (query)
 *   - job.listForDocument (query) — polling
 *   - job.cancel (mutation)
 *   - outline.get (query)
 *   - outline.generate (mutation)
 *   - outline.regenerate (mutation)
 *   - outline.edit (mutation)
 *   - outline.approve (mutation)
 *   - reference.list (query)
 *   - reference.add (mutation)
 *   - reference.remove (mutation)
 *   - reference.acknowledgeStale (mutation)
 *   - contextPipeline.preview (query) — Ch 31 context preview panel
 *
 * Ch 35.3 — No business logic in React.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Save, X, Archive, ArchiveRestore, RefreshCw,
  CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp,
  FileText, Eye, Download
} from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import ReviewPane from '../components/ReviewPane.js';
import ContextPreviewPanel from '../components/ContextPreviewPanel.js';

// ============================================================
// Job status banner
// ============================================================
interface JobBannerProps {
  documentId: string;
}

function JobBanner({ documentId }: JobBannerProps): React.ReactElement | null {
  const utils = trpc.useUtils();
  const { data } = trpc.job.listForDocument.useQuery({ documentId }, {
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
      return hasActive ? 5000 + Math.random() * 1000 : false;
    },
  });

  const jobs = data?.jobs ?? [];
  const activeJob = jobs.find((j) => j.status === 'queued' || j.status === 'running');

  const cancelMutation = useGuardedMutation(
    (input: { jobId: string }) => utils.client.job.cancel.mutate(input),
    { onSuccess: () => void utils.job.listForDocument.invalidate({ documentId }) }
  );

  useEffect(() => {
    if (!activeJob) {
      void utils.document.get.invalidate({ documentId });
      void utils.version.list.invalidate({ documentId });
    }
  }, [activeJob, documentId, utils]);

  if (!activeJob) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
      <RefreshCw className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0" />
      <span className="text-amber-800 flex-1">
        {activeJob.jobType.replace(/_/g, ' ')} in progress…
      </span>
      <button
        onClick={() => cancelMutation.mutate({ jobId: activeJob.id })}
        disabled={cancelMutation.isPending}
        className="text-xs text-amber-700 hover:underline disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}

// ============================================================
// Outline panel (for iterative mode)
// ============================================================
interface OutlinePanelProps {
  documentId: string;
  matterId: string;
}

function OutlinePanel({ documentId, matterId }: OutlinePanelProps): React.ReactElement {
  const utils = trpc.useUtils();
  const [editingSections, setEditingSections] = useState(false);
  const [sectionEdits, setSectionEdits] = useState<Array<{ title: string; description: string; orderIndex: number }>>([]);

  const { data: outlineData } = trpc.outline.get.useQuery({ documentId });
  const outline = outlineData?.outline ?? null;

  const generateMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.outline.generate.mutate(input),
    { onSuccess: () => void utils.outline.get.invalidate({ documentId }) }
  );

  const regenerateMutation = useGuardedMutation(
    (input: { outlineId: string }) => utils.client.outline.regenerate.mutate(input),
    { onSuccess: () => void utils.outline.get.invalidate({ documentId }) }
  );

  const editMutation = useGuardedMutation(
    (input: { outlineId: string; sections: Array<{ title: string; description: string; orderIndex: number }> }) =>
      utils.client.outline.edit.mutate(input),
    {
      onSuccess: () => {
        void utils.outline.get.invalidate({ documentId });
        setEditingSections(false);
      },
    }
  );

  const approveMutation = useGuardedMutation(
    (input: { outlineId: string }) => utils.client.outline.approve.mutate(input),
    { onSuccess: () => void utils.outline.get.invalidate({ documentId }) }
  );

  void matterId; // used for context

  if (!outline) {
    return (
      <div className="p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-firm-navy">Outline</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">No outline yet. Generate one to structure the document.</p>
        <button
          onClick={() => generateMutation.mutate({ documentId })}
          disabled={generateMutation.isPending}
          className="px-3 py-1.5 text-xs bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
        >
          {generateMutation.isPending ? 'Generating…' : 'Generate Outline'}
        </button>
      </div>
    );
  }

  const startEdit = (): void => {
    setSectionEdits(outline.sections.map((s, i) => ({
      title: s.title,
      description: s.description,
      orderIndex: i,
    })));
    setEditingSections(true);
  };

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-firm-navy">Outline</h3>
          <span className={clsx(
            'text-xs px-1.5 py-0.5 rounded',
            outline.status === 'draft' && 'bg-amber-100 text-amber-700',
            outline.status === 'approved' && 'bg-green-100 text-green-700',
            outline.status === 'skipped' && 'bg-gray-100 text-gray-600',
          )}>
            {outline.status}
          </span>
        </div>
        {outline.status === 'draft' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => regenerateMutation.mutate({ outlineId: outline.id })}
              disabled={regenerateMutation.isPending}
              className="text-xs text-gray-500 hover:text-firm-navy"
            >
              Regenerate
            </button>
            <button
              onClick={startEdit}
              className="text-xs text-firm-navy hover:underline"
            >
              Edit
            </button>
            <button
              onClick={() => approveMutation.mutate({ outlineId: outline.id })}
              disabled={approveMutation.isPending}
              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        )}
      </div>

      {editingSections ? (
        <div className="space-y-2">
          {sectionEdits.map((s, i) => (
            <div key={i} className="border border-gray-200 rounded p-2 space-y-1">
              <input
                type="text"
                value={s.title}
                onChange={(e) => {
                  const next = [...sectionEdits];
                  next[i] = { ...next[i]!, title: e.target.value };
                  setSectionEdits(next);
                }}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
                placeholder="Section title"
              />
              <textarea
                value={s.description}
                onChange={(e) => {
                  const next = [...sectionEdits];
                  next[i] = { ...next[i]!, description: e.target.value };
                  setSectionEdits(next);
                }}
                rows={2}
                className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy resize-none"
                placeholder="Section description"
              />
            </div>
          ))}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditingSections(false)}
              className="px-2 py-1 text-xs text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={() => editMutation.mutate({ outlineId: outline.id, sections: sectionEdits })}
              disabled={editMutation.isPending}
              className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {outline.sections.map((s, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium text-firm-navy">{i + 1}. {s.title}</span>
              {s.description && (
                <p className="text-gray-500 mt-0.5 ml-3">{s.description}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ============================================================
// VersionHistory panel
// ============================================================
interface VersionHistoryProps {
  documentId: string;
  currentVersionId: string | null;
}

function VersionHistory({ documentId, currentVersionId }: VersionHistoryProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const { data: versions } = trpc.version.list.useQuery({ documentId });
  const { data: selectedVersion } = trpc.version.get.useQuery(
    { versionId: selectedVersionId! },
    { enabled: !!selectedVersionId }
  );

  const versionList = versions ?? [];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 bg-white text-sm font-semibold text-firm-navy hover:bg-gray-50"
      >
        <span>Version History ({versionList.length})</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="border-t border-gray-100">
          <div className="flex">
            {/* Version list */}
            <div className="w-48 border-r border-gray-100 bg-gray-50">
              {versionList.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400">No versions yet.</p>
              ) : (
                versionList.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVersionId(v.id)}
                    className={clsx(
                      'w-full text-left px-3 py-2 text-xs border-b border-gray-100 hover:bg-white transition-colors',
                      selectedVersionId === v.id && 'bg-white font-medium',
                      v.id === currentVersionId && 'text-firm-navy'
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <span>v{v.versionNumber}</span>
                      {v.id === currentVersionId && (
                        <span className="text-xs text-green-600">(current)</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </div>
                  </button>
                ))
              )}
            </div>
            {/* Version content */}
            <div className="flex-1 p-3 max-h-64 overflow-y-auto">
              {selectedVersion ? (
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                  {selectedVersion.content}
                </pre>
              ) : (
                <p className="text-xs text-gray-400">Select a version to view its content.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// VariableMapEditor — for template-mode documents
// ============================================================
interface VariableMapEditorProps {
  documentId: string;
  variableMap: Record<string, unknown>;
}

function VariableMapEditor({ documentId, variableMap }: VariableMapEditorProps): React.ReactElement {
  const [localMap, setLocalMap] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(variableMap).map(([k, v]) => [k, String(v ?? '')])
    )
  );
  const [saved, setSaved] = useState(false);
  const utils = trpc.useUtils();

  const updateMutation = useGuardedMutation(
    (input: { documentId: string; variableMap: Record<string, unknown> }) =>
      utils.client.document.updateVariableMap.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    }
  );

  const keys = Object.keys(variableMap);

  if (keys.length === 0) {
    return (
      <div className="p-3 bg-gray-50 rounded text-xs text-gray-400">
        No variables extracted yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <label className="text-xs text-gray-600 w-40 flex-shrink-0 truncate" title={key}>
            {key}
          </label>
          <input
            type="text"
            value={localMap[key] ?? ''}
            onChange={(e) => setLocalMap((prev) => ({ ...prev, [key]: e.target.value }))}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
          />
        </div>
      ))}
      <div className="flex items-center gap-2 justify-end pt-1">
        {saved && <span className="text-xs text-green-600">Saved</span>}
        <button
          onClick={() => updateMutation.mutate({ documentId, variableMap: localMap })}
          disabled={updateMutation.isPending}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
        >
          <Save className="w-3 h-3" />
          {updateMutation.isPending ? 'Saving…' : 'Save Variables'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DocumentDetail — main export
// ============================================================
export default function DocumentDetail(): React.ReactElement {
  const { matterId, documentId } = useParams<{ matterId: string; documentId: string }>();
  const utils = trpc.useUtils();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState('');
  const [regenerateInstructions, setRegenerateInstructions] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'outline' | 'variables' | 'references'>('content');

  const { data: doc, isLoading } = trpc.document.get.useQuery(
    { documentId: documentId! },
    { enabled: !!documentId }
  );

  const { data: references } = trpc.reference.list.useQuery(
    { sourceDocumentId: documentId! },
    { enabled: !!documentId }
  );

  // ---- Mutations ----
  const updateTitleMutation = useGuardedMutation(
    (input: { documentId: string; title: string }) => utils.client.document.updateTitle.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        setEditingTitle(false);
      },
    }
  );

  const setNotesMutation = useGuardedMutation(
    (input: { documentId: string; notes: string | null }) => utils.client.document.setNotes.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        setEditingNotes(false);
      },
    }
  );

  const archiveMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.archive.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const unarchiveMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.unarchive.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const unfinalizeMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.unfinalize.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const generateDraftMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.generateDraft.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        void utils.job.listForDocument.invalidate({ documentId: documentId! });
      },
    }
  );

  const regenerateMutation = useGuardedMutation(
    (input: { documentId: string; instructions: string }) => utils.client.document.regenerate.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        void utils.job.listForDocument.invalidate({ documentId: documentId! });
        setRegenerateInstructions('');
      },
    }
  );

  const acceptSubstantiveMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.acceptSubstantive.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const reopenSubstantiveMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.reopenSubstantive.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const finalizeMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.finalize.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  // Template-mode mutations
  const extractVariablesMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.extractVariables.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        void utils.job.listForDocument.invalidate({ documentId: documentId! });
      },
    }
  );

  const populateFromMatterMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.populateFromMatter.mutate(input),
    { onSuccess: () => void utils.document.get.invalidate({ documentId: documentId! }) }
  );

  const renderMutation = useGuardedMutation(
    (input: { documentId: string }) => utils.client.document.render.mutate(input),
    {
      onSuccess: () => {
        void utils.document.get.invalidate({ documentId: documentId! });
        void utils.job.listForDocument.invalidate({ documentId: documentId! });
      },
    }
  );

  const acknowledgeStaleRefsMutation = useGuardedMutation(
    (input: { sourceDocumentId: string }) => utils.client.reference.acknowledgeStale.mutate(input),
    { onSuccess: () => void utils.reference.list.invalidate({ sourceDocumentId: documentId! }) }
  );

  if (!documentId || !matterId) return <div className="p-6 text-red-600">Invalid document ID.</div>;
  if (isLoading) return <div className="p-6 text-gray-400 text-sm">Loading document…</div>;
  if (!doc) return <div className="p-6 text-red-600 text-sm">Document not found.</div>;

  const isArchived = doc.archivedAt !== null;
  const isComplete = doc.workflowState === 'complete';
  const isIterative = doc.draftingMode === 'iterative';
  const isTemplate = doc.draftingMode === 'template';
  const staleRefs = (references ?? []).filter((r) => !r.stalenessAcknowledgedAt);

  const workflowStateColor = {
    drafting: 'bg-amber-100 text-amber-700',
    substantively_accepted: 'bg-blue-100 text-blue-700',
    finalizing: 'bg-purple-100 text-purple-700',
    complete: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-600',
  }[doc.workflowState] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
        <Link to="/matters" className="hover:text-firm-navy">Matters</Link>
        <span>/</span>
        <Link to={`/matters/${matterId}`} className="hover:text-firm-navy flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Matter
        </Link>
        <span>/</span>
        <span className="text-firm-navy font-medium">{doc.title}</span>
      </div>

      {/* Job banner */}
      <div className="mb-4">
        <JobBanner documentId={documentId} />
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                className="text-xl font-garamond font-semibold text-firm-navy border-b-2 border-firm-navy focus:outline-none bg-transparent"
                autoFocus
              />
              <button
                onClick={() => updateTitleMutation.mutate({ documentId, title: titleInput })}
                disabled={updateTitleMutation.isPending}
                className="p-1 text-firm-navy hover:text-green-600 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditingTitle(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-garamond font-semibold text-firm-navy">{doc.title}</h1>
              <button
                onClick={() => { setTitleInput(doc.title); setEditingTitle(true); }}
                className="p-1 text-gray-400 hover:text-firm-navy"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400 capitalize">{doc.documentType}</span>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-gray-400 capitalize">{doc.draftingMode}</span>
            <span className="text-xs text-gray-300">·</span>
            <span className={clsx('text-xs px-1.5 py-0.5 rounded capitalize', workflowStateColor)}>
              {doc.workflowState.replace(/_/g, ' ')}
            </span>
            {isArchived && (
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
            )}
          </div>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={() => setShowContextPreview(!showContextPreview)}
            title="Context Preview"
            className={clsx(
              'p-1.5 rounded',
              showContextPreview ? 'text-firm-navy bg-firm-navy/10' : 'text-gray-400 hover:text-firm-navy'
            )}
          >
            <Eye className="w-4 h-4" />
          </button>
          {isArchived ? (
            <button
              onClick={() => unarchiveMutation.mutate({ documentId })}
              disabled={unarchiveMutation.isPending}
              title="Unarchive"
              className="p-1.5 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <ArchiveRestore className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => archiveMutation.mutate({ documentId })}
              disabled={archiveMutation.isPending}
              title="Archive"
              className="p-1.5 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stale references warning */}
      {staleRefs.length > 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800 flex-1">
            {staleRefs.length} referenced document{staleRefs.length > 1 ? 's have' : ' has'} been updated.
          </span>
          <button
            onClick={() => acknowledgeStaleRefsMutation.mutate({ sourceDocumentId: documentId })}
            disabled={acknowledgeStaleRefsMutation.isPending}
            className="text-xs text-amber-700 hover:underline disabled:opacity-50"
          >
            Acknowledge
          </button>
        </div>
      )}

      {/* Context preview panel */}
      {showContextPreview && (
        <div className="mb-4">
          <ContextPreviewPanel matterId={matterId} documentId={documentId} />
        </div>
      )}

      {/* Main layout: tabs + workflow actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: tabs */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200">
            {(['content', 'outline', 'variables', 'references'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                  activeTab === tab
                    ? 'border-firm-navy text-firm-navy'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                {tab === 'variables' ? 'Variables' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Content tab */}
          {activeTab === 'content' && (
            <div className="space-y-4">
              {/* Current version content */}
              {doc.currentVersionId ? (
                <VersionHistory documentId={documentId} currentVersionId={doc.currentVersionId} />
              ) : (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                  <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No draft yet.</p>
                </div>
              )}

              {/* Notes */}
              <div className="p-4 bg-white border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-firm-navy">Notes</h3>
                  {!editingNotes && (
                    <button
                      onClick={() => { setNotesInput(doc.notes ?? ''); setEditingNotes(true); }}
                      className="text-xs text-firm-navy hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      rows={4}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingNotes(false)}
                        className="px-3 py-1.5 text-xs text-gray-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => setNotesMutation.mutate({ documentId, notes: notesInput.trim() || null })}
                        disabled={setNotesMutation.isPending}
                        className="px-3 py-1.5 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{doc.notes || <em className="text-gray-300">No notes</em>}</p>
                )}
              </div>
            </div>
          )}

          {/* Outline tab */}
          {activeTab === 'outline' && (
            <OutlinePanel documentId={documentId} matterId={matterId} />
          )}

          {/* Variables tab */}
          {activeTab === 'variables' && isTemplate && (
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h3 className="text-sm font-semibold text-firm-navy mb-3">Variable Map</h3>
              <VariableMapEditor
                documentId={documentId}
                variableMap={doc.variableMap as Record<string, unknown> ?? {}}
              />
            </div>
          )}
          {activeTab === 'variables' && !isTemplate && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-sm text-gray-400">
              Variables are only available for template-based documents.
            </div>
          )}

          {/* References tab */}
          {activeTab === 'references' && (
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <h3 className="text-sm font-semibold text-firm-navy mb-3">Document References</h3>
              {(references ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No references.</p>
              ) : (
                <div className="space-y-2">
                  {(references ?? []).map((ref) => (
                    <div key={ref.id} className="flex items-center gap-2 text-sm">
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      <span className="flex-1 text-gray-700 truncate">{ref.referencedDocumentId}</span>
                      {!ref.stalenessAcknowledgedAt && (
                        <span className="text-xs text-amber-600">stale</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: workflow actions */}
        <div className="space-y-4">
          {/* Workflow state card */}
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <h3 className="text-sm font-semibold text-firm-navy mb-3">Workflow</h3>

            {/* Iterative mode actions */}
            {isIterative && (
              <div className="space-y-2">
                {doc.workflowState === 'drafting' && !doc.currentVersionId && (
                  <button
                    onClick={() => generateDraftMutation.mutate({ documentId })}
                    disabled={generateDraftMutation.isPending}
                    className="w-full px-3 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
                  >
                    {generateDraftMutation.isPending ? 'Queuing…' : 'Generate Draft'}
                  </button>
                )}
                {doc.workflowState === 'drafting' && doc.currentVersionId && (
                  <>
                    <div className="space-y-1">
                      <textarea
                        value={regenerateInstructions}
                        onChange={(e) => setRegenerateInstructions(e.target.value)}
                        rows={3}
                        placeholder="Instructions for regeneration…"
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy resize-none"
                      />
                      <button
                        onClick={() => {
                          if (regenerateInstructions.trim()) {
                            regenerateMutation.mutate({ documentId, instructions: regenerateInstructions.trim() });
                          }
                        }}
                        disabled={regenerateMutation.isPending || !regenerateInstructions.trim()}
                        className="w-full px-3 py-2 text-xs border border-firm-navy text-firm-navy rounded hover:bg-firm-navy hover:text-white disabled:opacity-50 transition-colors"
                      >
                        {regenerateMutation.isPending ? 'Queuing…' : 'Regenerate'}
                      </button>
                    </div>
                    <button
                      onClick={() => setShowReview(true)}
                      className="w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
                    >
                      Request Review
                    </button>
                    <button
                      onClick={() => acceptSubstantiveMutation.mutate({ documentId })}
                      disabled={acceptSubstantiveMutation.isPending}
                      className="w-full px-3 py-2 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Accept Substantive
                    </button>
                  </>
                )}
                {doc.workflowState === 'substantively_accepted' && (
                  <>
                    <button
                      onClick={() => reopenSubstantiveMutation.mutate({ documentId })}
                      disabled={reopenSubstantiveMutation.isPending}
                      className="w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reopen Drafting
                    </button>
                    <button
                      onClick={() => finalizeMutation.mutate({ documentId })}
                      disabled={finalizeMutation.isPending}
                      className="w-full px-3 py-2 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      Finalize
                    </button>
                  </>
                )}
                {doc.workflowState === 'finalizing' && (
                  <div className="flex items-center gap-2 text-xs text-purple-700">
                    <Clock className="w-3.5 h-3.5" />
                    Finalizing…
                  </div>
                )}
                {doc.workflowState === 'complete' && (
                  <div className="flex items-center gap-2 text-xs text-green-700">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Complete
                  </div>
                )}
                {isComplete && (
                  <button
                    onClick={() => unfinalizeMutation.mutate({ documentId })}
                    disabled={unfinalizeMutation.isPending}
                    className="w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Unfinalize
                  </button>
                )}
              </div>
            )}

            {/* Template mode actions */}
            {isTemplate && (
              <div className="space-y-2">
                {doc.workflowState === 'drafting' && (
                  <>
                    {Object.keys(doc.variableMap as Record<string, unknown> ?? {}).length === 0 ? (
                      <button
                        onClick={() => extractVariablesMutation.mutate({ documentId })}
                        disabled={extractVariablesMutation.isPending}
                        className="w-full px-3 py-2 text-xs bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
                      >
                        {extractVariablesMutation.isPending ? 'Extracting…' : 'Extract Variables'}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => populateFromMatterMutation.mutate({ documentId })}
                          disabled={populateFromMatterMutation.isPending}
                          className="w-full px-3 py-2 text-xs border border-firm-navy text-firm-navy rounded hover:bg-firm-navy hover:text-white disabled:opacity-50 transition-colors"
                        >
                          Auto-populate from Matter
                        </button>
                        <button
                          onClick={() => renderMutation.mutate({ documentId })}
                          disabled={renderMutation.isPending}
                          className="w-full px-3 py-2 text-xs bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
                        >
                          {renderMutation.isPending ? 'Rendering…' : 'Render Document'}
                        </button>
                        <button
                          onClick={() => acceptSubstantiveMutation.mutate({ documentId })}
                          disabled={acceptSubstantiveMutation.isPending}
                          className="w-full px-3 py-2 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Accept Substantive
                        </button>
                      </>
                    )}
                  </>
                )}
                {doc.workflowState === 'substantively_accepted' && (
                  <>
                    <button
                      onClick={() => reopenSubstantiveMutation.mutate({ documentId })}
                      disabled={reopenSubstantiveMutation.isPending}
                      className="w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reopen Drafting
                    </button>
                    <button
                      onClick={() => finalizeMutation.mutate({ documentId })}
                      disabled={finalizeMutation.isPending}
                      className="w-full px-3 py-2 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      Finalize
                    </button>
                  </>
                )}
                {doc.workflowState === 'complete' && (
                  <>
                    <div className="flex items-center gap-2 text-xs text-green-700">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Complete
                    </div>
                    <button
                      onClick={() => unfinalizeMutation.mutate({ documentId })}
                      disabled={unfinalizeMutation.isPending}
                      className="w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Unfinalize
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Quick info */}
          <div className="p-4 bg-white border border-gray-200 rounded-lg text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500">Official substantive v</span>
              <span className="text-gray-700">{doc.officialSubstantiveVersionNumber ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Official final v</span>
              <span className="text-gray-700">{doc.officialFinalVersionNumber ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Created</span>
              <span className="text-gray-700">{new Date(doc.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/*
            Download DOCX — Phase 6 (Ch 32)
            Visible whenever a version exists to export.
            Implemented as a plain anchor tag pointing to the REST endpoint.
            No tRPC mutation is called. No stored artifact is created.
            The server selects the version and injects the correct watermark.
          */}
          {(doc.currentVersionId ||
            doc.officialFinalVersionNumber !== null ||
            doc.officialSubstantiveVersionNumber !== null) && (
            <a
              href={`/api/documents/${documentId}/export`}
              download
              className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5" />
              Download DOCX
            </a>
          )}
        </div>
      </div>

      {/* Review pane */}
      {showReview && (
        <ReviewPane
          documentId={documentId}
          iterationNumber={(doc.officialSubstantiveVersionNumber ?? 0) + 1}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}
