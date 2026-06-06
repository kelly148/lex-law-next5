# STATE.md — Whereas build, running state log

Append-only, **newest-first**. One dated paragraph per engagement close-out (CLAUDE.md Operating Rule 16): what changed, current build state, open items, gate residuals. Mirrored to `C:\Users\Kelly\Desktop\Historical_Thread_Extraction\_progress\STATE.md` so a fresh thread always has current state. Full phase-boundary context lives in the `HANDOFF_BRIEF_<date>` briefs in that same folder. The authoritative machine-readable tracker is `docs/MR_CAL_engagement_state.json`; this file is the human-readable narrative.

---

## 2026-06-06 (DEPLOY) — R2 #7 DEPLOYED (`2e2bdd7`) — Matter Record ledger now on prod; merge↔deploy gap closed

**What changed.** Operator deployed `main` (`2e2bdd7`) via Railway "Deploy Latest Commit". **prod = `2e2bdd7`** (`/api/version` confirmed `2e2bdd7…`, builtAt 2026-06-06T18:42:38Z — SHA check clean). **MODE B** (manual verify; no auto-rollback). Deploy range `4e6e7fa`→`2e2bdd7` = R2 #7 ledger (`f532620`) + two `docs(state)` commits. **No migrations in the range** (`git diff --name-only` shows zero `migrations/`/`schema.ts`/`.sql` — still through 0020; the wired `preDeployCommand apply-prod-migrations.mjs` ran as a no-op against the existing allowlist) — clean code-only deploy. The unshipped piece is now drained: **prod = main**.

**Now on prod (since `4e6e7fa`):** R2 #7 — the read-only **Matter Record** panel on MatterDetail (chronological `audit_events` projection) + its additive read-only `matter.auditLog` procedure. Both gates stay **OFF** (`CONFLICT_GATE_ENABLED`, `SENDABILITY_GATE_ENABLED`).

