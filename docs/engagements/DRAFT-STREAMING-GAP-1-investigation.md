# DRAFT-STREAMING-GAP-1 — Diagnostic (read-only)

**Class.** Diagnostic investigation (read-only). Diagnostic-first: confirm the gap, propose the minimal fix, **surface before changing behavior.** No code changed.

**Subject.** Cowork live-tested F3 token streaming on prod (DRAFT_STREAMING_ENABLED set + redeployed, rebuild 13:36 UTC): it does NOT engage on either draft path. Both initial generation (`document.generateDraft`) and regenerate (`document.regenerate`) show a static "Generating draft…" placeholder then the full result at once — **no `/api/stream/draft` SSE call, no incremental render.** Evidence: `outputs/F3_AND_NOTIFICATIONS_TEST_2026-06-21.md`.

**Date.** 2026-06-21 (America/New_York). Traced against `origin/main`; the F3 draft-path files are **byte-identical** between deployed prod (95a5473) and the traced HEAD, so this analysis reflects what is deployed.

**Bottom line.** The F3 server seam is **wired and engages** (the flag is read, `canStream` is true for drafts, the server opens the bus and publishes deltas), but it **streams to a bus with no subscriber.** Drafts run **synchronously** — the client only learns the `jobId` in the final tRPC response, *after* the LLM call and all delta publishes have completed and the stream has been torn down. So there is **no window** in which a client holds the `jobId` while the stream is live. This is **not a flag gap** (the flag works) — it is a **sync-mutation timing gap on the server AND a never-subscribes gap on the client**, two facets of one root cause: drafts are a synchronous request/response, unlike the F2 reviewer path which dispatches async. **Minimal fix: dispatch drafts async like F2 reviewers** (enqueue → return the jobId early → run in the background; client subscribes on the early jobId). **STOP for operator direction before implementing.**

---

## 1. Server — generateDraft / regenerate run SYNCHRONOUSLY; the seam streams to nobody

Both mutations call `executeCanonicalMutation` **inline and awaited** (`documents4a.ts:578` generateDraft, `:746` regenerate). `executeCanonicalMutation` is the INLINE path — `enqueueJob` then `runJob`, both awaited, returning the terminal result (`canonicalMutation.ts:1085-1090`). The handler returns `{ jobId, status }` only **after** `runJob` fully completes (`documents4a.ts:630`, `:798`; status set 'completed' only after `txn2Commit`, `canonicalMutation.ts:1077`). This is the OPPOSITE of the F2 reviewer path, which fire-and-forgets: `registerDeferredContinuation(...)` then `void runDeferredCanonicalJob(...).catch(...)` returns a sessionId/jobId immediately while the job runs detached (`reviewSession.ts:723-726`).

The F3 seam **does engage** for drafts: `canStream` = `isDraftStreamingEnabled() && jobType ∈ {draft_generation, regeneration} && adapter.generateStream exists && structuredOutputSchema===undefined && egress===undefined` (`canonicalMutation.ts:765-770`). Drafts qualify: jobType is `draft_generation`/`regeneration` (`documents4a.ts:580/:748`); `buildLlmParams` sets **no** `structuredOutputSchema` (`:587-592` — drafts are free-form); and drafts pass **no** `egress` param. So with the flag on and a streaming-capable adapter, `canStream` is **true**, and the seam runs `await generateStreaming()` (`canonicalMutation.ts:825`), which `openDraftStream(jobId)` + `publishDraftDelta(jobId, …)` per token + `closeDraftStream(jobId)` — **all inside the awaited inline call, before the handler returns** (`:779-792`).

Consequence: `publishDraftDelta` fans out only to `entry.subscribers` (`draftStreamBus.ts:72-79`); at delta time the subscriber set is empty. `closeDraftStream` deletes the entry when `subscribers.size===0` (`:93-95`). By the time the client has the `jobId` and could `GET /api/stream/draft/:jobId`, the entry is already gone. **The server genuinely streamed — to no one — then tore the stream down.**

---

## 2. Client — it never opens an EventSource for these flows (independent gap)

`useDraftStream` needs an **early jobId while the draft is still generating** (and, for regenerate, a not-yet-existing `currentVersionId`). But the mutations are **awaited synchronously** and only return the jobId **after** the version is committed and `currentVersionId` is set. The jobId is created inside `executeCanonicalMutation` (`uuidv4`, `canonicalMutation.ts:445`); the discovery path `useDocumentJobs` does **not poll** (`refetchInterval:false`, `DocumentDetail.tsx:176`) and is only invalidated post-await — so a queued/running draft job is **never visible to the client during the generating window**. Net: `streamingText` stays `''`, `isStreamingDraft` is false, and the canvas shows the "Generating draft…" skeleton (`DocumentCanvas.tsx:206-223`) then the whole draft at once via a `version.list` refetch. **The client never subscribes — confirmed independent of the server gap.**

---

## 3. SSE endpoint + bus + flag — endpoint is fine; the flag is fine; the bus drops post-completion

