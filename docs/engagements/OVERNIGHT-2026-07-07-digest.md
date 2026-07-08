# OVERNIGHT-2026-07-07 — morning digest (A8 format)

**Run:** `run batch OVERNIGHT-2026-07-07` per `docs/engagements/OVERNIGHT-2026-07-07-dispatch.md`. Autonomous, no mid-run operator questions, hold-don't-stop on gated PRs. Baseline verified against `origin/main` (`13c847c` at start → `f192f52` after this batch's docs merges; PRs below).

**One-line status:** the GOV-MECH-1 governance chain (item 1) and the NC-PT-11 design (item 5) are DONE (5 PRs, 3 auto-merged, 1 held, 1 spec-for-operator); the gift-path FIRE build (item 3) and the C4-C6 flagship (item 2) are CARRIED with reasons; FL sweep (item 4) not reached; stretch (item 6) skipped.

---

## 1. PRs MERGED (auto-merge lane, green CI)
| PR | What | Squash SHA |
|---|---|---|
| #551 | GOV-MECH-1 **C-1** — 26 July governing docs onto main | `92f070f` |
| #553 | GOV-MECH-1 **Part B** FLAG-FLIP-RUNBOOK-1 (runbook + 9-test coverage/schema/orphan) | `6cdec23` |
| #554 | GOV-MECH-1 **C-2** state.json repair EVIDENCE report (PREPARE-ONLY) | `f192f52` |

`origin/main` = **`f192f52`** after these. (Pre-batch this session also landed the DEED work: #549 `9b228c7`, #550 `13c847c`.)

## 2. PRs BUILT-AND-HELD (each with the exact gate it awaits)
| PR | What | Gate it awaits |
|---|---|---|
| #552 | GOV-MECH-1 **Part A** CI-LANE-GUARD-1 | **Operator review of the guard logic** (red-team item 5) → apply `lane:non-reversible-ack` (self-ack of this `.github/**` change) → `operator approve accept:CI-LANE-GUARD-1`. The `Reversible-lane guard` job is RED on this PR **by design** (it detected the `.github/**` change with no operator label and failed-closed in 6s — the in-vivo negative self-test; the guard works). `Type Check + Tests` + `Lint` are green. |
| #555 | GOV-MECH-1 **C-3 spec** + **NC-PT-11 design** (items 1 + 5) | Docs-only → auto-merge on green (CI settling at digest time; merge if green, else it rides the morning). C-3 itself is a **spec for you to apply** — see §5. |

## 3. Migrations queued (apply-before-flip)
**None introduced this batch** — every merged/held PR is docs, tests, or a CI workflow; zero new `.sql`. The CARRIED gift-path build (item 3) WILL introduce one (an audit-log table/column for G12) — flagged in its spec, HOLD PR, apply-before-flip.

## 4. Flags introduced
**None this batch.** (The gift-path build stays behind the existing `DEED_DRAFT_AGENT_ENABLED`.)

## 5. OPERATOR morning pass — deferred decisions (the gate each awaits)
1. **Part A #552** — review the guard logic (`.github/workflows/ci.yml` + `tools/ci/reversibleLaneGuard.mjs`); confirm the live actor-verification path against a real label; apply `lane:non-reversible-ack`; `operator approve accept:CI-LANE-GUARD-1`. **Self-flagged:** the timeline-API actor check can't be validated locally — validate on a test label before trusting it.
2. **C-2 state.json repair (report in #554)** — apply the 5 field repairs; this is a **Rule-11 print-and-wait `y`** (decision-bearing). I did NOT write state.json.
3. **C-3 CLAUDE.md amendment (spec in #555)** — **apply the before/after edits yourself** from `docs/engagements/GOV-MECH-1-C3-claudemd-amendment-spec.md`, then diff-approve. I did NOT edit CLAUDE.md: the harness self-modification guard correctly blocked an agent editing its own oversight config, and the dispatch's own hard stop requires operator diff approval. Every pruned line is quoted verbatim in the spec.
4. **FOLD-L0-1 — OPERATOR-RESOLVE (C-2):** self-use live-verified 2026-06-20 (Claim A) vs. the client-facing "FOLD-L0-1 live-verified" gate still treated open (Claim B). Reconcile whether the client-facing bar is met. **Not resolved by me** (contradiction).
5. **Gift-path FIRE build (item 3)** — approved-with-conditions (G1–G12 + N1 + N2). CARRIED with a full build spec `docs/engagements/DEED-MANUAL-LEGAL-GIFT-1-build-spec.md`. Records-sensitive; will be its own HOLD PR (migration). N1 finding: #549 (already merged) satisfies flow-through only — it lacks the field-level `attorney_entered` provenance + the N2 affirmation, both specified for the follow-up.
6. **Deploy (carried from earlier):** `origin/main` is now well ahead of prod `b92591e` — the deed line (#547/#548/#549) + all of tonight's docs. Everything is flag-dark; deploy is your Railway step (`operator approve deploy:`) when ready.

## 6. Skips + carries (with reasons)
- **Item 2 — C4-C6 conversational matter page: CARRIED (not built).** Reason: a multi-increment flagship (new `CONV_MATTER_PAGE_ENABLED` flag, an additive migration, NC-C1-1..8 + NC-PT-1..12 conformance) — too large to build correctly at the tail of this batch; skip-if-risky over a partial flagship. Substrate + brief unread this run; a dedicated session should start at C.4a per `docs/engagements/C4a-substrate-consolidation-dispatch.md`.
- **Item 3 — gift-path build: CARRIED with spec** (see §5.5) — records/send-safety, skip-if-risky.
- **Item 4 — FL sweep: NOT REACHED (carried).** `docs/UAT_FIX_LIST_2026-07-05.md` not swept this run; the small residuals (FL-17 template Activate; OCR-confidence display on the deed cure card) are unbuilt.
- **Item 6 — stretch OPS-DEADMAN-1: SKIPPED** (gated on items 1–5 all done; 2/3/4 carried).

## 7. Untracked-inventory report (C-1)
132 untracked files at batch start. **Committed by C-1 (26):** the enumerated July governing docs (roadmap, COWORK_MAP, the July dispatches, FRESH-EYES/OUTSIDE-REVIEW/GOV-MECH-1-red-team/DEED-triad reviews, 12 `docs/design/` July docs). **Left untracked (deliberately, per "note disposition; delete nothing"):** repo-root working files (`CLI_PROMPT_*`, `HANDOFF_*`, `AUDIT_*`, `FABLE_*`, `COWORK_*`, `*_dispatch_*` scratch); older `docs/reviews/` dispositions + packets from prior engagements (LIVE-9, FOLD-DEED-1, TITLE-EXAM-1, PRODUCT-THESIS-1, CR-4, etc.) not in the C-1 enumerated set; older `docs/engagements/` specs (FOLD-*, NOTIFY-*, REVIEW-LOOP-UX-1, ULTRABUILD-1-*). None deleted; a future C-1-style pass can commit the older reviews if desired.

## 8. Self-flagged / notes
- Part A actor-verification is untestable without live Actions (validate on a test label).
- C-3 not applied to CLAUDE.md (self-mod guard + operator diff gate) — delivered as an exact spec.
- The guard job correctly RED on its own PR is expected, not a failure.
- Local build worktree: `C:\Users\Kelly\Documents\lex-ov0707-wt` (node_modules junctioned; tsc/eslint/vitest green on all built work; the 5 OCR-dep tsc errors are the universal local artifact, CI-authoritative).

*OVERNIGHT-2026-07-07 digest. Post-run reporting, never a gate substitute (Rule 19 / A8). Every operator gate above is retained.*
