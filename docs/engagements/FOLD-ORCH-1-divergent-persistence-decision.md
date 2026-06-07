# FOLD-ORCH-1 — Divergent-Item Persistence: Contract Decision Doc

Type: Investigation / architecture decision (read-only; no code changed). Surfaced during Whereas R2 #2 Inc B; deliberately **not** resolved inside R2 — this is a behavior/contract decision, not a display change.
Date: 2026-06-05. Repo: `lex-law-next5`. Branch state at write: `main` @ `0fcde3d`, working tree mid-R2 (untouched by this doc).

---

## 1. The question

`orchestration.getConsolidation` computes divergent reviewer disagreements **per session, ephemerally**. They only become **durable** (an `open_items` row, `origin='orchestration'`, `status='open'`) when the attorney clicks **"Record disagreements as open items"** (`orchestration.registerDivergentItems`, idempotent per session). Unrecorded divergences therefore **vanish** on regenerate (new session), session-close, or locked-decision overlap.

R2 #2 Inc B mitigates the **display** side (surfaces recorded items persistently + loudly flags that unrecorded ones won't persist). That flag is interim — it does **not** make ORCH-1's stated invariant ("divergent items are content-preserving, never auto-closed, never silently dropped") actually hold for **unrecorded** items.

**Decide:** should consolidation **auto-register** divergent items so the invariant holds without a manual click?

---

## 2. What the code actually does (verified)

- **`getConsolidation`** ([orchestration.ts:63](src/server/procedures/orchestration.ts)) is a tRPC **query** — pure read, no writes. It returns `divergentItems` computed by the PURE `assembleSessionConsolidation` ([sessionConsolidation.ts:79](src/server/orchestration/sessionConsolidation.ts)). Nothing is persisted.
- **`registerDivergentItems`** ([orchestration.ts:80](src/server/procedures/orchestration.ts)) is the only write. **Idempotent, keyed on `reviewSessionId`** (`o.origin==='orchestration' && o.reviewSessionId===…` → no-op). Triggered solely by the UI button ([OrchestrationConsolidationPanel.tsx:230](src/client/components/OrchestrationConsolidationPanel.tsx)).
- **`registerDivergentOpenItem`** ([openItems.ts:177](src/server/db/queries/openItems.ts)) writes the row as `status='open'`, `statusSource='auto'`, `origin='orchestration'`, `category='divergent_reviewer_feedback'`, **`requiresAttorneyConfirmation=true`**, content-preserving `detail` JSON. **Never-auto-close** is structural: only `resolveOpenItem`/`withdrawOpenItem` (statusSource='attorney', transactional audit row) move a row out of `open`. A later orchestration pass that omits the divergence does **not** close it.
- **Send-gate coupling (the sharp edge):** `countOpenBlockers` ([openItems.ts:104](src/server/db/queries/openItems.ts)) counts `status='open' AND severity='blocker'`. `mapOrchSeverityToOpenItemSeverity` ([divergentOpenItem.ts:23](src/server/orchestration/divergentOpenItem.ts)) maps orchestration `BLOCKER` → `blocker`. So a registered **blocker** divergence **blocks send** until resolved/withdrawn — **today only if the attorney clicks "Record."**
- **No live read-path-write precedent.** `autoRegisterOpenItem` ([openItems.ts:131](src/server/db/queries/openItems.ts)) exists and is documented ("auto-detection MAY create"), but has **zero production callers** (verified by grep). The registry was *built* with a never-auto-close auto-register capability; the divergent path deliberately wired an **explicit attorney mutation** instead.

## 3. What ORCH-1's reviewed design actually said

- Plan §3.4 ([FOLD-ORCH-1-plan.md](docs/engagements/FOLD-ORCH-1-plan.md)): "An undecided divergent item **stays open (surfaces as an open item / blocks 'done')** — it is never silently dropped."
- Triad packet Fork E: "undecided divergent **blocks 'done' / surfaces as an open item**; 'never auto-close' enforced across regenerations."
- Central tenet, repeated throughout the plan and packet: **"automate the LABOR, never the JUDGMENT. The attorney is always final."**

**Key finding — implementation/intent gap.** The reviewed design says divergent items *surface as open items and are never silently dropped*. It did **not** specify that surfacing-as-durable requires a manual click. The implementation introduced the manual-click-to-persist step. That step satisfies the literal "never **auto-close**" (a recorded item never auto-closes) but **violates "never silently dropped"** for the un-clicked case: an unrecorded divergence is dropped on regenerate/close. So the current behavior diverges from the reviewed Fork E intent.

## 4. The decisive frame: ORCH-1's own labor/judgment line

ORCH-1's spine is *automate the labor, never the judgment.* Apply it to the divergence:

- **Persisting the record** of "reviewers disagreed on issue X" = **clerical labor** (record-keeping). Forgetting to click loses an audit fact, not a decision.
- **Resolving the divergence** (adopt one side / withdraw / decide) = **judgment** — and `requiresAttorneyConfirmation=true` already forces the attorney to engage each item before it leaves `open`.

Under ORCH-1's own principle the **record** belongs on the automated side and the **decision** stays manual. The current design has it backwards: it automates nothing and makes the attorney perform the clerical act (clicking "Record") on pain of silent data loss. The loud R2 flag is a band-aid over that inversion — it asks the attorney to do clerical labor reliably, which is exactly what ORCH-1 set out to remove.

## 5. Options weighed

