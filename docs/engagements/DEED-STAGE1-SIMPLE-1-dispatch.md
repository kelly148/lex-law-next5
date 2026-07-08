# DEED-STAGE1-SIMPLE-1 — dispatch (paste-ready for the Claude Code CLI)

**Author:** Cowork, 2026-07-06, operator-directed. **Goal:** for Stage-1 solo use, the deed page is just "parties + facts in → draft out → Download DOCX in whatever state it's in; the attorney finalizes recordability himself." All recordability machinery goes behind ONE default-OFF flag (turn back on anytime). Prod = `main` (`398d154` + #547). Two parts; Part A is the operator's explicit ask.

**Operator decisions (2026-07-06, recorded):** (1) recordability machinery → single default-OFF flag, off Kelly's path, kept in code for the future; (2) **Gate G-A (D3/A.6 deed Trust-Protocol) is DROPPED** as the Phase-1 gate — do not plan around it.

---

## PART A — `DEED-RECORDABILITY-FLAG-1` (the explicit ask; reversible build-and-PR)

**Add one flag `DEED_RECORDABILITY_ENABLED` (default OFF)** in `src/server/config/featureFlags.ts` (mirror the `isDeedGateEnabled` accessor pattern → `isDeedRecordabilityEnabled()`). It gates the DISPLAY of the recordability machinery and the export block, together, as one switch.

**When OFF (default — Kelly's Stage-1 state):**
- `src/client/pages/DocumentDetail.tsx` does NOT mount the deed recordability drawer or its status line — i.e., do not render `DeedGatePanel.tsx` ("Deed recordability" three-gate + "Record the attorney's affirmative acts"), `DeedSignoffPanel.tsx` (D3 sign-off), or the `DeedStatusStrip.tsx` "Recording checklist: N open · Source sign-off" line (mount points around DocumentDetail.tsx:575 and :1504). The deed page renders **document-first**: the drafted instrument + the action row (Download DOCX / Request Review / etc.), nothing else below.
- **Export never blocks on recordability.** In the export route `src/server/index.ts` (~L745–L809), when `!isDeedRecordabilityEnabled()`, skip the D3 block entirely — the `d3Mode === 'enforce'` → `D3_SIGNOFF_REQUIRED` 409 must not fire, and the observe-mode telemetry block may be skipped too. (D3 is already `observe` in prod, so this is belt-and-suspenders, but wire it to the flag so the two move together.) The LIVE-9 `DEED_EXPORT_BLOCKED` sanctioned-deed guard STAYS regardless of this flag (it is not recordability supervision — it prevents non-agent deed text from exporting; leave it intact).

**When ON:** current behavior exactly — the recordability drawer renders and the D3 export gate applies. Flag-ON path = today's tests pass unmodified.

**Acceptance (Part A):**
- Flag OFF: a generated deed's document page shows the instrument + Download DOCX and NONE of the recordability drawer/strip (render test); Download DOCX returns the current draft (200, valid .docx) with no recordability/D3 block; existing deed generation still works.
- Flag ON: byte-for-byte current behavior; existing deed-gate / D3 / DeedSignoffPanel render + behavior tests pass UNMODIFIED.
- CI green (tsc + vitest + eslint).

**FIRE triage (Part A): `Checkpoint triage: skip`** — additive default-OFF flag, fully reversible by flipping it; it does not delete the recordability code or change LIVE-9. It DOES change Kelly's Stage-1 deed export to skip the D3 recordability check (operator-directed, Stage-1 personal use, not client-facing, reversible via the flag). Reversible build-and-PR: self-approve scope (Rule 8), auto-merge on green CI (Rule 15). Note the safety-posture change plainly in the close-out.

## PART B — `DEED-MANUAL-LEGAL-DESC-1` (fixes the "incomplete deed"; §3.1 triage required)

**Problem:** the legal description is only ever read verbatim from an uploaded prior deed (LIVE-9 — the system never writes it). When the upload OCRs below the confidence floor (a scanned prior deed), the description is withheld and the draft carries a `[[ Legal description (VERBATIM) ]]` placeholder with no way to supply it in-app — so the deed comes out incomplete even after the parties are typed.

**Change:** add an optional **"Legal description (paste verbatim from the source)"** text field to the deed intake (`QuickDeedPage` / the matter-side deed intake). When the attorney pastes text there, it flows into the draft as the legal description exactly as entered. This is the **attorney supplying verbatim source text by hand** — the same trust model as the upload path (verbatim, attorney-responsible), NOT the system authoring it.

**§3.1 triage (Part B): the CLI must run this before implementing.** It is deed-instrument-adjacent and touches the LIVE-9 boundary (legal-description provenance on a recordable instrument). My read: it does NOT cross LIVE-9 (attorney manual verbatim entry ≠ system-authored, and it mirrors the existing verbatim-from-upload path), so it likely does NOT fire — but confirm against LIVE-9 / NC-C1-1 and the deed-agent's verbatim-only invariant. If it fires, assemble the packet + halt for triad review. Label the pasted description's provenance as attorney-entered (distinct from OCR-extracted) so its origin is auditable. Acceptance: a deed with a pasted legal description and typed parties renders complete (no placeholder); with nothing pasted and no upload, the placeholder behavior is unchanged.

## Baseline + branch

7-command baseline first. `main` = the merged CI-green commit (`398d154` + #547 area — verify at run time). Part A and Part B are separate PRs. Close-outs state which manual carry each eliminates (Part A: eliminates the recordability round-trip Kelly doesn't want; Part B: eliminates re-typing the legal description into Word after download).

**Paste-to-start:** `Execute docs/engagements/DEED-STAGE1-SIMPLE-1-dispatch.md. Do Part A first (report repo state, §6 triage = skip, build the DEED_RECORDABILITY_ENABLED flag per Part A, land it). Then run the §3.1 triage on Part B and proceed per its disposition.`

---

*Cowork dispatch. The CLI is the sole builder. Part A is reversible build-and-PR; Part B is gated on its own §3.1 triage.*
