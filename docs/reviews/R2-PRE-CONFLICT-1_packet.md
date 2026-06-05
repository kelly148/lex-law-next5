# Triad-Review Packet — R2-PRE-CONFLICT-1 (client-not-a-party conflicts gap)

> **§3.1 FIRE — EXTERNAL TRIAD REVIEW REQUIRED BEFORE IMPLEMENTATION.**
> This packet is self-contained: it is reviewable with **no repo access**. It states a finding and a
> **fix-design fork** for the triad (GPT + Grok + a fresh independent Claude synthesis) to resolve.
> **Do NOT self-run, self-review, or self-approve.** No code has been or will be written for this
> engagement until the operator returns a triad disposition. This fires on three grounds:
> (a) it changes a **load-bearing conflicts-of-interest / ethics** behavior; (b) the correctness of
> conflict *coverage* is **not caught by CI**; (c) it is a **corrected diagnosis** — a "fix-these-now"
> item that, on inspection, appears not to have landed.

---

## 1. Banner / context

- **Engagement:** R2-PRE-CONFLICT-1 — close the "client is not a conflict party" gap. A prerequisite, surfaced during **Whereas R2 #3** (matter-state header / readiness strip), for the strip's **conflicts-status chip** to be trustworthy. R2 #3 will ship its other elements without the conflicts chip pending this disposition.
- **Product:** Whereas (matter-centric attorney-supervised legal AI; repo `lex-law-next5`). Self-use, pre-client-facing.
- **Lineage:** FOLD-L0-1 (conflicts-at-intake, Fork A/G) built the deterministic conflict engine + intake. This engagement addresses a coverage gap in that system.
- **Evidence class:** finding is **confirmed by server-side code inspection** (files inlined below). NOT exhaustively traced through the client UI; it is possible (but not found) that a UI-level prompt nudges the attorney to add the client as a party.

## 2. The finding (what is wrong)

Conflict checking is **deterministic and runs only over the `matter_parties` table** (parties the attorney adds explicitly). The matter's **`clientName`** is a *separate field on the `matters` row* and is **never automatically represented as a party**, and **no transition is guarded on the client actually being among the checked parties**. Therefore:

> A conflict check can return **"cleared"** for a matter whose **client was never conflict-checked at all** — because if the client is not a `matter_parties` row, the engine never compares the client's name against the firm's adverse parties, so no client-side BLOCKER can ever be produced, and the hard-block gate (`hasUndispositionedBlocker` = "no undispositioned BLOCKER in the latest check") is satisfied **vacuously**.

This is an ethics-grade soft failure: the system can *look* conflict-cleared while silently never having checked the single most important party — the client.

**Concrete chain (all inlined in §6):**
1. `matter.create` / `matter.updateMetadata` set `matters.clientName` but never insert a `matter_parties` row.
2. `matter_parties` rows are created **only** by the manual `matterIntake.addParty` mutation (attorney types `displayName` + `role`). `insertMatterParty` has exactly one caller — that mutation.
3. `runConflictCheck` computes hits over `listPartiesForMatter(matterId)` (i.e., `matter_parties`) only.
4. The hard-block gate `hasUndispositionedBlocker` returns **false** when there is no check **or** no undispositioned BLOCKER hit — and its own comment notes *"No check yet ⇒ no known blockers."*
5. So `lockPlan` (and any advance gated on "conflicts cleared") can pass for a matter whose client was never added as a party.

## 3. DECISION UNDER REVIEW — the fix-design fork

How should the system guarantee the client is conflict-checked before any conflict-sensitive transition? Two designs; the triad should resolve which (or propose a third).

### Option (a) — Auto-represent `clientName` as a `client`-role party
On matter create/update (or lazily at conflict-check time), auto-insert/sync a `matter_parties` row with `role='client'`, `displayName = clientName`, `source='client_name'`.
- **Pro:** the client is *always* checked; zero attorney burden; the gap closes structurally.
- **Con:** it **automates a judgment** the current design deliberately left explicit — `matter_parties` is an attorney-curated set (names are normalized + matched; party identity is a legal determination). Auto-deriving a party from a free-text `clientName` can create mis-normalized or duplicate parties, and muddies the audit story ("who asserted this party?"). `clientName` is also sometimes not a clean legal party name (e.g., "Smith Family Trust (prospective)").

### Option (b) — Guard conflict-sensitive transitions until the client is explicitly represented *(builder's lean)*
Do **not** auto-create parties. Instead, **block/flag** the conflict-sensitive transitions (`runConflictCheck` "cleared" disposition, `lockPlan`, advance-to-drafting) when the matter has a `clientName` but **no `matter_parties` row plausibly representing the client** (e.g., no `role='client'` party, or no party whose normalized name matches the client). Surface a deterministic, attorney-facing prompt: *"Add the client as a party before clearing conflicts."*
- **Pro:** consistent with the existing **explicit `matter_parties` matching** and the project's **automate-the-labor-not-the-judgment** principle; the attorney still makes the party determination; clean audit; no silent/auto-derived parties.
- **Con:** adds an attorney step (must add the client as a party); requires a "does a party represent the client?" predicate (name-match heuristic or an explicit `role='client'` check) — needs a clear, non-flaky definition.

**Builder's lean: (b)** — it preserves the explicit-curation contract and the judgment/labor boundary, and it fails *visibly* (a prompt) rather than *silently auto-creating* a legal party. But this is exactly the kind of load-bearing ethics call the triad exists to resolve; **both are presented; do not pre-implement.**

