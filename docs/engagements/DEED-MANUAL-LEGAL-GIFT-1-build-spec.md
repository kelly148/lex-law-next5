# DEED-MANUAL-LEGAL-GIFT-1 — build spec (OVERNIGHT-2026-07-07 item 3, CARRIED)

**Status: CARRIED, not built this batch.** Skip-if-risky: this is a records/send-safety build across client + server + the gift assembler with a likely audit-log migration (G12) — building it correctly to all 12 conditions warrants a focused session, not the tail of a long batch. This spec makes the morning build fast and faithful. **Governing conditions:** `docs/reviews/DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07.md` (G1–G12 + N1 + N2-ADOPTED). Operator checkpoint: **approve-with-conditions**, given 2026-07-07. No softening of **G3** (affirmation + subject-property cross-check) or **G10** (Express protected-span lock — the model-never-authors red line).

## Current state (verified)
- Non-gift off-ramp `DEED-MANUAL-LEGAL-DESC-1-NONGIFT` MERGED (PR #549, `9b228c7`): the six non-gift lanes accept a pasted `legalDescription` via the existing server `firstNonEmpty(input.legalDescription, factLegal)`. Client-only, fenced out of gift.
- **N1 finding (verification of #549 vs. the non-gift conditions):** #549 satisfies flow-through + no-placeholder + honest-ish label + doc-provenance-latch-untouched. It does **NOT** satisfy: **field-level `attorney_entered` provenance** (there is no provenance concept — the server just uses the string) or **its provenance tests**, and it has **no affirmation** (N2). So N1 + N2 are a required delta on the non-gift lanes too.

## Likely PR disposition
Introduces field-level provenance + an audit log (G4/G12) → almost certainly a **new migration (audit/provenance table or column)** → **protected surface → HOLD PR** (never auto-merge; `operator approve accept:`). If the audit can ride an existing table with no migration, re-triage; default assumption is HOLD.

---

## Server (`src/server/deed/deedGiftAssembler.ts`, `src/server/procedures/deedDraftAgent.ts`)

- **G2 (explicit gift branch):** add `legalDescription?: string` + `legalDescriptionAffirmation?: {...}` to `GiftDeedInput` and a **separately-tested** gift wire-through in `assembleGiftDeed` — do NOT reuse the shared non-gift path. Today `assembleGiftDeed` reads the legal ONLY from `facts.legalDescription`; add: if a **valid affirmed** `input.legalDescription` exists, use it verbatim in place of the withheld/absent extracted legal.
- **G3 (affirmation, non-negotiable):** the pasted legal is used ONLY when the attorney's per-instance affirmation is present, combining: (a) verbatim-from-identified-source, (b) personal responsibility for accuracy, (c) **subject-property cross-check** ("this legal describes the property conveyed by THIS deed"). No affirmation → paste ignored, `[[ ]]` placeholder stays. Non-pre-checked; timestamped; logged.
- **G8 (no model editing):** the pasted text flows through **byte-for-byte** — no normalization/cleanup of calls, metes-and-bounds, lot/block, subdivision, or tax-map refs.
- **G4 (field-level provenance):** record `legalDescriptionProvenance: 'attorney_entered' | 'ocr_extracted'`, timestamped/auditable. **Document-level provenance stays `agent_assembled`** — assert in code that the paste does NOT mutate the LIVE-9 latch (`isSanctionedAgentDeed` in `deedDocTypeGuard.ts` must still return true).
- **G5 (source capture):** record the cited source (instrument + book/page or recording ref) OR an explicit "no recorded source" affirmation; where an upload OCR'd below floor, associate the paste with that upload as "attorney-entered from uploaded source."
- **G12 (audit log):** paste + affirmation events captured immutably (who/what/basis/timestamp). This is the migration-bearing piece — additive table/column; apply-before-flip; NOT on the destructive path.

## Export route (`src/server/index.ts`) + D3
- **G7 (D3 branching):** an attorney-entered legal renders D3 as "attorney-supplied verbatim — no extracted source available for automated comparison; attorney has affirmed accuracy," requires explicit acknowledgment, **never reports a false comparison**, and does not auto-block export solely for the missing extraction. (Advisory fuzzy-compare vs. a below-floor extraction: optional, not a gate.) Note: D3 is already flag-gated by `DEED_RECORDABILITY_ENABLED` (Part A) — branch within the recordability-on path.
- **G9 (export warning):** conspicuous warning on export of an attorney-entered-legal deed ("not machine-compared to extracted source facts — confirm against the source instrument before execution or recording"). Default NON-BLOCKING (R1).

## Client (`src/client/components/DeedIntake.tsx`, gift lane)
- Add the paste field to the **gift** intake (today it deliberately has none). **G6 (B6 posture):** an affirmed+sourced paste clears the `[[ ]]` placeholder but moves the draft to a DISTINCT state — "attorney-entered legal, attorney verification required" — with a **persistent visible banner**; resolution logged as attorney-entry, never silent. Unaffirmed paste clears nothing.
- **G10 (Express protected-span lock, non-skippable):** register the attorney-entered legal as a **protected/locked span** — no Express revise/regenerate pass (`AUTO_REVIEW_LOOP` locus gate) may touch it. This keeps the model-never-authors red line intact.
- **G11 (honest UI copy):** update the "never typed… never written by the system" promise to describe the dual path truthfully (extraction-only OR attorney-verbatim; the system still never authors).

## N2 (ADOPTED) — uniform affirmation across all lanes
Apply the **same** G3 affirmation component + G6 banner + G9 warning to the **non-gift** lanes too (seller/TOD/confirmation/LLC/trust), not just gift. Build ONE shared affirmation component and reuse it. Backfill the N1 delta on #549's non-gift paste fields: field-level `attorney_entered` provenance + provenance tests.

## FIRE §7 spine doc (G1)
Record G1 in the `deedGiftAssembler.ts` header (the FIRE §7 spine) as the operator's **express re-ratification exception** to the extraction-only invariant, citing `docs/reviews/DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07.md`. (This is the one edit that changes the ratified-invariant comment — do it as part of the build, under the recorded exception.)

## G12 test grid (union — the acceptance)
no-paste/no-upload → placeholder unchanged; paste **without** affirmation → not used; **affirmed** paste → complete draft, no placeholder; field provenance `attorney_entered`; **doc** provenance `agent_assembled` (LIVE-9 sanction intact); D3 honest (no false comparison); Express protected-span lock holds under a revise pass; audit log captures paste + affirmation events; the non-gift lanes carry the same provenance + affirmation (N1/N2).

## Flag
All flag-dark behind `DEED_DRAFT_AGENT_ENABLED` (default OFF). Not client-facing until FOLD-L0-1 live-verified.

*Carried under skip-if-risky. Reversible build-and-PR; HOLD PR expected (migration). Execute against the disposition + this spec.*