| Option | Closes the gap? | Read-path write? | Audit / "who opened it" | Send-gate effect | Verdict |
|---|---|---|---|---|---|
| **A. Status quo + loud flag** (R2 Inc B) | No — relies on attorney clicking | No | Clean (attorney records) | Blocker divergence blocks send only if recorded | Interim only; invariant does **not** hold |
| **B. Auto-register on every read** (`getConsolidation`) | Yes | **Yes — side-effect on a query** (smell; fires on incidental renders; breaks read-only contract) | "auto/orchestration" — honest | Blocks send as soon as panel is viewed | Rejected — the strongest objection lands here |
| **C. Auto-register on session COMPLETION / consolidation-commit** | Yes | **No** — write on a defined lifecycle event, not on read | "auto/orchestration" + `requiresAttorneyConfirmation=true` — honest machine-surfaced, attorney-confirmed | Blocker divergence blocks send automatically = **what Fork E intended** ("blocks done") | **Recommended** |
| **D. Auto-register behind a flag** | Yes when on | Depends | Same as C | Same as C | Fine as the *rollout mechanism* for C, not a separate answer |

Why **C** over **B**: B's "write triggered by read" is the one objection in the prompt that is genuinely a design defect, not a trade-off. C eliminates it — the persist happens once, on the session finishing (the same point the consolidation is first computed for real), is naturally **idempotent** (already keyed on `reviewSessionId`), and never fires on an incidental panel render.

Why **C** over **A**: A does not make the invariant hold; it documents that the invariant is violated. ORCH-1 committed to "never silently dropped." A loud flag is mitigation, not compliance.

The two real costs of C (honestly stated):
1. **Noise / unwanted items.** Every run with a genuine disagreement spawns a durable `open` item the attorney must withdraw if unwanted. Bounded: consolidation only emits *classified-divergent* groups (not every suggestion); `requiresAttorneyConfirmation=true` marks them visibly pending; the attorney can withdraw. By design these are the highest-signal items.
2. **Auto-blocking send.** A blocker divergence now blocks send without an explicit attorney act. But Fork E **explicitly intends** "undecided divergent blocks 'done'." So C makes the send gate *enforce the reviewed contract* rather than silently under-enforce it. The residual risk is a false-positive block (evaluator over-flags a trivial disagreement as BLOCKER) — mitigated by the existing withdraw path and the severity mapping that only routes true `BLOCKER` to `blocker`.

## 6. Recommendation

**Adopt Option C: auto-register divergent items on session completion / consolidation-commit — NOT on the read path.** Keep the existing "Record" button as an idempotent manual fallback (already a no-op if already registered).

Rationale, in one line: persisting the *record* of a disagreement is labor → automate it (ORCH-1's own spine); deciding it stays judgment → `requiresAttorneyConfirmation` already keeps that manual. C makes the "never silently dropped" invariant actually hold, keeps the audit story honest (machine-surfaced `statusSource='auto'`, attorney-confirmed at resolve), and makes the send gate enforce Fork E as written — all without the side-effect-on-read defect of B.

**This is a §3.1 triad-review FIRE.** It changes a load-bearing, already-triad-reviewed decision-authority/records contract: (a) hard to reverse in spirit (creates durable records + changes when send is blocked), (b) not caught by CI, (c) carries **client-send-safety** + **records-management** risk. Per the loop rules this **halts before implementation** for external triad review. I have **not** written code and do not self-approve. The conditional Phase-A plan below is *for the triad packet*, not authorization to build.

## 7. Conditional Phase-A plan (only if the disposition is "auto-register")

Smallest faithful change; additive; reuses existing machinery.

1. **Trigger point.** Call the existing registration logic from the **session-completion / consolidation-commit** path — i.e. where a review session transitions to its terminal state and the consolidation is first materialized — **not** from `getConsolidation` (which stays a pure query). Candidate seam: the same server path that finalizes the session feedback (reuse `loadConsolidation` → for each `projection.divergentItems` → `registerDivergentOpenItem`), guarded by the existing `reviewSessionId` idempotency check lifted out of the mutation into a shared helper so both the auto path and the manual button share one idempotent register.
2. **Refactor, don't duplicate.** Extract the idempotent "register divergent items for this session" body from `registerDivergentItems` into a shared server function; the mutation and the completion hook both call it. No behavior change to `registerDivergentOpenItem` itself (already never-auto-close, `requiresAttorneyConfirmation=true`).
3. **Flag-gate the rollout (Option D as mechanism).** New default-OFF feature flag (e.g. `ORCH_AUTO_REGISTER_DIVERGENT`) in `featureFlags.ts`. OFF = today's manual-only behavior (safe rollback without revert). Flip ON after triad + live-verify.
4. **Keep the button.** The manual "Record" affordance stays as an idempotent no-op-if-present fallback; R2 Inc B's persistence-display continues to read durable items.
5. **Send-gate is intentionally in scope.** Document that auto-registered `blocker` divergences will count toward `countOpenBlockers` and block send by design (Fork E). No change to `countOpenBlockers`.
6. **Tests.** (a) completion path registers divergent items exactly once (idempotent on re-run / re-read); (b) a blocker divergence increments `countOpenBlockers` after completion without a manual click; (c) regenerate → prior session's divergent items remain `open` (never-auto-close preserved); (d) flag OFF = no auto-registration (current behavior).
7. **Migrations / egress.** **None.** No schema change (reuses `open_items`), no new external/egress contract, no destructive action. Reversible build-and-PR once the triad clears — but the **contract decision itself is the FIRE**, so build only starts post-disposition.

**Out of scope:** changing `getConsolidation` to write; changing severity mapping; touching convergent/bulk-confirm; fixing reviewer-reliability bugs; any UI restructure beyond what already reads durable items.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
