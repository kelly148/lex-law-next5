/**
 * MaterialsDropZone — DEED-INTAKE-REDESIGN-1: the reusable drag-and-drop upload affordance.
 *
 * Extracted verbatim from MaterialsDrawer's private UploadForm so the ONE upload code path
 * (POST /api/materials/upload, multipart) is shared by every surface — the drawer (its Upload
 * mode renders this) AND the top-level DeedIntake primary affordance. No parallel upload logic.
 *
 * Two matterId modes, so the same component serves a matter that already exists AND the Quick Deed
 * lazy-matter lane (spec §4: merely viewing /deed must persist nothing):
 *   - matterId provided  -> behaves exactly as the drawer's UploadForm always has (no lazy create).
 *   - matterId absent + resolveMatterId given -> the matter is created LAZILY on the FIRST accepted
 *     file (the first real interaction), then every file uploads against the resolved id.
 *
 * Ch 35.13 — file upload uses fetch (not tRPC) because the server exposes POST /api/materials/upload
 * as a multipart endpoint; the Vite proxy forwards /api -> localhost:3001.
 */
import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';
import { isAcceptedUpload, ACCEPTED_UPLOAD_ATTR, ACCEPTED_UPLOAD_LABEL } from '../../shared/deedUploadFormats.js';

interface MaterialsDropZoneProps {
  /** The owning matter. When omitted, resolveMatterId is used to create/resolve it lazily on first file. */
  matterId?: string | undefined;
  /** Lazily resolve (creating if needed) the owning matter id — called on the FIRST accepted file when
   *  matterId is absent, and awaited before upload. Lets the Quick Deed lane defer matter creation. */
  resolveMatterId?: () => Promise<string>;
  /** Called after every queued file uploaded successfully (the drawer returns to its list; a page refetches facts). */
  onUploaded?: () => void;
  /** When provided, a Cancel button is rendered (the drawer's "return to list"); omitted for an inline primary zone. */
  onCancel?: () => void;
  /** AUTO-COMMIT (LIVE-10): upload each accepted file the MOMENT it is attached (resolving the owning matter
   *  first), so the doc-derived facts resolve WITHOUT a separate "Upload" click. The deed intake surfaces set
   *  this; the general materials drawer keeps the explicit stage-then-Upload model (default false). When on, the
   *  manual Upload button + description field are hidden (the commit happens on drop). */
  autoCommit?: boolean;
}

// Accepted upload formats come from the SHARED contract (src/shared/deedUploadFormats.ts) so the dropzone and
// the server upload endpoint cannot drift. E2 widened it: docx/txt/md/pdf + png/jpg/jpeg/tif/tiff/webp (image
// OCR). .doc/.heic are excluded (each needs a new dependency — operator-gated).
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — matches the server multer LIMIT_FILE_SIZE
const MAX_FILE_LABEL = '50 MB';

function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

// Returns a friendly reason string if the file should be rejected, or null if it is accepted.
function rejectReason(file: File): string | null {
  const typeOk = isAcceptedUpload(file.type, fileExtension(file.name));
  if (!typeOk) return `${file.name}: unsupported type — accepted: ${ACCEPTED_UPLOAD_LABEL}.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: exceeds the ${MAX_FILE_LABEL} limit.`;
  return null;
}

