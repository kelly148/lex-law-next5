# OVERNIGHT-2026-07-06 — PROD DEPLOY RECORD

**Deploy:** operator-approved and operator-initiated on 2026-07-06 (`operator approve deploy:OVERNIGHT-2026-07-06`; "this is deploying now").
**Prod moves:** `7f8f7b2` (#523) → **`38eeba5`** (#538), via Railway.
**Executor:** the operator (Railway). The assistant did not trigger the deploy and ran no live/prod calls.

---

## What is in this deploy

Everything on `main` since prod `7f8f7b2`: PRs **#526–#538** (the OVERNIGHT-2026-07-06 batch) plus the pre-run docs-state **#524**. Full per-item detail: `docs/engagements/OVERNIGHT-2026-07-06-morning-report.md` §1.

- **Item 1** DEED-DOC-PAGE-LAYOUT-1 (#526) — document-first deed page.
- **Item 2** UI-ATTORNEY-SWEEP-1, 4 increments (#527–#530) — nav reorder; matters/overview; matter-detail + conflicts quieting; settings/supervision/diagnostics; oxblood accent; G9 error surfacing.
- **Item 3** TEMPLATE-PIPELINE-1, 2 increments (#531/#532) — bind-at-create + schema authoring.
- **Item 11** PERF scroll-reset + sidebar clip (#534); **CI-RECOVERY-1** (#536); **Item 8** SESSION-UNSTICK-1 (#535); **Item 5 + investigations** (#533); **Item 10** IR-EXPORT-DOCX-1 (#537); the morning report + STATE.md (#538).

## Pre-deploy facts (confirmed by repo inspection)

- **No pending DB migrations.** The `7f8f7b2..38eeba5` diff adds **zero** migration / drizzle / `.sql` / schema files (grep-confirmed). Deploying this code needs no schema step; nothing to apply to prod TiDB first.
- **Behavior:** display + additive. Product flags unchanged (still OFF where they were). New capabilities are additive and dark-by-default where flag-gated (Diagnostics abandon rides `REVIEWER_HEALTH_VIEW_ENABLED`; template-mode surfaces only appear for template documents with an active template).
- `main = 38eeba5` is the merged, CI-green commit (all constituent PRs verified green via `--json statusCheckRollup`).

## Post-deploy verification (operator / Cowork — Pattern 16; NOT performed by the assistant)

Spot-check after the deploy settles (~30–90s):
1. `/api/health` OK and `/api/version` reports the new commit (`38eeba5` / its short SHA).
2. Deed document page reads document-first (status strip on top, recording drawer collapsed below).
3. Sidebar nav order: Overview, Matters, Deed, Templates, Upload & Format, Notifications, Settings, Supervision, Diagnostics.
4. Templates page → expand a valid version → **Configure schema** derives fields; Save then Confirm.
5. New Document (template mode) shows the template picker; a document binds a chosen template.
6. Information Request → **Export DOCX** downloads a valid `.docx`.
7. Navigate to Settings mid-scroll from a long page → no mid-scroll blank band (scroll resets to top).
8. (If `REVIEWER_HEALTH_VIEW_ENABLED`) Diagnostics shows **Abandon session** only on possibly-stuck sessions.

**Green → mark live-verified.** **Red → roll back** in Railway to the previous deployment (`7f8f7b2`).

**Reminder:** this remains **self-use only — not client-facing until FOLD-L0-1 (conflicts-at-intake) is live-verified.** This deploy does not change that posture.

## Carryforwards (open after this deploy)

- **Carried batch items** (built recon, not shipped): item 4 (FL-MEDIUM), item 6 (MATTER-DROP), item 7 (COPILOT-UPLOAD), item 9 (CAL-T1-2).
- **Operator decisions surfaced:** (a) G7 matter-chip click-through — reverses the signed RELAYOUT status-only spec §2.3; (b) the Gemini "dormant" caption — unverified status, needs your confirmation; (c) SUPERVISION-UNIFY-1 — whether Supervision should present one unified vendor-oversight ledger (reviewer/deed/intake egress is written to `egress_events` but has no reader).
- **Deferred sweep sub-items:** S14 doc-count/last-activity (needs a `matter.list` server field); S18 voice segmented control; S16 capacity collapse; S17 DocumentDetail chrome pass (partial).
- **Incident note (closed):** #529/#531 briefly landed on a red `main` (auto-merge trusted `gh pr checks --watch` exit code = completion, not success); repaired by CI-RECOVERY-1 (#536) with no test-assertion changes; `main` fully green since.

---

## PART 2 — completion deploy (items 4/6/7/9 + rider)

**Deploy:** operator-approved and operator-initiated on 2026-07-06 ("Deployment is complete").
**Prod moves:** `38eeba5` (#538) → **`b92591e`** (#545), via Railway.
**Executor:** the operator (Railway). The assistant did not trigger the deploy and ran no live/prod calls.

**Why a second deploy.** After PART 1 shipped the partial batch, the operator directed "don't stop until all items are completed." The run finished the carried queue; this deploy carries that completion to prod.

**In this deploy** = everything on `main` from `38eeba5` to `b92591e` (23 files):
- **item 6 MATTER-DROP-1** (#540 `847a498`) — full-page drag→Materials via the existing upload path.
- **item 9 CAL-T1-2** (#541 `47b3a34`) — golden P8-T1 scorer credits routine-blank suppression (offline re-baseline; NOT a runtime behavior change; no user-visible surface).
- **item 4 FL-MEDIUM-1** (#542 `39ff220`) — FL-5 gloss / FL-6 scroll / FL-8 no-upload prompt (display); FL-7 investigation-only.
- **item 7 COPILOT-UPLOAD-1** (#543 `1ac763b`) — chat-attachment endpoint + composer chips, **flag-dark** behind `CHAT_COPILOT_ENABLED` (OFF on prod → unreachable).
- **hatGate rider** (#544 `5987d2e`) + **final docs** (#545 `b92591e`).

**Pre-deploy checklist (as satisfied).**
- **Pending DB migrations: NONE.** The `38eeba5..b92591e` diff adds **zero** migration/schema/`.sql`/drizzle files (grep-confirmed). Item 7's `chat_attachments` table (migration 0035) shipped with the earlier reviewed CHAT-COPILOT-2 work and is not new to this deploy; item 7's surface stays flag-dark regardless.
- **Schema-free + display/scorer/flag-dark.** Visible net-new: the matter-page drop overlay + the two deed prompts/gloss. Item 7 and the calibration change have no reachable user surface on prod.
- **`main` = the merged, CI-green commit deployed** (`b92591e`).

**Post-deploy verification (operator / Cowork, Pattern 16 — NOT assistant-verified).** Suggested spot-checks: `/api/health` + `/api/version` shows `b92591e`; drag a file onto a matter page and confirm it lands in Materials with per-file feedback; a gift-deed Generate with a missing field scrolls to and highlights it; the sendability card shows "(would block sending)" on a BLOCKER. The copilot upload surface is **not** checkable on prod (flag OFF, by design). Green → mark live-verified; red → roll back to `38eeba5`.

**Reminder:** still **not client-facing until FOLD-L0-1 (conflicts-at-intake) is live-verified — self-use only.** Nothing in this deploy changes that posture.

**Batch status: CLOSED.** All 11 queue items + all three riders merged and deployed; the mid-run CI incident is closed; residuals recorded in the morning report (§3, §7) and STATE.

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
