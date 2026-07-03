# External triad-review packet — C1-CONV-DESIGN (conversation-first design brief)

> **BANNER — §3.1 FIRE checkpoint. HALT.** This is a self-contained review packet for an external triad review
> (GPT + an independent Claude). It is reviewable with **no repo access**. Do **NOT** self-run, self-review, or
> self-approve. No code is written past this checkpoint until the operator returns a triad disposition.
> Assembled by Claude Code (ULTRABUILD-1 W10a), 2026-07-03, against `origin/main` `2cc7ecc`.

---

## Part 1 — Decision under review

**Whether to adopt this conversation-first design brief as the governing design for the Phase-C restructure
(run-sheet C.1) before any of C.4 (disposition UX) / C.5 (surface consolidation) / C.6 (route deed/review/panel
from conversation) is built.** The brief is *design only* — no implementation is proposed here. It is a §3.1
FIRE because it establishes a **load-bearing product-architecture decision** (what the primary surface is, what
folds/retires) that is (a) hard to reverse once surfaces are consolidated, (b) not caught by CI, and (c)
touches client-send-safety + records-management (it must preserve the LIVE-9 deed routing invariant and the two
structural gates).

**Two gates the reviewers must weigh against:**
- **A.6 gate (run-sheet, amended 2026-07-03):** C.4–C.6 do **not** open until the deed **Trust Protocol** passes
  (5 real archetype deeds drafted both ways, byte-compared) **in addition to** this triad clearance. So even a
  "proceed" disposition here does not itself open the build — the deed lane must earn trust first.
- **LIVE-9 invariant (must hold):** a deed request is **ROUTED** to Quick Deed and never drafted in a chat
  thread. The durable instrument is only ever produced by the deterministic server assembler.

---

## Part 2 — The design brief (the substance under review)

### Scope guard (what this brief answers, and ONLY this)

This brief answers exactly five questions and no more (it does **not** design implementation, schemas, or UI
components):

**Q1 — What is the primary surface?**
Today there is no single primary conversational surface; there are **two competing matter-thread UIs**, both
flag-dark:
- **CHAT-UI-1 `ChatSurface`** (`CHAT_UI_1_ENABLED`) — a three-zone "conversation-dominant" shell (spine rail /
  thread / focused-deliverable slot) whose own brief *declares* conversation the primary. It is largely a **W0
  scaffold** ("preview"); the composer wires to `chatDispatch.submitTurn` but there is **no conversation
  persistence** and the deliverable/provenance zones are partial.
- **CHAT-COPILOT-1 `CopilotPage`** (`CHAT_COPILOT_ENABLED`) — a **more complete, persisted** matter-scoped
  copilot: a conversation LIST + THREAD, windowed history, grounding/citations, guided modes, and a durable
  by-reference conversation store (migration 0033). It **hard-excludes** promote-to-draft / send / finalize.

**RECOMMENDATION (for the triad to accept or reject):** make **CopilotPage the one conversation surface** — it
is the further-along, persisted, grounded surface, and it already enforces the correct hard exclusions. Fold
ChatSurface's *good ideas* (the focused-deliverable slot; the posture/provenance zones) **into** CopilotPage
rather than maintaining two thread UIs. *This is the pivotal design fork and the main thing the triad must
rule on* — see Open Question 1.

**Q2 — What actions are invocable from the primary surface?**
From the conversation surface the attorney may **invoke** (not perform free-form): open/röad a matter; ask
grounded questions about matter materials; request analysis; **route** to a deliberate act; and **route** a
deed request to Quick Deed. The conversation *orchestrates*; it never *executes* an irreversible act inline.
Invocable-by-routing:
- **"Do the deed" → ROUTES to Quick Deed** (`/deed` or `quickDeed.generate`), landing the attorney on the
  document review/finalize surface. The instrument is assembled deterministically server-side and persisted
  through the standard documents/versions path. **LIVE-9 holds: the deed is never assembled in the thread.**
- **"Review this" → ROUTES to the calibrated reviewer panel** (legacy `ReviewPane` on the document surface) or
  the copilot review panel — a routing decision, not an inline critique that can be adopted without the panel.
- **A deliberate act → ROUTES to its confirm affordance** (`DeliberateActButton`), never a free-form command.

**Q3 — What CANNOT be done free-form (the two fixed gates + five deliberate acts stay OUT of conversation)?**
The following are **structural** and never satisfiable by a free-form chat instruction — the conversation may
*surface* or *route to* them, but the gate/act itself is a deterministic, confirmable commitment:
- **Two fixed gates** (deterministic, always in force when on):
  1. **Conflicts-at-intake** (FOLD-L0-1) — RPC-mandatory, **FAIL-CLOSED** (an ethics gate is never satisfied by
     absence of evidence).
  2. **Outbound sendability** (FOLD-SEND-1) — block/warn/pass at the export boundary (fail-**to-warn** today;
     QA-5 amendment hard-stops `wrong_matter_id`). *(Note the deliberate asymmetry: conflicts fail-closed vs.
     sendability fail-to-warn.)*
- **The five deliberate acts** (the "hard-stop floor", each rendered via `DeliberateActButton`, never a chat
  command): **lock** a decision; **tier** a source/authority; **disposition** a finding (adopt/reject/etc.);
  **send**; and **matter identity** confirmation. *(The v2 posture trio — issuer identity / privilege status /
  recipient class — extends this to eight; the brief should adopt the floor as-built.)*

**Terminology note for reviewers:** "two fixed gates + five deliberate acts" is **not** a literal phrase in the
repo. It maps to (gates) `isConflictGateEnabled` (fail-closed) + `isSendabilityGateEnabled` (fail-to-warn), and
(acts) the CHAT-UI-1 BUILD_BRIEF "hard-stop floor". This mapping is stated so the reviewer is not chasing a
phrase that isn't there.

