/**
 * CopilotAttachments — COPILOT-UPLOAD-1 (CHAT-COPILOT-2 A3): the ephemeral chat-attachment surface for the
 * Copilot composer. Upload a file → POST /api/chat/attachments/upload (bytes → OCR → ingestChatAttachment,
 * store-by-reference, purged at conversation end). Render each attachment as a THREE-STATE chip keyed on
 * extractionStatus (extracted / low_confidence / failed), with a "select for this turn" toggle whose ids the
 * parent threads into submitTurn (Q5: selected-for-this-turn only — a dropped attachment does not become
 * globally available unless SAVED to the matter). Actions: accept-with-warning (Q5, low_confidence only),
 * save-to-matter (Q4 retention act), pin (Q6 survive-purge). A cross-matter duplicate (Q3, 409) offers an
 * explicit override.
 *
 * Mutations use utils.client.*.mutate directly with a shared in-flight guard — the same pattern CopilotThread
 * uses for its lifecycle actions (the copilot surface does not wrap these in useGuardedMutation).
 */
import React, { useRef, useState } from 'react';
import { Paperclip, Check, AlertTriangle, XCircle, Pin } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';

interface CopilotAttachmentsProps {
  conversationId: string;
  matterId: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export default function CopilotAttachments({ conversationId, matterId, selectedIds, onToggleSelect }: CopilotAttachmentsProps): React.ReactElement {
  const utils = trpc.useUtils();
  const attachmentsQ = trpc.chatCopilot.listAttachments.useQuery({ conversationId });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingCrossMatter, setPendingCrossMatter] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = (): void => { void utils.chatCopilot.listAttachments.invalidate({ conversationId }); };

  const upload = async (file: File, allowCrossMatterDuplicate = false): Promise<void> => {
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('matterId', matterId);
    fd.append('conversationId', conversationId);
    if (allowCrossMatterDuplicate) fd.append('allowCrossMatterDuplicate', 'true');
    try {
      const res = await fetch('/api/chat/attachments/upload', { method: 'POST', body: fd });
      if (res.ok) {
        setPendingCrossMatter(null);
        refresh();
      } else if (res.status === 409) {
        // Q3 cross-matter HARD STOP → offer the explicit override.
        setPendingCrossMatter(file);
        setUploadError('This file already exists in another matter — use it here anyway?');
      } else {
        let m = `Upload failed (${res.status})`;
        try { const b = (await res.json()) as { message?: string; error?: string }; m = b.message ?? b.error ?? m; } catch { /* non-JSON */ }
        setUploadError(m);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Direct-mutate with a synchronous in-flight guard (mirrors CopilotThread's runLifecycle).
  const runAction = (fn: () => Promise<unknown>): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    void (async () => {
      try { await fn(); refresh(); }
      catch (e) { setActionError(e instanceof Error ? e.message : 'Action failed'); }
      finally { inFlight.current = false; setBusy(false); }
    })();
  };
  const acceptWithWarning = (id: string): void => runAction(() => utils.client.chatCopilot.acceptAttachmentWithWarning.mutate({ attachmentId: id }));
  const pin = (id: string, pinned: boolean): void => runAction(() => utils.client.chatCopilot.pinAttachment.mutate({ attachmentId: id, pinned }));
  const saveToMatter = (id: string): void => runAction(() => utils.client.chatCopilot.saveAttachmentToMatter.mutate({ attachmentId: id }));

  const attachments = attachmentsQ.data ?? [];

  return (
    <div data-testid="copilot-attachments" className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="copilot-attach-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs border border-line text-ink rounded hover:bg-surface disabled:opacity-50"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Attach a file'}
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
        />
        {attachments.length > 0 && (
          <span className="text-[10px] text-ink-hint">Selected attachments ground only this turn — Save to matter to keep one.</span>
        )}
      </div>

      {uploadError && (
        <p data-testid="copilot-attach-error" className="text-xs text-warning">
          {uploadError}
          {pendingCrossMatter && (
            <button type="button" data-testid="copilot-attach-override" onClick={() => void upload(pendingCrossMatter, true)} className="ml-2 underline hover:text-ink">
              Use anyway
            </button>
          )}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => {
            const status = a.extractionStatus;
            const selected = selectedIds.has(a.id);
            const tone =
              status === 'extracted' ? 'border-line bg-surface text-ink'
                : status === 'low_confidence' ? 'border-warning/40 bg-warning-tint text-warning'
                  : 'border-danger/40 bg-red-50 text-danger';
            return (
              <li key={a.id} data-testid={`copilot-attach-chip-${status}`} className={clsx('flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]', tone)}>
                <label className="flex items-center gap-1 cursor-pointer">
                  {/* failed = no text; not selectable as this-turn context (Q4). */}
                  <input
                    type="checkbox"
                    data-testid="copilot-attach-select"
                    checked={selected}
                    disabled={status === 'failed'}
                    onChange={() => onToggleSelect(a.id)}
                  />
                  {status === 'extracted' ? <Check className="w-3 h-3" /> : status === 'low_confidence' ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  <span className="truncate max-w-[9rem]" title={a.filename ?? undefined}>{a.filename ?? 'attachment'}</span>
                </label>
                {status === 'low_confidence' && (
                  <span className="text-[10px]">{a.acceptedWithWarning ? 'accepted (low confidence)' : 'text is low-confidence'}</span>
                )}
                {status === 'failed' && <span className="text-[10px]">no readable text</span>}
                {status === 'low_confidence' && !a.acceptedWithWarning && (
                  <button type="button" data-testid="copilot-attach-accept" onClick={() => acceptWithWarning(a.id)} disabled={busy} className="underline hover:text-ink disabled:opacity-50">
                    Accept anyway
                  </button>
                )}
                {status !== 'failed' && (
                  a.savedMaterialId === null ? (
                    <button type="button" data-testid="copilot-attach-save" onClick={() => saveToMatter(a.id)} disabled={busy} className="underline hover:text-ink disabled:opacity-50">
                      Save to matter
                    </button>
                  ) : (
                    <span className="text-[10px] text-ink-hint">in matter file</span>
                  )
                )}
                <button
                  type="button"
                  data-testid="copilot-attach-pin"
                  onClick={() => pin(a.id, !a.pinned)}
                  disabled={busy}
                  title={a.pinned ? 'Unpin' : 'Pin (survives purge)'}
                  className={clsx('hover:text-ink disabled:opacity-50', a.pinned && 'text-accent')}
                >
                  <Pin className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {actionError && <p data-testid="copilot-attach-action-error" className="text-xs text-warning">{actionError}</p>}
    </div>
  );
}
