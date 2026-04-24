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
import React, { useState, useRef } from 'react';
import { X, Pin, PinOff, Trash2, RotateCcw, Upload, FileText, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface MaterialsDrawerProps {
  matterId: string;
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
          className="px-3 py-1.5 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Adding…' : 'Add Material'}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// UploadForm — upload a file via POST /api/materials/upload
// ============================================================
interface UploadFormProps {
  matterId: string;
  onDone: () => void;
}

function UploadForm({ matterId, onDone }: UploadFormProps): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file) { setError('Please select a file.'); return; }
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('matterId', matterId);
      if (description.trim()) formData.append('description', description.trim());

      const response = await fetch('/api/materials/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? `Upload failed: ${response.status}`);
      }

      void utils.materials.list.invalidate({ matterId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleUpload(e)} className="space-y-3 p-4 bg-gray-50 rounded-lg">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          File <span className="text-red-500">*</span>
        </label>
        <div
          className="border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer hover:border-firm-navy transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <p className="text-sm text-firm-navy">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
          ) : (
            <p className="text-sm text-gray-400">Click to select a file</p>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
          disabled={uploading}
          className="px-3 py-1.5 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload'}
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
            )}>
              {material.extractionStatus.replace(/_/g, ' ')}
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
              className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
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
                  className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
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
                  className="px-2 py-1 text-xs bg-firm-navy text-white rounded disabled:opacity-50"
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
        </div>
      )}
    </div>
  );
}

// ============================================================
// MaterialsDrawer — main export
// ============================================================
export default function MaterialsDrawer({ matterId, onClose }: MaterialsDrawerProps): React.ReactElement {
  const [mode, setMode] = useState<'list' | 'paste' | 'upload'>('list');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { data, isLoading } = trpc.materials.list.useQuery(
    { matterId, includeDeleted },
    { refetchInterval: false }
  );

  const materials = data ?? [];

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="w-96 bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-firm-navy">
          <h2 className="text-white font-semibold text-sm">Materials</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action bar */}
        {mode === 'list' && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
            <button
              onClick={() => setMode('paste')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-firm-navy text-white rounded hover:bg-opacity-90"
            >
              <FileText className="w-3.5 h-3.5" />
              Paste Text
            </button>
            <button
              onClick={() => setMode('upload')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
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
            <UploadForm matterId={matterId} onDone={() => setMode('list')} />
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
