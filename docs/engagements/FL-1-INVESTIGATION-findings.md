# FL-1-INVESTIGATION — Supervision Egress Coverage (Findings-Only)

**Engagement:** FL-1-INVESTIGATION (read-only, OVERNIGHT-2026-07-06 batch item 6/5)
**Date:** 2026-07-05 (America/New_York)
**Worktree inspected:** origin/main
**Scope:** Does the LLM/provider egress log surfaced on the Supervision page actually cover reviewer-lane, deed-agent, and intake-parse provider calls — or are those calls written to a different log, filtered out, or bypassed entirely? All conclusions below are **confirmed by code inspection** unless flagged otherwise. **This is findings-only; no logging-path code was changed.**

---

## Executive summary

The app has **two separate, structurally different egress audit tables**, each with its own writer and its own reader:

| Table | Written by | Covers | Read by Supervision? |
| :--- | :--- | :--- | :--- |
| `chat_egress_events` | `egressClient.send()` (the CHAT copilot broker) | chat copilot primary/grounding sends + the in-chat review **panel** (`kind` `chat_primary`/`chat_grounding`/`chat_panel`) | **YES** |
| `egress_events` | `documentEgressSend()` (the shared control-plane adapter) | reviewer **lanes**, deed-agent **intake parse**, **sendability**, title-exam (`surface` `reviewer`/`intake`/`sendability`/…) | **NO** |

**The Supervision page is hard-wired to `chat_egress_events` only.** The surface-agnostic `egress_events` ledger — which *does* durably record reviewer-lane, deed-agent, and intake-parse sends — has **no production reader anywhere**; only tests and the writer import it. So those sends are audited (written), but **invisible on Supervision**.

Net verdict: reviewer-lane, deed-agent, and intake-parse are all **WRITTEN-BUT-FILTERED** — written to `egress_events`, never shown by the Supervision view because the view queries the other table. (The materials OCR/deed-ingest *text-extraction* path is a non-issue: it is fully local, no provider, nothing to log. And separately, the document **draft generation** provider call bypasses *both* tables — see Additional Findings.)

---

## Source map (exact files / functions)

**Write path — two brokers, two tables**
- `src/server/llm/egressClient.ts` — `send()` (the CHAT broker). Writes `chat_egress_events` via `recordEgressDecision()` → `completeEgressEvent()`. Used ONLY by the chat copilot surface.
- `src/server/db/queries/chatEgress.ts` — sole read/write layer for `chat_egress_events`; exports `recordEgressDecision`, `completeEgressEvent`, `listEgressEvents`.
- `src/server/egress/auditedEgress.ts` — the shared, surface-agnostic gate→record→dispatch→complete primitive (no table of its own; injected by adapters).
- `src/server/egress/documentEgress.ts` — `documentEgressSend()` (the DOCUMENT adapter). Writes `egress_events` via `recordEgressEvent()` → `completeEgressEvent()` (from `egressEvents.ts`). Line 161 is the internal single dispatch `resolveAdapter(...).generate(...)`.
- `src/server/db/queries/egressEvents.ts` — sole read/write layer for `egress_events`; exports `recordEgressEvent`, `completeEgressEvent`, `listEgressEvents`. **Its `listEgressEvents` is imported by NO production module** (only `documentEgress.ts` imports the *writers*; `test-utils/setup.ts` imports the test seam).

**Provider dispatch chokepoints (only two in non-test source)**
- `src/server/db/canonicalMutation.ts:719,736` — `resolveAdapter(modelString).generate(...)`. When `params.egress` is set (line 805-822), the dispatch is wrapped by `documentEgressSend` → `egress_events`. When `params.egress` is absent, it calls `adapter.generate` raw with **no egress log**.
- `src/server/egress/documentEgress.ts:161` — internal single dispatch for `documentEgressSend` callers that don't pass a `dispatch` override (e.g. sendability).
- `src/server/llm/registry.ts:37` — `resolveAdapter()` is the single provider factory (anthropic/openai/google/xai).

**Provider call sites by category**
- Reviewer lanes: `src/server/jobs/reviewerJobFactory.ts:192-210` attaches an `egress` descriptor (`surface: 'reviewer'`, `enforceProviderAllowlist: false`) → `canonicalMutation.ts:812` routes through `documentEgressSend` → `egress_events`. Sync reviewer path: `src/server/procedures/reviewSession.ts` also calls `documentEgressSend`. Enforced by `src/server/__tests__/architecture_egress_broker.test.ts`.
- Deed-agent (AI intake parse): `src/server/procedures/deedDraftAgent.ts:2336` (`runCategoryProposeIntake`) and `:2467` (`proposeIntake`) — both `documentEgressSend`, `surface: 'intake'`, subject `matter`. This is the deed track's **only** LLM call; deed *assembly* is deterministic template code (no provider).
- Sendability classifier: `src/server/procedures/reviewSession.ts:2079` — `documentEgressSend`, `surface: 'sendability'`.
- In-chat review **panel** (distinct from reviewer lanes): `src/server/procedures/chatReviewPanel.ts:166` — `egressClient.send({ kind: 'chat_panel' })` → `chat_egress_events` → **shown on Supervision**.
- Materials/deed text extraction (OCR + field parse): `src/server/intake/ocrExtract.ts` (tesseract.js, local WASM, explicit "NO EGRESS") and `src/server/deed/deedIngestExtract.ts` (deterministic regex, "NO network, NO provider"). No provider call at all.

