# LIVE-9 — External Triad-Review Packet (§3.1 FIRE)

> **BANNER — HARD STOP.** This is a §3.1 external-review checkpoint. The build is **HALTED** pending a triad disposition (GPT + an independent Claude). **No guard code has been written.** This packet is self-contained: a reviewer with **no repo access** can review from it alone. Do **not** treat this packet as an approval — it is the labor of assembling the review, not the review itself.

- **Engagement:** LIVE-9 — "Force deed sub-types through the deterministic agent."
- **Source finding:** Live UAT (2026-06-26). "The generic New-Document / LLM path can mint a deed with the exemption-killing verb."
- **Investigation base:** worktree off `origin/main` @ **3157ecb** (current main). Confirmed-by-code throughout.
- **Disposition requested:** `operator approve checkpoint:LIVE-9` (after the external review returns) — then build, OR a redirected design per the reviewers.

---

## PART 1 — Decision under review

A user can today produce a **Virginia deed** (a recorded, third-party-facing legal instrument) through the **generic LLM drafting path**, with **no deterministic exemption-preservation and no downstream backstop**. The free LLM is liable to use the **exemption-killing granting clause** — "grant, **bargain, sell,** and convey" and/or a consideration recital ("for valuable consideration of $X") — in place of the exemption-safe gift language the deterministic assembler guarantees. That **defeats the Virginia recordation-tax exemption** (Va. Code § 58.1-811 family; the gift exemption is § 58.1-811(D), P.D. 93-212) and re-characterizes a tax-exempt gift as a taxable conveyance. Because the deed is recorded with the circuit-court clerk, the harm is **irreversible once recorded**.

The fix forces deed sub-types away from the free LLM path. **That introduces three NEW load-bearing decisions the parent DEED-DRAFT-AGENT-1 triad review did NOT cover:**

