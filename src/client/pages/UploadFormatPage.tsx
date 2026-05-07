/**
 * UploadFormatPage — MR-UPLOAD-FORMAT-1 / MR-UPLOAD-FORMAT-2 / MR-UPLOAD-FORMAT-3
 *
 * Upload & Format Existing Document workflow.
 *
 * Allows users to upload an existing .docx, .txt, or .md file and apply
 * the Satterwhite formatting pass directly, returning a formatted DOCX download.
 *
 * No Generate, Review, Regenerate, or Finalize required.
 * No DB persistence. No LLM calls.
 *
 * Supported input:
 *   .docx — DOCX extraction via mammoth (server-side)
 *   .txt  — plain text
 *   .md   — Markdown
 *
 * PDF: not supported. Clear error shown.
 *
 * Upload methods:
 *   - Local file picker (click to browse)
 *   - Drag-and-drop drop zone
 *   - Pasted text / Markdown input
 *
 * Document profiles (MR-UPLOAD-FORMAT-3):
 *   general — Legal Instrument / General Legal Document (default; preserves POA/instrument behavior)
 *   letter  — Letter / Engagement Letter (correspondence-style formatting)
 *
 * Server endpoint: POST /api/upload-format (multipart/form-data, fields 'file' and 'profile')
 * or POST /api/upload-format with text body via synthetic File.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

const ACCEPTED_EXTENSIONS = ['.docx', '.txt', '.md'];
const ACCEPTED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Valid document profile values. */
export type DocumentProfile = 'general' | 'letter';

const PROFILE_OPTIONS: { value: DocumentProfile; label: string }[] = [
  { value: 'general', label: 'Legal Instrument / General' },
  { value: 'letter', label: 'Letter / Engagement Letter' },
];

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const mimeOk = ACCEPTED_MIME_TYPES.includes(file.type) || file.type === '';
  return extOk || mimeOk;
}

export default function UploadFormatPage(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [usePaste, setUsePaste] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successFilename, setSuccessFilename] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [profile, setProfile] = useState<DocumentProfile>('general');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearState = (): void => {
    setError(null);
    setSuccessFilename(null);
  };

  const handleFileSelect = (selected: File): void => {
    clearState();
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setError('File exceeds the 50 MB limit.');
      return;
    }
    if (!isAcceptedFile(selected)) {
      const ext = selected.name.includes('.')
        ? selected.name.slice(selected.name.lastIndexOf('.')).toLowerCase()
        : selected.type || 'unknown';
      setError(
        `Unsupported file type '${ext}'. Supported: .docx, .txt, .md. PDF is not supported — please convert to .docx or paste text.`
      );
      return;
    }
    setFile(selected);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = e.target.files?.[0];
    if (selected) handleFileSelect(selected);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (): void => {
    setDragOver(false);
  };

  const handleFormat = async (): Promise<void> => {
    clearState();

    let uploadFile: File;

    if (usePaste) {
      if (!pastedText.trim()) {
        setError('Please enter or paste text before formatting.');
        return;
      }
      uploadFile = new File([pastedText], 'pasted-document.md', { type: 'text/markdown' });
    } else {
      if (!file) {
        setError('Please select a file before formatting.');
        return;
      }
      uploadFile = file;
    }

    setFormatting(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('profile', profile);

      const response = await fetch('/api/upload-format', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errMsg = `Formatting failed (HTTP ${response.status})`;
        try {
          const body = await response.json() as { error?: string; message?: string };
          errMsg = body.message ?? body.error ?? errMsg;
        } catch {
          // ignore JSON parse failure
        }
        setError(errMsg);
        return;
      }

      // Trigger browser download
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition') ?? '';
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition);
      const downloadName = filenameMatch?.[1] ?? 'formatted-document.docx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessFilename(downloadName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setFormatting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-garamond font-semibold text-firm-navy">Upload &amp; Format</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload an existing document and apply Satterwhite firm-standard formatting. Returns a
          formatted .docx file. Supported: .docx, .txt, .md. No review or generation required.
        </p>
      </div>

      {/* Document type / profile selector */}
      <div className="mb-5" data-testid="upload-profile-selector">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Document Type
        </label>
        <div className="flex gap-4">
          {PROFILE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="documentProfile"
                value={opt.value}
                checked={profile === opt.value}
                onChange={() => setProfile(opt.value)}
                className="accent-firm-navy"
                data-testid={`upload-profile-${opt.value}`}
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Input mode toggle */}
      <div className="flex gap-3 mb-5">
        <button
          type="button"
          onClick={() => {
            if (!usePaste) {
              // Already in upload mode — open the file picker directly
              fileInputRef.current?.click();
            } else {
              setUsePaste(false);
              clearState();
            }
          }}
          className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
            !usePaste
              ? 'bg-firm-navy text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          data-testid="upload-mode-button"
        >
          Upload File
        </button>
        <button
          type="button"
          onClick={() => { setUsePaste(true); clearState(); }}
          className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
            usePaste
              ? 'bg-firm-navy text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Paste Text / Markdown
        </button>
      </div>

      {!usePaste ? (
        /* ── File upload mode ── */
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-firm-navy bg-firm-navy/5'
                : 'border-gray-300 hover:border-firm-navy hover:bg-gray-50'
            }`}
            data-testid="upload-drop-zone"
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-firm-navy">{file.name}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {(file.size / 1024).toFixed(1)} KB — click or drag to replace
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Drag &amp; drop a document here, or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Accepted: .docx, .txt, .md — up to 50 MB. PDF is not supported.
                </p>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="hidden"
            data-testid="upload-file-input"
            onChange={handleInputChange}
          />
        </div>
      ) : (
        /* ── Paste text mode ── */
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Paste text or Markdown
          </label>
          <textarea
            value={pastedText}
            onChange={(e) => { setPastedText(e.target.value); clearState(); }}
            rows={12}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-firm-navy resize-y"
            placeholder="Paste document text or Markdown here…"
            data-testid="upload-paste-input"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700" data-testid="upload-error">
          {error}
        </div>
      )}

      {/* Success */}
      {successFilename && !error && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700" data-testid="upload-success">
          Download started: <strong>{successFilename}</strong>
        </div>
      )}

      {/* Format button */}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => void handleFormat()}
          disabled={formatting || (!usePaste && !file) || (usePaste && !pastedText.trim())}
          className="px-5 py-2.5 bg-firm-navy text-white text-sm font-medium rounded hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="upload-format-button"
        >
          {formatting ? 'Formatting document…' : 'Format Document'}
        </button>
        {formatting && (
          <p className="text-xs text-gray-400 mt-2" data-testid="upload-pending-state">
            Applying Satterwhite formatting…
          </p>
        )}
      </div>

      {/* Supported types note */}
      <div className="mt-6 text-xs text-gray-400 border-t pt-4">
        <p>
          <strong>Supported formats:</strong> .docx (Word), .txt (plain text), .md (Markdown).
        </p>
        <p className="mt-1">
          <strong>PDF:</strong> Not supported in this version. Convert to .docx or paste text.
        </p>
        <p className="mt-1">
          Substantive content is preserved. No AI rewriting or review is applied.
        </p>
      </div>
    </div>
  );
}
