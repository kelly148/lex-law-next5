# ADR — EGRESS-CONTROL-PLANE-1 (External-Model Egress Control Plane, Increment 1)

This is the documentation gate the HI-2 / ME-1 triad disposition (`docs/reviews/HI-2_ME-1_triad_disposition_2026-06-16.md`, 2026-06-16) requires before the plane is considered closed. It records what was built in Increment 1, the boundary principle it enforces, what it deliberately does not do, and the legal grounding it answers to. All dates are America/New_York.

---

## 1. Status and scope

**Status:** Accepted; Increment 1 built. Sendability routes through the plane today; the remaining document surfaces are not yet onboarded (see section 3).

**In scope for Increment 1:**

- **The shared primitive** — `auditedEgress()` (`src/server/egress/auditedEgress.ts`): the single gate → synchronous pre-dispatch record → fail-closed throw → dispatch → best-effort complete skeleton that every onboarded external send flows through. It imports no provider primitive; it wraps an opaque dispatch closure.
- **The generalized ledger** — `egress_events` (migration `0041_egress_control_plane_1_egress_events.sql`), a surface-agnostic audit-of-record, with its sole query layer `src/server/db/queries/egressEvents.ts`.
- **The CI guard** — the architecture test `src/server/__tests__/architecture_egress_broker.test.ts`: the structural lock that bans raw provider-primitive access outside named chokepoints.
- **The sendability pilot** — `checkSendability` (`src/server/procedures/reviewSession.ts`) routes through the new document adapter `documentEgressSend` (`src/server/egress/documentEgress.ts`) with surface `'sendability'`.
- **The matter/global hold model** — `egress_hold` (migration `0042_egress_control_plane_1_egress_hold.sql`) plus the scoped evaluator `resolveEffectiveHold` (`src/server/db/queries/egressHold.ts`).

**Explicitly deferred:**

- **Reviewer / drafter / evaluator / outline / intake / information_request onboarding = Increment 2.** Those surfaces still reach a provider through the job plane (`executeCanonicalMutation → runJob → llmFetch`), which the disposition found is *not* control-equivalent (no audit row, no hold). The route-through-broker vs. gate-inside-canonicalMutation decision for reviewer/drafter carries a fail-closed-allowlist prod risk and is operator-gated.
- **CR-4 (stuck-session recovery)** — shares the mid-fan-out seam with this work and is dispositioned/built jointly, but is its own triad.
- **No kill-switch UI while coverage is partial.** Increment 1 ships the hold *model* and evaluator, not an operator-facing global `no_external` control. The disposition is explicit: a hold that lies (appears global while blocking coverage is partial) is worse than no hold (false assurance). `recordEgressHold` exists for tests and future operator-gated hold management only.

---

## 2. What external-model egress is

**External-model egress** is an external send of client/matter content to a third-party LLM provider (`anthropic` / `openai` / `google` / `xai`) — the moment privileged or NPI-bearing work product crosses the firm's trust boundary to a vendor.

The control boundary is **external-egress-of-client-content vs. no-external-egress** — **NOT chat vs. document.** The product surface (chat, document, job, matter) is a **field on the audit row** (`egress_events.surface`), not a gate on whether a row exists. Every onboarded external send writes one decision row, regardless of surface; the document side is the *higher*-stakes surface because that is where privileged drafting work product lives and where sends can be background or system-initiated.

The "it was about to be sent to the client anyway" rebuttal does **not** apply: send-to-client is not send-to-external-model. The egress concern is the third-party trust-boundary crossing, which is a distinct event from delivery to the client.

---

## 3. Surfaces covered

**Covered today:**

| Surface(s) | Adapter | Ledger written |
| :-- | :-- | :-- |
| Chat (`chat_copilot`, `chat_grounding`, `chat_panel`) | `egressClient.send` (the chat adapter over the primitive) | `chat_egress_events` (retained, unchanged) |
| Sendability classifier (`sendability`) | `documentEgressSend` (the document adapter over the primitive) | `egress_events` (new generalized ledger) |

**Not yet covered (the shrinking CI-guard inventory):** `reviewer`, `drafter`, `evaluator`, `outline`, `intake`, `information_request`. Each is already a declared `egress_events` surface value, so it can be recorded the moment it onboards. The CI guard tracks them in `EGRESS_ONBOARDING_TODO`; the list shrinks to empty as surfaces onboard in later increments.

---

## 4. The audit-of-record

The audit-of-record is two ledgers, one per adapter, both written through the same primitive:

- **`egress_events`** — the surface-agnostic ledger for the new plane (document/sendability today, the remaining surfaces as they onboard). Sole read/write path: `recordEgressEvent` / `completeEgressEvent` / `listEgressEvents` in `src/server/db/queries/egressEvents.ts`.
- **`chat_egress_events`** — retained for chat, byte-for-byte unchanged. It is the chat adapter's existing GLBA audit log; Increment 1 does not migrate or rewrite a single existing chat row.

