# GOV-MECH-1 C-2 — `engagement_state.json` one-time repair (PREPARE-ONLY report)

**Status: NOT APPLIED.** This is the evidence artifact only. The actual `docs/MR_CAL_engagement_state.json` write is a **morning Rule-11 item** — it is decision-bearing (a demotion + list-membership changes), so it requires the operator's print-and-wait `y`. Nothing here self-executes (dispatch v2 C-2 + red-team item 8).

**Method (red-team item 8):** each field resolved **per-item with evidence, never normalized in bulk.** Classifications: **factual correction** (a provably-stale value), **demotion** (obsolete content pointed to the authoritative source), **OPERATOR-RESOLVE** (a genuine contradiction I must NOT resolve myself).

Authoritative sources cited: `docs/STATE.md` (the human-readable running log, itself authoritative per the demotion header this proposes), the merge history on `origin/main`, and `src/server/config/featureFlags.ts` (flag/migration reality).

---

## Before / after evidence table

| # | Field | Old value (excerpt) | Proposed new value | Evidence source | Classification |
|---|---|---|---|---|---|
| 1 | `current_phase` prod pin | "prod = origin/main = **`4e07e51`** (live, healthy)" (dated 2026-06-20) | "prod = **`b92591e`** (deployed 2026-07-06, operator-confirmed). `origin/main` is AHEAD of prod — do not conflate them: main advanced through the deed line (#547/#548/#549) + GOV-MECH-1 C-1/B docs to `13c847c`+ during OVERNIGHT-2026-07-07; those are flag-dark and **not deployed**." | STATE.md 2026-07-06 "PROD DEPLOY (completion) — prod `b92591e`"; `git log origin/main` | **factual correction** (the pin is 17 days + many merges stale; it also falsely asserts prod == main) |
| 2 | `in_progress_engagement` = CHAT-COPILOT-1 | "…BUILD COMPLETE through Inc 5… All behind CHAT_COPILOT_ENABLED (default OFF); NOTHING deployed… NEXT operator-gated (all HALTED): move in_progress → completed…" | **Clear `in_progress_engagement` to `null`; move CHAT-COPILOT-1 to a new `awaiting_operator_acceptance` entry** carrying its own text: build complete #291–#299, operator-gated closeout items (accept → completed; set `GROUNDED_CHAT_PROVIDERS`; ratify Part-C defaults; deploy w/ migration 0033). | The field's own text says build is COMPLETE and the only opens are operator-gated; nothing is actively building. | **demotion** (phantom "in progress" → the true state, awaiting operator acceptance). **Rule-11 list-membership change → morning `y`.** |
| 3 | `queue` = [FOLD-PM-3, FOLD-INTEG-1, FOLD-SEED-1, FOLD-MIGRATE-1, FOLD-VERIFY-1] | the pre-fold MR-CAL queue | **Replace with a pointer:** `["SUPERSEDED — the live plan is docs/WHEREAS_BUILD_ROADMAP_2026-07.md (roadmap phases) + the current dispatch queue; this MR-CAL FOLD queue is obsolete. FOLD-PM-3 already SHIPPED (PARTY_MODEL_ENABLED, migration 0044)."]` | `featureFlags.ts` shows `PARTY_MODEL_ENABLED` (FOLD-PM-3) already built (migration 0044); roadmap is the live plan. | **demotion** (obsolete queue → roadmap pointer). **Rule-11 → morning `y`.** |
| 4 | `blocked_engagements` = [FOLD-ADV-TITLE-1] | one entry | **Verify at repair time:** FOLD-ADV-TITLE-1 (advisory title generalization) — confirm still genuinely blocked vs. superseded by the TITLE-EXAM-1 track (`TITLE_EXAM_ENABLED`, migrations 0054/0055 shipped). If superseded → move to a note; if still blocked → keep with a refreshed reason. **Do not bulk-clear.** | `featureFlags.ts` TITLE_EXAM_ENABLED exists; STATE.md title-exam entries. | **operator-verify** (per-item, evidence-gated; flagged not auto-resolved) |
| 5 | `last_updated` / `last_updater` | 2026-07-05 / "NOTIFY-STALE-1 close-out" | 2026-07-07 / "GOV-MECH-1 C-2 repair (operator-applied)" — set when the operator applies the repair. | the file itself | **factual correction** (stamp on apply) |

---

## OPERATOR-RESOLVE (do NOT resolve — record both claims)

**FOLD-L0-1 (conflicts-at-intake) verification status — contradiction, marked `OPERATOR-RESOLVE`:**

- **Claim A (state.json, 2026-06-20):** FOLD-L0-1 was **LIVE-VERIFIED, STRONG PASS** on prod `4e07e51` (Cowork UAT, 3 synthetic cross-conflict matters; `outputs/FOLD-L0-1_UAT_RESULTS_2026-06-20.md`). Framed as satisfying the **self-use-only** lift condition for the conflicts vertical; "the operator decision to go client-facing is SEPARATE."
- **Claim B (roadmap + every recent dispatch, incl. OVERNIGHT-2026-07-07):** treats **"not client-facing until FOLD-L0-1 is live-verified"** as a **still-unmet gate** — i.e. the client-facing bar is open.

These may be reconcilable (self-use verified ≠ client-facing gate cleared) or may reflect drift. **Per C-2 I do not resolve it.** Proposed marker in the repaired JSON: a `fold_l0_1_status` note = `"OPERATOR-RESOLVE: self-use live-verified 2026-06-20 (Claim A) vs. client-facing gate still treated open (Claim B) — operator to reconcile whether the client-facing FOLD-L0-1 bar is met."`

---

## Repair sequencing (per C-2 + red-team item 8)

1. **STATE.md reconciliation completes BEFORE the demotion header is added** — confirm STATE.md is current (the OVERNIGHT-2026-07-07 Rule-16 entry lands in the digest step) first.
2. Apply items 1–5 above (Rule-11 print-and-wait `y` for the membership changes #2/#3; #1/#5 are factual stamps; #4 is per-item verify).
3. Add the demotion header to the top of `engagement_state.json`: **"Generated/secondary; docs/STATE.md is authoritative; do not hand-maintain."**

*GOV-MECH-1 C-2. PREPARE-ONLY report artifact. The state.json write is operator-gated (Rule-11 `y`), a morning item — this file is the evidence + proposed repair, nothing more.*