1. **Routing/interception policy** — a new cross-cutting seam in the *generic document pipeline* (not the deed agent's internals): the generic path must detect a deed and **block** it (refuse + point to the deterministic deed agent) **or redirect** it into the deterministic assembler.
2. **Deed taxonomy over a free-text `documentType`** — which values count as "a deed"? `deed` and `deed_of_trust` are first-class dropdown values; `documentType` is free text (max 64 chars); `custom` carries an arbitrary label. **`deed_of_trust` is a security/financing instrument, NOT a gift deed** — it must be kept off the free LLM but must **not** be routed to the gift assembler.
3. **Fail-closed posture vs. the `DEED_DRAFT_AGENT_ENABLED` flag** — when the deed agent is **OFF** (its prod default is operator-controlled; the agent fail-closes when off), if the generic path is also blocked then **deeds have no drafting path at all**. Is "deeds aren't draftable until the agent is enabled" the correct, acceptable posture (the safe default), or a regression to avoid?

**Why this is FIRE (all three §3.1 prongs hold):**
- **(c) client-send-safety** — strongly met. A recorded, third-party instrument; a wrong granting verb is a substantive legal/tax harm to the client.
- **(b) not caught by CI** — met. CI can assert "a deed routes to the agent," but cannot validate that the deed taxonomy is *legally* correct, that `deed_of_trust` is handled correctly, or that the fail-closed posture is acceptable. These are legal-judgment questions.
- **(a) load-bearing, hard-to-reverse-in-effect** — met. The git change is revertible, but §3.1 measures "hard to reverse" by **shipped effect**: a wrongly-routed or wrongly-blocked deed reaches a clerk/client. The DEED-DRAFT-AGENT-1 parent review covered the agent's *internal* exemption spine — **not** this generic-pipeline routing policy, the free-text taxonomy, or the flag-interaction. §3.1 expressly permits re-flagging a downstream engagement FIRE for new load-bearing decisions the parent didn't cover, and the engagement instruction pre-committed it ("if it changes a load-bearing routing/client-send-safety decision, treat it as a §3.1 external-review checkpoint rather than self-approving").

**Steelman against FIRE (and why it's defeated):** "The guard is additive and monotonically safer (today the path drafts freely; any block strictly reduces risk), the code is reversible build-and-PR, and DEED-DRAFT-AGENT-1 was already triad-reviewed — so LIVE-9 just *implements a reviewed design* and rides the parent review." This is defeated because the **routing policy, the free-text deed taxonomy, and the fail-closed/flag-interaction** are new decisions outside the parent's reviewed scope — exactly the carve-out §3.1 names for re-flagging.

---

## PART 2 — Ready-to-paste reviewer prompt (GPT + independent Claude)

> You are an external reviewer for an attorney-supervised legal-drafting platform (Virginia real-estate deeds). A self-contained engineering packet follows (PARTS 1, 3–6). **You have no repo access; review from the packet alone.**
>
> **Context:** A "deterministic deed agent" assembles VA deeds with pure code (no LLM), hardcoding an exemption-safe granting verb ("grant and convey", never "grant, bargain, sell, and convey") and a "Deed of Gift" face statement — both required for the Va. Code § 58.1-811(D) recordation-tax exemption (P.D. 93-212). **Separately**, a generic LLM document-drafting path (`document.generateDraft`) can be pointed at any `documentType` — including `deed` and `deed_of_trust` — and will free-draft "a deed" with no exemption-preservation. There is **no downstream backstop** (the deed recordability gate is flag-off by default, gates *recordability state* not draft text, and does not block generation; the sendability gate does category/level lookups only). The finding: the generic path can mint a deed with the exemption-killing verb, which is then recordable and sendable.
>
> **Decide and give reasons:**
> 1. **Is the harm real and correctly characterized?** Does a consideration/warranty granting clause on a gift deed actually defeat the § 58.1-811(D) exemption and expose the client to recordation tax? Any other legal harms (e.g., mischaracterized grantor, missing exemption recital, wrong instrument for `deed_of_trust`)?
> 2. **Block vs. redirect.** Should the generic path **hard-block** deed sub-types (refuse with a message directing the user to the deterministic deed agent) or **transparently redirect** into the deterministic assembler? Weigh safety, UX, and coupling of the two pipelines. (Note: a deterministic assembler exists for gift / seller-side / into-LLC / out-of-LLC / TOD / confirmation / into-trust — but **not** for `deed_of_trust`, a security instrument.)
> 3. **Deed taxonomy over a free-text `documentType`.** Which values must be treated as "a deed" for the guard: `deed`, `deed_of_trust`, and/or a `custom` label matching a deed pattern? Where should `deed_of_trust` go (block, but to which destination — certainly not the gift assembler)? How conservative should the matcher be (false-positives block a non-deed; false-negatives let a deed through)?
> 4. **Fail-closed posture vs. the agent flag.** When `DEED_DRAFT_AGENT_ENABLED` is OFF, if the generic path is also blocked, deeds have **no** drafting path. Is "block-always so the LLM never mints a deed, even while the deterministic agent is dark" the right default, or unacceptable? Should the block be independent of the agent flag?
> 5. **Coverage.** Must the guard cover `document.regenerate` and any template-mode path (a deed could otherwise be minted on regenerate), and ideally `document.create`, not just `document.generateDraft`? Server-side is required because the client offers `deed` as a dropdown value AND `documentType` is free text (a client-only guard is bypassable) — confirm.
> 6. **Anything missing / any objection** to shipping the recommended Phase-A plan in PART 6.
>
> Return: (a) harm confirmed/adjusted; (b) block-vs-redirect decision; (c) the deed taxonomy + `deed_of_trust` destination; (d) the fail-closed posture; (e) required coverage; (f) any blocking objection or go-ahead.

---

## PART 3 — Document manifest (files implicated; current main @ 3157ecb)

| Area | File | Role in the finding |
| :-- | :-- | :-- |
| New-Document UI | `src/client/pages/MatterDetail.tsx` | `New Document` button → `CreateDocumentForm` → `document.create`; `DOCUMENT_TYPES` dropdown offers `deed`, `deed_of_trust`, `custom`; `draftingMode` defaults `iterative` |
| Create mutation | `src/server/procedures/documents.ts` | `documentType` free-text (`z.string().min(1).max(64)`); stores `draftingMode` + `workflowState='drafting'`; no deed guard |
| Doc-type config | `src/shared/docTypes/docTypeConfig.ts` | `deed` = `targetStructure: 'role_sided'` (→ no subject binding required) |
| Generic LLM draft | `src/server/procedures/documents4a.ts` | `document.generateDraft` (~485) + `document.regenerate` (~661): generic prompt `Draft a ${documentType} document…`; **no deed branch**; `finalize` privilege-footer note only (:1211) |
| Subject scope | `src/server/documents/draftingSubject.ts`, `src/server/documents/subjectBinding.ts` | `role_sided` → `kind:'none'`, `mustBindFirst:false` (deed passes the only generate-time identity gate) |
| Deterministic agent | `src/server/procedures/deedDraftAgent.ts`; `src/server/deed/deedGiftAssembler.ts` (+ into-LLC/out-of-LLC/TOD/confirmation/into-trust/seller-side) | Pure, no-LLM assembler with the exemption-safe granting-verb spine |
| Router wiring | `src/server/procedures/router.ts` | `deedDraftAgent` (:163), `quickDeed` (:177) — SEPARATE routers; `documents4a.ts` imports none of them |
| Flags | `src/server/config/featureFlags.ts` | `isDeedDraftAgentEnabled()` gates ONLY the separate agent (fail-closed); does not touch the generic path |
| Downstream gates | `src/server/procedures/deedGate.ts`, `src/server/procedures/sendabilityGate.ts` | `deedGate` flag-off default, gates recordability STATE not draft text, doesn't block generate; `sendabilityGate` category/level only |

---

## PART 4 — Inlined evidence (confirmed-by-code)

**(4.1) A deed is a first-class, selectable generic document type; iterative by default.**
```
src/client/pages/MatterDetail.tsx
:51  { value: 'deed', label: 'Deed (general/special warranty, quitclaim, gift)' },
:52  { value: 'deed_of_trust', label: 'Deed of Trust' },
:80  { value: 'custom', label: 'Other / Custom' },
:99  const [draftingMode, setDraftingMode] = useState<'template' | 'iterative'>('iterative');
:592 'New Document'  (button → CreateDocumentForm → document.create)
```

**(4.2) The create mutation accepts `documentType` as free text and stores `drafting` state — no deed guard.**
```
src/server/procedures/documents.ts
:162 documentType: z.string().min(1).max(64),
:164 draftingMode: z.enum(['template', 'iterative']),
:261 draftingMode: input.draftingMode,
:266 workflowState: 'drafting',
:229 const needsClientParties = structure === 'individual_subject' || structure === 'party_set';   // deed=role_sided → false
```

**(4.3) The generic LLM path gates only on mode/state/binding — NO `documentType` branch — and free-drafts the deed.**
```
src/server/procedures/documents4a.ts  (document.generateDraft)
:491 if (doc.draftingMode !== 'iterative') { ... }
:497 if (doc.workflowState !== 'drafting') { ... }
:526 if (subjectScope.mustBindFirst) { ... }          // role_sided deed → mustBindFirst=false, passes
:557-563 systemPrompt = [
        'You are an expert legal document drafter for ${draftingForName}.',
        'Draft a ${doc.documentType} document titled "${doc.title}".',   // documentType only interpolated, never branched
        subjectScopeInstruction,
        'Write in a professional legal style. Be thorough and complete.',
        'Return only the document text, no commentary.' ]
```
`document.regenerate` (~:661, :742 "You are revising a ${doc.documentType} document…") has the same generic, deed-agnostic construction. `documents4a.ts` imports nothing from the deed agent; its only "deed" string is a privilege-footer formatting note (:1211).

**(4.4) The deterministic assembler hardcodes the exemption-safe verb — the protection the generic path lacks.**
```
src/server/deed/deedGiftAssembler.ts
:14  *  3. EXEMPTION-SAFE — the granting verb is hardcoded "grant and convey" (NOT "grant, bargain, sell, and
:15  *     convey") and the instrument states it is a "Deed of Gift" on its face; both are required for the
:16  *     § 58.1-811(D) exemption (P.D. 93-212). These are NOT parameterized.
:205 const exemptionCitation = gift?.exemptionCitation ?? 'Va. Code § 58.1-811(D)';
:206 const grantingVerb = 'grant and convey'; // P.D. 93-212: NOT "grant, bargain, sell, and convey"
```
**The exemption-killing verb is therefore "grant, bargain, sell, and convey" (+ a consideration recital)** — the standard sale clause a free LLM will naturally produce.

**(4.5) The agent flag gates only the separate agent; it does not constrain the generic path.**
```
src/server/config/featureFlags.ts
:184 export function isDeedDraftAgentEnabled(): boolean {
:185   return process.env["DEED_DRAFT_AGENT_ENABLED"] === "true"; }
src/server/procedures/deedDraftAgent.ts:1174  if (!isDeedDraftAgentEnabled()) { ... }   // agent fail-closes; generic path unaffected
```

**(4.6) No downstream backstop catches an LLM-drafted deed before send/record.**
```
src/server/procedures/deedGate.ts
:50  if (!isDeedGateEnabled()) { throw ... 'DEED_GATE_DISABLED' }   // default OFF
:59  if (doc.documentType !== 'deed') { throw 'DEED_GATE_NOT_A_DEED' } // only documentType==='deed'
      → gates recordability STATE (affirmative-act checklist), NOT the draft text; does not block generateDraft
src/server/procedures/sendabilityGate.ts
:32,:45  ruleLevels = rules.map(... category, documentType, level ...)   // no granting-verb / exemption inspection
src/server/procedures/documents4a.ts
:1211  privilege-footer formatting note only — no exemption / granting-verb inspection in finalize
```
**Net: the risk is fully open.** Between generic-path generation and the attorney sending/recording, nothing deterministic catches the exemption-killing verb — it depends entirely on the attorney noticing.

---

## PART 5 — Routing map (plain English)

```
New Document (MatterDetail.tsx:592)
  → CreateDocumentForm → document.create (documents.ts:162)        [documentType FREE TEXT; deed/deed_of_trust selectable]
      → stored: draftingMode='iterative' (default), workflowState='drafting'
  → DocumentDetail "Generate draft"
      → document.generateDraft (documents4a.ts:485)                 [gates: iterative + drafting + (indiv-subject only) bind]
          → role_sided deed: mustBindFirst=false → PASSES
          → generic LLM prompt "Draft a {documentType} document…"   ← NO deed branch, NO exemption spine
                                                                      ← *** THE FORK THAT IS MISSING ***
  ── vs ──
  Deterministic deed agent (router.ts:163 deedDraftAgent / :177 quickDeed)
      → src/server/deed/*Assembler.ts  (pure, no LLM, exemption-safe "grant and convey" + Deed-of-Gift face)
      → reached ONLY via the Quick-Deed / Deed-Intake surfaces — the generic pipeline never defers to it.
```

---

## PART 6 — Proposed Phase-A plan (NOT implemented; for the triad to ratify or amend)

> Presented so reviewers can object to the concrete shape. **Nothing here is built.** It will be built only after `operator approve checkpoint:LIVE-9`.

**Altitude:** server-side, because the client offers `deed` as a dropdown value AND `documentType` is free text — a client-only guard is bypassable.

**Cover all generic write paths:** `document.generateDraft` AND `document.regenerate` (documents4a.ts), and ideally a guard at `document.create` (or a clear UX redirect) so a deed never enters the iterative pipeline in the first place. Confirm whether any template-mode path also needs it.

**Recommended default = BLOCK (fail-closed), not redirect:**
- A shared `isDeedDocumentType(documentType, customTypeLabel?)` classifier (deed taxonomy — see open questions) → if true, `generateDraft`/`regenerate` throw `PRECONDITION_FAILED` with a message directing the user to the deterministic deed agent / Quick-Deed surface.
- **Block is independent of `DEED_DRAFT_AGENT_ENABLED`** — even when the agent is dark, the generic LLM must never mint a deed (the safe posture: deeds simply aren't draftable on the generic path; they wait for the agent). This is the load-bearing fail-closed call for the triad.
- `deed_of_trust` is blocked from the generic LLM but is **NOT** a gift deed — it must not be routed to the gift assembler. Its correct destination is an open question for the reviewers (likely: block with a distinct message; no deterministic assembler exists for it).

**Redirect (alternative, if the triad prefers):** intercept and call the deterministic assembler for the deed sub-types that HAVE one (gift / seller-side / into-LLC / out-of-LLC / TOD / confirmation / into-trust). Better UX, but couples the two pipelines and needs sub-type disambiguation — higher blast radius.

**Tests (CI):** (a) a deed-typed doc on `generateDraft` is blocked (or redirected) — assert the `PRECONDITION_FAILED`/route; (b) same for `regenerate`; (c) `deed_of_trust` handled per the triad's destination; (d) a NON-deed `documentType` is unaffected (regression); (e) the block holds with `DEED_DRAFT_AGENT_ENABLED` OFF.

**Build base:** `origin/main` @ 3157ecb (both the generic path and the deed agent coexist there). Reversible build-and-PR; flag-dark deed track; no schema, no migration, no prod, no new egress.

---

## Open questions for the triad

1. **Block vs. redirect** — hard-block + point to the deed agent (simpler, safer) or transparently route into the deterministic assembler (better UX, more coupling)?
2. **Fail-closed posture** — when `DEED_DRAFT_AGENT_ENABLED` is OFF and the generic path is blocked, deeds have NO drafting path. Acceptable safe default, or a regression to avoid?
3. **Deed taxonomy over free-text `documentType`** — which values count: `deed`, `deed_of_trust`, and any `custom` label matching a deed pattern? How conservative should the matcher be?
4. **`deed_of_trust` destination** — it is a security/financing instrument, not a gift deed: block (to what message/where), never to the gift assembler — confirm.
5. **Coverage** — must the guard cover `regenerate` and template-mode paths, and `document.create`, not only `generateDraft`?
6. **Parent-review scope** — did DEED-DRAFT-AGENT-1's triad cover the generic-pipeline interception/routing policy, or only the agent's internal exemption spine? (This memo assesses the latter → new load-bearing decision → FIRE. The record/operator should confirm.)

---

**STATUS: packet ready for LIVE-9 — HALTED for external triad review. No code written. Awaiting `operator approve checkpoint:LIVE-9` after the GPT + independent-Claude disposition.**

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