**The invariant:** exactly **one durable decision row is written synchronously, BEFORE dispatch** — `allowed` or `blocked` plus reason. The primitive (`auditedEgress`) calls `recordDecision` (step 2) before it ever calls `dispatch` (step 4). A blocked decision throws *after* the blocked row is durable and *without* dispatching.

**Auditability over availability:** an audit-write failure prevents egress. If `recordDecision` throws, the primitive aborts the send — there is no unlogged egress. Only the *secondary* outcome update (`completeDecision`, step 5) is best-effort: a failed completion is swallowed so it cannot mask the real dispatch result, and the decision row is already durable.

---

## 5. What is logged, and what is deliberately not

Each `egress_events` row records:

- `provider`, `model`
- `createdAt` (decision time) and `completedAt` (outcome time)
- `subjectType` + the polymorphic subject scope: `conversationId` / `documentId` / `documentVersionId` / `jobId` (nullable per subject type), plus `userId` / `matterId`
- `surface`
- `decision` (`allowed` / `blocked`) + `blockReason`
- `holdScope` — which hold scope supplied the binding decision (provenance for why a send was blocked or allowed)
- `policyVersion` — a stable fingerprint of the provider allowlist policy at decision time (`allowlistFingerprint()`)
- `inputBundleHash` — see below
- `correlationId`
- `status` (`pending` → `success` / `blocked` / `failed` / `timeout` / `cancelled`) + `failureReason`

**Store-by-reference (load-bearing).** `inputBundleHash` is a salted/keyed HMAC-SHA256 over the *whole minimized payload* (`bundleHash()` in `documentEgress.ts`), keyed so a low-entropy field cannot be brute-forced from the hash and hashes do not correlate across deployments. The row stores a **hash and the document/version reference — never the draft text.**

**Default: NO prompt content is retained.** The ledger must not become a second, unprotected repository of privileged content. There is no field that holds the system prompt, the user prompt, the document body, or the provider response. The decision to retain *any* prompt content (e.g., for provider-dispute defense) was made deliberately and is **no**.

---

## 6. How `no_external` applies across conversation / matter / global

The scoped hold lives in `egress_hold` (`scope ∈ {conversation, matter, global}`; `holdFlag ∈ {none, no_panel, no_external}`). The conversation-scoped chat hold (`conversation.holdFlag`) is retained and untouched; `egress_hold` adds the matter and global scopes the conversation-only flag could not express.

- **Precedence: global > matter > conversation** (`EGRESS_HOLD_SCOPE_PRECEDENCE`). The evaluator `resolveEffectiveHold` returns the most-restrictive active `no_external` hold for a subject and reports which scope supplied it.
- **Document sends check matter + global.** A document subject has no conversation, so `resolveEffectiveHold` queries the global and matter scopes only (`listActiveForSubject` adds the conversation predicate only when a `conversationId` is present).
- **A conversation hold does NOT block unrelated matters** — it is keyed to its own `subjectId` (the conversationId) and never matches a document send in another matter.
- **A matter or global hold DOES reach document sends.**
- **No synthetic `conversationId`.** A document send leaves `egress_events.conversationId` NULL; the linkage rides `documentId` / `documentVersionId`. Context is generalized, never spoofed.
- **Purge / retention:** matter- and conversation-scoped holds carry `matterId` and purge with the matter (`byMatter` in `matterPurge.ts`); a firm-level global hold has `matterId` NULL and is therefore retained across a matter purge, like `authority_source`. Hold release is audit-preserving (`active=false` + `releasedAt`, no in-operation row delete).

---

## 7. Fail-closed posture (refined)

Per the second-round triad refinement, fail-closed is **targeted, not blanket:**

- **The hold check is unconditionally fail-closed.** If the system cannot *confirm* there is no applicable hold — `resolveEffectiveHold` throws on a store error — the send is BLOCKED with `blockReason = 'hold_check_uncertain'`. The evaluator never silently returns `'none'` on a DB error, and the adapter never returns `'allowed'` on uncertainty. A present `no_external` hold blocks with `'hold_no_external'`; a provider not on the allowlist blocks with `'provider_not_allowlisted'`. An audit-*write* failure also prevents egress (the primitive aborts before dispatch).
- **A generic broker/audit outage has a defined degraded mode.** Failing closed on every blip would DoS the whole drafting/review pipeline, since the broker is the chokepoint for all model egress. For the **advisory sendability classifier specifically**, the defined degraded behavior is `CLASSIFIER_UNAVAILABLE`: `checkSendability` wraps `documentEgressSend` in a degrade-to-unavailable try/catch, so a block, an audit-write failure, an uncertain hold check, or a provider/parse failure surfaces to the attorney as "the classifier could not run" and never affects finalize or export — and never produces an unlogged send of client document text.

