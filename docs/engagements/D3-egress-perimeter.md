# D3-SIGNOFF — egress perimeter enumeration (NC-D3-2)

**A.1, per NC-D3-2:** before ENFORCE, audit every path assembled deed content can leave the system, and gate or
record each. One gated route with ungated siblings is theater. This enumerates the paths as of `origin/main`
`2cc7ecc`; **it must be re-verified before the ENFORCE flip.**

## Paths assembled deed content can leave the system

| # | Path | Where | D3 posture |
|---|---|---|---|
| 1 | **DOCX export / download** | `GET /api/documents/:id/export` (`src/server/index.ts`) | **THE gated route.** Inc 3 wires the OBSERVE comparison here; ENFORCE (later increment + operator flip) hard-blocks here until a valid sign-off exists. This is the primary recordable-instrument egress. |
| 2 | **On-screen render** | `DocumentCanvas` on `DocumentDetail` renders the deed in-browser | **Un-gatable at the server.** The attorney reads the deed on screen; **on-screen copy-paste is the named un-gatable residual** (NC-D3-2). The sign-off + not-OCR-only attestation is the human control here, not a gate. |
| 3 | **Browser print / "print to PDF"** | client-side browser print of the rendered page | **Un-gatable at the server** (OS/browser print). Same residual class as #2. |
| 4 | **Provider egress (reviewer / copilot)** | a deed document's content sent to a reviewer (`reviewSession`) or the copilot goes to model providers via the single audited egress broker | **Separately gated + audited** by the egress control plane (`egressClient` / `auditedEgress`; every send writes an `egress_events` row; a broker bypass fails the build). Not a client-facing *delivery* of the instrument, but IS an egress of its content — recorded, not D3-gated. |
| 5 | **Bulk / matter export** | none found on `origin/main` (no bulk-deed export endpoint) | N/A today. **If a bulk export is ever added, it MUST route through the D3 gate** (or it becomes an ungated sibling). Recorded as a standing constraint. |

## The named un-gatable residual

**On-screen copy-paste (and browser print) of the rendered deed cannot be gated server-side.** This is stated
explicitly (NC-D3-2): the D3 gate reduces — it does not eliminate — the ways a deed leaves. The compensating
control for the residual is the attorney's own sign-off + the not-OCR-only / vs-original attestation (NC-D3-1),
and the fact that the deed is a DRAFT (watermarked NON-FINAL) until finalized.

## Standing constraint (for future work)

Any new path that emits assembled deed content — a new export format, a share/deliver action, a bulk export, a
new render surface — must either route through the D3 export gate or record its egress, before it ships. Add
the check to this doc when a new path is introduced.
