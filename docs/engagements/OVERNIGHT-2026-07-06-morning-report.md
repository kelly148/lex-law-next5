# OVERNIGHT-2026-07-06 — MORNING REPORT

**Run:** unattended overnight batch per `docs/engagements/OVERNIGHT_BATCH_2026-07-06_dispatch.md`.
**Base at start:** `origin/main = 2bc3026` (#524). **Prod at start:** `7f8f7b2` (#523).
**End state:** `origin/main = 1d7a99f` — green. All merges below are on `main`, **not yet deployed**.

Continuous-run authorization was honored: auto-merged every green PR with no operator pauses; recorded residuals and continued; halted only per the hard-stop rules. **No prod deploy, no flag flips, no prod data mutation, no live provider calls** anywhere in this batch.

---

## 1. What merged (in order, with squash SHAs / PRs)

| # | Item | PR | Squash SHA |
| :-- | :-- | :-- | :-- |
| 1 | **DEED-DOC-PAGE-LAYOUT-1** (sweep S1) — document-first deed page: neutral status strip + collapsed recording drawer below the document | #526 | `a3d8119` |
| 2A | **UI-ATTORNEY-SWEEP-1 S12** — sidebar nav reorder | #527 | `c0f23da` |
| 2B | **S14/S15 + G6/G7/G9** — matters list identity + bulk archive/delete + navigate-into-new-matter; overview sort/links/add-error; phase-chip ramps | #528 | `cf61dfe` |
| 2C | **S13/S16 + G6** — conflicts-block quieting; "Intake analysis" rename; interim Add-client; FL-18 header height; chip ramps | #529 | `5a22881` |
| 2D | **S19 + G6/G7/G9 + FL-18** — Supervision provider select + un-truncate; Settings toggles→oxblood; Diagnostics tone; Templates activate-error; deed "Propose the facts" nowrap | #530 | `074d8eb` |
| 3-i | **TEMPLATE-PIPELINE-1 inc 1** — bind a template at document create (server validation + deed exclusion) + template picker + extract/populate/render error surfacing | #531 | `f36924d` |
| 3-ii | **TEMPLATE-PIPELINE-1 inc 2** — schema authoring UI (derive → edit → save → confirm) + pure derivation helper | #532 | `c5d3803` |
| 11 | **PERF-TRANSITIONS-1 (FL-11)** — reset `<main>` scroll on navigation (fixes Settings mid-scroll blank) + sidebar name-clip rider | #534 | `0a0142c` |
| — | **CI-RECOVERY-1** — repaired main after #529/#531 merged on a misleading CI signal (see §2) | #536 | `c11d594` |
| 8 | **SESSION-UNSTICK-1** — Diagnostics per-session manual Abandon for possibly-stuck review sessions (server `isPossiblyStuck` flag + guarded UI, audited, no bulk reap) | #535 | `f9fd839` |
| 5 + 11-inv | **FL-1 + PERF-TRANSITIONS-1 investigations** (findings-only docs) | #533 | `0f286c8` |
| 10 | **IR-EXPORT-DOCX-1** — real `.docx` export for information requests via the shared engine + Export DOCX button | #537 | `1d7a99f` |

Item **2** (UI-ATTORNEY-SWEEP-1) shipped as four increments (2A–2D). Item **3** (TEMPLATE-PIPELINE-1) shipped as two increments. **DEED-EXPORT-FORMAT-1 (#520) and UI-ATTORNEY-SWEEP-1 inc 1/2 (#521/#523) were already merged before this run and were SKIPPED** as instructed.

---

## 2. INCIDENT (needs your awareness) — main went red mid-run; fixed

**What happened:** PRs #529 (UI-sweep 2C) and #531 (template-pipeline inc 1) were merged while their **Type Check + Tests** CI job was actually **RED**. The auto-merge relied on `gh pr checks <n> --watch` returning exit 0 — which signals **completion, not success**. Two test files regressed on `main`:

- `src/server/__tests__/fold_l0_1_intake_ui.test.ts` (source-audit) — 2C added an `openSignal` prop to the `<MatterIntakePanel>` mount, breaking the exact-match assertion.
- `src/client/components/__tests__/deedExpressMatterEntry.render.test.tsx` — 3-i added a `trpc.template.list` call the test's mock didn't have.

**Fix (#536, `c11d594`):** reverted the `openSignal` auto-open so the mount matches again — the header **"Add client" is now scroll-only** (the brief called it interim); and added the `template.list` mock stub. **No test assertions were changed.** Verified: the full client suite (100 files / 727 tests) is green locally, and #536's CI is green (checked via `gh pr view --json statusCheckRollup`, not the watch exit).

**Process fix adopted for the rest of the run and going forward:** (a) verify CI **conclusions** via `--json statusCheckRollup` before every merge, never the watch exit code; (b) run the **full affected test set** (including source-audit tests that scan a changed file) before pushing, not only the tests judged "relevant." All merges after #536 were JSON-verified green.

**One residual for you:** #529 and #531 are on `main` as green-squash commits, but they were briefly red between merge and #536. `main` is now fully green. Nothing to do, but flagging the sequence for the record.

---

## 3. Flagged residuals / minor deviations (recorded, non-blocking)

- **Item 1:** the status strip shows *Recording checklist* + *Source sign-off* counts but **no "Export checks" chip** — there's no persistent run-state to show honestly; the export/sendability pre-flight relocated below the document with its own affordance.
- **Item 2 — G7 recital-band click-through: NOT DONE (deliberate).** Making the matter status-strip chips click through **reverses an operator-signed spec** (RELAYOUT design spec v1.1 §2.3: the band is status-only, non-interactive, "NEVER oxblood"). Left as a decision for you. The safe G7 parts (Diagnostics tone, Overview count-badge links) shipped.
- **Item 2 — S14 doc-count / last-activity columns: DEFERRED.** They need new fields on `matter.list` (server) → not display-only. Client name, navigate-into-new-matter, and multi-select archive/delete shipped.
- **Item 2 — S18 Gemini "dormant pending calibration" caption: SKIPPED.** No code enforces Gemini dormancy, so the caption would assert an **unverified product status**. Needs your confirmation of the actual Gemini posture before it can be stated.
- **Item 2 — S18 voice segmented control + section reorder: DEFERRED** (larger reshape; lower value).
- **Item 2 — S16 CapacityElectionPanel collapse-to-chip: DEFERRED** (nice-to-have).
- **Item 2 — S17 DocumentDetail chrome pass: PARTIAL.** The content sheet is already Fraunces-on-paper; the G9 extractVariables error surfacing shipped inside item 3-i. The remaining tab/breadcrumb token pass + shell-width tweak were not done. The "not yet wired" template-button badge was **skipped** because item 3 wires those buttons this same batch.
- **Build-stamp rider:** only ONE build-stamp source exists in the code (`AppShell` → `/api/version`). No conflicting second source found — the "different values" is a runtime/deploy-cache artifact, not a code duplication. **No code change; verify live.**
- **Item 3-ii:** the specific phase-2 warnings aren't itemised in the acknowledge notice (`confirmSchema` throws `SCHEMA_WARNINGS_UNACKNOWLEDGED` without the list; surfacing details needs a server behavior change, out of the "no new server procedures" scope). In the normal derive-from-source flow there are no warnings.

---

## 4. Carried to the next batch (built recon, not shipped)

Stopped building after item 10 to protect quality after the §2 incident and to guarantee this report. The operator pre-authorized carrying items 7–12; items 4 and 6 are higher-priority carries.

- **Item 4 — FL-MEDIUM-1** (deed/matter UX): FL-5 sendability-tier gloss; FL-6 failed-generate auto-expand + scroll; FL-8 no-upload cure-card variant; FL-7 assessed-value extraction **investigation-only**. Not started.
- **Item 6 — MATTER-DROP-1** (operator 7/5 ruling): page-level drag-drop → Materials via the existing `POST /api/materials/upload` path + drop overlay + per-file feedback. Recon done: the drawer uploads via that REST endpoint; MatterDetail's root needs drag handlers + an overlay. Not started.
- **Item 7 — COPILOT-UPLOAD-1**: the A3 multipart upload endpoint + attachment chips per the CHAT-COPILOT-2 A2/A3 reviewed design. Not started (rides the parent §3.1 disposition; STOP-and-flag if a conflict with the drop-to-Materials ruling surfaces).
- **Item 9 — CAL-T1-2**: golden P8-T1 extractor refinement (committed fixtures only, zero live calls, list pin flips). Not started.

---

## 5. Follow-ups surfaced by the investigations

- **SUPERVISION-UNIFY-1** (from FL-1, item 5): Supervision reads only `chat_egress_events`; reviewer-lane / deed-agent / intake-parse sends are written to `egress_events` which has **no production reader**. A read-side unification would surface them. Draft generation bypasses both tables. See `docs/engagements/FL-1-INVESTIGATION-findings.md`. **Governance decision for you:** whether Supervision should present one unified vendor-oversight ledger.
- **DocumentDetail chunk split + CDP screenshot idle-wait** (from PERF, item 11): structural follow-ups, own briefs. See `docs/engagements/PERF-TRANSITIONS-1-findings.md`.

---

## 6. DEPLOY PROMPT

**Milestone:** overnight batch complete (items 1, 2, 3, 5, 8, 10, 11 + CI recovery). **In this deploy** = everything on `main` since prod `7f8f7b2`: PRs #526–#537 (see §1) plus the pre-run docs-state #524.

**Pre-deploy checklist**
- **Pending DB migrations: NONE.** Every item this batch was display-only or additive-with-no-migration (template pipeline, IR docx, session-unstick all explicitly no-migration; session-unstick's `isPossiblyStuck` is a computed field on an existing snapshot, no schema change). Deploying code needs no schema step.
- **Schema-free + largely display/additive.** Visible changes: nav reorder, accent-system chips/toggles, deed page-first layout, scroll-reset-on-nav. New capabilities (all additive, none client-facing): template bind + schema authoring, per-session abandon on Diagnostics (behind `REVIEWER_HEALTH_VIEW_ENABLED`, default OFF), IR `.docx` export.
- **Guard status:** confirm whether `SMOKE_USERNAME`/`SMOKE_PASSWORD` + `RAILWAY_TOKEN`/`RAILWAY_SERVICE_ID`/`RAILWAY_ENVIRONMENT_ID` are set. If yes → MODE A (one-action deploy, auto smoke + rollback). If not → MODE B (deploy, then verify by hand).
- **Confirm `main` is the merged, CI-green commit** you intend to deploy (`1d7a99f`).

**Deploy steps**
- **MODE A** (if smoke secrets + token present): Railway `Ctrl+K` → **Deploy Latest Commit**. Migrations (none here), post-deploy smoke, and rollback-on-red are automatic.
- **MODE B**: trigger the Railway deploy of `main`; then by-hand verify `/api/health` + `/api/version` shows the new commit + spot-check the deed page, nav order, Templates schema editor, Diagnostics abandon (flag-gated), and an IR `.docx` export.

**Post-deploy:** run the smoke suite (or by-hand checks). Green → mark live-verified. Red → roll back (auto if token; else Railway → previous deployment).

**Reminder:** this is **not client-facing until FOLD-L0-1 (conflicts-at-intake) is live-verified — self-use only.** Nothing in this batch changes that posture.

**Deploy is operator-gated (`operator approve deploy:OVERNIGHT-2026-07-06`) — it is not automated.**

---

## 7. FINAL COMPLETION UPDATE — the run continued to full completion

§§1–6 above were written mid-run (after item 10), when items 4/6/7/9 were carried, not built. You then directed **"don't stop until all items are completed."** The run resumed and finished the entire queue. **End state: `origin/main = 5987d2e` — green.** The four carried items and the last rider are now merged:

| # | Item | PR | Squash SHA |
| :-- | :-- | :-- | :-- |
| 6 | **MATTER-DROP-1** — full-page drag-and-drop → Materials on the matter page, via the existing `POST /api/materials/upload` path (same OCR/extraction pipeline; no new egress); drop overlay + per-file feedback (G9) + accepted-format validation. Composer-level drops are item 7, not this. | #540 | `847a498` |
| 9 | **CAL-T1-2** — credit routine-blank *suppression* in the GOLDEN P8-T1 scorer (cal7b parity): suppressed routine-blank → PARTIAL, unsuppressed → FAIL. Re-baselined from committed fixtures, **DARK harness, ZERO live calls**. Pin flips: P8-T1 × `claude_lite` FAIL→PARTIAL; 5 empty lanes gain `suppressedRoutineBlank:false`. | #541 | `47b3a34` |
| 4 | **FL-MEDIUM-1** — FL-5 sendability "(would block sending)" gloss on BLOCKER (display); FL-6 scroll-to-first-missing-field on failed Generate (jsdom-safe, gate logic unchanged); FL-8 no-upload cure prompt (display); FL-7 assessed-value extraction **investigation-only** (findings doc). | #542 | `39ff220` |
| 7 | **COPILOT-UPLOAD-1** — completes the reviewed CHAT-COPILOT-2 A3 design: `POST /api/chat/attachments/upload` (flag-gated, synchronous OCR, `ingestChatAttachment`, 409 cross-matter) + `CopilotAttachments` composer chips (three-state, select-for-this-turn → `submitTurn`, accept-with-warning / save-to-matter / pin / 409 override). Flag-dark behind `CHAT_COPILOT_ENABLED`. | #543 | `1ac763b` |
| rider | **hatGate.ts stale header** — the file-header still said "PB-1 interim: UT-hat only"; corrected to PB-1 RESOLVED (matches `resolveFaticAvailability`). Docs-only. | #544 | `5987d2e` |

All five were JSON-verified green before merge (the §2 process fix), and the **full client suite (734) + chat/attachment server tests (107)** ran green locally on each. **Every rider is now resolved:** sidebar name-clip (item 11, #534), build-stamp (investigation — one source, no code change), hatGate header (#544).

**New residuals (item 7, recorded, non-blocking):** (1) OCR-source `meanConfidence` is **derived from the extraction status** (representative), not the raw numeric confidence — the honesty floor stays meaningful; (2) the copilot soft matter-mismatch advisory passes **party names but omits parcels** (a fast-follow). **Item 4 FL-7** is investigation-only — the assessed-value extraction fix (same-line/colon pairing relaxation, or a `vesting_deed` fallback) is a separate reviewed engagement, not done here.

**Revised deploy scope:** the §6 DEPLOY PROMPT now covers **everything on `main` since prod `7f8f7b2` → `5987d2e`** (PRs #526–#544). **Still zero pending DB migrations** — items 4/6/9 are display/scorer-only; item 7's tables (`chat_attachments`, migration 0035) shipped in the earlier reviewed CHAT-COPILOT-2 work and are **not** new to this batch (verify 0035 is applied to prod before the copilot flag is ever turned on — but the flag stays OFF, so nothing in this deploy is reachable). Item 7 + the copilot surface remain **flag-dark** (`CHAT_COPILOT_ENABLED` OFF). The not-client-facing-until-FOLD-L0-1 reminder is unchanged.

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
