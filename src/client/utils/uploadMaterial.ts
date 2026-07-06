/**
 * uploadMaterial — MATTER-DROP-1: the single client uploader for a matter material.
 *
 * Posts one file to the EXISTING `POST /api/materials/upload` multipart endpoint — the same server pipeline
 * (OCR + extraction) the drawer's Upload File and MaterialsDropZone use. No new egress, no new extraction
 * behavior; this is only a thin, reusable client wrapper so the matter-page drop and the drawer share one
 * server path. The caller invalidates `materials.list` after a batch.
 */
export interface MaterialUploadResult {
  ok: boolean;
  error?: string;
}

export async function uploadMaterialFile(
  file: File,
  matterId: string,
  description?: string,
): Promise<MaterialUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('matterId', matterId);
  if (description && description.trim()) formData.append('description', description.trim());

  try {
    const response = await fetch('/api/materials/upload', { method: 'POST', body: formData });
    if (response.ok) return { ok: true };
    let msg = `Upload failed: ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      msg = body.message ?? body.error ?? msg;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    return { ok: false, error: msg };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed.' };
  }
}
