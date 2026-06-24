# Deed KB — grounded §2 rows for the 5 remaining categories (variant-aware)

**Status:** GROUNDED from real Mason exemplars, 2026-06-23 (Cowork). Fills the per-category grounding gap the build brief flagged. Citations confirmed against the actual deeds; variant axes captured from multiple exemplars per category so GOLDEN fixtures cover the real spread. **All client-specific facts are `[[ ]]` slots; committed fixtures stay synthetic (PII-free).** Extends the shared Mason skeleton in `docs/deed-agent/DEED_KB_SEED.md` §1.

> **Provenance note (de-identified for the repo):** this committed copy uses neutral exemplar IDs (e.g. "Exemplar C1-a") in place of the real client matter surnames that appear in the Cowork source, per the MONSTER-v2 cleanup note. No client deed data (names, addresses, tax IDs, legal descriptions, SSNs) is in this file — only the legal patterns, confirmed citations, variant axes, and `[[ ]]` slot maps. The real exemplars remain reference-only and are never committed. 13 exemplars were read across the 5 categories.

---

## C1 — DEED OF CONFIRMATION
**Exemption:** § 58.1-810(1) (house default). **Alternative:** § 58.1-811(K) (deed of distribution, testamentary passage — if used, add front-page "This is a deed of distribution" and style Grantor as the Executor). **Warranty:** General Warranty + English Covenants. **Vesting:** sole owner. **Consideration:** $0.00. **Parties:** same person, "party of the first part (Grantor)" → "party of the second part (Grantee)" — confirms record title, does NOT transfer.

**Two archetypes (cover BOTH in GOLDEN):**
- **C1-a Survivorship (Exemplar C1-a):** co-owner died; survivor confirms sole ownership by operation of law. Granting verb: "**grant and convey**, with General Warranty…". WHEREAS chain: took-title-as-JTWROS → co-owner "departed this life on or about [[date]]" → "by operation of law [[survivor]] became the sole owner".
- **C1-b Testate / devise (Exemplar C1-b):** title vested in a **devisee** by will. Granting verb: "**grant, confirm, and convey**, with General Warranty…". WHEREAS chain is longer: prior deed → TBE survivorship → testator "departed this life **testate** on [[date]], … Will … admitted to probate … as Fiduciary No. [[FI-…]]" → "under Article [[#]] of the … Will, [[devisee]] … is the … devisee … and title thereto vested in her as devisee upon the death of the Testator" → "the Grantor desires by this Deed of Confirmation to confirm, and to place of record, her title". The estate-caption name + FI number stay on the chain.

**Load-bearing principle (verbatim from the testate exemplar's drafter's notes — feeds Inc 2 / B2):** "Confirmatory deed records title that vested by devise at death; it does not transfer. **No executor's deed needed — realty passed to the devisee, not the PR, and no power of sale is being exercised.**" (This is the B2 estate-source principle, confirmed in the corpus.)

**Slots:** `[[name]]` (both parts) · `[[chain-of-title facts]]` · `[[decedent + DOD]]` · `[[testate: will date, probate FI no., devise article]]` · `[[legal description verbatim]]` · `[[prior instrument ref]]` · `[[tax id]]` · `[[assessed value]]`.

---

## C2 — DEED INTO TRUST
**Exemption:** § 58.1-811(A)(12). **Divorce variant adds § 58.1-811(A)(15)** (Exemplar C2-ii). **TBE-immunity note (§ 55.1-136(C))** for married grantors who held as tenants by the entirety — phrasing varies (see below). **Warranty:** General Warranty + English Covenants. **Vesting:** to the Trustees. **Consideration:** $0.00. **Parties:** grantor(s) → same person(s) as Trustee(s) of their revocable living trust. **Trustee-powers clause:** the full "IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey … no obligation or liability upon any purchaser … to inquire as to the terms of the Trust …" block — carry verbatim.

