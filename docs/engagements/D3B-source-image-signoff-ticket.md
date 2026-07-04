# D3B — source-image retention + image-side sign-off verification (follow-on ticket)

**Opened:** 2026-07-03, per the D3-SIGNOFF triad disposition (OQ1: ship Fork A now; Fork B = this ticket).
**Status:** OPEN, not scheduled. **Depends on:** D3 (A.1) shipping first; additive — **no rework of the A.1 gate
when this lands.**

## Why this exists

The D3 A.1 sign-off (Fork A) compares the assembled deed against the **extracted source TEXT / consolidated
facts** — honestly labeled as such (NC-D3-1). It **cannot** catch an extraction-vs-true-instrument error (an OCR
error appears identically on both sides). The residual control against that class is the attorney's own
comparison against the **original document**, currently an attestation. D3B closes that residual structurally by
retaining and displaying the **actual source-document image** beside the draft.

## Scope (Fork B)

1. **Blob storage for source materials.** Today `matter_materials.storageKey` is a **placeholder**; no blob bytes
   are persisted (only extracted text). D3B introduces real blob retention for uploaded source instruments
   (image / scanned PDF), retrievable at finalize/export.
2. **Image-side verification UI.** Render the source-document image beside the assembled deed at sign-off, so the
   attorney's comparison is against the true instrument, not only the extracted text.
3. **Records-management + confidentiality.** Retention policy for the stored images (RPC 1.6 / GLBA); access
   controls (owner-scoped; where the blobs live enters `WHERE_CLIENT_DATA_LIVES.md`); PII posture; deletion on
   matter purge (the `purgeMatter` cascade must cover the blobs).

## Guardrails (unchanged from D3)

- **NC-1 holds:** the image is for human comparison; no operative string is ever model-composed or auto-copied
  from the image into the instrument.
- **Additive:** D3B extends the A.1 sign-off record + UI; it does not change the deterministic comparator or the
  three-tier block structure. When D3B lands, the A.1 gate is unchanged; the image prong is added alongside.
- **FIRE re-flag:** blob storage of client instruments is a new records-management + confidentiality decision —
  D3B is a §3.1 FIRE in its own right (new load-bearing storage/retention decision the D3 review did not cover).