---

## 8. Incident reconstruction / compliance query

`listEgressEvents(userId, filter)` (`src/server/db/queries/egressEvents.ts`) is the supervision/compliance read path. It is owner-scoped (`ownerScope`) and supports filtering by:

- `matterId` — all egresses for a matter
- `documentId` — all egresses for a document
- `surface` — e.g. all `sendability` egresses
- `decision` — e.g. all `blocked` egresses
- `sinceCreatedAt` — by date/recency

Results are ordered newest-first. Because **blocked rows are logged too** and carry `blockReason`, `holdScope`, `provider`, `model`, and `policyVersion`, a supervisor can reconstruct, for any matter/document: which external sends were attempted, which were blocked and why (hold scope and reason), which provider/model each used, and when. The backing indexes on `egress_events` (`idx_egress_events_matter`, `idx_egress_events_surface`, `idx_egress_events_document`, `idx_egress_events_decision`) support exactly these queries.

---

## 9. The CI guard

The structural lock lives in `src/server/__tests__/architecture_egress_broker.test.ts` and fails the build on a bypass. It enforces, by deterministic source scan (no DB, no network):

1. **No raw provider-SDK package** is imported anywhere in `src/` (the adapters are fetch-based; a direct SDK import would be an unaudited egress path).
2. **Provider-primitive containment** — the provider-reaching primitives (the adapter registry / `resolveAdapter`, the `llmFetch` wrapper, and the concrete provider adapters) are imported **only** by an allowlisted set of chokepoint modules (`REGISTRY_ALLOWED` / `LLMFETCH_ALLOWED` / `ADAPTER_ALLOWED`), following both static and dynamic imports.
3. **The shared primitive stays provider-agnostic** — `auditedEgress.ts` imports no registry, no `llmFetch`, no adapter, and no canonical dispatch (it wraps an opaque closure).
4. **The document adapter is a real chokepoint** — `documentEgress.ts` reaches the provider via the registry, dispatches through the shared primitive, writes `egress_events`, and checks `egressHold`.

**The shrinking allowlist (the ME-1 structural lock).** Increment 1 onboarded the sendability classifier: `procedures/reviewSession.ts` was **removed** from `REGISTRY_ALLOWED` (it no longer reaches a provider raw — sendability now routes through the egress plane), and the new chokepoint `egress/documentEgress.ts` was added. The guard asserts `reviewSession` no longer imports the registry / `llmFetch` / an adapter and *does* import `egress/documentEgress`. Any new raw provider importer outside the named chokepoints fails the guard. `EGRESS_ONBOARDING_TODO` is the explicit checklist of surfaces still on the job plane; an entry is deleted when its surface onboards.

---

## 10. Legal grounding

Two independent regimes, per the disposition — cite both:

- **Rules of Professional Conduct.** RPC 1.6 (confidentiality of client information), RPC 1.1 (technological competence — understanding the benefits and risks of the technology used), and the attorney's supervision duties over non-lawyer assistance and tools. Sending client/matter content to a third-party model is a disclosure event RPC 1.6 governs; competently understanding and controlling that egress is an RPC 1.1 obligation.
- **The GLBA Safeguards Rule (16 CFR Part 314, 2021 FTC amendments).** The firm's title and settlement business makes it a GLBA "financial institution": settlement agents handle customer nonpublic personal information (NPI) and are squarely covered. The 2021 FTC amendments tightened service-provider and vendor-oversight duties, which **flow down to the LLM tools** that process customer NPI. The Safeguards Rule is *more* apt here than for generic legal SaaS — it is an independent regulatory hook on top of the RPC duties.

The control plane is the technical implementation that makes egress to these vendors auditable and blockable, in service of both regimes.

---

## 11. Necessary, but NOT sufficient — the operator/compliance layer

Routing through the broker **controls and logs** egress; it does **NOT** by itself **create authority to send.** "Now it's routed" must not be read as "now it's compliant." Two operator-layer prerequisites remain, independent of this code and owned by the supervising attorney:

1. A **no-train / zero-retention / confidentiality DPA** with each provider (`anthropic` / `openai` / `google` / `xai`) — the long-pending GLBA vendor-oversight operator item.
2. **Client disclosure / consent** appropriate to AI processing of their NPI (RPC 1.6 plus the engagement terms).

The control plane makes egress auditable and blockable; the supervising attorney still owns the authority and the consent to send.

---

## 12. Exceptions

None in Increment 1. Every onboarded path gets **log AND hold from day one** — there is no "log-now, gate-later" path, and no onboarded surface that is logged but not gateable. The staging is over *which call sites* are onboarded, never over *whether* an onboarded site is gateable. The first onboarded site (sendability) is fully gated and fully logged from the first commit.

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
