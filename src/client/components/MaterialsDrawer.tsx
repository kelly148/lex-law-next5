/**
 * MaterialsDrawer — Lex Law Next v1
 *
 * Ch 27 — Materials Drawer
 *
 * Slide-in drawer for managing matter materials (uploaded files and pasted text).
 *
 * Procedures used:
 *   - materials.list (query)
 *   - materials.create (mutation) — paste text
 *   - POST /api/materials/upload (fetch) — file upload
 *   - materials.pin / materials.unpin (mutation)
 *   - materials.softDelete (mutation)
 *   - materials.restore (mutation)
 *   - materials.updateTags (mutation)
 *   - materials.updateDescription (mutation)
 *
 * Ch 35.3 — No business logic in React: all logic is server-side.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 *
 * File upload uses fetch (not tRPC) because the server exposes
 * POST /api/materials/upload as a multipart/form-data endpoint.
 * The Vite proxy forwards /api → localhost:3001.
 */
import React, { useState } from 'react';
import { X, Pin, PinOff, Trash2, RotateCcw, Upload, FileText, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import { DocumentExtractionPanel } from './DocumentExtractionPanel.js';
import MaterialsDropZone from './MaterialsDropZone.js';

interface MaterialsDrawerProps {
  matterId: string;
  matterTitle?: string | null;
  clientName?: string | null;
  onClose: () => void;
}

// ============================================================
// PasteForm — paste text content as a material
// ============================================================
interface PasteFormProps {
  matterId: string;
  onDone: () => void;
}

function PasteForm({ matterId, onDone }: PasteFormProps): React.ReactElement {
  const [textContent, setTextContent] = useState('');
  const [filename, setFilename] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const createMutation = useGuardedMutation(
    (input: { matterId: string; textContent: string; filename?: string; description?: string }) =>
      utils.client.materials.create.mutate(input),
    {
      onSuccess: () => {
        void utils.materials.list.invalidate({ matterId });
        onDone();
      },
      onError: (err) => setError(err.message),
    }
  );

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!textContent.trim()) { setError('Text content is required.'); return; }
    setError(null);
    createMutation.mutate({
      matterId,
      textContent: textContent.trim(),
      ...(filename.trim() ? { filename: filename.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-gray-50 rounded-lg">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Filename (optional)</label>
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy"
          placeholder="e.g., client-notes.txt"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Text Content <span className="text-red-500">*</span>
        </label>
        <textarea
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          rows={6}
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy resize-y"
          placeholder="Paste text content here…"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-firm-navy"
          placeholder="Brief description…"
        />
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
          Cancel
        </button>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="px-3 py-1.5 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
        >
          {createMutation.isPending ? 'Adding…' : 'Add Material'}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// MaterialCard — single material item
// ============================================================
interface MaterialCardProps {
  material: {
    id: string;
    filename: string | null;
    description: string | null;
    tags: string[];
    pinned: boolean;
    uploadSource: 'upload' | 'paste';
    extractionStatus: string;
    deletedAt: string | null;
    fileSize: number | null;
    createdAt: string;
  };
  matterId: string;
}

function MaterialCard({ material, matterId }: MaterialCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState(material.tags.join(', '));
  const [editingDesc, setEditingDesc] = useState(false);
  const [descInput, setDescInput] = useState(material.description ?? '');
  const utils = trpc.useUtils();

  const pinMutation = useGuardedMutation(
    (input: { materialId: string }) => utils.client.materials.pin.mutate(input),
    { onSuccess: () => void utils.materials.list.invalidate({ matterId }) }
  );
  const unpinMutation = useGuardedMutation(
    (input: { materialId: string }) => utils.client.materials.unpin.mutate(input),
    { onSuccess: () => void utils.materials.list.invalidate({ matterId }) }
  );
  const softDeleteMutation = useGuardedMutation(
    (input: { materialId: string }) => utils.client.materials.softDelete.mutate(input),
    { onSuccess: () => void utils.materials.list.invalidate({ matterId }) }
  );
  const restoreMutation = useGuardedMutation(
    (input: { materialId: string }) => utils.client.materials.restore.mutate(input),
    { onSuccess: () => void utils.materials.list.invalidate({ matterId }) }
  );
  const updateTagsMutation = useGuardedMutation(
    (input: { materialId: string; tags: string[] }) => utils.client.materials.updateTags.mutate(input),
    {
      onSuccess: () => {
        void utils.materials.list.invalidate({ matterId });
        setEditingTags(false);
      },
    }
  );
  const updateDescMutation = useGuardedMutation(
    (input: { materialId: string; description: string | null }) => utils.client.materials.updateDescription.mutate(input),
    {
      onSuccess: () => {
        void utils.materials.list.invalidate({ matterId });
        setEditingDesc(false);
      },
    }
  );

  const isDeleted = material.deletedAt !== null;
  const displayName = material.filename ?? `Pasted text (${new Date(material.createdAt).toLocaleDateString()})`;

  const saveTags = (): void => {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    updateTagsMutation.mutate({ materialId: material.id, tags });
  };

  const saveDesc = (): void => {
    updateDescMutation.mutate({ materialId: material.id, description: descInput.trim() || null });
  };

  return (
    <div className={clsx(
      'border border-gray-200 rounded-lg overflow-hidden',
      isDeleted && 'opacity-60',
      material.pinned && 'border-firm-gold/50'
    )}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {material.pinned && <Pin className="w-3 h-3 text-firm-gold flex-shrink-0" />}
            <span className="text-sm font-medium text-firm-navy truncate">{displayName}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400 capitalize">{material.uploadSource}</span>
            {material.fileSize && (
              <span className="text-xs text-gray-400">{(material.fileSize / 1024).toFixed(1)} KB</span>
            )}
            <span className={clsx(
              'text-xs px-1 py-0.5 rounded',
              material.extractionStatus === 'extracted' && 'bg-green-100 text-green-700',
              material.extractionStatus === 'partial' && 'bg-amber-100 text-amber-700',
              material.extractionStatus === 'failed' && 'bg-red-100 text-red-700',
              material.extractionStatus === 'not_supported' && 'bg-gray-100 text-gray-600',
              // MATERIALS-DROPZONE-1 Inc B — async OCR states
              material.extractionStatus === 'processing' && 'bg-firm-navy/10 text-firm-navy',
              material.extractionStatus === 'low_confidence' && 'bg-amber-100 text-amber-700',
            )}>
              {material.extractionStatus === 'processing'
                ? 'OCR…'
                : material.extractionStatus.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isDeleted && (
            material.pinned ? (
              <button
                onClick={() => unpinMutation.mutate({ materialId: material.id })}
                disabled={unpinMutation.isPending}
                title="Unpin"
                className="p-1 text-firm-gold hover:text-gray-400 disabled:opacity-50"
              >
                <PinOff className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => pinMutation.mutate({ materialId: material.id })}
                disabled={pinMutation.isPending}
                title="Pin"
                className="p-1 text-gray-400 hover:text-firm-gold disabled:opacity-50"
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            )
          )}
          {isDeleted ? (
            <button
              onClick={() => restoreMutation.mutate({ materialId: material.id })}
              disabled={restoreMutation.isPending}
              title="Restore"
              className="p-1 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => softDeleteMutation.mutate({ materialId: material.id })}
              disabled={softDeleteMutation.isPending}
              title="Delete"
              className="p-1 text-gray-400 hover:text-danger disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-400 hover:text-firm-navy"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 space-y-2">
          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">Description</span>
              {!isDeleted && !editingDesc && (
                <button
                  onClick={() => setEditingDesc(true)}
                  className="text-xs text-firm-navy hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={descInput}
                  onChange={(e) => setDescInput(e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
                />
                <button
                  onClick={saveDesc}
                  disabled={updateDescMutation.isPending}
                  className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingDesc(false); setDescInput(material.description ?? ''); }}
                  className="px-2 py-1 text-xs text-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500">{material.description || <em>No description</em>}</p>
            )}
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                <Tag className="w-3 h-3" /> Tags
              </span>
              {!isDeleted && !editingTags && (
                <button
                  onClick={() => setEditingTags(true)}
                  className="text-xs text-firm-navy hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
            {editingTags ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="tag1, tag2, tag3"
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-firm-navy"
                />
                <button
                  onClick={saveTags}
                  disabled={updateTagsMutation.isPending}
                  className="px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingTags(false); setTagInput(material.tags.join(', ')); }}
                  className="px-2 py-1 text-xs text-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {material.tags.length === 0 ? (
                  <span className="text-xs text-gray-400 italic">No tags</span>
                ) : (
                  material.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-firm-navy/10 text-firm-navy px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>

          {/* FOLD-PM-2 — document-type structured extraction (flag-gated; renders nothing when OFF). */}
          <DocumentExtractionPanel materialId={material.id} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// MaterialsDrawer — main export
// ============================================================
export default function MaterialsDrawer({ matterId, matterTitle, clientName, onClose }: MaterialsDrawerProps): React.ReactElement {
  const [mode, setMode] = useState<'list' | 'paste' | 'upload'>('list');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { data, isLoading } = trpc.materials.list.useQuery(
    { matterId, includeDeleted },
    {
      // MATERIALS-DROPZONE-1 Inc B — poll while any material is mid-OCR so the result lands visibly,
      // then stop (no background polling once everything has settled).
      refetchInterval: (query) =>
        (query.state.data ?? []).some((m) => m.extractionStatus === 'processing') ? 4000 : false,
    }
  );

  const materials = data ?? [];

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="w-96 bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-line bg-surface-2">
          <div className="flex items-center justify-between">
            <h2 className="text-ink font-semibold text-sm">Materials</h2>
            <button onClick={onClose} className="text-ink-secondary hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          </div>
          {(matterTitle || clientName) && (
            <div className="mt-1 border-t border-line pt-1.5">
              {matterTitle && (
                <p className="text-ink text-xs font-medium truncate">{matterTitle}</p>
              )}
              {clientName && (
                <p className="text-ink-secondary text-xs truncate">{clientName}</p>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        {mode === 'list' && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
            <button
              onClick={() => setMode('paste')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-line text-ink rounded hover:bg-surface"
            >
              <FileText className="w-3.5 h-3.5" />
              Paste Text
            </button>
            <button
              onClick={() => setMode('upload')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-line text-ink rounded hover:bg-surface"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload File
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="rounded"
              />
              Show deleted
            </label>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {mode === 'paste' && (
            <PasteForm matterId={matterId} onDone={() => setMode('list')} />
          )}
          {mode === 'upload' && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <MaterialsDropZone
                matterId={matterId}
                onUploaded={() => setMode('list')}
                onCancel={() => setMode('list')}
              />
            </div>
          )}
          {mode === 'list' && (
            <>
              {isLoading ? (
                <p className="text-center text-gray-400 text-sm py-8">Loading materials…</p>
              ) : materials.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 text-sm">No materials yet.</p>
                  <p className="text-gray-400 text-xs mt-1">Upload a file or paste text above.</p>
                </div>
              ) : (
                materials.map((m) => (
                  <MaterialCard key={m.id} material={m} matterId={matterId} />
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