**Variant axes (cover the spread in GOLDEN):**
- **Granting verb varies:** "**quitclaim, release and convey**" (Exemplars C2-i, C2-ii) vs. "**grant, bargain, sell and convey**" (Exemplar C2-iii). Both "with General Warranty and English Covenants."
- **Trust structure:** one joint trust (Exemplar C2-i) · one spouse's trust with both signing (Exemplar C2-ii) · **his-and-hers dual trusts** (Exemplar C2-iii — "Trustees under THE [[H]] LIVING TRUST … and … THE [[W]] LIVING TRUST").
- **Marital status:** married/TBE (Exemplars C2-i, C2-iii) · **divorced, not remarried** (Exemplar C2-ii — adds § 58.1-811(A)(15); BEING recital states the divorce Order + that per the Marital Separation Agreement one spouse relinquished interest; both still sign).
- **TBE note phrasing:** "The GRANTORS herein wish to preserve the protection from creditors afforded to property held as tenants by the entirety pursuant to Virginia Code § 55.1-136(C). After this transfer, this property shall have the same immunity…" (Exemplar C2-i) vs. "NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold … as tenants by the entirety pursuant to VA Code Section 55.1-136(C)." (Exemplar C2-iii). Include for married/TBE grantors; omit for the divorced/single case.
- **Property:** condo (Exemplar C2-i — unit + parking/storage limited-common-elements language verbatim) vs. SFH (Exemplars C2-ii, C2-iii).
- **"For estate planning purposes, and other good and valuable consideration"** opens the granting clause in all.

**Slots:** `[[grantors + marital status]]` · `[[trust name(s) + date(s)]]` · `[[legal description verbatim]]` · `[[derivation/prior deed]]` · `[[divorce facts if applicable]]` · `[[tax id]]` · `[[assessed value]]`.

---

## C3 — DEED INTO AN LLC
**Exemption:** § 58.1-811(A)(10). **Title:** plain `DEED`. **Granting:** "the GRANTOR(S) does/do hereby **quitclaim release and convey** unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest…" — **NO warranty** (quitclaim). **Vesting:** LLC takes fee. **Consideration:** $0.00. **Parties:** "[[grantor]], [[marital status]], GRANTOR(S), and [[LLC]], a Virginia Limited Liability Company, GRANTEE". "SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE" pagination marker.

**Variant axes:**
- **Grantor(s):** single unmarried (Exemplars C3-i, C3-ii) vs. **married couple** (Exemplar C3-iii — both sign; note the source typo "all of the **Grantor's**" singular with two grantors → a real negative-lint target, do not reproduce).
- **Property:** SFH (Exemplars C3-i, C3-iii) vs. **condo** (Exemplar C3-ii — multiple Declaration amendments recited verbatim).
- **Legal-description casing:** title-case (Exemplars C3-i, C3-ii) vs. **ALL-CAPS** (Exemplar C3-iii) — carry verbatim either way.
- Derivation-of-title line is a slot (DB/Page or Instrument No.).

**Slots:** `[[grantor(s) + marital status]]` · `[[LLC name]]` · `[[legal description verbatim]]` · `[[derivation]]` · `[[tax id]]` · `[[assessed value]]`.

---

## C4 — DEED OUT OF AN LLC
**Exemption:** § 58.1-811(A)(11). *(NEG target: the exemplar typos "58-1-811(A)(11)" — flag, never reproduce.)* **Title:** plain `DEED` + the "THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE" banner + Universal Title return block + File Number. **Granting:** "the Grantor does hereby **grant and convey, with Special Warranty of title**, unto the said Grantees, in fee simple, **as tenants in common**…". **Vesting:** tenants in common. **Warranty:** **Special**. **Consideration:** $0.00. **Parties (name-before-parenthetical-label form):** "[[LLC]], A Virginia Limited Liability Company, (the "Grantor"), and [[members]], collectively being the members of the Grantor LLC, (the "Grantees")". **Signature:** LLC by each member. **Name-bleed discipline (OCR-B1):** the `(the "Grantor")` label must not bleed into the party name.

*(Only one exemplar — Exemplar C4-i. A second out-of-LLC exemplar would strengthen the fixture spread if available; one is sufficient to ground.)*

**Slots:** `[[LLC name]]` · `[[members]]` · `[[legal description verbatim]]` · `[[prior instrument ref]]` · `[[file number]]` · `[[tax id]]` · `[[assessed value]]`.

---

## C5 — REVOCABLE TRANSFER ON DEATH DEED (TOD/TODD)
**Exemption:** § 58.1-811(J). **Act recital (verbatim):** "pursuant to the … **Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq.** … at my death, I transfer and convey my interest … to my designated beneficiaries as follows:". **RIGHT TO REVOKE / METHOD TO REVOKE** full block (the 4-part (a)-(d) list + acknowledgment/recording requirement + takes-subject-to clause) — carry **verbatim**. **Consideration:** $0.00. **Warranty:** none (death-effective transfer, not a present conveyance). Single transferor signature.