**Read / view path (Supervision)**
- `src/server/procedures/supervision.ts` — tRPC `supervision.query` (gated by `SUPERVISION_VIEW_ENABLED`). Calls `querySupervision(ctx.userId, …)`. Its `kind` filter enum is `CHAT_EGRESS_KIND_VALUES` = `['chat_primary','chat_grounding','chat_panel']` (chat-only vocabulary).
- `src/server/db/queries/supervisionEgress.ts:17,105` — `querySupervision()` reads via `listEgressEvents` **imported from `./chatEgress.js`** — i.e. `chat_egress_events`. It never touches `egress_events`.
- `src/client/pages/SupervisionView.tsx:22,52` — client renders only `supervision.isEnabled` + `supervision.query`. No other egress reader exists client-side.

---

## The precise mechanism of the gap

It is **not** a WHERE/filter clause dropping reviewer rows. It is a **table binding**: `supervisionEgress.ts` imports `listEgressEvents` from `chatEgress.js` (the `chat_egress_events` table), while reviewer/deed/intake sends are written by `documentEgressSend` to the *other* table, `egress_events`. The two tables even have different shapes — `chat_egress_events` keys on `kind` (chat_primary/grounding/panel); `egress_events` keys on `surface` (reviewer/intake/sendability/…). The Supervision `kind` filter could never match a reviewer/intake row even if the tables were unioned. Because `egress_events` has no surfaced reader, those durable audit rows are effectively write-only.

---

## Verdict table

| Category | Written? | Which table / seam | Shown on Supervision? | **Verdict** |
| :--- | :--- | :--- | :--- | :--- |
| **Reviewer lane** | Yes | `egress_events`, `surface:'reviewer'` (via `reviewerJobFactory` → `canonicalMutation` → `documentEgressSend`) | No (view reads `chat_egress_events`) | **WRITTEN-BUT-FILTERED** |
| **Deed-agent** (AI intake parse) | Yes | `egress_events`, `surface:'intake'` (`deedDraftAgent.proposeIntake`/`runCategoryProposeIntake`) | No | **WRITTEN-BUT-FILTERED** |
| **Intake-parse (LLM)** — same call as deed-agent | Yes | `egress_events`, `surface:'intake'` | No | **WRITTEN-BUT-FILTERED** |
| Intake/materials **text extraction** (OCR + deed-ingest) | N/A — no provider send | Local tesseract.js / deterministic regex | N/A | **Not applicable** |
| In-chat review **panel** | Yes | `chat_egress_events`, `kind:'chat_panel'` | **Yes** | COVERED |
| Chat copilot primary/grounding | Yes | `chat_egress_events` | Yes | COVERED |

---

## Additional findings (material to "does the log cover provider calls")

1. **Document draft generation bypasses BOTH tables.** `draft_generation`/`regeneration` jobs are dispatched through `canonicalMutation` **without** an `egress` descriptor. Comment at `canonicalMutation.ts:757-770`: "drafts do not egress — this keeps streaming entirely out of the egress dispatch path." So the document-drafting provider send — arguably the largest egress of client content — has **no audit row in either table**. **BYPASSED** (confirmed by code inspection).
2. **`egress_events` is a write-only ledger in production.** No tRPC procedure and no other server module reads it. The GLBA "vendor oversight" value of that ledger is currently unrealized for everything except chat.
3. `EGRESS_SURFACE_VALUES` already reserves `drafter`, `evaluator`, `outline`, `information_request` — the plane was designed to absorb those surfaces, but they are not yet wired to `documentEgressSend`.

---

## Recommended follow-up engagement (IF a gap is to be closed)

**Real gap confirmed.** Recommended engagement:

- **Suggested name:** `SUPERVISION-UNIFY-1` — surface the `egress_events` ledger on Supervision.
- **Scope / seam (single, additive, reversible, read-side only):**
  - `src/server/db/queries/supervisionEgress.ts` + `src/server/procedures/supervision.ts` — add a read over `egress_events` (via the existing owner-scoped, Zod-walled `listEgressEvents` in `egressEvents.ts`, which supports `surface`/`decision`/`matter`/`recency` filters), and either (a) union with the chat read or (b) expose it as a second Supervision tab/filter axis. Augment the chat-only `kind` filter with the `surface` dimension.
  - `src/client/pages/SupervisionView.tsx` — add the surface filter + column.
  - No new table, no writer change, no migration, no env var, no egress-path change — read-side only; reversible build-and-PR lane.
- **Governance decision to surface to operator:** whether Supervision should present a **single unified vendor-oversight ledger** (both tables, all surfaces) vs. keep chat separate — a product/compliance framing call.
- **Separately consider** onboarding draft-generation egress onto `egress_events` (a `surface:'drafter'` descriptor on the draft job). This is a **write-path** change (adds an egress row to a currently-unlogged send) — a larger, separately-reviewed engagement, NOT part of the read-side unification.

**This batch made no logging-path changes** — findings only.

### Evidence-class notes
- Two-table split, Supervision→`chat_egress_events` binding, `egress_events` having no production reader, reviewer/deed/intake routing through `documentEgressSend`, and draft-generation lacking an egress descriptor: all **confirmed by code inspection**.
- "Reviewer/deed/intake rows are actually written at runtime" is contingent on those features executing (some flag-dark in prod); structurally the write path is present and CI-guarded. The coverage conclusion holds regardless of flag state.

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