- **Endpoint (reachable):** `GET /api/stream/draft/:jobId` is mounted (`index.ts:357`), session-cookie auth-gated (401 at `:362-364`), owner-scoped via `getJobById(jobId, userId)` (404 at `:372-376`), sets `text/event-stream`, and flushes deltas live (`:380-394`). Not the gap.
- **Flag (works):** `isDraftStreamingEnabled()` = `process.env['DRAFT_STREAMING_ENABLED'] === 'true'`, default OFF, read **per-call** (consumer `index.ts:392`, producer `canonicalMutation.ts:766`). A prod env-set + redeploy activates it (the redeploy matters only because Railway loads env at process start). **Not the gap** — the operator's env-set + redeploy correctly turned the seam on.
- **Bus (the decisive detail):** the per-jobId in-memory bus **buffers and replays** the prefix for a subscriber that connects **while the stream is open** (`draftStreamBus.ts:109-129`) — so a slightly-late but in-flight subscriber still sees the whole draft. But it **drops everything for a subscriber that connects AFTER the producing mutation finished**: `closeDraftStream` deletes the unobserved entry (`:93-95`), `subscribeDraftStream` then returns null (`:107`), and the endpoint sends `done {status:'no_stream'}` → the client falls back to polling (`index.ts:402-405`). So even with the flag on and the seam running, **a client that connects only after the synchronous mutation completes receives nothing.**
- **Per-replica hazard:** the bus is a **per-process in-memory Map** (`draftStreamBus.ts:42`), so the SSE request must hit the **same Railway instance** that ran the mutation. An implicit single-replica assumption; a real hazard if prod ever scales to multiple replicas (the deltas would need a shared transport — e.g. Redis pub/sub — to survive cross-instance).

---

## 4. Conclusion — which gap

- **Flag gap:** NO. `DRAFT_STREAMING_ENABLED` is read and the seam engages.
- **Server wiring gap:** YES — drafts run **synchronously**, so the seam publishes deltas to a bus with no subscriber and tears it down before the client can know the jobId.
- **Client-trigger gap:** YES (and independent) — the client never opens the EventSource because it gets the jobId only post-completion and `useDocumentJobs` doesn't poll.

These are **two facets of one root cause**: a draft is a synchronous request/response, so there is no live window where the client holds the jobId and a subscriber is attached. (The bus *would* buffer for an in-flight subscriber — but none ever connects in time.)

---

## 5. Minimal fix (proposed — DO NOT implement; for operator direction)

**Dispatch drafts ASYNC, exactly as the F2 reviewer path already does** (the infra exists: dispatcher, `registerDeferredContinuation`, `runDeferredCanonicalJob`, and F2 async is now ON). Concretely:
1. **Server:** `generateDraft`/`regenerate` enqueue the draft job and **return its jobId immediately** (before `runJob`), then run `runJob` in the background (`registerDeferredContinuation` + `void runDeferredCanonicalJob`, or via the dispatcher) so deltas publish **while a subscriber can be attached**. The committed version remains the durable source of truth (streaming is a delivery overlay) — the existing two-transaction commit is unchanged.
2. **Client:** on the mutation returning the early jobId, **subscribe-before-await** — open the EventSource with that jobId while the job runs, render `streamingText` incrementally, and realign `useDraftStream`'s active condition (don't require `!currentVersionId` for regenerate; don't depend on the non-polling job-list snapshot). On stream end, fall back to the `version.list` refetch (already the terminal source).
3. **The bus needs no change** for the common case (it already replays the prefix for an in-flight subscriber, covering the small enqueue→subscribe race). 

**Caveats to weigh (operator):**
- **Multi-replica:** the per-process bus means the SSE must hit the same instance as the job. Fine on a single replica (likely current prod); if prod scales out, streaming needs a shared transport (Redis pub/sub) — a larger lift. **Confirm the replica count before relying on streaming at scale.**
- **Async draft = a behavior change** to the draft path (returns a jobId immediately instead of the finished draft) — the client must handle the "running" state (it largely does, via the skeleton). This is a real, reversible change but more than a one-line flag flip; it should be its own flag-gated increment (reuse `DRAFT_STREAMING_ENABLED` or a new async-draft flag).
- This mirrors the **same architectural move** the F2 reviewer activation made; the draft path is simply still on the old synchronous model.

**Alternative (smaller, weaker):** keep drafts synchronous but have the client **predict/lock the jobId before calling** (client-generated jobId passed into the mutation, subscribe first, then call). This avoids async dispatch but introduces a client-supplied id into the canonical mutation (a new trust/validation surface) and still races the bus open; the async-dispatch fix is cleaner and reuses proven F2 infra.

**STOP for operator direction** before implementing any of the above.

---

## Out-of-scope log

- Wrote NO code. Read-only diagnostic + this doc. No prod action, no flag flip, no deploy.
- Did not implement the async-draft fix (gated on operator direction).
- Not established here (no prod access): the current Railway replica count (decides whether the per-process bus is a real constraint for the fix).

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