### Sub-questions for the triad
1. (a) vs (b) — or a hybrid (e.g., auto-create but flagged `unconfirmed`, requiring attorney confirmation before "cleared")?
2. If (b): what is the right "client is represented" predicate — presence of any `role='client'` party? a normalized-name match against `clientName`? both?
3. Which transitions must be guarded — only `lockPlan`, or also advance-to-drafting / the conflict "cleared" disposition / export (send)?
4. Retroactive matters: existing matters created before the fix may have a `clientName` and no client party. Should the guard apply retroactively (flag them), or only forward?
5. Is a schema change needed (e.g., a `matter_parties.source='client_name'` tag, or a `role='client'` constraint), and if so does that itself warrant migration review?

## 4. Ready-to-paste reviewer prompt

> You are reviewing a proposed fix for a conflicts-of-interest coverage gap in an attorney-supervised legal-AI product ("Whereas"). Deterministic conflict checking runs only over an attorney-curated `matter_parties` table; the matter's `clientName` is a separate field and is never automatically a party, and no transition is guarded on the client being among the checked parties — so a conflict check can read "cleared" while the client was never checked. Two fix designs are proposed: (a) auto-represent `clientName` as a `client`-role party; (b) do not auto-create parties, but guard conflict-sensitive transitions (and the "cleared" disposition) until the client is explicitly represented, with an attorney-facing prompt. The builder leans (b) for consistency with the explicit-curation contract and the automate-the-labor-not-the-judgment principle. Assess: which option (or a hybrid) is correct for a legal-ethics conflicts system; the right "client is represented" predicate; which transitions to guard; retroactive handling; and any failure modes (false clears, silent auto-created parties, mis-normalized names, audit integrity). Give a clear recommendation and call out anything that should block implementation. The relevant code is inlined below; assume no other access.

## 5. Document manifest

All evidence is inlined in §6 (no external access needed). Source references (for a reviewer who does have the repo): `src/server/conflicts/engine.ts`; `src/server/db/queries/conflicts.ts`; `src/server/db/queries/matterParties.ts`; `src/server/procedures/matterIntake.ts`; `src/server/procedures/matters.ts`; `src/server/db/schema.ts` (`matters`, `matter_parties`).

## 6. Inlined code (the evidence)

**(i) Parties are attorney-curated; `insertMatterParty` has one caller — the manual `addParty`:**
```ts
// src/server/procedures/matterIntake.ts
addParty: protectedProcedure
  .input(z.object({ matterId: z.string().uuid(), role: ROLE, displayName: z.string().min(1).max(256),
                    partyType: PARTY_TYPE.optional(), source: z.string().max(64).optional() }))
  .mutation(async ({ ctx, input }) => {
    await assertMatterOwned(input.matterId, ctx.userId);
    return insertMatterParty({ userId: ctx.userId, matterId: input.matterId, role: input.role,
      displayName: input.displayName, ...(input.partyType ? { partyType: input.partyType } : {}),
      ...(input.source ? { source: input.source } : {}) });
  }),

runConflictCheck: protectedProcedure
  .input(z.object({ matterId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertMatterOwned(input.matterId, ctx.userId);
    return runConflictCheck(input.matterId, ctx.userId);   // computes hits over matter_parties only
  }),
```

**(ii) The check runs over `matter_parties` (this matter) vs other matters' parties — never `clientName`:**
```ts
// src/server/db/queries/conflicts.ts
export async function runConflictCheck(matterId, userId) {
  const thisParties = (await listPartiesForMatter(matterId, userId)).map(toLite);   // matter_parties only
  const others      = (await listOtherPartiesForOwner(matterId, userId)).map(toLite);
  const hits = computeConflictHits(thisParties, others);   // pure, deterministic, NO LLM
  // ... persist check + hits ...
}

// Hard-block gate (Fork A):
export async function hasUndispositionedBlocker(matterId, userId) {
  const check = await getLatestCheckForMatter(matterId, userId);
  if (!check) return false;                       // "No check yet => no known blockers"
  const hits = await listHitsForCheck(check.id, userId);
  return hasBlocker(hits.filter((h) => h.disposition === 'pending'));
}
```

**(iii) `matter.create` sets `clientName` but inserts NO party:**
```ts
// src/server/procedures/matters.ts  (create)
clientName: input.clientName ?? null,   // ... no insertMatterParty anywhere in matters.ts
```

**(iv) `clientName` and `matter_parties` are structurally separate:**
```ts
// src/server/db/schema.ts
export const matters = mysqlTable('matters', {
  id, userId, title,
  clientName: varchar('clientName', { length: 256 }),   // free-text; NOT a party
  // ... no jurisdiction column either (separate finding, R2-PRE-JURIS-1) ...
});
export const matterParties = mysqlTable('matter_parties', { /* id, userId, matterId, role, displayName, normalizedName, partyType, source ... */ });
```

**(v) `lockPlan` is "GATED on conflicts cleared" (file header) — i.e., on `hasUndispositionedBlocker` being false, which is vacuously true when the client was never a party.**

## 7. Disposition (operator fills in after triad)

- Triad lanes (GPT / Grok / fresh-Claude synthesis): _pending_
- Consolidated disposition: _pending_
- Chosen design (a / b / hybrid) + named constraints: _pending_
- Then: `operator approve checkpoint:R2-PRE-CONFLICT-1` to authorize implementation.

---

End of formal addendum. Any content below this line is platform-injected and not part of the engagement output.