**Q4 — What existing surfaces fold, link, or retire?**
- **FOLD:** `ChatSurface` (CHAT-UI-1) folds into `CopilotPage` (its distinctive zones — focused-deliverable
  slot, posture/provenance panels — migrate in). The `ChatComposer` → `chatDispatch` substrate is reused.
- **LINK (unchanged):** `MatterDetail` remains the always-on hub and hosts the entry link to the one
  conversation surface. Quick Deed (`/deed`) remains the deed route target. The legacy document `ReviewPane`
  remains the calibrated reviewer panel on the document surface (the conversation *routes* to it).
- **RETIRE (candidates, per the audit's cut list):** the duplicate CHAT-UI-1 W-surfaces once folded; the
  audit's separately-flagged "defer/cut" items (draft streaming overlay, notification sound, landing-at-root)
  are out of this brief's scope but reinforce "one conversation surface, not two."

**Q5 — What durable records are created (build on W1's E4b/E7b)?**
The conversation surface itself creates **no new authoritative record type**; it reuses the records that
already exist, and specifically builds on the durable Express records **W1 (this batch) just added**:
- **W1's E4b/E7b** — `express_loop_run` + `express_ledger_entry` (durable decision ledger) and
  `express_approval_attestation` (durable attorney sign-off). *These are now real tables* (flag-dark), so when
  the conversation surface routes to an Express review loop, the decision ledger + the attorney's complete
  sign-off are durably reconstructable. **Fork-C consistency: attorney decisions route through `audit_events`;
  the conversation must not introduce a competing decision store.**
- Existing durable records the conversation reuses: documents/versions (the only durable draft-instrument
  record), `posture_provenance` (per-act posture confirm), `audit_events` (the Matter-Record decision stream),
  `chat_egress_events` (the egress audit log), and the copilot conversation/message/summary tables.

*(Naming note resolved: the "E4b/E7b" the task references ARE the Express durable-persistence increments; they
were **deferred/in-memory** at audit time and are **built by ULTRABUILD-1 W1** — PR #470. The brief builds on
those real tables, not on unbuilt scaffold.)*

---

## Part 3 — Ready-to-paste reviewer prompt

> You are one lane of an external triad review (GPT + an independent Claude). Review the **C1-CONV-DESIGN
> conversation-first design brief** (Part 2 above) for a solo Virginia attorney's AI drafting/review platform.
> Return **PROCEED / PROCEED-WITH-NAMED-CHANGES / DO-NOT-PROCEED** with reasons. Judge specifically:
> 1. **The pivotal fork (Q1):** is making CopilotPage the one conversation surface (folding ChatSurface into
>    it) the right call, or should ChatSurface be the base? What is lost either way?
> 2. **LIVE-9 preservation (Q2):** does the "route to Quick Deed, never draft in-thread" rule hold under this
>    design? Is there any seam where conversation could produce an instrument?
> 3. **The gates/acts staying out of free-form (Q3):** is the mapping of "two fixed gates + five deliberate
>    acts" to the actual code (conflicts fail-closed + sendability fail-to-warn; the hard-stop floor) correct
>    and complete? Should any act be added/removed from the floor?
> 4. **Durable records (Q5):** is building on W1's E4b/E7b + the existing records (documents/versions,
>    audit_events, posture_provenance) sufficient, and does it avoid a competing decision store (Fork C)?
> 5. **Scope discipline:** does the brief correctly answer ONLY the five questions without drifting into
>    implementation? Flag any place it over-reaches or under-specifies a load-bearing decision.
> 6. **Sequencing:** the A.6 gate (deed Trust Protocol must pass before C.4–C.6) and this triad clearance are
>    both required — is that the right order, and is anything mis-sequenced?
> Assume no repo access; everything you need is in this packet.

---

## Part 4 — Document manifest (for the reviewer)

Everything needed is inlined above. Supporting repo references (cited by path:line for the operator's use; a
reviewer does not need to open them):
- Surfaces: `src/client/App.tsx` (routes); `src/client/pages/MatterDetail.tsx:512,523` (entry links);
  `src/client/pages/ChatSurface.tsx`; `src/client/pages/CopilotPage.tsx:10-12` (hard exclusion);
  `src/client/components/ChatReviewPanel.tsx:20`; `src/client/components/ReviewPane.tsx`;
  `src/client/pages/QuickDeedPage.tsx:89-107,95` (deed route + navigate-to-document — the LIVE-9 seam).
- Gates/acts: `src/server/config/featureFlags.ts:100-136` (sendability fail-to-warn vs conflicts fail-closed);
  `docs/CHAT-UI-1/BUILD_BRIEF.md:7-10` (hard-stop floor); `src/client/components/DeliberateActButton.tsx`.
- Durable records: W1 tables `express_loop_run` / `express_ledger_entry` / `express_approval_attestation`
  (schema.ts; ULTRABUILD-1 PR #470); `src/server/db/queries/postureProvenance.ts`; `audit_events`.
- Roadmap/gates: `docs/WHEREAS_FOLD_master_plan.md:84-86,101,126`; run-sheet A.6 (Trust Protocol) + C.1–C.6.

## Part 5 — Open questions for the triad (the design forks that code cannot resolve)

1. **Which thread surface is the base** — CopilotPage (recommended: persisted, grounded, further along) or
   ChatSurface (declares itself conversation-first but is a W0 scaffold)? *This is the load-bearing fork.*
2. **Does the conversation surface get any promote-to-draft affordance at all**, or is it strictly
   analyze/route (routing all drafting to Quick Deed and all finalization to the document surface)? The brief
   assumes **strictly route** (LIVE-9-safe); confirm.

---
End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
