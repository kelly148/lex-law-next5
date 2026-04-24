/**
 * TemplatesPage — Lex Law Next v1
 *
 * Ch 28 — Template Management UI
 *
 * Displays all templates with version management.
 * Supports uploading new templates, activating versions, archiving/unarchiving.
 *
 * Procedures used:
 *   - template.list (query)
 *   - template.get (query)
 *   - template.upload (mutation) — base64 encoded file
 *   - template.activate (mutation)
 *   - template.archive (mutation)
 *   - template.unarchive (mutation)
 *   - template.confirmSchema (mutation)
 *
 * Ch 35.3 — No business logic in React: all logic is server-side.
 * Ch 35.13 — Every mutation uses useGuardedMutation.
 */
import React, { useState, useRef } from 'react';
import { Plus, Archive, ArchiveRestore, ChevronDown, ChevronUp, CheckCircle, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

// ============================================================
// UploadTemplateForm
// ============================================================
interface UploadTemplateFormProps {
  onClose: () => void;
  onUploaded: () => void;
}

function UploadTemplateForm({ onClose, onUploaded }: UploadTemplateFormProps): React.ReactElement {
  const [name, setName] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const uploadMutation = useGuardedMutation(
    (input: { name: string; documentType: string; fileBase64: string }) =>
      utils.client.template.upload.mutate(input),
    {
      onSuccess: () => {
        void utils.template.list.invalidate();
        onUploaded();
      },
      onError: (err) => setError(err.message),
    }
  );

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!documentType.trim()) { setError('Document type is required.'); return; }
    if (!file) { setError('Please select a file.'); return; }
    setError(null);

    // Read file as base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      if (!base64) { setError('Failed to read file.'); return; }
      uploadMutation.mutate({ name: name.trim(), documentType: documentType.trim(), fileBase64: base64 });
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-firm-navy mb-4">Upload Template</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g., Standard Engagement Letter"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Document Type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g., engagement_letter"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template File (.docx) <span className="text-red-500">*</span>
            </label>
            <div
              className="border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer hover:border-firm-navy transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <p className="text-sm text-firm-navy">{file.name}</p>
              ) : (
                <p className="text-sm text-gray-400">Click to select a .docx file</p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploadMutation.isPending}
              className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// TemplateVersionRow
// ============================================================
interface TemplateVersionRowProps {
  version: {
    id: string;
    versionNumber: number;
    validationStatus: string;
    createdAt: string;
  };
  templateId: string;
  isActive: boolean;
  onRefresh: () => void;
}

function TemplateVersionRow({ version, templateId, isActive, onRefresh }: TemplateVersionRowProps): React.ReactElement {
  const utils = trpc.useUtils();

  const activateMutation = useGuardedMutation(
    (input: { templateId: string; versionId: string }) => utils.client.template.activate.mutate(input),
    {
      onSuccess: () => {
        void utils.template.list.invalidate();
        void utils.template.get.invalidate({ templateId });
        onRefresh();
      },
    }
  );


  return (
    <div className={clsx(
      'flex items-center gap-3 px-3 py-2 text-sm',
      isActive && 'bg-green-50'
    )}>
      <span className="text-gray-500 w-16">v{version.versionNumber}</span>
      <span className={clsx(
        'text-xs px-1.5 py-0.5 rounded',
        version.validationStatus === 'valid' && 'bg-green-100 text-green-700',
        version.validationStatus === 'invalid' && 'bg-red-100 text-red-700',
        version.validationStatus === 'pending' && 'bg-gray-100 text-gray-600',
      )}>
        {version.validationStatus}
      </span>
      {isActive && (
        <span className="flex items-center gap-1 text-xs text-green-700">
          <CheckCircle className="w-3 h-3" /> Active
        </span>
      )}
      {version.validationStatus === 'valid' && !isActive && (
        <button
          onClick={() => activateMutation.mutate({ templateId, versionId: version.id })}
          disabled={activateMutation.isPending}
          className="text-xs text-firm-navy hover:underline disabled:opacity-50"
        >
          Activate
        </button>
      )}
      <span className="ml-auto text-xs text-gray-400">
        {new Date(version.createdAt).toLocaleDateString()}
      </span>
    </div>
  );
}

// ============================================================
// TemplateRow
// ============================================================
interface TemplateRowProps {
  template: {
    id: string;
    name: string;
    documentType: string;
    activeVersionId: string | null;
    archivedAt: string | null;
    createdAt: string;
  };
}

function TemplateRow({ template }: TemplateRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();

  const { data: detail, refetch } = trpc.template.get.useQuery(
    { templateId: template.id },
    { enabled: expanded }
  );

  const archiveMutation = useGuardedMutation(
    (input: { templateId: string }) => utils.client.template.archive.mutate(input),
    { onSuccess: () => void utils.template.list.invalidate() }
  );

  const unarchiveMutation = useGuardedMutation(
    (input: { templateId: string }) => utils.client.template.unarchive.mutate(input),
    { onSuccess: () => void utils.template.list.invalidate() }
  );

  const isArchived = template.archivedAt !== null;

  return (
    <div className={clsx('border border-gray-200 rounded-lg overflow-hidden', isArchived && 'opacity-60')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-firm-navy text-sm">{template.name}</span>
            {isArchived && (
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Archived</span>
            )}
            {template.activeVersionId && (
              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Active
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400">{template.documentType}</span>
        </div>
        <div className="flex items-center gap-1">
          {isArchived ? (
            <button
              onClick={() => unarchiveMutation.mutate({ templateId: template.id })}
              disabled={unarchiveMutation.isPending}
              title="Unarchive"
              className="p-1.5 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <ArchiveRestore className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => archiveMutation.mutate({ templateId: template.id })}
              disabled={archiveMutation.isPending}
              title="Archive"
              className="p-1.5 text-gray-400 hover:text-firm-navy disabled:opacity-50"
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-gray-400 hover:text-firm-navy"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Versions */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50">
          {!detail ? (
            <p className="px-4 py-3 text-xs text-gray-400">Loading versions…</p>
          ) : detail.versions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">No versions yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {detail.versions.map((v) => (
                <TemplateVersionRow
                  key={v.id}
                  version={v}
                  templateId={template.id}
                  isActive={v.id === detail.activeVersionId}
                  onRefresh={() => void refetch()}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// TemplatesPage — main export
// ============================================================
export default function TemplatesPage(): React.ReactElement {
  const [showUpload, setShowUpload] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data, isLoading } = trpc.template.list.useQuery(
    includeArchived ? { includeArchived: true } : {}
  );

  const templates = data?.templates ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-garamond font-semibold text-firm-navy">Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {templates.length} template{templates.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 bg-firm-navy text-white text-sm rounded hover:bg-opacity-90"
          >
            <Plus className="w-4 h-4" />
            Upload Template
          </button>
        </div>
      </div>

      {/* Template list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No templates yet.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="text-firm-navy text-sm underline mt-2"
          >
            Upload your first template
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} />
          ))}
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadTemplateForm
          onClose={() => setShowUpload(false)}
          onUploaded={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