**Post-deploy verification.** `/api/version` = `2e2bdd7` ✓; `/api/health` = 200 ✓; unauth `trpc/matter.list` = 401 ✓ (auth intact, no bypass regression). **Matter Record ledger — Claude-driven light UAT PASS** (browser "UNIVERSALTITLE", authed `kelly`, hard-reloaded): `/matters` renders the real `poa` matter (`matter.list` live DB read OK); MatterDetail mounts fully (readiness strip + Intake/KB/Matter State/Closing package/**Matter Record**); the **Matter Record** panel renders collapsed-default and **expands** to its description + the designed **empty state** ("No recorded acts yet.") — the new `matter.auditLog` procedure returns successfully (empty for `poa`, which has no audit events; the populated path is covered by the green render test). **No React #310 / hooks violation** (only benign Chrome-extension message-channel noise). **Evidence class:** Claude-driven light UAT PASS; the formal Pattern-16 `live-verified` verdict remains the operator's (not overstated).

**Build state.** `main` = prod = **`2e2bdd7`**. Deploy gap CLOSED. Both flags OFF.

**Next.** R2 #8 (nav-only command palette — scope set: nav core now [global nav + jump-to-matter + contextual matter routes], deep-jumps deferred to inc 2) → #9 (R3 polish). Then R2 complete. Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Parallel operator Dispatch session also building R2 — coordinate on main. Open chips: `task_bc281353`, `task_b0f9ffb5`, R1-CLEANUP-1, fail-loud migration-runner.

---

## 2026-06-06 (+R2 #7) — R2 #7 MERGED (`f532620`, PR #197) — Matter Record ledger (read-only audit_events projection)

**What changed.** Built + merged **R2 #7** → `main` via [PR #197](https://github.com/kelly148/lex-law-next5/pull/197), squash **`f532620`**, CI green (merged by Claude per the standing rule). A read-only chronological **Matter Record** on MatterDetail — every recorded act (locks/adoptions/dispositions/confirmations/conflict acts), newest-first. Plain ledger (no analytics/editing/charts, per keep-list). **Re-presents existing data; no migration; reversible; flags untouched.**
- **Backend (additive read-only):** new `matter.auditLog` procedure (owner-scoped; NOT_FOUND on non-owned) exposing the existing `listAuditEventsForMatter` — audit events had no client read until now.
- **Client:** `MatterRecordLedger` collapsible panel on MatterDetail (recommended matter-panel placement, not a standalone screen): timestamp · actor(+model) · action · summary · rationale; loading + empty states; no blue.
Test: jsdom render (collapsed-default → recorded acts + rationale, empty, no-blue; ci-gotchas #10); audit-events guard `mr_fold_gov_1a` stays green.

**Build state.** `main` = **`f532620`**; prod = `4e6e7fa` (R2 #7 not yet deployed — display + additive-read, no migration; rides the next deploy). Both gates OFF.

**Next (R2):** #8 (nav-only command palette — jump-to-matter/open-review/conflicts/export + nav shortcuts; NO material-act shortcuts) → #9 (R3 polish: global empty/loading states, print stylesheet). Then R2 is complete. Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Parallel operator Dispatch session also building R2 — coordinate on main. Open chips: `task_bc281353`, `task_b0f9ffb5`. Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 (DEPLOY) — R2 display batch DEPLOYED (`4e6e7fa`) + light UAT PASS (Claude-driven)

**What changed.** Operator deployed `main` (`4e6e7fa`) via Railway "Deploy Latest Commit". **prod = `4e6e7fa`** (`/api/version` confirmed `4e6e7fa…`, builtAt 2026-06-06T16:34:39Z — SHA check clean). **MODE B** (manual verify; no auto-rollback). **No migrations in the range** (3ce1324→4e6e7fa is display + additive-read only; no `migrations/`/`schema.ts` changes) — clean code-only deploy.

**Now on prod (since 3ce1324):** R1-CLEANUP-1 (control colors→tokens) · R2 #3 (matter-state readiness strip + additive read-only `matterState.dashboard` conflictClearance/jurisdiction) · R2 #4 (unverified-KB-at-override WARN + grouped reasons; additive engine-only category) · R2 #5 (provenance badge grammar + low-risk surfaces + draft-body badge) · R2 #6 (KB adoption surface — built via operator Dispatch). Both gates stay **OFF** (`CONFLICT_GATE_ENABLED`, `SENDABILITY_GATE_ENABLED`).

**Live verification — light UAT PASS** (Claude-driven, browser "UNIVERSALTITLE", authed `kelly`): `/matters` renders (`matter.list` OK; only `poa` remains post-cleanup); **R2 #3 readiness strip** renders on MatterDetail with all six chips + correct advisory states (Set jurisdiction · Conflicts: not yet checked · No sources · No open items · Drafting · Safe to send); matter panels (Intake/KB/Matter State/Closing package) render; **no React/#310 errors** (only Chrome-extension message-channel noise); `/upload-format` (R1-CLEANUP-1 controls) renders. **Not exercised live** (prod has only `poa`, minimal data): provenance badges *with* data, export-safety grouping *with* findings + unverified-KB-at-override, KB adoption candidates — covered by green render/unit tests; hosting pages render healthy. **Evidence class:** Claude-driven light UAT; operator directed advance — formal Pattern-16 `live-verified` verdict not separately stated (recorded as light PASS evidence, not overstated).

**Build state.** `main` = prod = **`4e6e7fa`**. Deploy batch DRAINED. Both flags OFF.

**Next.** R2 #7 (Matter Record ledger — read-only projection of `audit_events`), then #8 (nav-only command palette), #9 (R3 polish). Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Open chips: `task_bc281353`, `task_b0f9ffb5`. Cowork: conflict-arc corrective STATE. (Note: a parallel operator Dispatch session is also building R2 — coordinate to avoid main collisions.)

---

## 2026-06-06 (+R2 #6) — R2 #6 MERGED (`5bdeb44`, PR #194) — KB / source-authority adoption surface (candidate-vs-adopted + deliberate-commit)

**What changed.** Built + merged **R2 #6** → `main` via [PR #194](https://github.com/kelly148/lex-law-next5/pull/194), squash **`5bdeb44`**, CI green (merged by Claude per the standing reversible-lane rule). A **display-only** delta on `KnowledgeBasePanel` re-presenting existing reads — **no backend, no schema/migration, no flag, no new egress; reversible.** Four deltas, all from build-order item #6 + the state-flow matrix §D:
- **Candidate-vs-adopted:** wired the existing (previously unused) `practiceKb.listAdoptions` query in. A surfaced candidate already adopted into this matter now reads **"Adopted"** (with its snapshotted `verificationStatusAtAdoption` posture) instead of re-offering the adopt act.
- **Deliberate-commit + audit:** the material KB acts (adopt / abstract / promote / mark-verified) now use the standardized `DeliberateActButton` (its header already named "#6 (KB adoption)" as the planned reuse). Server `kb_events` audit unchanged.
- **Provenance/currency legibility:** surfaced candidates carry the R2 #5 `ProvenanceBadge` (verification facet).
- **Show-ready states (definition of done):** loading skeleton + a designed inline error notice (never blank); the two remaining **blue** pills on this surface swept to semantic `--wa-` tints.
- Tests: new jsdom render test `knowledgeBaseAdoption.render.test.tsx` (ci-gotchas #10); existing `fold_kb_1_inc5_ui` source-audit stays green (all `.mutate` call sites preserved). **First CI run went RED** (4 new render assertions "expected null to be truthy") — the test mock captured each query object by reference at `vi.mock` setup, so per-test reassignment never reached the component; fixed to read `mock[key]` fresh per render; second run green.

**⚠ SCOPE JUDGMENT to revisit (non-blocking).** I scoped the deliberate-commit conversion to the KB **record/posture** acts (adopt/abstract/promote/mark-verified) and intentionally **left `paKey`-confirm and file-memo as routine** buttons. The state-flow matrix marks `paKey`-confirm as a ✦ deliberate act — I treated it as matter/profile config rather than a #6 *adoption* act and deferred it to a later profile-surface increment. Flag for the operator to veto if the matrix marking should hold.

**Build state.** `main` = **`5bdeb44`**; prod still `3ce1324`. Display-only → rides the next operator deploy. **Unshipped display batch is now R1-CLEANUP-1 + R2 #3 + R2 #4 + R2 #5(inc1+inc2) + R2 #6** — all display-only, no migration. A batch deploy + live-verify is increasingly worth doing to keep the gap small (deploy stays operator-gated; not a phase boundary, so no DEPLOY PROMPT auto-fired).

**Next (R2):** R2 #7 (Matter Record ledger — read-only `audit_events` projection) → #8 (nav-only command palette) → #9 (R3 polish). Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). The untracked `docs/engagements/FOLD-ORCH-1-divergent-persistence-decision.md` (§3.1 FIRE) remains uncommitted, left alone per operator. Open chips: `task_bc281353`, `task_b0f9ffb5`. Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 (+R2 #5 inc2) — R2 #5 increment 2 MERGED (`0bae0e0`, PR #192) — draft-body provenance badge → **R2 #5 COMPLETE**

**What changed.** Built + merged **R2 #5 increment 2** → `main` via [PR #192](https://github.com/kelly148/lex-law-next5/pull/192), squash **`0bae0e0`**, CI green (merged by Claude per the standing rule). Applies the `ProvenanceBadge` (inc1) to the **draft body**: DocumentDetail's document header shows a single `verification="unverified"` badge when the draft drew on an unverified KB memo (`documents.drewOnUnverifiedKb`, KB-1). One meaningful, gated badge — not confetti. Display-only; flags untouched; no migration; reversible. Source-guard test (the badge itself is render-tested in inc1).

**Review-pane provenance — intentionally NOT a per-reviewer badge** (every reviewer is an AI model → confetti, which the disposition warns against). Already served by the R2 #2 "review basis: version X as of [time]" line + the R2 #4 export-safety panel. → **R2 #5 is COMPLETE** for the in-scope surfaces (KB + authorities, inc1; draft body, inc2).

**Build state.** `main` = **`0bae0e0`**; prod still `3ce1324`. Display-only → rides next deploy. **Unshipped display batch is now sizable: R1-CLEANUP-1 + R2 #3 + R2 #4 + R2 #5 (inc1+inc2)** — all display-only, no migration. Recommend a batch deploy + live-verify soon to keep the gap small.

**Next (R2):** R2 #6 (KB/source-authority adoption surface) → #7 (Matter Record ledger) → #8 (nav-only command palette) → #9 (R3 polish). Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Open chips: `task_bc281353`, `task_b0f9ffb5`. Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 (+R2 #5 inc1) — R2 #5 increment 1 MERGED (`dfb61af`, PR #190) — provenance/currency badge grammar + low-risk surfaces

**What changed.** Built + merged **R2 #5 increment 1** → `main` via [PR #190](https://github.com/kelly148/lex-law-next5/pull/190), squash **`dfb61af`**, CI green (merged by Claude per the standing rule). One reusable **`ProvenanceBadge`** with a fixed four-facet grammar (origin · verification · currency · severity), tone-coded chips, **click/focus inline-expand** disclosure (never hover-only — a11y rule; real `<button>` for keyboard). Semantic `--wa-` tints only (no blue). Display-only; flags untouched; no migration; reversible.
- **Grammar (pure unit-tested resolvers):** model_derived/counterparty → attention; verified/attorney_verified_current → good; unverified/stale → attention; superseded/not_legal_authority → muted; lifecycle superseded → muted; severity blocker → alert / review → attention. Normalizes source-authority (3-state) + KB-memo (5-state) verification vocabularies.
- **Low-risk surfaces (per disposition "KB/citations/authorities first"):** KnowledgeBasePanel (raw gray verificationStatus pill → badge) + MatterStateDashboard source-authority rows (origin/lifecycle text → badge with origin+verification+currency).
- **STAGED:** this is **increment 1**. Draft body + review-pane provenance = a **LATER R2 #5 increment** (deferred per disposition "draft body + review pane last").
Tests: pure facet-grammar + render/disclosure (ci-gotchas #10); full client render suite green (no regression).

**Build state.** `main` = **`dfb61af`**; prod still `3ce1324`. Display-only → rides the next operator deploy (batches with R1-CLEANUP-1 + R2 #3 + R2 #4 — all display-only, no migration; a sizable unshipped display batch is accumulating).

**Next (R2):** R2 #5 increment 2 (draft body + review-pane provenance), then R2 #6 (KB/source-authority adoption surface), #7 (Matter Record ledger), #8 (nav-only command palette), #9 (R3 polish). Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa` client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Open chips: `task_bc281353`, `task_b0f9ffb5`. Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 (+R2 #4) — R2 #4 MERGED (`656ed92`, PR #188) — unverified-KB flag at the override moment (WARN-only) + grouped reasons

**What changed.** Built + merged **R2 #4** (export-safety gate UI delta) → `main` via [PR #188](https://github.com/kelly148/lex-law-next5/pull/188), squash **`656ed92`**, CI green (merged by Claude per the standing rule). R2 #4's core was already shipped by FOLD-SEND-1 Inc 4 (`ExportSafetyPanel`: verdict + findings + recorded-override + shadow/enforce + matter-header sendability chip from R2 #3); this PR adds the two genuine deltas. Display-layer + read of an existing flag; **flags untouched** (`SENDABILITY_GATE_ENABLED` + `CONFLICT_GATE_ENABLED` stay OFF); **NO migration**; reversible.
- **Unverified-KB at override:** the existing `documents.drewOnUnverifiedKb` flag (KB-1, durable, survives versioning) → `assembleSendabilityContext` → `SendabilityContext.drewOnUnverifiedKb` → `evaluateSendability` emits a **WARN** finding (`unverified_kb`) via the existing place()/findings/recorded-override/eval-log machinery, landing at the override moment by construction. Warn, never block (fail-to-warn; distinct from the conflicts gate's fail-closed). Shadow-safe.
- **No migration, hardened two ways:** `unverified_kb` added to the **shared** engine vocabulary only, NOT the `schema.ts` mysqlEnum — never reaches `sendability_rule.category`/`sendability_override.category`. (1) a guard test pins the engine-only-vs-DB-enum asymmetry; (2) a runtime guard in `insertSendabilityOverride` rejects the category at the persistence boundary (overrides are block-only anyway).
- **Grouped reasons:** `ExportSafetyPanel` groups findings under Blocking / Review headers (severity).
- **Deferred:** verify-to-clear (clearing the flag via `markMemoReverified`) — follow-up.

**⚠ CONSCIOUS INTERIM POSTURE (operator-directed; revisit at the flag flip).** Warn-only is a deliberate interim choice. The FOLD-SEND-1/R2 disposition leans toward **block-with-override** ("barred from clearing outbound without current verification"); warn-only was chosen partly to **avoid the enum migration while the gate is in shadow** (`SENDABILITY_GATE_ENABLED` OFF). **When `SENDABILITY_GATE_ENABLED` flips to enforce, REVISIT** whether `unverified_kb` should become block-with-override — which would require an **additive `sendability_override.category` (and `sendability_rule.category`) enum migration** at that point (the guard test will force that decision to be made consciously).

**Build state.** `main` = **`656ed92`**; prod still `3ce1324`. Display/additive-read only → rides the next operator deploy (batches with R1-CLEANUP-1 + R2 #3, all display-only, no migration).

**Next (R2):** R2 #5 (provenance/currency visual system — staged, KB/citations/authorities first), then #6–#9. Separately the operator-gated R2-PRE-CONFLICT-1 close-out (confirm `poa`'s client party → flip `CONFLICT_GATE_ENABLED` → live-verify). Open follow-up chips: `task_bc281353` (migration-runner fail-loud guard), `task_b0f9ffb5` (status-pill tokens). Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 (+R2 #3) — R2 #3 MERGED (`f138bd9`, PR #186) — matter-state header / readiness strip on MatterDetail (display-only)

**What changed.** Built + merged **R2 #3** (the highest-leverage R2 add) → `main` via [PR #186](https://github.com/kelly148/lex-law-next5/pull/186), squash **`f138bd9`**, CI green (merged by Claude per the standing rule). A single-glance readiness strip at the top of MatterDetail, from **one** `matterState.dashboard` read. Display-only; flags untouched (`CONFLICT_GATE_ENABLED` OFF); **no migration**; reversible. Prereqs were satisfied (PREREQ-1 jurisdiction live; PREREQ-2 conflicts build complete) so the full strip — incl. the conflicts chip — shipped.
- **Backend (additive, read-only):** `matterState.dashboard` gained `conflictClearance` (re-presents the already-computed `evaluateConflictClearance` state/reasons — same predicate the gate consumes, surfaced read-only/owner-scoped) + `jurisdiction` (via `getMatterById`). **Matter-state engine untouched.**
- **`MatterReadinessStrip`** (new), mounted at MatterDetail top only (NOT the matters list — out of scope per the cut cross-matter view). Fixed chip order: **jurisdiction LEADS** (VA/MD inline-editable via `matter.updateMetadata`) · conflicts status · source-authority count · open items (blockers emphasized) · rolled-up review status (operative-doc workflow state — **not** the review-pane denominator) · sendability (`safeToSend`).
- **Conflicts chip framing:** ADVISORY while the flag is OFF — truthful state ("no client party" / "not yet checked" / "client unconfirmed" / "re-check needed" / "cleared"), not "blocked/enforced"; flips to enforcing framing when `CONFLICT_GATE_ENABLED` activates (a one-line copy change). No blue (R1-CLEANUP-1) — semantic `--wa-` tints only. Render test added (ci-gotchas #10).

**Build state.** `main` = **`f138bd9`**; prod still `3ce1324`. Display-only → rides the next operator deploy (batches with R1-CLEANUP-1, both display-only, no migration). 

**Next (R2):** R2 #4–#9 per `_brand\UI_SCOPE_consolidated_disposition_2026-06-04.md` + the state-flow matrix (provenance grammar #2 sequenced behind #3; nav-only command palette; etc.). Separately, the **R2-PRE-CONFLICT-1** close-out (operator-gated): add+confirm `poa`'s client party → flip `CONFLICT_GATE_ENABLED` → live-verify; the conflicts chip then flips to enforcing framing automatically.

**Open follow-up chips:** `task_bc281353` (migration-runner fail-loud guard), `task_b0f9ffb5` (status-pill tokens). Cowork: conflict-arc corrective STATE.

---

## 2026-06-06 — R1-CLEANUP-1 MERGED (`a9a3ab7`, PR #184) — off-palette/off-spec control colors → tokens (display-only)

**What changed.** Standalone low-risk brand cleanup; merged to `main` via [PR #184](https://github.com/kelly148/lex-law-next5/pull/184), squash **`a9a3ab7`**, CI green. Display-only; no layout restructure; no migration; **flags untouched (`CONFLICT_GATE_ENABLED` stays OFF)**. Removes blue (nowhere in the Whereas palette) + heavy navy/black control fills, mapping each control to its button-grammar role. **NOT** a blanket primary→oxblood promotion (that stays the R2 per-control call).
- **UploadFormatPage** (the Document-formatting panel): "Format Document" download primary → oxblood (`bg-accent`/`text-on-accent`); "Upload File / Paste Text" segmented active → subtle surface card (`bg-surface`/`text-ink`/`border-line`/`shadow-sm`), inactive muted.
- **DocumentDetail**: both "Accept Substantive" buttons (the R1-deferred blue) → the `DeliberateActButton` ✦ oxblood commit affordance (`size="sm"`).
- **InformationRequestPage**: `hover:bg-blue-900` → `hover:bg-firm-navy/90`.
Tests: UploadFormatPage render test + source guard (4 control fixes). 

**Out of scope (filed follow-up `task_*`):** non-control status-tint pills still using `bg-blue-100` (substantively_accepted / intake / minor / generating / KB tags) — a semantic status-color decision.

**Build state.** `main` = **`a9a3ab7`**. Display-only — rides the next deploy (operator-gated); not yet on prod. *(NOTE: the R2-PRE-CONFLICT-1 deploy/incident-fix/cleanup arc — prod `3ce1324`, migrations 0019/0020 applied via PR #182, the 9-matter synthetic purge, and the corrective note that the prior `3bff333` "0019/0020 applied" line was an unverified inference — is being recorded separately by Cowork; not duplicated here.)*

---

## 2026-06-05 (later, +Inc 5) — R2-PRE-CONFLICT-1 Inc 5 MERGED (`9626172`, PR #180) → **ENGAGEMENT BUILD COMPLETE** (all 6 BLOCK-until items satisfied). Remaining: operator-gated migration EXECUTION + the flag flip.

**What changed.** Built + merged **Inc 5** on `whereas/r2-pre-conflict-1-inc5` → `main` via [PR #180](https://github.com/kelly148/lex-law-next5/pull/180), squash **`9626172`**, CI green (operator authorized "build now, merge ≠ deploy"). Closes **BLOCK-until #3** — the last. Pure code; **NO schema migration** (it's a runtime data backfill behind an operator-triggered procedure; inert until invoked).

**Mechanism (`src/server/db/queries/conflictsMigration.ts` + 2 procedures).** `migrateClientPartiesForOwner(userId, { dryRun })` backfills a **`confirmed=false`, `source='migration'`** `role='client'` party for every owned matter (incl. archived) with a non-empty `clientName` and no client party yet. `dryRun:true` = preview only (count + sample, **no writes**); `dryRun:false` = insert + **one immutable audit event per insert**. **Idempotent** (skips any matter already having a client party); **never auto-confirms**; **never touches prior `conflict_checks`/`hits`** (staleness is Inc 4's predicate). Pure decision `needsClientPartyMigration` unit-tested. `listConflictsComplianceQueue` = read-only queue of matters with an unconfirmed client party awaiting the Confirm act (Inc 3c). Procedures: `matterIntake.migrateClientParties` (dryRun mutation) + `conflictsComplianceQueue` (query). D2=include archived, D3=minimal queue now / polish rides R2 #3.

**BLOCK-until: ALL SATISFIED** — #1 (3b) · #2 (2/3a) · #3 (5) · #4 (4) · #5 (3a/3c) · #6 (3c). The R2-PRE-CONFLICT-1 **build** is done.

**Build state.** `main` = **`9626172`** (prod still `3bff333`). `CONFLICT_GATE_ENABLED` still **OFF**. Inc 3b/3c/4/5 added **NO new schema migrations** (0019/0020 already on prod from the 3bff333 deploy) → deploying `main` now is a clean **additive code-only** deploy.

**REMAINING to fully close (all operator-gated, in order):**
1. **Deploy** `main` (`9626172`) — additive, no new migration, flag OFF. Makes the confirm UX + prompt marker live and the `migrateClientParties`/queue procedures runnable. (Deploy ≠ execute; nothing enforces yet.)
2. **Retroactive migration — dry-run preview** (`migrateClientParties dryRun:true`): produce count of affected matters + sample of names + edge-case confirmation (empty/whitespace skipped, idempotent, no dup, all `confirmed=false`, no auto-confirm, no prior-check mutation). **Surface for operator approval.**
3. **Migration apply** (`dryRun:false`) — operator-approved only.
4. **Work the Conflicts Compliance Review queue** — Confirm each legitimate client party.
5. **Flip `CONFLICT_GATE_ENABLED=true`** — separate operator gate, timed for after the queue is worked (else matters with unconfirmed clients hard-block). Single reversible flag flip.
6. **Live-verify** (Pattern 16) the enforced gate end-to-end.

Then R2 #3 (the surface that surfaced all this) — jurisdiction chip + header + the now-trustworthy conflicts-status chip.

**Open items unchanged.** Local: tsc 0, eslint 0; Inc5 + ownerScope ratchet + intake-conflicts green; ~12 Windows-only env false-negatives unrelated/green in CI.

---

## 2026-06-05 (later, +Inc 4) — R2-PRE-CONFLICT-1 Inc 4 AUTO-MERGED (`628ddb0`, PR #178) — check-party snapshot + stale-clear invalidation; BLOCK #4 satisfied (only #3 / Inc 5 remains)

**What changed.** Built + **auto-merged** (Rule 15: reversible lane, CI green, no fork/residual surfaced) **Inc 4** on `whereas/r2-pre-conflict-1-inc4` → `main` via [PR #178](https://github.com/kelly148/lex-law-next5/pull/178), squash **`628ddb0`**. Closes **BLOCK-until #4** (constraint D). Pure code; **no migration** (the `conflict_checks.checkedPartyIds` column was already additive from migration 0020).

**Mechanism.** (1) `runConflictCheck` snapshots the exact screened party-id set onto `checkedPartyIds` (additive write of a previously-null column). (2) `evaluateConflictClearance` gains the 4th CLEARED condition (constraint A "current vs the party set") via a **pure, exported, unit-tested** comparator `partyIdSetUnchanged`: a party **added/removed** since the latest check invalidates a prior clear → `NOT_ESTABLISHED 'check_stale_parties_changed'` (re-check); **confirming** a party does NOT change the id set, so it does not force a re-check; a **null/legacy snapshot is fail-closed** (treated as stale).

**Safety.** The new branch is strictly more restrictive — it can only add a `NOT_ESTABLISHED` path, never make something CLEARED that wasn't before (fail-safe). `evaluateConflictClearance` is consumed only behind `CONFLICT_GATE_ENABLED` (OFF), so this is **inert** until the flip; the snapshot write is harmless additive. **Flip-time note:** any matter whose latest check predates Inc 4 (null snapshot) reads stale → must re-check before clearing — consistent with the existing activation constraint (re-checks happen pre-flip / via Inc 5).

**Build state.** `main` = **`628ddb0`** (prod still `3bff333`). `CONFLICT_GATE_ENABLED` still OFF. No migration; reversible.

**BLOCK-until status:** #1 (3b) ✓ · #2 (2/3a) ✓ · #4 (4) ✓ · #5 (3c) ✓ · #6 (3c) ✓. **ONLY #3 REMAINS — Inc 5** (retroactive migration + Conflicts Compliance Review queue; **operator-gated/STAGED data migration**). After Inc 5: the `CONFLICT_GATE_ENABLED` flip (single reversible flag flip), then R2 #3.

**NEXT = Inc 5 (the data-migration increment).** Build (migration runner + Conflicts Compliance Review queue) is reversible build-and-PR; **EXECUTION against prod data is a HARD STOP** (irreversible data mutation — operator-gated; preview count+sample → staging → prod; no auto-confirm, no history rewrite). Plan to be presented for sign-off before building.

**Open items unchanged.** Local: tsc 0, eslint 0; Inc4 + Inc3a + intake-conflicts green; ~12 Windows-only env false-negatives unrelated/green in CI.

---

## 2026-06-05 (later, +Inc 3c) — R2-PRE-CONFLICT-1 Inc 3c MERGED (`c21c7ce`, PR #176) — consumer audit (G/#6) + first-class confirm UX (#5); BLOCK #5 + #6 now satisfied

**What changed.** Built + merged **Inc 3c** on `whereas/r2-pre-conflict-1-inc3c` → `main` via [PR #176](https://github.com/kelly148/lex-law-next5/pull/176), squash **`c21c7ce`**, CI green; `operator approve accept:R2-PRE-CONFLICT-1-Inc3c`. Completes the **consumer audit (constraint G / BLOCK #6)**: no reader of `matter_parties` may treat an UNCONFIRMED row as attorney-asserted. 5 files (+226/-8).

**Audit result.** Readers classified: `runConflictCheck` (screening — unconfirmed *should* be screened), `evaluateConflictClearance` (requires confirmed client, Inc 3a), `ensureAutoClientParty` (existence check) — all correct, **unchanged**. Two fixed: (1) the **analysis-prompt injection** (`matterIntake.generateAnalysis`) now appends a uniform shared `UNCONFIRMED_PARTY_PROMPT_MARKER` (layer0.ts) — `(UNCONFIRMED — screened for conflicts; identity NOT attorney-verified; do not treat as established)` — for unconfirmed parties, plain for confirmed (operator chose option A: annotate, not exclude); (2) the **intake UI** (`MatterIntakePanel`).

**Confirm UX (BLOCK #5).** Per-party status badge (confirmed vs "unconfirmed — screened, not yet verified") + a first-class **Confirm** button → `matterIntake.confirmParty` (procedure + immutable audit already from Inc 3a). Constraint-B side-by-side `clientName`-vs-party display + a **soft, overridable** name-mismatch advisory (never a gate; advisory-grade normalize client-side — canonical `normalizeName` stays server-side). Jsdom render test added (ci-gotchas #10).

**Build state.** `main` = **`c21c7ce`** (prod still `3bff333`). `CONFLICT_GATE_ENABLED` still **OFF** → all conflict enforcement remains inert; the confirm UX + prompt marker are live additively (the marker only matters once the gate enforces; harmless before). No migration; reversible.

**BLOCK-until status:** #1 (caller audit, 3b) ✓ · #2 (auto-party screened + can't clear, Inc 2/3a) ✓ · #5 (confirm UX first-class + logged, 3c) ✓ · #6 (consumer audit, 3c) ✓. **Remaining: #3** (retroactive migration, Inc 5) · **#4** (check-party snapshot + stale-clear invalidation, Inc 4).

**Remaining on R2-PRE-CONFLICT-1.** **Inc 4** (D/#4 — populate `conflict_checks.checkedPartyIds` on a terminal check; add the 4th CLEARED condition to `evaluateConflictClearance`: current check vs current party set; a party mutation after a clear invalidates it) → **Inc 5** (E/#3 — retroactive migration + Conflicts Compliance Review queue; **operator-gated/STAGED** data migration) → then the `CONFLICT_GATE_ENABLED` flip (single reversible flag flip; activation constraint per the entry below) → then R2 #3.

**Open items unchanged** from the entries below. Local: tsc 0, eslint 0; Inc3a/3c + intake-conflicts + panel render all green; the ~12 Windows-only env false-negatives unrelated/green in CI.

---

## 2026-06-05 (later) — R2-PRE-CONFLICT-1 Inc 3b ENFORCEMENT WIRING MERGED (`cfe201c`, PR #174) — flag-gated, DEFAULT OFF (inert); BLOCK-until #1 satisfied

**What changed.** Built + merged **Inc 3b** on `whereas/r2-pre-conflict-1-inc3b` → `main` via [PR #174](https://github.com/kelly148/lex-law-next5/pull/174), squash commit **`cfe201c`**, CI green (Lint + Type Check + Tests). This wires the affirmative `evaluateConflictClearance` predicate (Inc 3a) into **every** conflict-sensitive transition (disposition §3C), replacing the overloaded `hasUndispositionedBlocker` — a complete static + runtime caller audit, **no bypass** (BLOCK-until #1). 5 files (4 edits + 1 test), +339/-14.

**The four transitions, behind a new `CONFLICT_GATE_ENABLED` flag (DEFAULT OFF, same pattern as `SENDABILITY_GATE_ENABLED`):**
- **advance-to-drafting** (`document.create`, documents.ts): FLAG ON → require state `CLEARED`; OFF → legacy `hasUndispositionedBlocker` exactly.
- **lockPlan + cleared-disposition ROOT** (`matterAnalysis.lockPlan`, writes `conflictsClearedForPlanning`): FLAG ON → adds the affirmative clearance requirement on top of the **kept** all-hits-dispositioned gate, so the clearance flag can never be set vacuously.
- **export/send** (`GET /api/documents/:documentId/export`, index.ts): **adds** a conflict gate (none existed). **FAIL-CLOSED** and **independent of `SENDABILITY_GATE_ENABLED`** — the intentional opposite of FOLD-SEND-1's fail-to-warn (documented in code so a future reader won't "fix" it). Gates ALL export states (a draft still leaves the system); carries the distinct reason codes into the 409.
- **finalize** — deliberately NOT gated (export is the deliverable boundary).

One shared predicate, no per-site copies. Distinct non-cleared reasons (`no_conflict_check` / `no_client_party` / `unconfirmed_client_party` / `undispositioned_blocker`) surfaced at every site.

**Build state.** `main` = **`cfe201c`** (prod still **`3bff333`**). **NO behavior change yet** — the flag is OFF, so all four sites behave exactly as before; Inc 3b merges/deploys **inert**. System is in a safe, coherent state.

**ACTIVATION CONSTRAINT (deploy-sequencing — record + honor).** `CONFLICT_GATE_ENABLED` must stay **OFF** until **Inc 3c** (confirm UX + consumer audit G/#6) **and Inc 5** (retroactive client-party migration E/#3) are live. Reason: enforcement requires a CONFIRMED `role='client'` party; today existing matters have none and new matters get an UNCONFIRMED auto-party (Inc 2), so flipping the flag early would **hard-block drafting, plan-lock, and export for every matter** (no confirm UI yet). Activation is then a **single reversible flag flip** — not a combined high-risk deploy. Shipping/deploying 3b now (flag OFF) is safe because merge ≠ deploy and the gate is dormant.

**Remaining on R2-PRE-CONFLICT-1.** Inc 3c (consumer audit G/#6 — `listPartiesForMatter` readers incl. the analysis-prompt injection at `matterIntake.ts:~160`; + the confirm-party UX / conflicts chip; closes BLOCK #5/#6) → Inc 4 (snapshot + invalidate D/#4 — populate `conflict_checks.checkedPartyIds`, add the 4th CLEARED condition) → Inc 5 (retroactive migration + Conflicts Compliance Review queue E/#3 — **operator-gated/STAGED** data migration). Then the flag flip, then R2 #3 (jurisdiction chip + header; conflicts chip rides Inc 3).

**Open items unchanged** from below: deploy batch (now also carries Inc 3b code, flag OFF — additive, no new migration); `task_99ce99c5`; the untracked FOLD-ORCH file (left per Hard Rule 3); carryforwards. Local: tsc 0, eslint 0; targeted Inc3a/3b + fold_l0_1_inc3 + fold_send_1_inc3 + phase3.acceptance + conflicts-intake + matter-state all green. The ~12 Windows-only env false-negatives (`[[ci-gotchas]]` #11) are unrelated and green in CI.

---

## 2026-06-05 (night, deploy) — R2 BATCH DEPLOYED (`3bff333`) + light live-verify PASS; migrations 0019+0020 applied

**What changed.** Operator deployed the batched `main` (`3bff333`) via Railway "Deploy Latest Commit". **prod = `3bff333`** (`/api/version` confirmed `3bff3335…`, builtAt 2026-06-05T19:57Z — correct merged commit, SHA check clean). **MODE B** (manual verify, no auto-rollback). The wired pre-deploy runner ran (deploy succeeded ⇒ its migration step succeeded): **migrations `0019` (matters.jurisdiction) + `0020` (matter_parties.confirmed/confirmedAt/confirmedByUserId + conflict_checks.checkedPartyIds) applied** (both additive).

**Now on prod.** Display: R2 #1 survivability + R2 #2 Inc A (denominator/review-basis) + Inc B (persistent disagreements + ✦ DeliberateActButton). Backend: R2-PRE-JURIS-1 (jurisdiction field) + R2-PRE-CONFLICT-1 Inc 1 (schema) + Inc 2 (auto-create client party) + Inc 3a (clearance predicate + confirm act — **ADDITIVE, NOT enforced**).

**Live verification — PASS (light)** (Claude-driven, browser "UNIVERSALTITLE", authed `kelly`, hard-reloaded): the document page hosting the rebuilt `ReviewPane` renders clean (rebrand intact, serif title, Sendability panel, Version History, tabs, Notes); **no #310 / no console errors** — the big review-pane batch is healthy. Not exercised live: the deep `ActiveSessionView` surfaces (denominator/persistent-disagreements/✦) need an active review session (quota + stuck-session risk) — covered by green CI render tests; hosting bundle verified healthy.

**Caveats true on prod.** (a) **The conflicts gap is NOT closed** — Inc 3a is additive/inert (predicate consumed nowhere; old `hasUndispositionedBlocker` still governs); closes only when **Inc 3b** (enforcement) deploys. (b) **New matters now auto-get an UNCONFIRMED `role='client'` party** (Inc 2); confirm UI + unconfirmed treatment come in Inc 3b/3c. (c) Still **self-use, not client-facing.**

**Build state.** `main` = prod = **`3bff333`**. Deploy batch DRAINED.

**Open items unchanged** from the handoff entry below: Inc 3b → 3c → 4 → 5 (resume per `HANDOFF_BRIEF_2026-06-05_whereas-r2-conflict.md`), then R2 #3, then R2 #4–#9; `task_99ce99c5`; the untracked FOLD-ORCH file; carryforwards.

---

## 2026-06-05 (late night, later) — PREREQ-1 jurisdiction MERGED; R2-PRE-CONFLICT-1 triad DISPOSITIONED (hybrid) → Inc 1/2/3a MERGED (mechanism only; enforcement = Inc 3b, NOT yet wired). Session handoff.

**Consolidated catch-up (several closes since the §7 entry above).**

**PREREQ-1 — R2-PRE-JURIS-1 (jurisdiction):** MERGED to `main` ([PR #167](https://github.com/kelly148/lex-law-next5/pull/167)). Additive `matters.jurisdiction VARCHAR(16)` + migration `0019`; settable via create/updateMetadata; no UI (the VA/MD chip + editor are R2 #3). **R2 #3 unblocked on its non-conflicts elements.**

**PREREQ-2 — R2-PRE-CONFLICT-1 (client-not-a-party conflicts fix): §3.1 FIRE triad RETURNED → operator DISPOSITIONED (hybrid).** Binding repo record: `docs/reviews/R2-PRE-CONFLICT-1_disposition.md` (chosen design, constraints A–G, six BLOCK-until items, 5-increment plan). Consolidated triad doc + lanes in Cowork `…\_analytical\phase2\reviews\`. **Chosen: hybrid, in-table, screen-early, confirmation-gated** + the gate-overload fix as the true headline (all three lanes: `hasUndispositionedBlocker` conflated "no blockers" with "no check / client uncovered" → "cleared" vacuously).

**Conflict-fix increments DONE this session (each CI-green, merged):**
- **Inc 1 ([#169](https://github.com/kelly148/lex-law-next5/pull/169)) — schema.** Migration `0020`: `matter_parties.confirmed` (BOOL NOT NULL DEFAULT TRUE → existing rows confirmed) + `confirmedAt`/`confirmedByUserId`; `conflict_checks.checkedPartyIds` (the §3D snapshot, populated Inc 4). Zod + `insertMatterParty` default `confirmed=true`. No hard `role='client'` constraint.
- **Inc 2 ([#170](https://github.com/kelly148/lex-law-next5/pull/170)) — auto-create + screen-early.** `ensureAutoClientParty` (idempotent, non-destructive) creates an UNCONFIRMED `role='client'` party (`source='auto_from_clientName'`, `confirmed=false`) from `clientName` when none exists; called by `matter.create` + `updateMetadata`. The client is screened from creation (BLOCK #2 first half).
- **Inc 3a ([#171](https://github.com/kelly148/lex-law-next5/pull/171)) — affirmative predicate + confirm act (ADDITIVE; NO enforcement yet).** `evaluateConflictClearance → CLEARED|BLOCKED|NOT_ESTABLISHED` (CLEARED ⇔ check exists ∧ no undispositioned BLOCKER ∧ a CONFIRMED `role='client'` party; "no check"/"unconfirmed-client" are distinct NOT_ESTABLISHED) + `isConflictCleared`. `confirmMatterParty` query + `matterIntake.confirmParty` procedure (immutably audited, attestation) — the explicit confirm act (BLOCK #5).

**Build state.** `main` = **`98eb7ee`** (prod = `64ea044`). **No behaviour change yet** from the conflict work: Inc 3a is additive — the new predicate is NOT consumed anywhere; the OLD `hasUndispositionedBlocker` still gates lockPlan + advance-to-drafting. So the system is in a safe, coherent state at this pause.

**Pending deploy batch (operator-gated, MODE B; all additive).** Display layer: R2 #1 + R2 #2 Inc A + Inc B. Backend: R2-PRE-JURIS-1 (migration `0019`) + R2-PRE-CONFLICT-1 Inc 1 (migration `0020`). **Migrations `0019` + `0020` apply at the deploy gate (pre-deploy runner).** Not yet deployed.

**REMAINING on R2-PRE-CONFLICT-1 (resume in a fresh session — see the HANDOFF_BRIEF):**
- **Inc 3b — enforcement wiring (the ethics-critical caller audit, BLOCK #1).** Replace `hasUndispositionedBlocker` with `isConflictCleared`/`evaluateConflictClearance` at ALL transitions. Audit map found: `hasUndispositionedBlocker` is consumed at exactly two sites today — advance-to-drafting (`documents.ts:175`, `document.create`) and `lockPlan` (`matterAnalysis.lockPlan` via conflicts). **Export is NOT conflict-gated today — must be added** (the FOLD-SEND-1 export/sendability path). Plus the "cleared-disposition" root. Full static+runtime caller audit required — no bypass.
- **Inc 3c — consumer audit (G, BLOCK #6).** Every `listPartiesForMatter` reader must not treat an UNCONFIRMED row as attorney-asserted. Consumers found: the check itself (`conflicts.ts:58` — screening, correct), the intake party list UI (`matterIntake.listParties`), and the **analysis-prompt injection** (`matterIntake.ts:160` "Parties:" — decide whether/how to flag unconfirmed there). + confirmation UX (the conflicts chip in R2 #3).
- **Inc 4 — check-party snapshot + invalidate-on-party-change (D, BLOCK #4).** Persist `checkedPartyIds` on terminal check; party mutation after a clear invalidates it (add the 4th CLEARED condition to `evaluateConflictClearance`).
- **Inc 5 — retroactive migration + Conflicts Compliance Review queue (E, BLOCK #3) — OPERATOR-GATED/STAGED data migration.** Matters with `clientName` + no client party → insert `source='migration'`, `confirmed=false`; preview + staging first; no auto-confirm/history-rewrite.

**Open items.** (a) Inc 3b–5 + R2 #3 (jurisdiction chip + non-conflicts header; conflicts chip rides Inc 3). (b) Deploy batch pending. (c) `task_99ce99c5` (auto-register divergent items — ORCH-1 contract). (d) Untracked `docs/engagements/FOLD-ORCH-1-divergent-persistence-decision.md` (NOT created by this thread; left per Hard Rule 3 — likely the auto-register task's output). (e) Carryforwards unchanged. A dated HANDOFF_BRIEF is written alongside this entry.

---

## 2026-06-05 (late night) — WHEREAS R2 #3 §7 verifications run → R2 #3 PAUSED on two prerequisites (PREREQ-1 jurisdiction PR'd; PREREQ-2 conflicts = §3.1 FIRE, triad pending)

**What happened.** Started R2 #3 (matter-state header / readiness strip) with the prerequisite **§7 verifications**. Findings (by server-side code inspection):
- **§7-1 open_items.severity — MIXED source** (NOT uniformly rule/attorney-assigned): rule-based for conflict-origin items (engine computes blocker/review deterministically); LLM-derived for orchestration/divergent items (mapped from reviewer/evaluator severity). Mitigant in place: FOLD-SEND-1 pinned `stale_baseline` to the adopt-ledger baseline, NOT `open_items.severity`, so the export gate does not inherit it. Impact on #3: open-items COUNT is fine; a severity LABEL carries mixed provenance (display caveat).
- **§7-2 clientName-not-a-party — APPEARS UNCLOSED (ethics-adjacent).** Conflict checking runs only over the attorney-curated `matter_parties` table; `matters.clientName` is never auto-represented as a party and no transition is guarded on the client being a party. So a conflict check can read "cleared" while the client was never checked (`hasUndispositionedBlocker` is vacuously false). The "fix-these-now" item does not appear to have landed. **→ R2-PRE-CONFLICT-1.**
- **§7-3 deliberate-commit audit writes — SATISFIED** (audit_events/kb_events wired across lock/adopt/disposition/kb-adopt/override/conflict-disposition). ✅

Also found: **`matters` has NO `jurisdiction` column** (the handoff's "Source: matters.jurisdiction" was inaccurate; jurisdiction lived only in `jurisdiction_rule` + `practice_memos`). The jurisdiction chip (the LEAD of the strip) needs a new field. **→ R2-PRE-JURIS-1.**

**Decision (operator: "go B").** Pause R2 #3; do both prerequisites first.

**PREREQ-1 — R2-PRE-JURIS-1 (jurisdiction field): BUILT → [PR #167](https://github.com/kelly148/lex-law-next5/pull/167) (CI green, awaiting `operator approve accept:`).** Additive backend-only (migration `0019` `matters.jurisdiction VARCHAR(16)` on its OWN PR, ordered ahead of any §7-2 schema; schema.ts + MatterRowSchema; matter.create/updateMetadata accept+persist+audit; source-scan test). No UI — the VA/MD chip + inline editor land in R2 #3. tsc 0, eslint 0; zodWall + matter-state 46/46.

**PREREQ-2 — R2-PRE-CONFLICT-1 (conflicts fix): §3.1 FIRE — TRIAD PENDING (HALT).** Self-contained triad packet written to `docs/reviews/R2-PRE-CONFLICT-1_packet.md`, mirrored to the Cowork `…\_analytical\phase2\reviews\` (for the GPT+Grok+fresh-Claude triad). Central question = the fix-design fork: (a) auto-represent clientName as a party vs (b) [builder's lean] guard conflict-sensitive transitions until the attorney explicitly adds the client (consistent with explicit matter_parties curation + automate-the-labor-not-the-judgment). **Not pre-implemented; blocked until `operator approve checkpoint:R2-PRE-CONFLICT-1`.** Tracked as chip `task_dcd54aed`.

**R2 #3 re-scope (operator-set).** When PREREQ-1 lands, R2 #3 ships the **jurisdiction chip + non-conflicts header elements** (source-authority currency, open-items count, rolled-up review status, sendability) + the jurisdiction VA/MD inline editor; **only the conflicts-status chip is held** for §7-2. Don't block the whole header on the FIRE.

**Current build state.** `main` = **`57894a8`** (prod = `64ea044`). On `main` awaiting **batched deploy**: R2 #1 + R2 #2 Inc A + R2 #2 Inc B (all display-only, no migrations). PREREQ-1 (`db0ca79`, PR #167, +migration 0019) awaiting accept; once merged + deployed it adds migration 0019 to the deploy batch's pre-deploy step.

**Open items.** (a) PR #167 awaiting `operator approve accept:`. (b) R2-PRE-CONFLICT-1 triad pending (operator-run). (c) `task_99ce99c5` (auto-register divergent items — ORCH-1 contract). (d) **Untracked file flagged (NOT created by this thread):** `docs/engagements/FOLD-ORCH-1-divergent-persistence-decision.md` — likely produced by the spawned auto-register task session; left untouched per Hard Rule 3. (e) Batched deploy still pending. (f) Carryforwards unchanged.

**Next.** Operator: accept PR #167 (jurisdiction) + run the R2-PRE-CONFLICT-1 triad. Then build R2 #3 (jurisdiction chip + non-conflicts header; hold conflicts-status). Deploy batch still parked.

---

## 2026-06-05 (night, later) — WHEREAS R2 #2 Inc B (persistent divergent items + deliberate-act) MERGED to `main` (`57894a8`) → R2 #2 COMPLETE; awaiting batched deploy

**What changed.** Built and merged **R2 #2 Inc B** on `whereas/r2-2b-divergent-persistence` → `main` via [PR #165](https://github.com/kelly148/lex-law-next5/pull/165), squash commit **`57894a8`**, CI green. **Completes R2 #2.** Display-only; no state-machine / acknowledgment changes; **NO new backend** (reuses `matterState.dashboard` + a client filter). 7 files (2 new components/tests, `ReviewPane`, `OrchestrationConsolidationPanel`, + a one-line `matterState.dashboard` stub into 3 existing render tests):
- **Persistent reviewer disagreements (load-bearing safety property):** a new always-visible "Unresolved reviewer disagreements" section in `ActiveSessionView` reads the DURABLE open-items store (`matterState.dashboard → full.openItems`, filtered `origin='orchestration'` + open + this document) — so recorded disagreements **never vanish** on regenerate / session-close / locked-decision overlap. Shown regardless of session/completion state; a render test proves it **survives a session change**. Read-only here + a one-click "Resolve on the matter page" pointer (matterId via `document.get`); boundary-wrapped.
- **`DeliberateActButton`:** reusable ✦ "deliberate act" affordance, visually heavier than an ordinary oxblood primary (filled oxblood + 2px border + accent ring + ✦). **R2 #4/#6/#7 will reuse it.** Used for the orchestration panel's confirm-group + record-disagreements acts.
- **Prominent non-persistence flag** in the orchestration panel ("until you record them, these disappear on the next regeneration or session close") + light token retheme of the disagreements box.

**Decisions (operator-set).** Reuse dashboard (no new query — doc-scoped query is a future optimization only). Read-only + resolve pointer (inline-resolve = pre-approved fast-follow if nav friction-y; SPA soft-nav + scroll-to-item + auto-return is part of that). Keep manual-record + prominent flag. **Separate engagement filed** (chip `task_99ce99c5`): should consolidation AUTO-register divergent items so ORCH-1's never-disappear invariant holds for *unrecorded* items? — surfaced, NOT resolved here (a behavior/contract question, likely a future FIRE).

**Current build state.** `main` = **`57894a8`**. Prod = **`64ea044`** (R1). **Awaiting a BATCHED deploy (all display-only, no DB migrations):** R2 #1 (`c28481b`) + R2 #2 Inc A (`2942222`) + R2 #2 Inc B (`57894a8`). Local gates green pre-merge; CI green on the PR.

**Open items / gate residuals.** (a) **Batched deploy + live-check pending** for the three R2 surfaces (operator-gated, MODE B). (b) `task_99ce99c5` auto-register contract question (independent). (c) Carryforwards unchanged (`LLN-PROD-CLEANUP-1`; reviewer reliability; flip-to-enforce export gate; MODE-A smoke secrets; the FOLD-SEND-1-DEPLOYED STATE.md divergence on `fold/phase-3-cont`).

**Next.** **R2 #3 — matter-state header / readiness strip** (jurisdiction chip LEADS, then conflicts / source-authority currency / open-items count / review status / sendability; the header carries only a **rolled-up review-status chip**, NOT the detailed denominator — that stays in the review pane per Inc A). **Run the §7 verifications first** (open_items.severity is rule/attorney-assigned not LLM; clientName-not-a-party closes before conflict-sensitive transitions; deliberate-commit acts write immutable audit/kb rows) — these gate #3/#4/#7. Investigate + present a plan before building.

---

## 2026-06-05 (night) — WHEREAS R2 #2 Inc A (review-pane clarity) MERGED to `main` (`2942222`) → awaiting deploy

**What changed.** Built and merged **R2 #2 Inc A — review-pane clarity** on `whereas/r2-2a-review-clarity` → `main` via [PR #163](https://github.com/kelly148/lex-law-next5/pull/163), squash commit **`2942222`**, CI green. First of the two-increment R2 #2 split (Inc A = clarity; Inc B = persistence + convergent + deliberate-commit). **Display-only; no state-machine / acknowledgment changes; NO new backend** (re-presents the server-computed orchestration denominator + existing session fields). Changes (`ReviewPane.tsx` + new render test):
- **Session-info strip** rethemed to Whereas tokens and now surfaces, in plain sight (was buried in the collapsed orchestration panel):
  - the honest **N-of-M denominator** ("X of N configured reviewers returned substantive feedback; no return: …; fewer-than-two convergence caveat") — reused from `orchestration.getConsolidation` (React Query dedupes with the panel's identical query; hook hoisted above the early returns per the #310 discipline);
  - a **"Review basis: the draft at iteration N, reviewed <time>"** line — the **anti-stale-review safeguard**, derived from `session.iterationNumber` + `session.createdAt` (already in the `get` response — **the feared new-field follow-on was NOT needed**).
- Light retheme of the pending state + global-instructions chrome.

**Decisions / notes.** (a) Review-basis names the **iteration** (the unit that changes on regenerate — correct staleness granularity), not the "v7" version label; exposing `versionNumber` is a tiny optional follow-on if the version label is later preferred. (b) Denominator shows once reviewers have **returned** (incl. a "0 of N" empty-return), a hair wider than strict completed-with-feedback — honest, and it avoids a brittle source-scan slice (the `completed_with_feedback` literal). (c) Per operator: the matter-state header (R2 #3) carries only a **rolled-up review-status chip**, NOT the detailed denominator — detail stays in the review pane; do not duplicate.

**Current build state.** `main` = **`2942222`**. Prod = **`64ea044`** (R1). **Not yet deployed:** R2 #1 (`c28481b`) + R2 #2 Inc A (`2942222`) are on `main` awaiting a **batched** deploy (operator-gated, MODE B; no DB migrations in either — display-only). Local gates were green pre-merge; CI green on the PR.

**Open items / gate residuals.** (a) **Batched deploy + light live-check pending** for R2 #1 + Inc A. (b) Carryforwards unchanged (`LLN-PROD-CLEANUP-1`; reviewer reliability; flip-to-enforce export gate; MODE-A smoke secrets; the FOLD-SEND-1-DEPLOYED STATE.md divergence on `fold/phase-3-cont`).

**Next.** **R2 #2 Inc B — the load-bearing one:** visibly-persistent divergent items (must NOT vanish on regenerate / session-close / locked-decision overlap — read from the durable matter open-items, not the ephemeral per-session consolidation; stop-and-flag if it needs a new doc-scoped open-items query) + convergent-grouping clarity + the standardized **deliberate-commit (✦)** affordance. Still display-only, no state-transition/acknowledgment changes. Investigate the divergent-persistence data path first, then present a plan + UX decisions for sign-off before building.

---

## 2026-06-05 (evening, later) — WHEREAS R2 #1 (review-pane survivability) MERGED to `main` (`c28481b`) → awaiting deploy

**What changed.** Built and merged **R2 item #1 — review-pane survivability** on `whereas/r2-1-review-survivability` → `main` via [PR #161](https://github.com/kelly148/lex-law-next5/pull/161), squash commit **`c28481b`**, both CI checks green. First R2 surface; hardens the review drawer (`ActiveSessionView`) — the surface that blanked prod twice with React #310 — to degrade gracefully + legibly instead of white-screening. Display-only; **no state-machine / acknowledgment changes** (off-limits; belong to R2 #2). 3 files:
- **`PanelErrorBoundary`** — new `variant="pane"`: full centered fallback that names what is intact (draft + matter record unaffected; nothing sent; export stays blocked) + Close. The `inline` side-panel variant is the default and byte-unchanged.
- **`ReviewPane`** — wraps the drawer body (`ActiveSessionView` / `CreateSessionView`) in the pane-level boundary, so a render throw in the body can never blank the review again.
- **`ActiveSessionView`** — designed loading state; split load-ERROR (retryable: Try again/Close, reads `isError`) from session-GONE (no longer available: Close), replacing the bare "Session not found". Both name what is intact.
- New `reviewPaneSurvivability.render.test.tsx` (loading / load-error+refetch / gone / crash→fallback); the `ActiveSessionView` #310 guard stays green.

**Current build state.** `main` = **`c28481b`**. Prod = **`64ea044`** (R2-1 not yet deployed — merge ≠ deploy; MODE B). **No DB migrations** (display-only). Local gates were green pre-merge (tsc 0, eslint 0 errors, render tests pass); CI green on the PR.

**Open items / gate residuals.** (a) **R2-1 deploy + light live-check pending** (operator-gated; degrade states are hard to trigger on demand — confirm the review pane still opens clean + loading renders; can be batched with later R2 surfaces to save deploy cycles). (b) Carryforwards unchanged (`LLN-PROD-CLEANUP-1`; reviewer reliability; flip-to-enforce export gate; MODE-A smoke secrets deferred; the FOLD-SEND-1-DEPLOYED STATE.md divergence on `fold/phase-3-cont`).

**Next.** **R2 #2 — review-pane clarity rebuild** (honest "X of N reviewers returned", convergent grouping, visibly-persistent divergent items, standardized deliberate-commit, "review basis: version X as of [time]") — the visual layer of the ORCH-1 decision-authority contract; still no state-transition/acknowledgment changes. Run the §7 verifications before surfaces that depend on them (header/export-gate/Matter-Record).

---

## 2026-06-05 (evening) — WHEREAS REBRAND R1 (tokenize + rename) DEPLOYED (`64ea044`) + LIVE-VERIFIED PASS → COMPLETE

**What changed.** Built and merged **R1 of the Whereas redesign** (display-layer only, zero layout change) on branch `whereas/r1-tokenize` → `main` via [PR #159](https://github.com/kelly148/lex-law-next5/pull/159), squash commit **`64ea044`**, both CI checks green (tsc + tests; lint). This is the first increment of the Cowork rebrand handoff (R0 design package → R1 tokenize/rename → R2 component redesign → R3 dark polish). Scope:
- **Token layer:** the verbatim R0 `src/client/styles/whereas-tokens.css` loads as the CSS-variable layer; `tailwind.config.ts` re-points the legacy `firm-*` names to the Whereas palette and adds the `--wa-` semantic palette. Brand colours that take Tailwind opacity use the `rgb(var(--wa-*-rgb) / <alpha-value>)` channel form (RGB companions in `globals.css`) so opacity modifiers keep working; 25 legacy `hover:bg-opacity-90` → `hover:bg-firm-navy/90`.
- **Rename:** serif **"Whereas,"** wordmark (oxblood comma) replaces the "LexLawNext" lockup; light Whereas rail; favicon → `public/whereas-appicon-oxblood.svg`; Fraunces + Inter + IBM Plex Mono via `<link>` (no new npm dep).
- **Type principle:** Fraunces (serif) for the law (matter/document names, titles, rendered draft body); Inter (sans) for chrome; two-weight rule on serif titles.
- **Dark mode** wired via the token layer (explicit `[data-theme]`; default light — full dark polish is R3).
- **Render-test gate:** new `appShell.render.test.tsx` covers the rebranded shell; the full `ActiveSessionView` #310 test remains green.

**Current build state.** `main` = prod = **`64ea044`** (deployed via Railway `Ctrl+K` → Deploy Latest Commit; `/api/version` confirmed `64ea044`, builtAt 2026-06-05T16:34Z, health 200; MODE B). **No DB migrations** in R1 (display-only, code-only deploy). The R1 render gate (full `ActiveSessionView` test) was confirmed present + green before build.

**Live verification — PASS** (`operator approve live-verified:whereas-r1`; Claude-driven in browser "UNIVERSALTITLE", authenticated as `kelly`, hard-reloaded): tab title "Whereas,"; **Matters** page renders the light Whereas rail + serif "Whereas," wordmark (oxblood comma) + matter names/title in Fraunces + warm paper + ink nav; **Matter detail** serif title/doc-names, sans chrome; **Document workspace** (POA iteration test, v7) renders rethemed — serif title, Sendability panel, regenerate band, tabs, Version History; **rendered draft body in Fraunces serif** (type principle); **no #310 / no app console errors** (only benign Chrome-extension message-channel noise). Not exercised: a *live* `ActiveSessionView` review run (LLM quota + stuck-session risk) — covered by the green CI render test + zero review-pane logic change.

**Open items / gate residuals.** (a) Three intentional **R2 deferrals** (flagged, on prod as designed): cool-gray neutrals warmed per-surface in R2; primary CTAs read ink (oxblood-CTA promotion is an R2 per-control call); one blue "Accept Substantive" status button left; Google-Fonts CDN now vs. self-hosting (privacy) in R3. (b) **STATE-TRACKING DIVERGENCE flagged (not reconciled):** the "FOLD-SEND-1 DEPLOYED + PHASE-3 CLOSED" close-out entry (commit `ea979fd`) + the `031b6c8` live record live on `fold/phase-3-cont` and were never merged to `main`, so `main`'s STATE.md lacked them (prod was genuinely deployed at `18d8816`; now `64ea044`). Surface to operator — do not silently reconcile. (c) **This R1 STATE.md upkeep commit is on LOCAL main only** — direct push to `main` was correctly blocked (PR-only workflow); it will reach `origin/main` via R2's PR. Desktop mirror is current. (d) Carryforwards unchanged: `LLN-PROD-CLEANUP-1`; reviewer reliability; flip-to-enforce export gate; MODE-A smoke secrets deferred.

**Next.** **R1 COMPLETE.** Begin **R2 item #1 (review-pane survivability pass)** when the operator is ready — branch off `main` (which will carry this STATE.md commit into R2's PR). R2 re-presents existing data only (no new backend); each surface ships empty/loading/error/partial/stale states + a render test.

---

## 2026-06-05 (afternoon) — FOLD-SEND-1 export-safety BUILD COMPLETE (shadow) → awaiting_live_verification; Phase-3 build complete

**What changed.** Built the full FOLD-SEND-1 deterministic export-safety / outbound-readiness gate on `fold/phase-3-cont` (HEAD `a9c7b58`), 4 increments, each CI-green, built to the triad disposition:
- **Inc 1** ([#154](https://github.com/kelly148/lex-law-next5/pull/154)) — data core: `sendability_rule` + `jurisdiction_rule` + `sendability_override` + `sendability_evaluation` + idempotent owner-null firm-default seeds (migration `0018`); `SENDABILITY_GATE_ENABLED` flag default-OFF.
- **Inc 2** ([#155](https://github.com/kelly148/lex-law-next5/pull/155)) — pure deterministic engine (block/warn/pass; **`wrong_matter_id` the only v1 block**; `stale_baseline` pinned to the `adopt_ledger` baseline, LLM-free; fail-to-warn; content/jurisdiction heuristics) + read-only `getGate`.
- **Inc 3** ([#156](https://github.com/kelly148/lex-law-next5/pull/156), **operator-accepted** — egress touch) — export-boundary wiring: **shadow logging** + enforce-behind-flag + content-hash-bound **override POST** (typed confirm for `wrong_matter_id`); fail-safe at the export endpoint.
- **Inc 4** ([#157](https://github.com/kelly148/lex-law-next5/pull/157)) — the "Export safety" UI panel + recorded-override flow + render test.

**Gate runs SHADOW by default** (flag OFF): exports evaluate + log but are **never blocked** — export behavior is unchanged. v1 block = `wrong_matter_id` only; the rest warn.

**State / gate.** FOLD-SEND-1 `in_progress` → **`awaiting_live_verification`** (operator `y`, Rule 11) — the UI + export wiring need Pattern-16 at the next deploy; migration `0018` is **not yet on prod**. **This was the last Phase-3 engagement → the Phase-3 BUILD is complete** (L0-1 · KB-1 · ORCH-1 · DRAFT-1 · SEND-1). Queue head = **FOLD-PM-1** (Phase 4).

**Current build state.** `main`/prod unchanged at `0d704c9`. `fold/phase-3-cont` ahead by all of FOLD-SEND-1 (migration `0018` + the export-safety panel + the shadow gate wiring).

**Next (operator-gated).** (a) **Deploy** `0018` + SEND-1 (gate stays **OFF/shadow** — no export-behavior change) → live-verify the Export-safety panel + confirm exports still work + shadow logging. (b) **Flip-to-enforce** (`SENDABILITY_GATE_ENABLED=true`) is a **separate, later** decision made on the shadow-mode false-positive data — not now. Carryforwards unchanged (`LLN-PROD-CLEANUP-1`; reviewer reliability; retention sign-off; MODE-A smoke secrets deferred). A full phase-boundary handoff brief is due once Phase 3 fully closes (after deploy + live-verify).

---

## 2026-06-05 (midday) — FOLD-SEND-1 triad disposition (PROCEED WITH NAMED CHANGES) recorded → Inc 1 started

**What changed.** The FOLD-SEND-1 §3.1 FIRE triad completed — three independent lanes (GPT-5 + two independent Claude), all "proceed with named changes"; operator consolidated + signed (`…\_analytical\phase2\reviews\FOLD-SEND-1_consolidated_disposition_2026-06-04.md` + the three raw lanes). Repo-side binding record written: **`docs/reviews/FOLD-SEND-1_disposition.md`** (supersedes the plan's open decisions). Rule-11 transition recorded: FOLD-SEND-1 `queue head` → **`in_progress`**.

**Binding named changes (build to these — not the plan defaults):** gate at the DOCX export boundary, **v1 hard-stops only `wrong_matter_id`** (stale_baseline + missing-signer **warn**, not block; engine reusable for a future real delivery/share); `unverified_statute_citation` **deferred** (warn-only via the LLM layer); every block **overridable + recorded** (append-only, content-hash-bound, typed confirm for matter-id, POST not GET, supersedes on version change); **shadow mode** (flag OFF still computes+logs per category, with an explicit flip criterion); append-only **`sendability_evaluation`** logging + per-category telemetry from the first commit; **fail-to-warn** not fail-to-block; `jurisdiction_rule` document-type-scoped + source-tagged + idempotent seeds + scope-guard (no settlement/title); **no config UI v1** (owner-null firm-default seeds); LLM classifier = **warn layer only**, deterministic blocks pure/LLM-free; audience-leak/GOV-1b **separate, warn-only v1**; rename user-facing **"sendability" → "export safety"/"outbound readiness"** (legacy code name kept).

**Verify-before-relying — both resolved.** (1) `open_items` severity **is LLM-derived** (orchestration `divergentOpenItemRegistration` → `mapOrchSeverityToOpenItemSeverity(group.severity)`); therefore `stale_baseline` is **pinned** to the `adopt_ledger` baseline + version-drift (no `open_items`-severity dependency) — an Inc-2 constraint. (2) the review packet's inlining **held** (all parts inline in the file); the "only the plan arrived" report was a paste issue → paste the whole packet next time.

**Build state.** `main`/prod unchanged at `0d704c9`. FOLD-SEND-1 `in_progress`; **Inc 1 (data core)** building on a sub-branch off `fold/phase-3-cont`: `sendability_rule` + `jurisdiction_rule` + `sendability_override` + `sendability_evaluation` + idempotent owner-null seeds + additive migration + `SENDABILITY_GATE_ENABLED` default-OFF; no behavior change. Deferred: statute-citation block, audience-leak deterministic block, export-intent selector, config UI, flip-to-enforce.

---

## 2026-06-05 (morning, later) — Phase-3 EARLY DEPLOY (`0d704c9`) + FOLD-DRAFT-1 LIVE-VERIFIED PASS → COMPLETE

**What changed.** Operator-gated early partial-phase deploy (Rule-17 deviation — phase 3 isn't done; FOLD-SEND-1 remains). `fold/phase-3-cont` merged to `main` via PR [#153](https://github.com/kelly148/lex-law-next5/pull/153) as **merge commit `0d704c9`** (CI-green, preserves per-engagement commits); operator deployed via Railway. The wired `preDeployCommand` applied additive migrations **`0016` (ldd_key_term)** + **`0017` (closure_package_item)** automatically — **confirmed** because recording into both tables succeeded live. Prod = `0d704c9` (`/api/version`, health 200, builtAt 2026-06-05 13:03Z). MODE B (manual verify, no auto-rollback).

**Live verification — PASS** (`operator approve live-verified:phase-3-early-deploy pass`; Claude-driven UAT, hard-reload first):
- **No #310 regression** — document page + `ActiveSessionView` render clean through create→active; console **zero React errors**.
- **LOI-vs-draft panel** (review pane) — recorded "Governing Law = Virginia" → **present** (engine found it in the draft); "Closing Date = December 31, 2099" → **not found — review** (drift, amber); header "1 to review"; `sourceType`↔`sourceId` invariant enforced.
- **Closing-package panel** (matter page) — "Executed Durable POA" (required/present) → **complete**; added "Witness signature page" (required/missing) → **"1 missing"** with the missing item listed; `itemType`↔`refId` invariant enforced.
- Both **default-safe** (flag/surface only; never edit/finalize/send/lock).

**Current build state.** `main` = **prod** = `0d704c9` — now carries ORCH-1 + provenance + LDD + closing-package; migrations `0007`–`0017` applied. **FOLD-DRAFT-1 → completed** (audience format/tone split + audience-leak filter remain **DEFERRED** → ride FOLD-SEND-1 + GOV-1b egress). `awaiting_live_verification` cleared.

**Open items.** `LLN-PROD-CLEANUP-1` += 2 `ldd_key_term` rows (doc `cbf83ad7`), 2 `closure_package_item` rows (matter `3917bf68`), 1 abandoned GPT-Lite review session (iteration 28). Carryforwards unchanged (reviewer reliability; ORCH-1 FIRE re-triage sufficiency still un-confirmed, non-blocking; retention sign-off; MODE A smoke secrets deferred). Rollback target if ever needed: `3df92dc`.

**Next.** Queue head = **FOLD-SEND-1** — a **§3.1 FIRE** (advisory→deterministic block/warn/pass sendability gate). When started: auto-assemble the triad-review packet to `docs/reviews/FOLD-SEND-1_packet.md` (+ phase2 Desktop mirror) and **HALT** before any implementation.

---

## 2026-06-05 (morning) — FOLD-DRAFT-1 non-deferred scope BUILD-COMPLETE (LDD + closing-package primitives); → awaiting_live_verification

**What changed.** Built **both** remaining FOLD-DRAFT-1 primitives on `fold/phase-3-cont` (HEAD `f0cc384`) — 6 increments, each auto-merged on green CI (Rule 15 reversible lane):
- **LDD (LOI-vs-draft diff):** [#147](https://github.com/kelly148/lex-law-next5/pull/147) `ldd_key_term` data core (migration `0016`) · [#148](https://github.com/kelly148/lex-law-next5/pull/148) deterministic `compareKeyTerms` engine + `sourceType`↔`sourceId` invariant + `getComparison` API · [#149](https://github.com/kelly148/lex-law-next5/pull/149) LOI-vs-draft UI panel in the review pane (+ render test).
- **Closing package:** [#150](https://github.com/kelly148/lex-law-next5/pull/150) `closure_package_item` data core (migration `0017`) · [#151](https://github.com/kelly148/lex-law-next5/pull/151) `computeClosure` completeness engine + `itemType`↔`refId` invariant + `getClosureCheck` API · [#152](https://github.com/kelly148/lex-law-next5/pull/152) closing-package UI panel on `MatterDetail` (+ render test).

All pure engines are deterministic/no-LLM; all queries owner-scoped via `ownerScope()` + Zod Wall; both record paths are attorney-acts, invariant-validated, and audited. **DEFAULT-SAFE / ADVISORY throughout** — they flag value drift / surface missing-required items; they never edit, finalize, send, or lock anything (sending is FOLD-SEND-1). Local gates green every increment (tsc + eslint + vitest incl. render tests for both new panels + ownerScope ratchet); CI green every PR.

**Current build state.** `main`/prod unchanged at `3df92dc` (ORCH-1 + provenance, live-verified). `fold/phase-3-cont` = `f0cc384` — ahead of prod by the LDD + closing-package work, including **two new user-visible UI panels** and **additive migrations `0016` + `0017`** (on the pre-deploy allowlist, **not yet applied** to prod).

**State / gate.** FOLD-DRAFT-1 moved `in_progress` → **`awaiting_live_verification`** (operator `y`, Rule 11) — the two new UI panels need Pattern-16 at the next deploy. The **audience format/tone split + audience-leak filter are DEFERRED** (ride FOLD-SEND-1 + GOV-1b egress). Queue head = **FOLD-SEND-1** (§3.1 **FIRE** — advisory→deterministic block/warn/pass sendability gate; auto-assemble triad packet + HALT before implementation).

**Open decisions (operator-gated).** (a) **Deploy:** early partial-phase deploy now to live-verify the LDD + closing-package panels and apply migrations `0016`/`0017` (MODE B), OR wait for the phase-3 boundary (after FOLD-SEND-1). (b) **FOLD-SEND-1 FIRE** triad review when we start it. Carryforwards unchanged (LLN-PROD-CLEANUP-1; reviewer reliability; ORCH-1 FIRE re-triage sufficiency still un-confirmed but non-blocking; retention sign-off; MODE A smoke secrets deferred).

---

## 2026-06-04 (evening, later) — FOLD-ORCH-1 + provision provenance LIVE-VERIFIED PASS → FOLD-ORCH-1 COMPLETE

**What changed.** Operator gave `operator approve live-verified:phase-3-redeploy PASS`. Claude drove the operator's authenticated browser (UNIVERSALTITLE, `kelly`) against prod `3df92dc` (`/api/version` = `3df92dc3cf…`, builtAt 2026-06-04T18:58Z — the #310-fixed build), hard-reloaded first, on doc `cbf83ad7` ("POA iteration test", matter `3917bf68`). **Results:** (1) **React #310 fix CONFIRMED** — the review pane / `ActiveSessionView` rendered through every loading→completed transition (initial open, create→active, two hard reloads, panel re-opens) with **no blank/crash**; the exact #310 culprit (the `listLockedDecisions` query, now hoisted above the early returns) rendered each time; **console showed zero React errors** all session (only a benign Chrome-extension messaging warning). (2) **Multi-reviewer end-to-end** — two 2-reviewer runs completed server-side: iteration 26 (Claude + GPT Lite) and iteration 27 (GPT + Grok). (3) **Orchestration panel** rendered on screen with the correct **N-of-M denominator**, the Convergent/Per-item/Disagreements buckets, the expand-to-see / no-one-click / attorney-final gating text, and **"0 selected" = nothing auto-acted**; backend `orchestration.getConsolidation` returned the correct denominator with empty bulk-eligible/divergent sets. (4) **Provision provenance panel** — default-safe ("never used to auto-justify"), the **source-type/`originId` invariant enforced** (operative_source + no id → Record button `disabled:true`; adding an id enabled it), and a recorded entry listed with attorney attribution.

**Current build state.** Prod = `main` = `3df92dc` (unchanged — this was verification of an already-deployed build, MODE B; no new deploy). FOLD-ORCH-1 → **completed**; provision-provenance primitive (FOLD-DRAFT-1, 1 of 5) **done + live-verified**. `awaiting_live_verification` now empty. New Phase-3 work branches off `fold/phase-3-cont`.

**Open items / residuals.** (a) **CAVEAT (not a defect):** the orchestration *confirm-a-convergent-group* and *record-disagreements* click-paths were **not** exercised live — neither run yielded two contributing reviewers (Claude as drafter returned 0 suggestions; Grok returned 0; only GPT/GPT-Lite produced). Reviewer-output limitation matching the reviewer-reliability carryforward; those paths are covered by committed render/unit tests and the verified backend consolidation engine. (b) **ORCH-1 FIRE re-triage** recorded as a Class-T corrected-diagnosis with **no new triad packet** (CI-caught Rules-of-Hooks bug, not a new load-bearing decision); operator sufficiency confirmation still pending (record-keeping, non-blocking). (c) **LLN-PROD-CLEANUP-1** += review iterations 26 & 27 on doc `cbf83ad7` (both abandoned — no stuck session left) + 1 `provision_provenance` row recorded during the UAT. (d) Reviewer reliability (Gemini invalid JSON; stuck-active-session; Claude/Grok intermittent 0-suggestion returns); Findings A/B; attorney retention sign-off; MODE A smoke secrets deferred.

**Next (Rule 14 auto-advance).** Queue head = **FOLD-DRAFT-1** remaining primitives: **LDD diff** (LOI-vs-draft + key-term dictionaries) and **package bundle/closure**; audience format/tone split **DEFERRED** (rides FOLD-SEND-1 + GOV-1b egress). Then **FOLD-SEND-1** (§3.1 FIRE). Run the §3.1 checkpoint triage before each.

---

## 2026-06-04 (evening) — FOLD-ORCH-1 + provision provenance RE-DEPLOYED with the #310 fix; live-verification PENDING; thread handoff

**What changed.** The #310 root-cause fix reached `main`: `fold/phase-3-cont` (`1ee2fbb`) merged to `main` via PR [#146](https://github.com/kelly148/lex-law-next5/pull/146) (merge commit **`3df92dc`**, CI-green), and the operator **deployed** it (MODE B). Verified `/api/version` = `3df92dc3cf…`, `/api/health` 200 — the **fixed** build (with #145's hoisted `useQuery`) is live. Migrations `0012`–`0015` already applied (idempotent). So FOLD-ORCH-1 (8 incs) + provision provenance (3 incs) + the #310 fix + the full-tree render guard are all on prod.

**Still open — the gate.** **Live verification has NOT been performed yet** (operator handed off to a new thread first). It is the immediate next action: drive the authenticated browser (hard-reload first to bust the stale bundle), run a multi-reviewer review, confirm the review pane renders through the loading→completed transition (no blank), the orchestration + provenance panels work, and nothing auto-acts → `operator approve live-verified:phase-3-redeploy` → clear the ORCH-1 gate. Rollback target if needed: `0d6e5d0` (Railway deploy `8242d069`).

**Current state.** Prod = `main` = `3df92dc` (fixed, deployed). `fold/phase-3-cont` = `1ee2fbb` (active Phase-3 branch; merged into main via #146). ORCH-1 `awaiting_live_verification`; queue head `FOLD-DRAFT-1` (provenance primitive done). **Full handoff brief:** `…\_progress\HANDOFF_BRIEF_2026-06-04_phase3-orch1-provenance-deployed-310fixed.md` (paste §11 to resume). Carryforwards unchanged (LLN-PROD-CLEANUP-1 += failed-UAT synthetic sessions on doc `cbf83ad7`; ~12 local-env-only test failures with CI authoritative; reviewer reliability; retention sign-off; etc.).

---

## 2026-06-04 (latest) — React #310 ROOT-CAUSED + FIXED + CI render guard (corrected diagnosis; re-deploy gated on ORCH-1 FIRE re-triage)

**Corrected diagnosis (supersedes the panel-hardening theory).** A second early re-deploy (`a417793` re-merged → `main` `31e06e5`, deployed) **still #310-crashed** the review view (confirmed on the *new* bundle after a hard reload — not a cache), so the #142 panel error boundary + unconditional mount were **treating symptoms, not the cause**. Rolled back to `0d6e5d0` again (`operator approve deploy:rollback-0d6e5d0`; `/api/version`=`0d6e5d0813f…`, review pane clean). Then root-caused **offline** (operator directive: no more deploy-to-diagnose).

**The actual root cause.** `ActiveSessionView` (in `ReviewPane.tsx`) called `trpc.reviewSession.listLockedDecisions.useQuery(...)` **after** its `if (isLoading) return` / `if (!data) return` early returns — a **conditional hook**. When `reviewSession.get`'s `isLoading` flips true→false, the hook count changes → **React #310** ("rendered more hooks than the previous render"), unmounting the whole review view. **Latent in `0d6e5d0`** (create→active kept `isLoading` false on the key render); the FOLD-ORCH-1/provenance panels added extra observers to the shared `reviewSession.get` query, flipping `isLoading` on a re-render and tripping it — which is why the panels (fine in isolation) crashed the full tree and the panel-level boundary couldn't help (the bad hook is in `ActiveSessionView`, outside the panels).

**Fix + the guard CI was missing** (PR [#145](https://github.com/kelly148/lex-law-next5/pull/145), merged to `fold/phase-3-cont` `c3f920c`, CI-green): hoist the `useQuery` above the early returns (all hooks before any return; one-line, no behavior change). Plus `activeSessionView.render.test.tsx` — mounts the **full** ActiveSessionView (sections + both panels) through the loading→loaded transition; its mocked tRPC `useQuery` hooks call a real `React.useRef` so a hook below an early return reproduces a real #310. **Proven:** the test FAILS with "Rendered more hooks than during the previous render" on the pre-fix code, PASSES after the hoist. This closes the incident's true gap: **CI now renders the review pane.** (Local full-suite still shows ~12 environment-only failures — docx footer extraction empty on Windows; CI is authoritative and green.)

**Current state.** Prod = `0d6e5d0` (healthy). `main` = `31e06e5` (carries the #310-crashing code — **do NOT redeploy** until the fix is merged to main). `fold/phase-3-cont` @ `c3f920c` = all FOLD-ORCH-1 + provision-provenance + the hardening (#142) + render smoke tests (#143) + the **root-cause fix + full-tree render guard (#145)**, all CI-green.

**Gate / next.** Per operator: **fold the whole incident into ORCH-1's FIRE re-triage before any re-deploy.** ORCH-1 stays `awaiting_live_verification` with a verified fix in hand. Re-deploy path when approved: merge `fold/phase-3-cont` → `main` → deploy → live-verify (the fix means the review pane should now render through the transition). Note: this was a Rules-of-Hooks bug now caught by CI — not a new load-bearing/irreversible decision — so no new triad *packet* was auto-assembled; operator to confirm whether the recorded resolution suffices or a formal triad re-review is wanted. `LLN-PROD-CLEANUP-1` += the synthetic review sessions on doc `cbf83ad7` from the failed UATs.

---

## 2026-06-04 (later) — EARLY PHASE-3 DEPLOY → React #310 CRASH → ROLLED BACK; panels hardened (re-verify pending)

**What happened.** Operator-directed **early partial-phase deploy**: `fold/phase-3-cont` (FOLD-ORCH-1 + provision provenance, 8+3 increments) was merged to `main` as a **merge commit `a417793`** (PR [#141](https://github.com/kelly148/lex-law-next5/pull/141), CI-green, conflict-free) and deployed to prod (pre-deploy runner applied migrations `0012`–`0015`; `/api/version` = `a417793`). **Live verification (Claude-driven in the operator's browser) FAILED:** opening a review session on a document **blanked the whole review view** — console showed **React error #310** (a hooks-order/count violation) from a newly-added review-pane panel, crashing the React tree. The document page itself was fine; the crash was isolated to `ActiveSessionView` (where the new panels mount).

**Rollback.** Operator rolled prod back to the last-good **git commit `0d6e5d0`** (PR #126, FOLD-L0-1 + KB-1) by redeploying Railway deployment **`8242d069`** (its source commit; `/api/version` now reads `0d6e5d0813f…`, review pane renders). `operator approve deploy:rollback-0d6e5d0`. **Key reconciliation:** STATE.md records the *git commit* (`0d6e5d0`); Railway lists *deploy IDs* (`8242d069`, `4d39f5c8`) which are **not** git SHAs — that mismatch (not an error in the record) caused the initial confusion. Rollback was safe: migrations `0012`–`0015` are additive, so `0d6e5d0`'s code runs cleanly against the migrated DB.

**Root-cause + fix.** The exact #310 trigger could **not** be isolated by static inspection (both new panels' hooks are top-level/unconditional; the conditional mount is reconciliation-safe) and there is **no local React runtime** (no `node_modules` / no testing-library/jsdom) to reproduce it. Hardened two ways (PR [#142](https://github.com/kelly148/lex-law-next5/pull/142), CI-green, on `fold/phase-3-cont`): (1) **`PanelErrorBoundary`** wraps each review-pane side panel → a panel crash degrades to a small inline notice and can **never blank the review view again**; (2) the **orchestration panel now mounts unconditionally** and gates visibility **after** its hooks (`visible` prop + `if (!visible) return null`), removing the render-time mount toggle (the most-plausible trigger).

**Current state.** Prod = `0d6e5d0` (working, rolled back). `main` = `a417793` (the broken merge — **do NOT redeploy "latest"**; it's #310-crashing). `fold/phase-3-cont` carries the hardening fix (PR #142). **No re-deploy until the operator approves** — behavioral re-verify is operator-driven live; the error boundary makes a re-deploy safe-by-construction (worst case = a contained panel notice). `state.json`: FOLD-ORCH-1 remains `awaiting_live_verification` (live-verify FAILED once; fix built, pending re-deploy + re-verify).

**Cleanup (LLN-PROD-CLEANUP-1).** Add: the mid-run/stuck **Claude + GPT-Lite review session** created during the failed UAT on doc **`cbf83ad7`** ("POA iteration test", matter `3917bf68`) — left active/incomplete when the page crashed; operator-approved cleanup only.

**Next.** Operator decision: (a) merge PR #142 → re-deploy (boundary-protected) → live-verify; or (b) stand up a local React render-test harness to root-cause/verify pre-deploy; or (c) hold. Reviewer-reliability carryforwards still apply (prefer GPT-Lite/Claude; avoid Gemini).

---

## 2026-06-04 — FOLD-ORCH-1 BUILD COMPLETE (8 increments on `fold/phase-3-cont`; awaiting deploy + live-verify)

**What changed.** The entire **FOLD-ORCH-1** (multi-model orchestration, §3.1 FIRE, triad-cleared *proceed with named changes*) **build is complete** on the Phase-3 continuation branch `fold/phase-3-cont` — **8 increments, all CI-green**: Inc1 engine ([#128](https://github.com/kelly148/lex-law-next5/pull/128), prior) · Inc2a evaluator-membership grouping source ([#130](https://github.com/kelly148/lex-law-next5/pull/130)) · Inc2b per-matter reviewer toggle ([#131](https://github.com/kelly148/lex-law-next5/pull/131)) · Inc3a persistence — `adopt_ledger.confirmationMode` + `open_items.detail` ([#132](https://github.com/kelly148/lex-law-next5/pull/132)) · Inc3b-1 capture evaluator `issueGroups` ([#133](https://github.com/kelly148/lex-law-next5/pull/133)) · Inc3b-2 consolidation read API + idempotent divergent registration ([#134](https://github.com/kelly148/lex-law-next5/pull/134)) · Inc3c-1 consolidation UI panel ([#135](https://github.com/kelly148/lex-law-next5/pull/135)) · Inc3c-2a `confirmationMode` threading + bulk-eligible member exposure ([#136](https://github.com/kelly148/lex-law-next5/pull/136)) · Inc3c-2b expand-to-see bulk-confirm act ([#137](https://github.com/kelly148/lex-law-next5/pull/137)).

**Binding named changes implemented.** Convergence = real successful-reviewer overlap (floor ≥2; the evaluator labels membership but never constitutes it); bulk-confirm only for convergent **and** low-risk, gated by **expand-to-see** (no one-click adopt-all, no typed attestation); divergent → content-preserving open items that **never auto-close** (reuses the `open_items` registry guarantee); per-item **confirmation MODE** recorded (never flattened to "adopted"); per-matter reviewer toggle (the N-of-M denominator); "run orchestration" is attorney-invoked. Three self-fixed CI traps along the way (TS2532 optional-array; a source-scan rename → operator-approved test-assertion; a Zod `.transform()` dropping a new field) are all captured in the CI-gotchas memory.

**Current build state.** `fold/phase-3-cont` HEAD = `bcc230c`. **`main` = `2b6cfdb` (= prod `0d6e5d0`, code-identical) — NOTHING DEPLOYED.** The ORCH-1 build is entirely on the phase branch. `state.json`: **FOLD-ORCH-1 moved `queue` → `awaiting_live_verification`** (Rule 11, operator "go"); **queue head → `FOLD-DRAFT-1`** (may proceed in parallel on the phase branch; does not depend on ORCH-1 live-verify).

**Open items / gate residuals.** **4 pending additive migrations** on the pre-deploy allowlist: `0012` (`matters.orchestrationLanes`) + `0013` (`adopt_ledger.confirmationMode` + `open_items.detail`) + `0014` (`feedback_evaluations.issueGroups`). **ORCH-1 needs deploy + Pattern-16 live verification** (operator-driven) to truly close — via the Phase-3-boundary merge → deploy (Rule 17/18) **or** an operator-chosen early partial-phase deploy (precedent: FOLD-L0-1/KB-1). **Live-verify checklist:** expand-to-see truly gates the Confirm; confirming a convergent-low-risk group selects its members tagged `bulk_acknowledged_low_severity_convergent`; Regenerate writes that mode to the adopt ledger; per-item adopts record `individually_adopted`; "record disagreements" creates never-auto-close open items; nothing auto-adopts/auto-regenerates/auto-closes. Prior carryforwards persist (retention sign-off; `kelly` credential unrotated; `SMOKE_*`/`RAILWAY_TOKEN` deferred → MODE B; `LLN-PROD-CLEANUP-1`; Cowork `_analytical\phase2` governance mirror). Stale local branch `lex-next/fold-orch-1-inc1` left untouched (branch deletion is gated).

**Next.** FOLD-DRAFT-1 (normal automation; rides FOLD-SEND-1 + GOV-1 reviews — likely a focused start/scoping) → FOLD-SEND-1 (§3.1 FIRE). Then the Phase-3-boundary merge → deploy → live-verify the whole phase (ORCH-1 included). Deploy stays operator-gated (`operator approve deploy:`); nothing forces it now.

---

## 2026-06-03 — PHASE-3 PARTIAL DEPLOYED + LIVE-VERIFIED (FOLD-L0-1 + FOLD-KB-1 on `main`/prod)

**What changed.** A **deliberate, operator-directed deviation from the Rule-17 per-phase-boundary cadence**: FOLD-L0-1 + FOLD-KB-1 were merged **early** from `fold/phase-3` → `main` ([PR #126](https://github.com/kelly148/lex-law-next5/pull/126), **merge commit `0d6e5d0`**, full CI green) so the **FOLD-KB-1 Inc4 dispatch-chokepoint hot-path** change could be verified before FOLD-ORCH-1/DRAFT-1/SEND-1 stack on top. The operator then **deployed `0d6e5d0` to prod** (Railway manual trigger, **MODE B** — smoke secrets deferred); the pre-deploy runner applied migrations **`0007`–`0011`** (additive/idempotent/guarded; first real run; deploy success ⇒ migrations passed; `/api/version` = `0d6e5d0` confirmed). Claude then ran a **live UAT** against prod by driving the operator's authenticated browser (no credential handling), and the operator gave **`live-verified:phase-3-partial`**.

**UAT results (all PASS).** (1) **Inc4 hot-path NON-BREAKING** — `generateAnalysis` ran end-to-end through the modified `executeCanonicalMutation`, producing a structured assessment/plan/open-questions/recommended-documents that reflected current matter state; the base-prompt path (no `paKey`) completes; the rollback-sensitive concern is cleared. (2) **Conflicts-at-intake full cycle** — role-aware **BLOCKER** on the client-here/adverse-there crossing + rationale-required gate; `document.create` refused with `CONFLICTS_BLOCKER_UNDISPOSITIONED` while undispositioned, then succeeded after a rationale-backed clear. (3) **KB surfacing** — memo filed most-private (`raw`/`matter_only`/`unverified`), surfaced with the specific currency warning, adopted with no error. Both disclosures (false-negative + KB-derived) shown; no console errors.

**Current build state.** `main` HEAD = `0d6e5d0`, **deployed to prod**, **live-verified**. `fold/phase-3` retained. The **"self-use only until FOLD-L0-1 live-verified" gate is CLEARED**.

**Open items / gate residuals.** **Findings (carryforwards, not regressions):** (A) the conflicts engine matches **recorded `matter_parties`**, not the creation-time `clientName` field — the client must be added as a party to be checked (UX note); (B) **no PA-profile create/activate UI in Inc5** — only `paKey` confirmation, so the per-PA auto-load "profile loads" branch isn't UI-exercisable yet (server-complete + unit-tested + non-breaking in prod; `kb_events pa_profile_loaded_for_job` not UI-surfaced) → candidate follow-up. KB deletion-enforcement wiring still deferred (policy fixed + tested). New synthetic prod data → `LLN-PROD-CLEANUP-1` (matters *UAT Conflict A/B 0603*, parties, doc *UAT Block Test Doc*, memo *UAT 1031* + adoption, one analysis). MODE A smoke secrets + smoke user still deferred. Prior carryforwards persist (attorney retention sign-off; Cowork phase2 mirror).

**Next.** Re-branch **FOLD-ORCH-1** (§3.1 **FIRE**, re-flagged) from the new `main`; run the checkpoint triage; if it fires, auto-assemble the review packet and halt for the external triad review. Then FOLD-DRAFT-1 → FOLD-SEND-1 complete Phase 3.

## 2026-06-03 — FOLD-KB-1 COMPLETE (Practice Knowledge Base) on fold/phase-3

**What changed.** FOLD-KB-1 (§3.1 FIRE, triad-cleared **PROCEED WITH NAMED CHANGES**) is **complete on `fold/phase-3`** across five operator-accepted increments, every one **CI-green on first try**: **Inc1** ([#121](https://github.com/kelly148/lex-law-next5/pull/121), `1295cb4`) — the data core: `pa_instruction_profiles` + `practice_memos` (migration `0008`), Zod Wall, owner-scoped queries (capture always most-private), the PURE **abstraction-required** access gate (stricter than FOLD-L1-4; surfacing == invocation), and `formatCurrencyWarning` (specific, never age-derived). **Inc2** ([#122](https://github.com/kelly148/lex-law-next5/pull/122), `cddd53f`) — adoption provenance: `kb_adoptions` + the durable `documents.drewOnUnverifiedKb` flag that **survives versioning** (migration `0009`), `adoptMemoIntoMatter` (gate → transactional provenance + matter audit + flag), deterministic surfacing (omits `originMatterId`), and the tRPC router. **Inc3** ([#123](https://github.com/kelly148/lex-law-next5/pull/123), `107d1c9`) — lifecycle: `kb_events` firm-level append-only audit (migration `0010`; operator-chosen over a nullable `audit_events`), the attorney-acts (`abstractMemoFromRaw` attorney-attested / `promoteMemoToReuse` abstraction-gated / `markMemoReverified` / `supersedeMemo` / `activatePaProfile`), and the retention policy (pure, tested). **Inc4** ([#124](https://github.com/kelly148/lex-law-next5/pull/124), `ca4a231`) — per-PA master-prompt **auto-load at the `executeCanonicalMutation` chokepoint**: `matters.paKey` (migration `0011`) + `confirmMatterPaKey`, a **degrade-safe** test-injectable provider (best-effort; base prompt on failure — mirrors matter-state injection), R11 capture via `kb_events pa_profile_loaded_for_job` (no jobs-table change). **Inc5** ([#125](https://github.com/kelly148/lex-law-next5/pull/125), `7782577`) — `KnowledgeBasePanel` UI (surface-not-inject; adopt; lifecycle acts; capture-from-analysis) wired into `MatterDetail`; **closes FOLD-KB-1**. Both operator retention decisions (retention-posture §5) are encoded: abstracted memos outlive origin-matter deletion (attested + owner-only provenance link); raw delete with the matter; `firm_wide` = firm-scoped, abstraction-gated, attorney-#2 forward-compatible.

**Current build state.** `fold/phase-3` HEAD = `7782577`. `main` unchanged at `9edfef8` (Phase 1+2, deployed). Phase-3 additive migrations on the pre-deploy allowlist: `0007` (L0-1) + `0008`/`0009`/`0010`/`0011` (KB-1). No prod deploy — merge ≠ deploy; deploy stays gated (`operator approve deploy:`).

**Open items / gate residuals.** **Live-verification PENDING** (post-deploy, Pattern 16) for FOLD-L0-1 **and** FOLD-KB-1 — including the **Inc4 hot-path check** (a draft/review run with a confirmed `paKey` loads the profile; one without is byte-identical). Still **self-use only**. KB **deletion-enforcement wiring deferred** until a matter hard-deletion / PERSIST-1 path exists (the policy is fixed + tested now). Prior carryforwards persist (Phase-2 deploy live-verify; attorney retention sign-off; `RAILWAY_TOKEN`/`SMOKE_*` + smoke user; Cowork phase2 governance mirror; LLN-PROD-CLEANUP-1).

**Next.** Auto-advance to Phase-3 queue head **FOLD-ORCH-1** (§3.1 **FIRE**, re-flagged: new decision-authority/judgment-automation contract) — run the checkpoint triage; if it fires, auto-assemble the review packet and **halt** for the external triad review before implementation. After the remaining Phase-3 engagements (FOLD-ORCH-1 → FOLD-DRAFT-1 → FOLD-SEND-1): the Phase-3-boundary merge `fold/phase-3` → `main` (Rule 17) + a Rule-18 deploy prompt.

## 2026-06-03 — FOLD-L0-1 COMPLETE (Layer-0 Matter Intake & Analysis) on fold/phase-3

**What changed.** FOLD-L0-1 (§3.1 FIRE, triad-cleared "PROCEED WITH NAMED CHANGES") is **complete on `fold/phase-3`** across three increments. **Inc1** (server core, `a5f6d4d`): migration `0007` (matter_parties, conflict_checks, conflict_hits, matter_analysis + matters.analysisStatus; additive; pre-deploy allowlist), deterministic role-aware conflicts engine, the query layers (runConflictCheck DB-side, dispositionConflictHit blocker-rationale-required + audit, lockPlan gated on conflicts cleared), the suggest-only model lane, the matterIntake router, and the shared false-negative-disclosure constant. **Inc2** ([PR #119](https://github.com/kelly148/lex-law-next5/pull/119), `3cf4275`): MatterIntakePanel disposition surface (disclosure shown at the surface; blocker-rationale UI gate; parties; run-check; lock-plan), wired into MatterDetail. **Inc3** ([PR #120](https://github.com/kelly148/lex-law-next5/pull/120), `33636a6`, CI-green first try): single-lane analysis generation (`matterIntake.generateAnalysis` via `executeCanonicalMutation`, Claude default, `jobType matter_analysis`, matter-state auto-injects, Fork-G-safe prompt, fail-loud parse) + the **advance-to-drafting hard-block** in `document.create` (`hasUndispositionedBlocker` → PRECONDITION_FAILED) + the UI generate/render wire. `matter_analysis` added to both `JOB_TYPE_VALUES` lists + the prompt-role map; `jobType` is `varchar(64)` ⇒ **no migration** for the job type.

**Current build state.** `fold/phase-3` HEAD = `33636a6`. `main` unchanged at `9edfef8` (Phase 1+2, deployed). Per Rule 17, `fold/phase-3` merges to `main` as one merge at the Phase-3 boundary (after FOLD-KB-1/ORCH-1/DRAFT-1/SEND-1). No prod deploy — merge ≠ deploy; deploy stays gated (`operator approve deploy:`). Migration `0007` is on the pre-deploy auto-apply allowlist (0004–0007).

**Open items / gate residuals.** **FOLD-L0-1 live-verification PENDING** (Pattern 16, post-deploy, operator-driven) — still **self-use only** until verified. `generateAnalysis` is covered by parse unit tests + structural parity to `outline.generate`, not a full e2e LLM-mock test (deferred to live-verify). Phase-2 deploy live-verification still open. Prior carryforwards persist (retention sign-off; `RAILWAY_TOKEN`/`SMOKE_*` + smoke user deferred; Cowork phase2 governance mirror; LLN-PROD-CLEANUP-1).

**Next.** Auto-advance to Phase-3 queue head **FOLD-KB-1** (§3.1 FIRE): run the checkpoint triage; if it fires, auto-assemble the review packet and **halt** for the external triad review before implementation.

## 2026-06-03 (evening) — MODE A deploy automation (smoke + auto-rollback enablement) + smoke-user helper + Rule 18 collapse

**What changed.** Completed the "click-deploy" automation. **Auto-migrations** (item 1) were already done (`a6312d6`) — confirmed, not duplicated. **MODE A smoke + auto-rollback** (item 2): the post-deploy smoke suite + Railway GraphQL auto-rollback were already coded in FOLD-DEPLOY-VERIFY-1 (`tools/deploy/smoke.mjs`/`smokeCore.mjs` + `post-deploy-smoke.yml`) and activate when the secrets are present; default smoke checks are **non-destructive** (login round-trip + `changePassword`-enforcement; real rotation is opt-in). Added **`scripts/create-smoke-user.mjs`** (`98d00c2`) to provision a dedicated, isolated smoke account (bcrypt cost 12; idempotent; never prints the password; no RBAC so "low-privilege" = separate account). **Rule 18 updated** (`36ff0d0`) with the **MODE A collapse** (single action: Deploy Latest Commit → migrations+verify+rollback automatic; manual = fallback) + the additive-only/destructive-excluded flag + the carry-caveat that the GraphQL auto-rollback is untested against a live token. Mirrored to `_analytical/phase2`.

**Current build state.** `main` HEAD = `36ff0d0` (+ this bookkeeping commit). Prod still unchanged — deploy not yet triggered; auto-deploy OFF; no Railway token handled by Claude.

**Open items / gate residuals.** Operator to: (a) run `create-smoke-user.mjs` against prod; (b) set the 5 GitHub repo secrets (`SMOKE_USERNAME`/`SMOKE_PASSWORD`/`RAILWAY_TOKEN`/`RAILWAY_SERVICE_ID`/`RAILWAY_ENVIRONMENT_ID`); (c) optionally wire the Railway "deployment succeeded" webhook → `repository_dispatch` for fully-automatic post-deploy smoke (else one "Run workflow" click). Auto-rollback to be verified on first real RED. Still self-use only (FOLD-L0-1 pending). Prior carryforwards persist.

**Next.** Operator completes secret setup + smoke user, then deploys (MODE A). Then Phase 3 (FOLD-L0-1, §3.1 FIRE) when directed.


## 2026-06-03 (evening) — Deploy auto-migration wired (Railway pre-deploy); Rule 18 added

**What changed.** Two governance/infra changes landed on `main`. **(1)** Added **operating Rule 18 — deploy-trigger prompts** (`331b758`): deploy stays operator-gated/never-autonomous, but at a deploy-trigger milestone (phase boundary | post-deploy live-verification dependency | urgent/security fix) I proactively surface a DEPLOY PROMPT and halt (CLAUDE.md Rule 18 + master-plan constraint 12; mirrored to `_analytical/phase2`). **(2)** **Auto-apply additive migrations via Railway pre-deploy** (`a6312d6`, PR #118): the Phase-2 deploy is now one operator click — Railway's `deploy.preDeployCommand` runs `scripts/apply-prod-migrations.mjs` (allowlist `0004`→`0005`→`0006`, idempotent, additive-guarded, fails the deploy on error = no half-migrated serving) against its own `DATABASE_URL` before serving. The Dockerfile runner stage now copies the migrations + runner into the slim image (they were absent); `mysql2` is already a prod dep. This **supersedes** the manual TiDB-console path for this deploy.

**Current build state.** `main` HEAD = `a6312d6` (+ this bookkeeping commit). Phase 1 + Phase 2 + the deploy-automation + Rule 18 all on `main`. Prod still unchanged — **deploy not yet triggered** (auto-deploy OFF; the operator's Deploy click is pending). No Railway token requested; deploy stays operator-gated.

**Open items / gate residuals.** **Pending operator action:** Railway `Ctrl+K → Deploy Latest Commit` → pre-deploy auto-applies `0004`/`0005`/`0006` → verify via deploy `[migrate]` logs + a matter's dashboard loading. CI does **not** build the image, so the Docker/pre-deploy wiring is validated by the deploy itself (fails safe). Guard: additive-only in the pre-deploy path; destructive migrations stay manual/operator-gated. Still **self-use only** until FOLD-L0-1 live-verified. Prior carryforwards persist.

**Next.** Operator triggers the deploy; I record the deploy + migration result via Rule 16. Then Phase 3 (FOLD-L0-1, §3.1 FIRE) when directed.

## 2026-06-03 (evening) — PHASE 2 MERGED TO MAIN (Rule 17 per-phase merge)

**What changed.** The Phase-2 boundary merge landed: `fold/phase-2` → `main` via [PR #117](https://github.com/kelly148/lex-law-next5/pull/117), operator-approved, as a **merge commit `122ca6d`** (not squash — preserves per-engagement history on `main` and gives one revertable per-phase merge, Rule 17). All five Layer-1 engagements are now on `main`: L1-1 Matter-State Engine (data model + read contract, migration `0005`) · L1-2 matter-memory injection · L1-3 shared-context substrate · L1-4 reusable-artifact registry + cross-matter gate (migration `0006`) · L1-5 five explicit acts + dashboard (gate G6). Additive + owner-scoped throughout; the `ownerScope` ratchet held across the phase.

**Current build state.** `main` HEAD = `122ca6d` (Phase 1 + Phase 2). `fold/phase-2` retained (not deleted). Full CI was green on the phase branch and on the boundary PR. **No prod deploy** — merge ≠ deploy (Railway auto-deploy OFF); deploy stays gated (`operator approve deploy:`).

**Open items / gate residuals.** **Migrations `0004`/`0005`/`0006` need an out-of-band prod apply** before L1 features return real data in prod (until then they degrade safe/inert). L1-4 cross-matter confidentiality boundary not externally triad-reviewed (operator disposition; mitigated by default-deny + audit). L1-5 UI live on-screen verification operator-driven (Pattern 16). Prior carryforwards persist (retention sign-off; `kelly` credential; `_analytical\phase2` mirror; `RAILWAY_TOKEN`/`SMOKE_*`; `LLN-PROD-CLEANUP-1`).

**Next.** **Phase 3** (spec-novel layers) begins with **FOLD-L0-1** (Layer-0 Matter Intake & Analysis — a §3.1 **FIRE**, gate G8) on a new `fold/phase-3` branched from `main`. Full phase-boundary handoff written to `_progress\HANDOFF_BRIEF_2026-06-03_phase2-complete.md`.

## 2026-06-03 (evening) — FOLD-L1-5 merged → PHASE 2 COMPLETE

**What changed.** **FOLD-L1-5** is merged onto `fold/phase-2` (`608df24`), completing **Phase 2 (Layer-1 Matter-State Engine)** — all five L1 engagements done. L1-5 surfaces the **five explicit acts** as deliberate, visible, confirmable commitments (never inferred): lock (pre-existing `reviewSession.lockDecision`), **tier** (`matterState.tierSource`, forces `designationSource: attorney`), **disposition** (`matterState.dispositionItem`, resolve/withdraw reusing L1-1's transactional-audited paths), **send** (`matterState.recordSend`, fail-visibly audited), and the matter-identity anchor. Plus the inspectable **matter-state dashboard** (`matterState.dashboard` + the `MatterStateDashboard` React component wired into `MatterDetail`) — state summary, sendability, open items, source authority, decision log, and the model-context-packet preview (the exact L1-2 block) — every act behind a single explicit confirm step via `useGuardedMutation`. Gate G6. PR [#116](https://github.com/kelly148/lex-law-next5/pull/116) (one CI red en route: a lint no-duplicate-imports fix, `89c1112`).

**Current build state.** `main` HEAD = `6e486b0` (Phase 1, unchanged). `fold/phase-2` HEAD = `608df24` (+ this Rule-16 bookkeeping commit) — **Phase 2 complete, not yet on `main`.** CI green. No schema/migration in L1-5; server-enforced (the explicit-not-inferred guarantee lives in the API + tests); live on-screen UI verification is operator-driven (Pattern 16).

**Phase 2 summary (5/5 on `fold/phase-2`):** L1-1 Matter-State Engine (data model + read contract; migration `0005`) · L1-2 matter-memory injection (every model call) · L1-3 shared-context substrate · L1-4 reusable-artifact registry + cross-matter gate (migration `0006`) · L1-5 five explicit acts + dashboard. Net-new migrations across the phase: `0005`, `0006` (plus pending `0004`).

**Open items / gate residuals.** **Phase-2 boundary pending:** per Rule 17, full CI on `fold/phase-2` → merge `fold/phase-2` → `main` (one merge), **operator-gated** (decisions/residuals surfaced across the phase → not auto-merge). Then Phase 3 branches `FOLD-L0-1` from `main`. **Migrations `0004`/`0005`/`0006` need an out-of-band prod apply** before L1 features return real data in prod. L1-4 cross-matter boundary not externally triad-reviewed (operator disposition; mitigated by default-deny + audit). Deploy separately gated. Prior carryforwards persist (retention sign-off; `kelly` credential; `_analytical\phase2` mirror; `RAILWAY_TOKEN`/`SMOKE_*`; `LLN-PROD-CLEANUP-1`).

**Next.** Surface the **Phase-2 → `main` merge** (Rule 17) for operator approval, after a full-CI-green check on `fold/phase-2`.

## 2026-06-03 (evening) — FOLD-L1-4 merged (reusable-artifact registry + cross-matter gate)

**What changed.** **FOLD-L1-4** is built and merged onto `fold/phase-2`: MM-8a reusable-artifact registry + MM-8b cross-matter invocation gate with anti-contamination controls. **Classification note:** at triage I *recommended* re-flagging this **FIRE** (cross-matter invocation is a confidentiality/contamination boundary L1-1's single-matter review never adjudicated); the operator dispositioned it **normal automation** (rides L1-1's review per the master plan) — so the cross-matter boundary did **not** get external triad review, and I built it to a conservative default-deny, fail-visibly-audited design to mitigate. The **pure cross-matter gate** is the heart: **default-deny across matters** — a client-derived artifact crosses matters **only** with an attorney-set `cross_matter` scope **AND** an explicit per-use opt-in; firm-level (null origin) and same-matter pass. Every allowed cross-matter invocation is **fail-visibly audited** (no audit ⇒ invocation refused). `reusable_artifacts` (migration `0006`, additive) defaults `reusableScope` to `matter_only`. Owner-scoped query layer + `reusableArtifact` tRPC router (create/list/setScope/invoke). PR [#115](https://github.com/kelly148/lex-law-next5/pull/115) squash-merged as `343e13f` (one CI red en route: a test-only tsc fix, `c5e438a`).

**Current build state.** `main` HEAD = `6e486b0` (Phase 1, unchanged). Active phase branch `fold/phase-2` HEAD = `343e13f` (plus this Rule-16 bookkeeping commit). No existing behavior changed. **Phase 2: 4 of 5 Layer-1 engagements merged** (L1-1..L1-4; remaining **L1-5** — the five explicit acts + matter-state dashboard, **gate G6** — the last Phase-2 engagement, after which the Phase-2 boundary merge `fold/phase-2` → `main` runs under Rule 17).

**Open items / gate residuals.** Migration `0006` (and pending `0004`/`0005`) need an **out-of-band prod apply**. Cross-matter confidentiality boundary not externally triad-reviewed (operator disposition; mitigated by default-deny + audit). Prior carryforwards persist (retention values PENDING ATTORNEY SIGN-OFF; `kelly` credential unrotated; `_analytical\phase2` Cowork mirror; `RAILWAY_TOKEN`/`SMOKE_*` secrets; `LLN-PROD-CLEANUP-1`).

**Next.** Auto-advance to **FOLD-L1-5** (five explicit acts + dashboard, gate G6) — the final Phase-2 engagement — running its §3.1 triage first.

## 2026-06-03 (later still) — FOLD-L1-3 merged (shared-context substrate)

**What changed.** **FOLD-L1-3** is built and merged onto `fold/phase-2`. It implements the FOLD-L1-1-reviewed design (rides the parent review; **not FIRE** — normal automation; cross-lane egress governed by FOLD-GOV-1's reviewed controls) and delivers the **shared-context conversation substrate** (Appendix C.6): thread + materials + matter-state assembled into one coherent, bounded, lane-aware "everyone up to speed" package — **not a raw dump**. It reuses L1-1 (`getMatterState`), L1-2 (`formatMatterStateBlock`), and the existing `assembleContext` pipeline; adds a bounded thread summary and the package shape. Materials are carried as **prioritized metadata only** (id/filename/tokens/priority/pinned) — the actual text continues to flow via the pipeline / L1-2 injection at dispatch, so no raw blobs leak into the package (test-verified). Exposed as the owner-scoped `sharedContext.get` read. PR [#114](https://github.com/kelly148/lex-law-next5/pull/114) squash-merged as `a6f3c68`. No schema/migration.

**Current build state.** `main` HEAD = `6e486b0` (Phase 1, unchanged). Active phase branch `fold/phase-2` HEAD = `a6f3c68` (plus this Rule-16 bookkeeping commit). Purely additive read substrate — does **not** change any existing model-call behavior. CI green first try. Prod unchanged — merge ≠ deploy. **Phase 2: 3 of 5 Layer-1 engagements merged** (L1-1, L1-2, L1-3; remaining L1-4 template registry + cross-matter gate, L1-5 the five explicit acts + dashboard [gate G6]).

**Open items / gate residuals.** Unchanged from the L1-2 entry (migration `0004`/`0005` out-of-band prod apply; retention values PENDING ATTORNEY SIGN-OFF; `kelly` credential unrotated; `_analytical\phase2` Cowork mirror; `RAILWAY_TOKEN`/`SMOKE_*` secrets; `LLN-PROD-CLEANUP-1`). L1-3 adds no new residuals.

**Next.** Auto-advance to **FOLD-L1-4** (reusable-template registry + cross-matter invocation gate with anti-contamination controls) on `fold/phase-2`, running its §3.1 triage first.

## 2026-06-03 (later) — FOLD-L1-2 merged (matter-memory injection)

**What changed.** **FOLD-L1-2** is built and merged onto `fold/phase-2`. It implements the FOLD-L1-1-reviewed design (rides the parent triad review; **not FIRE** — master plan classifies it normal automation) and delivers the **matter-memory injection service**: the "no cold reviews" precondition. The L1-1 `model_context` package (matter phase, operative document, open blockers/substantive, matter-level items, operative source-authority currency, safe-to-send) is now injected into **every** LLM call at the single dispatch chokepoint (`executeCanonicalMutation`) — one hook covers all job types (reviewer, evaluator, drafter, regeneration, outline, IR). It is **best-effort + default-safe** (a failed matter-state read degrades to a byte-identical prompt; a telemetry breadcrumb is emitted) with a `setMatterStateProvider()` test seam mirroring `setJobWriteFunctions`. The block deliberately **excludes** locked-decisions/adoptions (already injected per-document by the reviewer path) to avoid duplication. PR [#113](https://github.com/kelly148/lex-law-next5/pull/113) squash-merged as `76e95c0`. No schema/migration.

**Current build state.** `main` HEAD = `6e486b0` (Phase 1, unchanged). Active phase branch `fold/phase-2` HEAD = `76e95c0` (after this Rule-16 bookkeeping commit). Not Rule-15 auto-merge: a proceed/pause decision was surfaced and the broad blast radius (changes the input to every model call) was flagged, so it stopped for `operator approve accept:`. CI green (Lint + Type Check + Tests) first try. Prod unchanged — merge ≠ deploy.

**Open items / gate residuals.** In production, injection returns **real** matter data only after migration `0005` is applied (otherwise the read fails → best-effort no-op → byte-identical/inert — safe). Once `0005` is applied **and** `fold/phase-2` is deployed, reviewer/drafter behavior shifts (intended "no cold reviews"). Non-breaking for the existing test suite (the new L1-1 query functions are unmocked everywhere, so injection provably no-ops without a test DB). Prior carryforwards persist (migration `0004`/`0005` out-of-band prod apply; retention values PENDING ATTORNEY SIGN-OFF; `kelly` credential unrotated; `_analytical\phase2` Cowork mirror; `RAILWAY_TOKEN`/`SMOKE_*` secrets; `LLN-PROD-CLEANUP-1`).

**Next.** Auto-advance to **FOLD-L1-3** (shared-context substrate) on `fold/phase-2`, running its §3.1 triage first.

## 2026-06-03 — FOLD-L1-1 merged (Layer-1 Matter-State Engine); Phase 2 underway

**What changed.** The first Phase-2 engagement, **FOLD-L1-1**, is built and merged onto `fold/phase-2`. Its §3.1 FIRE was **cleared** by the external triad (GPT + fresh-Claude + third-lane all converged on "proceed with named changes"), and it was implemented to the operator's PROCEED-WITH-NAMED-CHANGES disposition (§4a). It delivers the **Layer-1 Matter-State Engine** — additive, owner-scoped, default-safe, **data model + read contract only** (no model-call injection, no UI): a dedicated `source_authority` table (Fork A — two axes authorityOrigin × lifecycle, explicit-attorney tier with a conservative default, staleness columns with no checking behavior); an `open_items` registry (Fork B/D — persistent, matter- AND document-level, default-safe so auto-detection never closes an attorney item, with resolution links to the audit record); `audit_events` extended with a `disposition` event type + detail columns (Fork C — disposition history is a **read-projection**, no new authoritative table); and the `matterState.get` read surface (`summary` / `full` / `model_context` modes) carrying the **integrity invariant** (every aggregated row's `matterId` must resolve to a matter owned by the same `userId`). Transactional fail-visibly audit was wired into the **new** decision flows only (item 5; existing adopt/lock flows untouched — the operator's chosen scope). Migration `0005` (additive). `fold/**` added to `ci.yml` (Rule 17). PR [#112](https://github.com/kelly148/lex-law-next5/pull/112) squash-merged as `adebaed`.

**Current build state.** `main` HEAD = `6e486b0` (Phase 1, unchanged). Active phase branch `fold/phase-2` HEAD = `adebaed` (FOLD-L1-1). Not Rule-15 auto-merge: a decision was surfaced during the engagement (the item-5 transactional-audit scope fork → operator chose "new flows only"), so it stopped for `operator approve accept:`. CI green (Lint + Type Check + Tests). Prod unchanged — merge ≠ deploy; `fold/phase-2` is not on `main` and deploy stays gated.

**Open items / gate residuals.** Migration `0005` (and the still-pending `0004`) need an **out-of-band prod apply** before the read surface returns data in prod (not needed for CI, which runs without a DB). Attorney mutation tRPC surface + UI for the five explicit acts deferred to **FOLD-L1-5**; matter-state **injection** into model calls deferred to **FOLD-L1-2**. Prior carryforwards persist (retention values PENDING ATTORNEY SIGN-OFF; `kelly` credential unrotated; `_analytical\phase2` Cowork mirror owes the recent governance updates; `RAILWAY_TOKEN`/`SMOKE_*` secrets; `LLN-PROD-CLEANUP-1`).

**Next.** Auto-advance to **FOLD-L1-2** (matter-state injection) on `fold/phase-2`, stopping at its first genuine gate (its §3.1 triage; it implements the already-reviewed L1 design, so likely rides the parent's review).

## 2026-06-02 (late) — governance + infra batch merged; Rule 16 first run

**What changed.** Four PRs merged to `main` (each separately, per operator): **#106** tightened the §3.1 FIRE criterion to the three-prong conjunctive test + re-flagged the fold queue (8 stay FIRE, 10 drop to normal automation, FOLD-ORCH-1 re-flagged FIRE); **#108** added Rule 16 (this log) + Rule 17 (per-phase merges); **#109** made FIRE checkpoints auto-assemble a self-contained review packet then halt (review stays a hard stop); **#107** added FOLD-DEPLOY-VERIFY-1 — the post-deploy smoke suite (health/ready/version-match/401-unauth/login/changePassword + opt-in rotate-and-restore; runs via `post-deploy-smoke.yml`), in **MODE B** (alert-only + exact rollback step; true auto-rollback gated behind an absent `RAILWAY_TOKEN`). This is Rule 16's first bookkeeping run.

**Current build state.** `main` HEAD = `72a5263`. Phase 1 stays on `main` (AUTH-1/TIER-1/GOV-1a/PERSIST-1 all merged). Governance now live: Rules 8, 14, 15, 16, 17 + the tightened §3.1 criterion + packet auto-assemble. Prod unchanged (auto-deploy OFF; `main` ahead by docs + the smoke tooling, nothing functional undeployed).

**Open items / gate residuals.** Unchanged from the seed entry, plus: provide `RAILWAY_TOKEN` (+ service/env ids) for true auto-rollback and `SMOKE_USERNAME`/`SMOKE_PASSWORD` repo secrets to run the smoke suite; **list-membership reconciliation pending a Rule-11 `y`** (move FOLD-PERSIST-1 → completed, record FOLD-DEPLOY-VERIFY-1, advance to Phase 2); the `_analytical\phase2` Cowork mirror now owes Rules 8/14/15 + the §3.1 re-triage + Rule 16/17 + packet-auto-assemble.

**Next.** Start **Phase 2** on `fold/phase-2` with **FOLD-L1-1** (§3.1 FIRE → auto-assemble the review packet, halt for triad review).

## 2026-06-02 — seed entry (Rule 16/17 introduced)

**What changed.** Introduced automated state upkeep + handoff (Rule 16) and per-phase integration branches/merges (Rule 17); this is the first `STATE.md` entry. Earlier today the governance layer was extended on `main`: scope self-approval for the reversible build-and-PR lane (Rule 8, #101), auto-advance on close-out (Rule 14, #103), auto-merge of the reversible lane (Rule 15, #105), the §3.1 FIRE-criterion tightening + queue re-flag (#106), and Railway auto-deploy was **disabled** so merge ≠ deploy (decouple live-verified: the #105 merge did not advance prod).

**Current build state.** `main` HEAD = `d869f21`. MR-CAL COMPLETE; the Whereas fold is open. **Phase 1 (on `main`):** FOLD-AUTH-1 merged (real per-user auth + owner-key chokepoint; gate G3; `AUTH_BYPASS_ENABLED` off prod = G1 closed, live-verified unauth→401); FOLD-TIER-1 merged (context-priority vs source-authority tier rename, gate G4); FOLD-GOV-1a merged (immutable `audit_events` Matter Record + best-effort instrumentation); FOLD-PERSIST-1 merged (#104; retention/DR posture scaffold + default-safe mechanism). Prod is at the FOLD-PERSIST-1 build; `main` is ahead by docs-only governance PRs (nothing functional undeployed).

**Open items / gate residuals.** (1) Retention/DR values are **PENDING ATTORNEY SIGN-OFF** — flip `signoffStatus` in `retentionPolicy.ts` once decided. (2) **Migration `0004_fold_gov_1a_audit_events.sql` not yet applied to prod TiDB** (out-of-band) — audit events won't persist until it is. (3) Deploy is now **gated** (`operator approve deploy:`); never automated. (4) **No `RAILWAY_TOKEN`** → post-deploy smoke runs in alert-only mode (FOLD-DEPLOY-VERIFY-1, PR #107 CI-green, pending accept); provide a token for true auto-rollback. (5) Stopgap `kelly` credential **unrotated** (rotate via `auth.changePassword`). (6) FOLD-GOV-1b privilege-egress posture parked on operator legal decisions; GOV-1c → FOLD-L1. (7) `LLN-PROD-CLEANUP-1` synthetic prod data (operator-approved cleanup only). (8) The `_analytical\phase2` Cowork mirror owes Rules 8/14/15 + the §3.1 re-triage + Rule 16/17.

**Next.** Finish Phase 1 on `main` as-is; start **Phase 2** on `fold/phase-2` with **FOLD-L1-1** (a §3.1 FIRE → auto-assemble the review packet, then halt for triad review before implementation).
