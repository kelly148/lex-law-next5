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

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