**Variant axes (TOD varies the most — cover the spread):**
- **Premise:** "made by [[transferor]][[, capacity]]" — capacity may be "surviving joint tenant" (Exemplar C5-i) or "unmarried, Grantor, whose address is …" (Exemplars C5-iii, C5-iv); some **name the Grantee in the premise** (Exemplars C5-iii, C5-iv: "…, and [[name]], Grantee"), some don't (Exemplars C5-i, C5-ii).
- **Beneficiaries:** multiple individuals (Exemplar C5-i — three) · a single individual "my daughter/son … as sole owner" (Exemplars C5-iii, C5-iv) · **a trust / successor-trustee** ("the Successor Trustee of my revocable trust, THE [[TRUST]] …" — Exemplar C5-ii). Add a CONTINGENT beneficiaries block when present.
- **Beneficiary vesting:** "joint tenants with the common law right of survivorship" (Exemplars C5-i, C5-ii) vs. "**sole owner**" (Exemplars C5-iii, C5-iv).
- **Chain:** BEING recital with a predeceased joint tenant (Exemplar C5-i) vs. plain derivation-of-title "For derivation of title, see Deed recorded …" (Exemplars C5-iii, C5-iv).
- **Property:** condo (Exemplars C5-ii, C5-iii — carry the full Chapter 4.2 / Title 55 condo subject-to language verbatim) vs. SFH (Exemplars C5-i, C5-iv — incl. a "corrected/erroneously omitted from prior recorded Deed" legal note).
- **Names:** a hyphenated surname (Exemplar C5-iv). NEG targets: a stray period in an address (e.g. "2231.4"), a stray OCR word.

**Slots:** `[[transferor + capacity]]` · `[[primary/contingent beneficiaries + vesting + relationship]]` · `[[property address]]` · `[[tax map]]` · `[[legal description verbatim]]` · `[[BEING/derivation facts]]`.

---

## Cross-category notes
- **Exemption cites confirmed (2026-06-23):** C1 § 58.1-810(1) (alt § 58.1-811(K)) · C2 § 58.1-811(A)(12) (+ (A)(15) divorce; + § 55.1-136(C) TBE) · C3 § 58.1-811(A)(10) · C4 § 58.1-811(A)(11) · C5 § 58.1-811(J) + § 64.2-621 et seq. (Cross-check against `docs/deed-agent/DEED_KB_SEED.md` §3 + `src/server/deed/deedKbVa.ts`: **(A)(10), (A)(15), and § 55.1-136(C) are NOT yet in the verified `deedKbVa.ts`** and must be added there — grounded by this 2026-06-23 corpus confirmation — before the C2/C3 assemblers may emit them under the no-hallucinated-cite rule.)
- **Real-corpus negative-lint targets (keep in NEG fixtures; assembler must NOT reproduce / must flag):** "58-1-811" (C4 malformed cite) · a stray OCR word (C2) · a stray period in an address e.g. "2231.4" (C5) · singular "Grantor's" with two grantors (C3 married-couple) · plus the prior set "FairfaxCounty", "will full powers", "Deed form".
- **Return-address blocks vary** (e.g. Universal Title: 3031 Fairview Park Dr, Falls Church vs. 4031 University Dr, Fairfax) — slot, don't hard-code.
- **PII:** the real exemplars carry real client data (names, addresses, tax IDs; one estate packet has a death cert with a full SSN). **Reference-only — never commit.** Derived fixtures are synthetic.
- **Bonus:** the testate-confirmation exemplar's embedded DRAFTER'S NOTES are a real-world model for the Inc 2/Inc 4 advisory layer (exemption alternative, executor's-deed-not-needed, estate-tax-lien analysis, address-discrepancy flag, judgment-search diligence).

## Next step (the per-category build pipeline)
Each category needs a **synthetic GOLDEN/NEG fixture pack** (PII-free, real structure, covering the variant axes above, exact-match assertions) → CLI builds the assembler + registers it + adversarially reviews + opens a flag-dark PR. The fixture packs are delivered as paste-ready per-category blocks (committed to `docs/deed/DEED_CAT_*_fixture_pack.md`).
