# CHAT-DISPATCH-1 — chat→model dispatch substrate: current-state map, build cards, §3.1 triage

**Engagement:** CHAT-DISPATCH-1 (architecture-planning report; Rule 12 commit-by-default)
**Date:** 2026-06-11 (America/New_York)
**Branch:** `lex-next/chat-dispatch-1` off `origin/main` @ `1adc312`
**Disposition:** §3.1 triage = **SKIP** → reversible build-and-PR (held), backend-only substrate behind `CHAT_DISPATCH_ENABLED` (default OFF). No prod, no migration, no flag flip, no UI change, no master injection.

Evidence classes: *Verified* = confirmed by code inspection this engagement; *Operator decision* = ratified in the planning docs; *Proposed* = recommended, not ratified.

---

## 1. Objective and scope

Build the substrate for a **`chat_turn`** job: route a single chat turn through the existing LLM-dispatch chokepoint (`executeCanonicalMutation`, the enqueue/run split from DISPATCHER-COMPLETE-1) and return a model response, **fully behind a new flag `CHAT_DISPATCH_ENABLED` (default OFF)**. Today the chat composer is an inert placeholder; there is no model round-trip anywhere in the chat surface.

**In scope (this engagement):** the backend `chat_turn` dispatch path (job type, prompt-version mapping, a gated tRPC procedure that enqueues+runs a turn and returns the model text, tests). **Out of scope / deferred:** wiring the visible composer UI; conversation-history persistence (multi-turn threading); the async/deferred-via-dispatcher variant; and **master-prompt injection into chat** (INSTR Phase D — separately blocked on Gate 0 + the dispatch + an external triad review; this substrate injects **no master**).

---

## 2. Current-state map (Verified against code)

### 2.1 The durable dispatcher — `src/server/jobs/dispatcher.ts`
- A polling loop (`pollOnce`, ~2s jittered) reads `getQueuedJobs()` and, per job, looks up `_handlers.get(job.jobType)`. **Job-type-agnostic**: an unknown job type is logged and skipped (`dispatcher.ts:498-505`).
- `registerJobHandler(jobType, handler)` (`:76`) populates the registry. `registerDefaultJobHandlers()` (`:190`) is **gated on `isJobDispatcherEnabled()`** and currently registers **only `reviewer_feedback`** → `runDeferredCanonicalJob(jobId)` (`:192-198`). Flag OFF ⇒ nothing registers ⇒ the dispatcher is a no-op and the **inline** path is byte-for-byte unchanged.
- Completion tracking + bounded retry (D-2/D-3), orphan reaper (JOB-RECOVERY-1, `JOB_REAPER_ENABLED`), and lane deadline sweep (REVIEWER-ASYNC-DISPLAY-1, `REVIEWER_ASYNC_ENABLED`) are all independent and flag-gated OFF.

### 2.2 The chokepoint — `src/server/db/canonicalMutation.ts`
- `executeCanonicalMutation(params)` = `enqueueJob()` **then** `runJob()` (`:854-859`) — the **inline** path, byte-for-byte identical to the pre-split function for every existing caller.
- `enqueueJob` (`:354`) inserts the `jobs` row `status='queued'` (input `{}` placeholder), calls `txn1Enqueue`, emits `job_queued`. `runJob` (`:411`) atomically claims (queued→running; a 0-row claim = cancelled/already-claimed → never double-run), calls the LLM inside a timeout/abort envelope with retry, then `txn2Commit` on success / `txn2Revert` on failure-timeout-cancel.
- **Deferred registry** (`:861-915`): `enqueueCanonicalJobForDispatcher` enqueues 'queued' + registers the continuation; the dispatcher later runs it via the **same `runJob()`** (`runDeferredCanonicalJob`). In-memory + non-durable by design; the `jobs` row survives a restart for JOB-RECOVERY-1.
- **Contract — `CanonicalMutationParams` (`:228-271`):** `userId, jobType, modelString, matterId?, documentId?, txn1Enqueue, buildLlmParams, txn2Commit, txn2Revert, timeoutMs?, telemetryCtx`. `Txn2CommitParams.output` (`:215-220`) = `llmResult.content` (the model text) + token counts. Composition (`resolvePromptComposition`) is consulted in `runJob`; `callRoleForJobType('chat_turn')` falls to `'other'` → `assemblePrompt` returns **legacy (no master)**.

