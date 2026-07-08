# C.4a — Composer substrate consolidation — dispatch (PRE-STAGED, paste-ready)

**Author:** Cowork, 2026-07-06. **Type:** reversible build-and-PR (FIRE triage: SKIP — see §6). **Phase:** WHEREAS roadmap Phase 1 (C4-C6 flagship), increment C.4a.

**⛔ DO NOT START until BOTH preconditions clear:** (1) **Gate G-A** — D3 `enforce` flip + 5 real-deed Trust Protocol pass (`docs/deed/D3_ENFORCE_A6_RUNBOOK_2026-07-05.md`); (2) operator says **"execute C4-C6."** This dispatch is pre-staged so it launches the instant G-A passes. Governing brief: `docs/design/C4-C6_IMPLEMENTATION_BRIEF_DRAFT_2026-07-05.md`. Design of record (triad-adopted, no new FIRE): `docs/reviews/C1-CONV-DESIGN_packet.v1.1.md`. Thesis of record: `docs/design/PRODUCT_THESIS_AND_ALIGNMENT_2026-07.md` v1.1 (NC-PT-1..12).

---

## 1. What C.4a builds (and does NOT)

**Consolidate to ONE composer substrate (NC-C1-4).** The matter-page composer and the drafting-rail composer become the **same component** with a `scope` prop (`matter` | `document`) — scope changes only the grounding binding, **never** egress behavior. All conversation turns submit through the **canonical broker path** (`chatCopilot.submitTurn`, which already carries the A1–A3 egress-broker, grounding, NPI-minimization, citation-fidelity, and per-turn gating). The legacy `chatDispatch.submitTurn` + its composer wiring are retired **behind a new default-OFF flag**, to be deleted at C.4 close.

**No visible product change.** This is a substrate/architecture increment. Flag OFF (default) = byte-for-byte legacy behavior. Nothing about the matter or document pages changes for the user yet (that's C.4b+).

## 2. Binding directives (from the brief — do not reopen the packet)

- **NC-C1-1 (LOAD-BEARING):** the conversation lane has no drafting tools, no write path to documents/versions, no instrument-formatted rendering; deed-text requests ROUTE to Quick Deed. C.4a must not introduce any send/write path outside the broker.
- **NC-C1-2:** `CopilotPage` is the only canonical conversation route; `ChatSurface` is slated to die (a temporary dev/migration flag is allowed now; deletion is C.6c).
- **NC-C1-4:** ONE composer substrate — the deliverable of this increment.
- **D1 (brief §Architecture):** substrate = `chatCopilot.submitTurn`; `chatDispatch.submitTurn` + `ChatComposer`'s dispatch path retired behind the migration flag; one composer component with a `scope` prop; scope never alters egress.

## 3. Concrete file map (verified on `main`/prod `b92591e`)

- `src/server/procedures/chatCopilot.ts` — `submitTurn` (the canonical path to keep).
- `src/server/procedures/chatDispatch.ts` — `submitTurn` (the path to retire behind the flag).
- `src/client/components/ChatComposer.tsx` (+ `__tests__/chatComposer.render.test.tsx`) — the composer to parameterize with `scope`.
- `src/client/pages/CopilotPage.tsx`, `src/client/pages/ChatSurface.tsx`, `src/client/components/CopilotThread.tsx` — consumers.
- `src/server/config/featureFlags.ts` — flag registry (`CHAT_COPILOT_ENABLED` at ~L428 is the pattern to mirror). **Add `CHAT_SURFACE_LEGACY_ENABLED` (default OFF)** here; it does not exist yet.
- `src/server/__tests__/architecture_egress_broker.test.ts` — the architecture test to EXTEND (see §5).

## 4. Steps

1. **Add flag `CHAT_SURFACE_LEGACY_ENABLED`** (default OFF) in `featureFlags.ts`, mirroring the `CHAT_COPILOT_ENABLED` accessor pattern. OFF = legacy `chatDispatch` path fully inert / unreachable; the canonical `chatCopilot.submitTurn` path is the only live send path.
2. **Parameterize `ChatComposer`** with a `scope: 'matter' | 'document'` prop. Both scopes submit via `chatCopilot.submitTurn`; scope selects the grounding binding only. Remove the second composer's independent send path (gate any residual `chatDispatch` wiring behind `CHAT_SURFACE_LEGACY_ENABLED`).
3. **Dispatch routing seam (thesis NC-PT / ruling #4):** thread a **task/model-class routing seam** through the consolidated substrate — a parameter the caller can pass (verb/task → model class), operator-overridable, **not hard-pinned to one model**. Seam only for now (no routing policy behavior change); it exists so C.6a/C.6b and the Dispatch layer can use it. Default preserves current model selection exactly.
4. **No product-visible change**: with the flag OFF, matter/document/copilot surfaces render and behave byte-identically.

## 5. Acceptance (CI-gated)

- **Architecture test extended** (`architecture_egress_broker.test.ts`): assert (a) **no send path exists outside the broker** — `chatCopilot.submitTurn` is the sole egress entry for conversation turns; (b) **no second composer import** — exactly one composer component is imported by the conversation surfaces; (c) the legacy `chatDispatch` send path is unreachable while `CHAT_SURFACE_LEGACY_ENABLED` is OFF.
- **Flag-off parity:** existing chat/copilot render + behavior tests pass UNMODIFIED (byte-for-byte legacy).
- **Scope prop:** a test proves the matter-scope and document-scope composer are the same component and both route through `chatCopilot.submitTurn`, differing only in grounding binding.
- CI green (tsc + vitest + eslint).

## 6. FIRE triage — SKIP

`Checkpoint triage: skip — C.4a is mechanical/additive substrate consolidation behind a default-OFF flag, no egress-semantics change (scope never alters broker behavior; the architecture test proves the invariant holds), riding the C1-CONV-DESIGN triad-adopted parent (brief: "no new FIRE for implementing it"). No access-control / privilege / ethics / client-send-safety / data-destruction decision is established or changed.` Reversible build-and-PR: self-approve scope (Rule 8), auto-merge on green CI (Rule 15). No open operator questions gate C.4a (OQ1→C.5a, OQ2→C.4b, OQ3→C.6b).

## 7. Baseline + branch

7-command repo-state baseline first. Branch onto the Phase-1 integration branch per Rule 17 (`fold/phase-c4c6` or the current convention — confirm against `docs/STATE.md` at execute-time; Phase-1 branch strategy per the brief §Increments). `main` = `0ccc06c` (= prod `b92591e` + docs PR #546). Close-out states which **manual carry** C.4a eliminates (here: none user-visible — it's the substrate that makes the later carries eliminable; say so).

**Paste-to-start (after G-A + "execute C4-C6"):** `Execute docs/engagements/C4a-substrate-consolidation-dispatch.md. Report repo state, run the §6 FIRE triage line, build C.4a per §4, and land it on the Phase-1 branch.`

---

*Cowork pre-staged dispatch. The CLI is the sole builder. Blocked on Gate G-A + operator "execute C4-C6"; do not begin before both.*
