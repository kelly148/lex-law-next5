# S5 — Confirmation deed survivorship: line-by-line review packet (for Kelly)

**ULTRABUILD-1 W3b (run-sheet A.3).** This is a **review packet, not a code change** — it inlines the
survivorship logic of the Deed of Confirmation assembler with plain-English annotations so you (the attorney)
can sign off on S5, a precondition to the Confirmation lane going client-facing. **No survivorship logic was
changed.** Source: `src/server/deed/deedConfirmationAssembler.ts`.

## What a Deed of Confirmation does (plain English)

A Deed of Confirmation does **not** transfer title. It **confirms — places of record** — title that has
**already vested by operation of law** (e.g. a surviving joint owner already owns the whole property the
instant the co-owner died; the confirmation deed just makes that clean in the land records). So the entire
legal substance lives in the **WHEREAS recital chain** — the story of how title got where it is. The assembler
is a **deterministic FORMATTER** of facts you provide; per the **NC-1 red line it never composes an operative
string** — every legal phrase is either a verified fixed fragment or a value you supplied verbatim.

## The two archetypes the code handles

- **C1-a — survivorship** (the SFH and condo exemplars). Granting verb *"grant and convey"*. A **3-link
  WHEREAS chain**: (1) the co-owners *took title as* joint tenants / tenants-by-the-entirety with right of
  survivorship → (2) one co-owner *departed this life* → (3) *by operation of law* the survivor became sole
  owner.
- **C1-b — testate / devise** (the estate exemplar). Granting verb *"grant, confirm, and convey"*. A **5-link
  WHEREAS chain**: prior deed → TBE survivorship → testator died testate + probate fiduciary → the devise
  article vests title in the devisee → …

## The survivorship logic to review (inlined)

**(a) Who is the surviving sole owner? — the derivation rule.** From the code (annotated):

```
survivorName?: string;
// Optional attorney-supplied surviving sole-owner name. When OMITTED, the survivor is DERIVED as the
// co-owner who is NOT the decedent — and that derivation must be UNAMBIGUOUS (exactly one co-owner matches
// the decedent name) or the chain FAILS CLOSED. Never silently defaulted to the first listed owner.
```

Plain English: if you don't name the survivor, the code figures it out by elimination (the co-owner who isn't
the one who died) — but **only if it can do so unambiguously**; otherwise it refuses to produce the deed rather
than guess. It will **never** just assume the first-listed owner is the survivor.

**(b) The chain facts you supply** (C1-a):

```
interface ConfirmationChainSurvivorship {
  tookTitleAs: string;   // e.g. "joint tenants with the common law right of survivorship"
  coOwners: string[];    // [survivor, decedent] in the matter's recited order
}
interface ConfirmationDecedent { /* the co-owner who died, triggering survivorship */ }
originalGranteesTenancy: string; // e.g. "tenants by the entirety with the common law right of survivorship"
```

Plain English: you tell the code the tenancy the owners held (JTWROS vs TBE) and which owner died; the code
renders the *"whereby [survivor] became sole owner by survivorship"* recital and the *"by operation of law"*
link from those facts. The tenancy strings are **your** verbatim inputs — the code does not invent the tenancy.

## The specific questions you (the attorney) must answer for S5 sign-off

1. **Survivorship as operation of law.** Is it legally correct, for a Virginia JTWROS **and** a TBE, to confirm
   that on the death of one co-owner the survivor holds sole title **by operation of law** — with a
   confirmation deed rather than any new conveyance? (The code treats both tenancies this way.)
2. **The derivation-by-elimination rule.** Are you comfortable that when the survivor's name is omitted, the
   code derives it as "the co-owner who is not the decedent," **fails closed on any ambiguity**, and never
   defaults to the first owner? Or should the survivor **always** be attorney-supplied (never derived)?
3. **Tenancy inputs.** The tenancy phrasings (`tookTitleAs`, `originalGranteesTenancy`) are verbatim inputs, not
   validated against a controlled list. Should there be a fixed set of accepted tenancy recitals (JTWROS / TBE
   with-right-of-survivorship), or is free-text attorney input correct here?
4. **The 3-link vs 5-link chain.** For C1-a (survivorship) is the 3-link recital chain
   (took-title-as → death → operation-of-law) complete and correct as a chain of title? For C1-b (testate) is
   the 5-link chain (prior deed → TBE survivorship → testate death + probate FI → devise article → vesting)
   complete? Anything a title examiner would require that is missing?
5. **"Departed this life" / a/k/a handling.** Is the decedent-name and a/k/a (also-known-as) handling in the
   recital sufficient for a clean chain, and is the granting verb correct per archetype
   ("grant and convey" for survivorship; "grant, confirm, and convey" for testate)?
6. **The scope of what's confirmed.** Is it correct that a Confirmation deed confirms the *existing* vesting
   only and never changes marital-rights / tax / vesting structure (those remain your decisions)?

## What this packet does NOT do

- It changes **no** survivorship logic (the dispatch forbids it).
- It does not sign off S5 — that is your attorney judgment, recorded when you answer the questions above.
- S5 remains **OPEN** on the client-facing preconditions list until you complete this review
  (`docs/CLIENT_FACING_PRECONDITIONS.md` item 3).
