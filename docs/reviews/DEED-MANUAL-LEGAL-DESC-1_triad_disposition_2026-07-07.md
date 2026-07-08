# DEED-MANUAL-LEGAL-DESC-1 — consolidated external triad disposition (2026-07-07)

**Process:** packet `…\phase2\reviews\DEED-MANUAL-LEGAL-DESC-1_packet.md` (self-contained, Part 3 prompt) was run by the OPERATOR HIMSELF against three external reviewers, returned to Cowork verbatim this date. Reviewer identity labels below are by order of return (R1/R2 unlabeled in the returns; R3 self-identified "Independent Claude"). Verbatim returns preserved in the operator's message of record; this file is the consolidation.

## Verdicts

| Leg | Verdict | Gift/Express | Seller/TOD/Confirmation |
|---|---|---|---|
| R1 | Approve-with-conditions | GO only as **expressly re-ratified exception** + 10 conditions | GO (parity; 5 conditions) |
| R2 | Approve-with-conditions | **NO-GO as scoped**; gift later only as separate re-ratified decision + full guardrails | GO (conditions 2–10) |
| R3 (Independent Claude) | Approve-with-conditions | GO with conditions (a)–(f) incl. the Express protected-span lock | GO unconditional |

**Convergence:** 3/3 approve the engagement; 3/3 GO on the non-gift archetypes (already merged as #549); 3/3 agree the gift path is the load-bearing part and CANNOT ride the parent silently. **Divergence:** R2 would exclude gift now; R1/R3 admit it behind express re-ratification + guardrails. R2 itself concedes gift is acceptable later as "a separate load-bearing decision requiring explicit operator re-ratification... plus the full guardrail set" — which is exactly what an operator ruling adopting this disposition constitutes. So the divergence is curable by the ruling itself, not a true deadlock.

**Framing note for the record (R3):** the model-never-authors red line is NOT in play if condition G10 (Express span lock) holds; the change is honestly characterized as "extends attorney-as-source to a fourth archetype," while the internal re-triage's "overturns a ratified invariant" framing correctly captures that the gift path's stronger posture (source-anchoring, honesty floor, B6 fail-close, UI promise) was deliberate and requires express exception. Both framings are preserved here; the operator's re-ratification resolves the tension.

---

## CONSOLIDATED CONDITIONS — GIFT/EXPRESS PATH (union of R1 c.1–10, R2 guardrails, R3 a–f)

- **G1 — Express re-ratification.** This ruling is recorded as an operator-approved EXCEPTION to the gift-path extraction-only invariant; FIRE §7 spine documentation updated with the carve-out and a decision-record cite. (R1-1, R2-10)
- **G2 — Explicit gift-path code branch.** No accidental shared-component exposure; the gift wire-through is a deliberate, separately-tested branch. (R1-1)
- **G3 — Mandatory per-instance affirmation, non-pre-checked**, logged with timestamp, combining: verbatim-from-identified-source + personal responsibility for accuracy + **subject-property cross-check** ("this legal describes the property conveyed by this deed"). No affirmation → the paste is not used, placeholder stays. (R1-2, R2-3, R3-a + R3's wrong-property risk)
- **G4 — Field-level provenance** `attorney_entered`, distinct from `ocr_extracted`, timestamped, auditable; **document-level provenance stays `agent_assembled`** — verify in code that the paste does not mutate the LIVE-9 latch. (R1-3, R2-4/7, R3-b/e)
- **G5 — Source capture.** Record the cited source (instrument + book/page or recording reference) or an explicit "no recorded source" affirmation; where an upload exists but OCR'd below floor, associate the paste with that upload as "attorney-entered from uploaded source." (R3-b, R1-8)
- **G6 — B6 posture.** An affirmed+sourced paste clears the `[[ ]]` placeholder but moves the draft to a DISTINCT state — "attorney-entered legal, attorney verification required" — with a **persistent visible banner**; resolution method logged as attorney-entry, never silent. Unaffirmed paste clears nothing. (R1-5, R2-5, R3-c + banner)
- **G7 — D3 branching.** Attorney-entered legal renders as "attorney-supplied verbatim — no extracted source available for automated comparison; attorney has affirmed accuracy," requires explicit acknowledgment, never reports a false comparison, and does not auto-block export solely for the missing extraction. Advisory fuzzy-compare against a below-floor extraction: nice-to-have, not a gate. (R1-6, R2-6, R3-d)
- **G8 — No model editing.** The pasted text flows through exactly as entered; no cleanup, normalization, or "improvement" of calls, metes-and-bounds, lot/block, subdivision, or tax-map references. (R1-7)
- **G9 — Export warning.** Conspicuous warning on export of an attorney-entered-legal deed ("not machine-compared to extracted source facts — confirm against the source instrument before execution or recording"). Default NON-BLOCKING per R1, operator may harden later. (R1-9, R2 "prominent UI warning")
- **G10 — Express protected-span lock.** The attorney-entered legal is registered as a protected/locked span; no Express revise/regenerate pass may touch it. This is the condition that keeps the model-never-authors red line intact — non-skippable. (R3-f)
- **G11 — Honest UI copy.** Update the "never typed… never written by the system" intake promise to describe the dual path truthfully. (R2-8, packet Part 6.1)
- **G12 — Test grid (union).** No-paste/no-upload → placeholder unchanged; paste without affirmation → not used; affirmed paste → complete draft, no placeholder; field provenance `attorney_entered`; doc provenance `agent_assembled`; D3 honest (no false comparison); LIVE-9 sanction intact; Express lock holds under a revise pass; audit log captures paste + affirmation events. (R1-10, R2-9, R3)

## CONSOLIDATED CONDITIONS — NON-GIFT LANES (delta check against merged #549)

- **N1** — verify #549 as merged satisfies: honest field label, field-level `attorney_entered` provenance, doc-provenance latch untouched, flow-through + no-placeholder + provenance tests. (R1 non-gift 1–5, R2 2/4/5/7/9)
- **N2 — OPERATOR SUB-CALL:** R2 requires the affirmation checkbox on the non-gift lanes too; R1/R3 do not. **Cowork recommendation: ADD IT** — one uniform affirmation component across all four lanes is cheaper than two trust postures, and G3 has to be built anyway. If adopted, apply G3/G6-banner/G9 uniformly.

---

## OPERATOR DISPOSITION (pending)

Proposed ruling for the operator to give the CLI, verbatim:

`operator approve checkpoint:DEED-MANUAL-LEGAL-DESC-1 — approve-with-conditions per docs/reviews/DEED-MANUAL-LEGAL-DESC-1_triad_disposition_2026-07-07.md: gift/Express GO under conditions G1–G12 (G1 constitutes my express re-ratification exception to the gift extraction-only invariant); non-gift delta N1 required; N2 [ADOPTED / DECLINED].`

Once returned, OVERNIGHT-2026-07-07 queue item 3 builds to these conditions (reversible build-and-PR; deed agent remains flag-dark on prod).

- GPT-5 verdict: approve-with-conditions (R1 or R2 per operator's leg labeling)
- Independent Claude verdict: approve-with-conditions (R3)
- Operator decision: ______

---

*Cowork consolidation. Verbatim returns are the operator's message of record 2026-07-07; nothing here self-executes. New file; packet Part 7 left for the operator/CLI to complete per convention.*