### 2.3 Schema / job types — `schema.ts`, `shared/schemas/jobs.ts`, `promptVersions.ts`
- `jobs.jobType` is **`VARCHAR(64)` (not a DB enum)** → a new value needs **no migration**. The TS allow-list `JOB_TYPE_VALUES` is duplicated in `schema.ts:141-156` **and** `shared/schemas/jobs.ts:28-41` (Zod Wall) and must be kept in sync.
- `jobs.input` / `jobs.output` are flexible JSON envelopes (`JobInputSchema`/`JobOutputSchema`); `roleMetadata` is an open `record`. Output union already includes `type:'text'`.
- `getPromptVersionForJobType(jobType)` (`promptVersions.ts:109`) **throws on an unknown jobType**; mapping lives in `JOB_TYPE_TO_PROMPT_ROLE`. `matter_analysis` reuses the `'drafter'` role for version provenance (`:101`) — `chat_turn` follows that precedent (no new role, prompt file, or env var).

### 2.4 The chat surface — `ChatSurface.tsx`, `chatUi.ts`, CHAT-UI-1 (W0–W3 + #268)
- Entire surface gated behind `CHAT_UI_1_ENABLED` (**default OFF; operator set it `false` on prod**). The **composer is an inert placeholder** (`ChatSurface.tsx:97-103`, "Conversation composer — arrives in CHAT-UI-1 W1") — **no input, no model call today**.
- The W1/W2/W3 floor is already load-bearing and wired: the single confirm component (`ConsequenceConfirm`), the autonomy slider/Auto-Act queue, the tamper-evident per-matter `posture_provenance` ledger, the matter-identity/undo/stale-preview machinery, and the ratified posture-coherence table.
- The "hard-stop acts" (#268) — lock / tier_source / send — are **confirmed consequential mutations** that run only inside `if (outcome.confirmed)`; **`recordSend` writes an internal `audit_events` row only — NO export, NO transmission, NO egress** (`chatUi.ts:176-177`). The dispatch substrate is a *consumer* of this floor, not a new act.

### 2.5 The single-shot model-job template — `matterIntake.generateAnalysis`
- `matterIntake.ts:232-294` is the cleanest request-response template: `assertMatterOwned` → `executeCanonicalMutation({ jobType:'matter_analysis', modelString: PRIMARY_DRAFTER_MODEL, txn1Enqueue, buildLlmParams (system+user), txn2Commit (persist), txn2Revert })`, returning the persisted result. **Ownership flows through every layer** (`getMatterById(matterId, userId)` → `ownerScope(...)`); matter-state integrity fails-visibly on any (userId, matterId) mismatch.

### 2.6 Flags / model config
- Pattern: `export function isXEnabled(): boolean { return process.env['X_ENABLED'] === 'true'; }` (env must be exactly `'true'`). 13 flags, **all default OFF**. `PRIMARY_DRAFTER_MODEL = 'anthropic:claude-opus-4-5'`.

---

## 3. Per-primitive build cards — `chat_turn`

| Facet | Decision |
|---|---|
| **Input schema** | `chatDispatch.submitTurn` input: `{ matterId: uuid, documentId?: uuid|null, turnText: string(1..8000) }`. `userId` is **never** client-supplied — always `ctx.userId` (Ch 35.2). |
| **Stored state** | **Reuse the `jobs` table** — a new `jobType:'chat_turn'` row (no migration; `jobType` is `VARCHAR(64)`). Input/output ride `jobs.input`/`jobs.output` JSON. **No new table** for the substrate; conversation-history persistence is a deferred follow-up. |
| **Trigger** | A protected tRPC mutation `chatDispatch.submitTurn`, gated `assertChatDispatchEnabled()` (PRECONDITION_FAILED `CHAT_DISPATCH_DISABLED` when OFF) then `assertMatterOwned(matterId, ctx.userId)`. |
| **Deterministic vs model step** | Deterministic: flag gate, ownership check, prompt assembly, job lifecycle (enqueue/claim/commit), telemetry. Model step: the single Anthropic `generate()` inside `runJob`'s timeout/abort/retry envelope. |
| **Path** | **Inline** via `executeCanonicalMutation` (the matter_analysis request-response template; the enqueue/run split). The async/deferred-via-dispatcher variant (`enqueueCanonicalJobForDispatcher` + a `chat_turn` handler) is a documented follow-up for non-blocking UX. |
| **Composition** | **Legacy, no master.** `callRoleForJobType('chat_turn')='other'` → `assemblePrompt` returns legacy. The substrate's `buildLlmParams` supplies a minimal neutral system prompt (clearly marked; the firm master is INSTR Phase D, triad-gated). |
| **Output** | The model text is captured in `txn2Commit` (closure) and returned as `{ jobId, status, response }`; it is also persisted durably in `jobs.output` and snapshotted via the existing chokepoint audit. |
| **UI affordance** | **None this engagement.** The composer stays the inert placeholder; flag-OFF *and* flag-ON leave the visible app byte-for-byte unchanged (the procedure is backend-only). Wiring the composer (a render-tested change) is a deferred follow-up. |
| **Audit log** | Existing `prompt_snapshots` (system text + hash + flag state) + `jobs` row + telemetry (`job_queued`/`job_completed`/...). No new audit surface. |
| **Flag** | **`CHAT_DISPATCH_ENABLED`** (default OFF). Flag OFF = the procedure refuses; no model call; no behavior change anywhere. A GUARD test proves it. |

---

## 4. §3.1 external-review triage — **SKIP** (does not fire)

Criterion (CLAUDE.md Rule 13, tightened): a checkpoint FIRES only if the engagement establishes/changes a load-bearing decision meeting **ALL THREE** prongs — (a) hard to reverse once shipped, (b) not caught by CI, **AND** (c) access-control / privilege-confidentiality / ethics-conflicts / client-send-safety / data-destruction risk — plus any §3 Class-T trigger (blocked / failed live-verify / corrected diagnosis / ≥2 failed attempts) which always fires.

- **Class-T triggers:** none (not blocked, no failed live-verification, no corrected diagnosis, no ≥2 failed attempts).
- **Prong (a) — hard to reverse? NO.** Behind `CHAT_DISPATCH_ENABLED` (default OFF), a held PR (no merge), no deploy, no migration. Chat jobs are queryable/cancellable like every job. Revert = the flag stays OFF / revert the PR. **Fails (a).**
- **Prong (b) — not caught by CI? NO (it is CI-caught).** Enqueue→run→response, ownership scoping (the ownerScope ratchet), and flag-OFF inertness are all unit-testable, and this engagement ships those tests. **Fails (b).**
- **Prong (c) — the named risk classes?**
  - *Access-control / confidentiality:* `chat_turn` inherits the **existing** `assertMatterOwned`→`ownerScope` pattern (the matter_analysis template). Reading matter materials into a prompt is an **existing, owner-scoped** behavior shared by draft/analysis/reviewer jobs — not a new decision.
  - *Ethics-conflicts:* the master-selection ethics decision (Law-Firm vs Title posture) is **INSTR Phase D**, explicitly deferred and triad-gated. This substrate injects **no master** (`callRole 'other'` → legacy). It makes **no** ethics-conflicts decision.
  - *Client-send-safety:* the dispatch returns model **text to the requesting attorney**; it does **not** send/transmit/export. The send/lock consequential acts remain in the already-gated W1/W2/W3 confirm floor (`recordSend` is internal-audit-only, no egress). **No new egress surface.**
  - *Data-destruction:* none (append-only/superseded, like all jobs).

**Conclusion:** the substrate **implements an already-decided architecture** (the prompt-injection plan §5.1: "A future chat dispatch must be implemented as a job type through the same helper" — which rode INSTR-1A0's triad review), is reversible + flag-gated, CI-testable, and introduces **no new** load-bearing access-control/send/ethics/data-destruction decision (the one ethics decision is explicitly deferred to the triad-gated Phase D and is **not** built here). Per Rule 13 this **does not fire** → SKIP → reversible build-and-PR (self-approved scope, Rule 8). It would be re-flagged FIRE only if a later increment wires master-into-chat selection (Phase D) — which this engagement does not.

---

## 5. Disposition and follow-ups

**Built (this engagement, held PR, backend-only, behind `CHAT_DISPATCH_ENABLED` default OFF):** the `chat_turn` job type (+ prompt-version mapping), `isChatDispatchEnabled()`, the gated `chatDispatch.submitTurn` procedure (inline `executeCanonicalMutation`, no master), and tests (enqueue→run→response; flag-OFF GUARD; ownership; legacy-composition / no-master proof).

**Deferred follow-ups (not built):**
1. **UI composer wiring** — replace the placeholder with a real composer that calls `submitTurn` (a render-tested client change; ci-gotchas #10).
2. **Conversation-history persistence** — a `chat_turns`/`chat_messages` table (additive migration) for multi-turn threading + context.
3. **Async-via-dispatcher variant** — `enqueueCanonicalJobForDispatcher` + a `chat_turn` dispatcher handler for non-blocking turns (requires `JOB_DISPATCHER_ENABLED`).
4. **INSTR Phase D — master-into-chat injection** — separately blocked on Gate 0 + this dispatch + the external triad review; **not** built here.

**Merge-sequencing note:** this branch touches `JOB_TYPE_VALUES` (`schema.ts` + `shared/schemas/jobs.ts`) and `promptVersions.ts`; INSTR-2B / Phase-D will touch `canonicalMutation.ts` / `assemblePrompt.ts` for chat master injection. There is **no file overlap with INSTR-2A** (PR #275, prompts/manifest + tests). The two held PRs are independent.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