export default function MaterialsDropZone({
  matterId,
  resolveMatterId,
  onUploaded,
  onCancel,
  autoCommit = false,
}: MaterialsDropZoneProps): React.ReactElement {
  // Multi-file queue. Both the click-to-browse path and the drop path append into THIS
  // list, and handleUpload sends every queued file through the one /api/materials/upload
  // path — no parallel upload/extraction code (keeps MATERIALS-BACKFILL-1 / ASSESSMENT-CONTEXT-1
  // semantics consistent for dropped files).
  const [files, setFiles] = useState<File[]>([]);
  const [rejects, setRejects] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The matter resolved lazily for the matterId-absent (Quick Deed) lane; the prop wins when present.
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const resolveStartedRef = useRef(false);
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveMatterId = matterId ?? resolvedId;

  // Kick off lazy matter creation on the first real interaction (a file being accepted), once. The result is
  // stored in resolvedId for the upload; failures surface when the attorney actually uploads (handleUpload).
  const startResolveIfNeeded = (): void => {
    if (effectiveMatterId || !resolveMatterId || resolveStartedRef.current) return;
    resolveStartedRef.current = true;
    void resolveMatterId()
      .then((id) => setResolvedId(id))
      .catch(() => {
        // Allow a retry on the next interaction; the explicit error surfaces from handleUpload.
        resolveStartedRef.current = false;
      });
  };

  // Single validation + queue path shared by click-to-browse and drag-and-drop.
  const addFiles = (incoming: File[]): void => {
    const accepted: File[] = [];
    const newRejects: string[] = [];
    for (const f of incoming) {
      const reason = rejectReason(f);
      if (reason) { newRejects.push(reason); continue; }
      // Skip a file already in the queue (same name + size) so a double-drop or
      // re-browse doesn't upload the same material into the matter twice. Removing
      // it from the queue clears this guard, so re-adding after a remove still works.
      const dup = files.some((q) => q.name === f.name && q.size === f.size)
        || accepted.some((a) => a.name === f.name && a.size === f.size);
      if (dup) { newRejects.push(`${f.name}: already added.`); continue; }
      accepted.push(f);
    }
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
      setError(null);
      if (autoCommit) {
        // LIVE-10: commit the just-attached files immediately (commitFiles resolves the owning matter first), so
        // the legal/parcel/assessed/locality facts resolve WITHOUT a separate "Upload" click.
        void commitFiles(accepted);
      } else {
        // First accepted file is the FIRST real interaction — lazily start the owning matter (spec §4).
        startResolveIfNeeded();
      }
    }
    // Only overwrite the reject notices when this add produced new ones, so a later
    // clean add doesn't silently stomp a still-relevant rejection message.
    if (newRejects.length > 0) setRejects(newRejects);
  };

  const removeFile = (idx: number): void => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setRejects([]); // managing the queue is a deliberate act — clear stale reject notices
  };

  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault(); // allow the drop and stop the browser from navigating to the file
    if (!dragActive) setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault();
    // Ignore leave events fired as the cursor crosses onto a child node — only clear
    // the drag-active state when the pointer truly leaves the zone (avoids flicker).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragActive(false);
    if (uploading) return; // don't accept new files mid-upload (they'd be lost when the form closes)
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  };

  // Commit (upload) the given files to the matter — the ONE upload path, shared by the manual "Upload" button and
  // the autoCommit-on-attach flow (LIVE-8: no longer a form `onSubmit`, so no native GET reload). A function
  // DECLARATION (hoisted) so addFiles above can call it. Resolves the owning matter first; invalidates
  // materials.list + calls onUploaded on success; on partial failure keeps the failed files queued with the error.
  async function commitFiles(toUpload: File[]): Promise<void> {
    if (toUpload.length === 0) { setError('Please select or drop at least one file.'); return; }
    setError(null);
    setUploading(true);
    const succeeded = new Set<File>();
    const failures: string[] = [];
    try {
      // Resolve the owning matter (creating it lazily) if one was not provided. Surface a clean error here
      // rather than uploading against no matter.
      let uploadMatterId = effectiveMatterId;
      if (!uploadMatterId && resolveMatterId) {
        uploadMatterId = await resolveMatterId();
        setResolvedId(uploadMatterId);
      }
      if (!uploadMatterId) {
        setError('Could not start the deed record. Please try again.');
        return;
      }

      for (const f of toUpload) {
        const formData = new FormData();
        formData.append('file', f);
        formData.append('matterId', uploadMatterId);
        if (description.trim()) formData.append('description', description.trim());

        const response = await fetch('/api/materials/upload', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          succeeded.add(f);
        } else {
          let msg = `Upload failed: ${response.status}`;
          try {
            const body = await response.json() as { error?: string; message?: string };
            msg = body.message ?? body.error ?? msg;
          } catch { /* non-JSON error body — keep the status message */ }
          failures.push(`${f.name}: ${msg}`);
        }
      }

      void utils.materials.list.invalidate({ matterId: uploadMatterId });
      if (failures.length > 0) {
        // Keep the form open with only the failed files queued so a retry doesn't re-upload successes.
        setFiles((prev) => prev.filter((f) => !succeeded.has(f)));
        setError(failures.join(' '));
      } else {
        onUploaded?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div
          data-testid="materials-drop-zone"
          className={clsx(
            'border-2 border-dashed rounded p-4 text-center cursor-pointer transition-colors',
            dragActive ? 'border-firm-navy bg-firm-navy/5' : 'border-gray-300 hover:border-firm-navy',
            uploading && 'pointer-events-none opacity-60' // freeze the zone while an upload is in flight
          )}
          onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragActive ? (
            <p className="text-sm text-firm-navy font-medium">Drop files to add them</p>
          ) : files.length > 0 ? (
            <p className="text-sm text-firm-navy">
              {files.length} file{files.length > 1 ? 's' : ''} ready — click or drop to add more
            </p>
          ) : (
            <p className="text-sm text-gray-400">Drag &amp; drop files here, or click to browse</p>
          )}
          <p className="text-xs text-gray-400 mt-1">{ACCEPTED_UPLOAD_LABEL} · up to {MAX_FILE_LABEL} each</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={uploading}
          accept={ACCEPTED_UPLOAD_ATTR}
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = ''; // allow re-selecting the same file (fires change again)
          }}
        />
      </div>

      {/* Queued files (from click or drop) */}
      {files.length > 0 && (
        <ul className="space-y-1" data-testid="materials-upload-queue">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between text-sm bg-white border border-gray-200 rounded px-2 py-1"
            >
              <span className="text-firm-navy truncate">{f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                disabled={uploading}
                title="Remove"
                aria-label={`Remove ${f.name}`}
                className="ml-2 p-0.5 text-gray-400 hover:text-danger disabled:opacity-50 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Friendly reject notices for unsupported / oversized files */}
      {rejects.length > 0 && (
        <div
          data-testid="materials-upload-rejects"
          className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs space-y-0.5"
        >
          {rejects.map((r, i) => <p key={i}>{r}</p>)}
        </div>
      )}

      {/* Description + the manual Upload button are hidden in autoCommit mode — the files commit on attach. */}
      {!autoCommit && (
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
      )}
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex justify-end gap-2 items-center">
        {autoCommit && uploading && (
          <span data-testid="materials-autocommit-uploading" className="mr-auto text-xs text-firm-navy">Reading your uploads…</span>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
        )}
        {!autoCommit && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => void commitFiles(files)}
            className="px-3 py-1.5 text-sm border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
          </button>
        )}
      </div>
    </div>
  );
}
