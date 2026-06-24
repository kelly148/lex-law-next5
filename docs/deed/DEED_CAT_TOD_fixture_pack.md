# DEED CATEGORY C5 — REVOCABLE TRANSFER ON DEATH DEED (TOD/TODD) — Synthetic Fixture Pack

**Status:** Paste-ready, PII-FREE. Synthetic fixtures for the deterministic Mason deed-drafting assembler (sibling of the deed-of-gift assembler). STRUCTURE replicated from real Mason exemplars (Exemplar-A TODD, TODD Exemplar-B, TODD Exemplar-C); ALL party names, addresses, tax IDs, legal descriptions, dates, deed-book references, and trust names are INVENTED. Style matches the seller-side / OCR-B1 synthetic-fixture convention (exact-match assertions; fail-closed NEG fixtures).

**Category invariants (C5):**
- **Exemption line (verbatim):** `THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.`
- **Title (verbatim):** `REVOCABLE TRANSFER ON DEATH DEED`
- **Act recital (verbatim):** the `Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq.` paragraph.
- **Revocation block (verbatim, LOAD-BEARING):** the full `RIGHT TO REVOKE AND METHOD TO REVOKE DEED` block — the (a)-(d) list under item 1, item 2 (acknowledgment/recording requirement), and the three trailing paragraphs (recorded-only-by-revocatory-instrument, inter-vivos-not-limited, takes-subject-to). Must be verbatim-COMPLETE or WITHHELD.
- **Consideration:** none stated (death-effective transfer). **Warranty:** none (not a present conveyance). **Signature:** SINGLE transferor + single-acknowledgment notary block.

**Slots:** `[[transferor + capacity]]` · `[[primary/contingent beneficiaries + vesting + relationship]]` · `[[property address]]` · `[[tax map]]` · `[[legal description verbatim]]` · `[[BEING/derivation facts]]`.

---

## SECTION 1 — GOLDEN FIXTURES

---

### GOLDEN G1 — Single transferor → MULTIPLE individual beneficiaries (JTWROS), SFH, BEING recital with a predeceased joint tenant

> Variant axes: capacity = "surviving joint tenant"; multiple individuals; vesting = "joint tenants with the common law right of survivorship"; SFH; BEING recital naming a predeceased joint tenant; Grantee NOT named in premise.

**INPUT (synthetic matter facts):**

```json
{
  "category": "TOD",
  "exemption": "§ 58.1-811(J)",
  "preparer": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "return_to": "4490 Heronwood Court, Reston, VA 20194",
  "tax_id": "0185 22F 0007",
  "deed_date_phrase": "__________ day of August 2025",
  "transferor": { "name": "Margaret T. HOLLOWAY", "capacity": "surviving joint tenant" },
  "grantee_named_in_premise": false,
  "primary_beneficiaries": {
    "persons": ["Daniel HOLLOWAY", "Rebecca HOLLOWAY-MERCER", "Theodore HOLLOWAY"],
    "vesting": "joint tenants with the common law right of survivorship",
    "relationship": null
  },
  "property_address": "4490 Heronwood Court, Reston, VA 20194",
  "tax_map_reference": "as stated above",
  "legal_description": "Lot Seven (7), Block F, Section Two (2), HERONWOOD ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 4118, at Page 209, among the land records of Fairfax County, Virginia.",
  "being_recital": "BEING the same property conveyed unto Arthur P. Holloway and Margaret T. Holloway by Deed dated April 2, 1995, and recorded on April 9, 1995 in Deed Book 9233, at page 0741, among the aforesaid land records.  Arthur P. Holloway departed this life on or about June 18, 2012, leaving Margaret T. Holloway as the sole surviving joint tenant.",
  "notary_county_blank": true,
  "acknowledgment_month_year": "August, 2025"
}
```

**EXPECTED ASSEMBLED DEED (full house style):**

```
THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.

This Deed was prepared by Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Return to: 4490 Heronwood Court, Reston, VA 20194

TAX ID NO: 0185 22F 0007


REVOCABLE TRANSFER ON DEATH DEED

THIS REVOCABLE TRANSFER ON DEATH DEED, dated as of the __________ day of August 2025, is made by Margaret T. HOLLOWAY, surviving joint tenant.

This Revocable Transfer on Death Deed is made pursuant to the provisions of the Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq. In accordance with the provisions of the Uniform Real Property Transfer on Death Act, at my death, I transfer and convey my interest in the below described property to my designated beneficiaries as follows:

PRIMARY BENEFICIARIES

I hereby designate as my Primary Beneficiaries Daniel HOLLOWAY, Rebecca HOLLOWAY-MERCER, and Theodore HOLLOWAY, as the Primary Beneficiaries of the property described, below, and which is commonly known as 4490 Heronwood Court, Reston, VA 20194, in fee simple, as joint tenants with the common law right of survivorship.

The street address of the real property is 4490 Heronwood Court, Reston, VA 20194, and the tax map reference is as stated above and the legal description of the real property that shall be transferred at my death pursuant to this Revocable Transfer on Death Deed is as follows:

Lot Seven (7), Block F, Section Two (2), HERONWOOD ESTATES, as the same appears duly dedicated, platted and recorded in Deed Book 4118, at Page 209, among the land records of Fairfax County, Virginia.

BEING the same property conveyed unto Arthur P. Holloway and Margaret T. Holloway by Deed dated April 2, 1995, and recorded on April 9, 1995 in Deed Book 9233, at page 0741, among the aforesaid land records.  Arthur P. Holloway departed this life on or about June 18, 2012, leaving Margaret T. Holloway as the sole surviving joint tenant.


RIGHT TO REVOKE AND METHOD TO REVOKE DEED:

Before my death, I have the right to revoke this deed.

Under the Uniform Real Property Transfer on Death Act, an instrument is effective to revoke a recorded transfer on death deed, or any part of it, only if the instrument:

1. Is one of the following: (a). A transfer on death deed that revokes the transfer on death deed or part of the transfer on death deed expressly; (b). A transfer on death deed that names a designated beneficiary that is inconsistent with the designated beneficiary in a prior transfer on death deed; (c). An instrument of revocation that expressly revokes the transfer on death deed or part of the transfer on death deed; or (d). An inter vivos deed that expressly revokes the transfer on death deed or part of the transfer on death deed.

2. Is acknowledged by the transferor after the acknowledgment of the transfer on death deed being revoked and recorded before the transferor’s death in the land records of the clerk’s office   of the circuit court where the deed is recorded.

After this transfer on death deed is recorded, it can be revoked only by an effective revocatory instrument recorded prior to the death of the transferor and may not be revoked by a revocatory act taken against or on the original or a copy of the recorded transfer on death deed.

The execution and recordation of this transfer on death deed does not limit the effect of an inter vivos transfer of the property.

At my death, a beneficiary takes the property subject to all conveyances, encumbrances, assignments, contracts, mortgages, liens, and other interests to which the property is subject at my death.

Witness the following signature and seals:
________________________________(seal)
Margaret T. HOLLOWAY

COMMONWEALTH OF VIRGINIA
CITY/COUNTY OF _________________, to wit:
The foregoing instrument was acknowledged before me this ______ day of August, 2025 by Margaret T. HOLLOWAY.
____________________________Notary Public
My commission expires: _____________________Registration number: _______________________
```

---

### GOLDEN G2 — Single transferor → ONE individual beneficiary ("my daughter") as SOLE OWNER, CONDO (Chapter 4.2 / Title 55 subject-to language)

> Variant axes: capacity = "unmarried, Grantor, whose address is …"; single individual; relationship = "my daughter"; vesting = "sole owner"; CONDO carrying the full Chapter 4.2 of Title 55 subject-to block; Grantee NAMED in premise; derivation-of-title line (not a BEING recital); carries the "PREPARED WITHOUT THE BENEFIT OF A TITLE EXAMINATION" banner + Assessed Value.

**INPUT (synthetic matter facts):**

```json
{
  "category": "TOD",
  "exemption": "§ 58.1-811(J)",
  "preparer": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "return_to": "5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207",
  "tax_id": "0312 08 0312",
  "assessed_value": "$341,500",
  "prepared_without_title_exam": true,
  "deed_date_phrase": "__________ day of October 2025",
  "transferor": { "name": "Patricia L. ABERNATHY", "capacity": "unmarried, Grantor, whose address is 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207" },
  "grantee_named_in_premise": true,
  "grantee_premise_name": "Olivia Grace ABERNATHY",
  "primary_beneficiary": {
    "person": "Olivia Grace ABERNATHY",
    "relationship": "my daughter",
    "vesting": "sole owner"
  },
  "property_address": "5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207",
  "tax_map_reference": "0312 08 0312",
  "legal_description_preamble": "all that certain lot or parcel of land, together with the improvements thereon and appurtenances thereunto belonging, situate, lying and being in the County of Arlington, Commonwealth of Virginia, and more particularly described as follows:",
  "legal_description": "CONDOMINIUM UNIT 312, WAKEFIELD STATION CONDOMINIUM, together with the an undivided interest in the common and Limited Common Elements and all other rights and privileges which attach or are appurtenant to said Unit, all as described in the Declaration recorded in Deed Book 5207 at page 1 with Plats and Plans and Exhibits attached thereto, and any amendments thereto whether now existing or hereafter recorded as permitted by the Declaration, said proportionate undivided interest in the Common and Limited Common Elements being subject to change by amendment to said Declaration as provided herein.",
  "condo_subject_to": "The CONDOMINIUM UNIT and its undivided interest in the common and Limited Common Elements are conveyed subject to the provisions of Chapter 4.2 of Title 55 of the Code of Virginia, the aforesaid Declaration, all Plats and Plans and Exhibits attached thereto, all amendments to the Declaration, all regulations and agreements lawfully made and entered into pursuant thereto, and the By-Laws of the Unit Owners’ Association and any amendments thereto; and subject also to all easements, covenants, conditions, restrictions, and limitations of record",
  "derivation_of_title": "For derivation of title, see Deed recorded in Deed Book 9014, at page 622, among the aforesaid land records.",
  "notary_city": "CITY OF ARLINGTON",
  "acknowledgment_month_year": "October, 2025"
}
```

**EXPECTED ASSEMBLED DEED (full house style):**

```
THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.

This Deed was prepared by Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Return to: 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207

TAX ID NO: 0312 08 0312

Assessed Value:  $341,500

PREPARED WITHOUT THE BENEFIT OF A TITLE EXAMINATION

REVOCABLE TRANSFER ON DEATH DEED

THIS REVOCABLE TRANSFER ON DEATH DEED, dated as of the __________ day of October 2025, is made by Patricia L. ABERNATHY, unmarried, Grantor, whose address is 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207, and Olivia Grace ABERNATHY, Grantee.

This Revocable Transfer on Death Deed is made pursuant to the provisions of the Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq. In accordance with the provisions of the Uniform Real Property Transfer on Death Act, at my death, I transfer and convey my interest in the below described property to my designated beneficiaries as follows:

PRIMARY BENEFICIARY

I hereby designate my daughter, Olivia Grace ABERNATHY, as the Primary Beneficiary of the property described, below, and which is commonly known 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207, in fee simple, as sole owner.


The street address of the real property is 5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207, and the tax map reference is 0312 08 0312, and the legal description of the real property that shall be transferred at my death pursuant to this Revocable Transfer on Death Deed is all that certain lot or parcel of land, together with the improvements thereon and appurtenances thereunto belonging, situate, lying and being in the County of Arlington, Commonwealth of Virginia, and more particularly described as follows:

CONDOMINIUM UNIT 312, WAKEFIELD STATION CONDOMINIUM, together with the an undivided interest in the common and Limited Common Elements and all other rights and privileges which attach or are appurtenant to said Unit, all as described in the Declaration recorded in Deed Book 5207 at page 1 with Plats and Plans and Exhibits attached thereto, and any amendments thereto whether now existing or hereafter recorded as permitted by the Declaration, said proportionate undivided interest in the Common and Limited Common Elements being subject to change by amendment to said Declaration as provided herein.

The CONDOMINIUM UNIT and its undivided interest in the common and Limited Common Elements are conveyed subject to the provisions of Chapter 4.2 of Title 55 of the Code of Virginia, the aforesaid Declaration, all Plats and Plans and Exhibits attached thereto, all amendments to the Declaration, all regulations and agreements lawfully made and entered into pursuant thereto, and the By-Laws of the Unit Owners’ Association and any amendments thereto; and subject also to all easements, covenants, conditions, restrictions, and limitations of record

For derivation of title, see Deed recorded in Deed Book 9014, at page 622, among the aforesaid land records.

RIGHT TO REVOKE AND METHOD TO REVOKE DEED:

Before my death, I have the right to revoke this deed.

Under the Uniform Real Property Transfer on Death Act, an instrument is effective to revoke a recorded transfer on death deed, or any part of it, only if the instrument:

1. Is one of the following: (a). A transfer on death deed that revokes the transfer on death deed or part of the transfer on death deed expressly; (b). A transfer on death deed that names a designated beneficiary that is inconsistent with the designated beneficiary in a prior transfer on death deed; (c). An instrument of revocation that expressly revokes the transfer on death deed or part of the transfer on death deed; or (d). An inter vivos deed that expressly revokes the transfer on death deed or part of the transfer on death deed.

2. Is acknowledged by the transferor after the acknowledgment of the transfer on death deed being revoked and recorded before the transferor’s death in the land records of the clerk’s office   of the circuit court where the deed is recorded.

After this transfer on death deed is recorded, it can be revoked only by an effective revocatory instrument recorded prior to the death of the transferor and may not be revoked by a revocatory act taken against or on the original or a copy of the recorded transfer on death deed.

The execution and recordation of this transfer on death deed does not limit the effect of an inter vivos transfer of the property.

At my death, a beneficiary takes the property subject to all conveyances, encumbrances, assignments, contracts, mortgages, liens, and other interests to which the property is subject at my death.

Witness the following signature and seals:



___________________________________(seal)
Patricia L. ABERNATHY

COMMONWEALTH OF VIRGINIA
CITY OF ARLINGTON, to wit:

The foregoing instrument was acknowledged before me this ______ day of October, 2025 by Patricia L. ABERNATHY.


____________________________Notary Public
My commission expires: _____________________Registration number: _______________________
```

---

### GOLDEN G3 — Single transferor → TRUST / SUCCESSOR-TRUSTEE beneficiary, CONDO

> Variant axes: capacity = "Grantor whose address is …"; beneficiary = "the Successor Trustee of my revocable trust, THE [[trust]] …"; vesting = "joint tenants with the common law right of survivorship" (the trust-beneficiary exemplar keeps the JTWROS phrasing verbatim); CONDO via Declaration-Deed-Book recital; Grantee NOT named in premise.

**INPUT (synthetic matter facts):**

```json
{
  "category": "TOD",
  "exemption": "§ 58.1-811(J)",
  "preparer": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "return_to": "2208 Lockwood Mews Lane Alexandria, VA 22301",
  "tax_id": "061.07-0B-44",
  "deed_date_phrase": "__________ day of May, 2025",
  "transferor": { "name": "GERALD WINSTEAD", "capacity": "Grantor whose address is 2208 Lockwood Mews Lane, Unit 44, Alexandria, VA 22301" },
  "grantee_named_in_premise": false,
  "primary_beneficiary": {
    "designation": "the Successor Trustee of my revocable trust",
    "trust": "THE GERALD R. WINSTEAD TRUST AGREEMENT, DATED FEBRUARY 14, 2021",
    "vesting": "joint tenants with the common law right of survivorship",
    "commonly_known_as": "2208 Lockwood Mews Lane, Unit 44 Alexandria, VA 22301"
  },
  "property_address": "2208 Lockwood Mews Lane Alexandria, VA 22301",
  "tax_map_reference": "as stated above",
  "legal_description": "Unit 44, Phase 3, LOCKWOOD MEWS CONDOMINIUM, together with an undivided interest in the Common Elements as created by that certain Declaration of Condominium recorded in Deed Book 2906 at Page 415, and any and all subsequent amendments thereto, among the Land Records of the City of Alexandria, Virginia.",
  "notary_county_blank": true,
  "acknowledgment_month_year": "May, 2025"
}
```

**EXPECTED ASSEMBLED DEED (full house style):**

```
THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.

This Deed was prepared by Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Return to: 2208 Lockwood Mews Lane Alexandria, VA 22301

TAX ID NO: 061.07-0B-44


REVOCABLE TRANSFER ON DEATH DEED

THIS REVOCABLE TRANSFER ON DEATH DEED, dated as of the __________ day of May, 2025, is made by GERALD WINSTEAD, Grantor whose address is 2208 Lockwood Mews Lane, Unit 44, Alexandria, VA 22301

This Revocable Transfer on Death Deed is made pursuant to the provisions of the Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq. In accordance with the provisions of the Uniform Real Property Transfer on Death Act, at my death, I transfer and convey my interest in the below described property to my designated beneficiaries as follows:

PRIMARY BENEFICIARIES

I hereby designate as my Primary Beneficiary as the Successor Trustee of my revocable trust, THE GERALD R. WINSTEAD TRUST AGREEMENT, DATED FEBRUARY 14, 2021, as the Primary Beneficiary of the property described, below, and which is commonly known as 2208 Lockwood Mews Lane, Unit 44 Alexandria, VA 22301, in fee simple, as joint tenants with the common law right of survivorship.


The street address of the real property is 2208 Lockwood Mews Lane Alexandria, VA 22301, and the tax map reference is as stated above and the legal description of the real property that shall be transferred at my death pursuant to this Revocable Transfer on Death Deed is as follows:

Unit 44, Phase 3, LOCKWOOD MEWS CONDOMINIUM, together with an undivided interest in the Common Elements as created by that certain Declaration of Condominium recorded in Deed Book 2906 at Page 415, and any and all subsequent amendments thereto, among the Land Records of the City of Alexandria, Virginia.

RIGHT TO REVOKE AND METHOD TO REVOKE DEED:

Before my death, I have the right to revoke this deed.

Under the Uniform Real Property Transfer on Death Act, an instrument is effective to revoke a recorded transfer on death deed, or any part of it, only if the instrument:

1. Is one of the following: (a). A transfer on death deed that revokes the transfer on death deed or part of the transfer on death deed expressly; (b). A transfer on death deed that names a designated beneficiary that is inconsistent with the designated beneficiary in a prior transfer on death deed; (c). An instrument of revocation that expressly revokes the transfer on death deed or part of the transfer on death deed; or (d). An inter vivos deed that expressly revokes the transfer on death deed or part of the transfer on death deed.

2. Is acknowledged by the transferor after the acknowledgment of the transfer on death deed being revoked and recorded before the transferor’s death in the land records of the clerk’s office   of the circuit court where the deed is recorded.

After this transfer on death deed is recorded, it can be revoked only by an effective revocatory instrument recorded prior to the death of the transferor and may not be revoked by a revocatory act taken against or on the original or a copy of the recorded transfer on death deed.

The execution and recordation of this transfer on death deed does not limit the effect of an inter vivos transfer of the property.

At my death, a beneficiary takes the property subject to all conveyances, encumbrances, assignments, contracts, mortgages, liens, and other interests to which the property is subject at my death.

Witness the following signature and seals:
________________________________(seal)
GERALD WINSTEAD

COMMONWEALTH OF VIRGINIA
CITY/COUNTY OF _________________, to wit:
The foregoing instrument was acknowledged before me this ______ day of May, 2025 by GERALD WINSTEAD.
____________________________Notary Public
My commission expires: _____________________Registration number: _______________________
```

---

## SECTION 2 — NEG / POISON FIXTURES (must FAIL CLOSED)

The assembler must NEVER emit an authoritative deed from these inputs. It WITHHOLDS the affected block (or the whole document) and FLAGS for attorney review. "Fail closed" = produce no draft of the load-bearing content; surface the defect.

---

### NEG N1 — Truncated legal / condo declaration cut → WITHHOLD + FLAG

**INPUT (defective):** legal description / condo block ends mid-sentence; the Declaration recital is cut off.

```json
{
  "category": "TOD",
  "transferor": { "name": "Patricia L. ABERNATHY", "capacity": "unmarried, Grantor" },
  "primary_beneficiary": { "person": "Olivia Grace ABERNATHY", "relationship": "my daughter", "vesting": "sole owner" },
  "property_address": "5125 N WAKEFIELD ST UNIT 312 ARLINGTON VA 22207",
  "legal_description": "CONDOMINIUM UNIT 312, WAKEFIELD STATION CONDOMINIUM, together with the an undivided interest in the common and Limited Common Elements and all other rights and privileges which attach or are appurtenant to said Unit, all as described in the Declaration recorded in Deed Book 5207 at page",
  "condo_subject_to": null
}
```

**EXPECTED BEHAVIOR:** FAIL CLOSED.
- Detect the legal description is truncated (ends "...Deed Book 5207 at page" with no page number; no terminal period; the condo subject-to / Chapter 4.2 block is missing entirely).
- Do NOT emit a deed with a partial legal description. Do NOT auto-complete the page number or the subject-to block.
- Flag: `LEGAL_DESCRIPTION_TRUNCATED` and `CONDO_SUBJECT_TO_MISSING` — withhold the property block; route to attorney. The legal description is verbatim-load-bearing; an incomplete one is never authoritative.

---

### NEG N2 — RIGHT-TO-REVOKE block garbled / partial → FAIL CLOSED (statutory revocation block is load-bearing)

**INPUT (defective):** the revocation block is missing sub-clause (c) and the entire item 2 (acknowledgment/recording requirement), and the trailing "takes-subject-to" paragraph.

```json
{
  "category": "TOD",
  "transferor": { "name": "Margaret T. HOLLOWAY", "capacity": "surviving joint tenant" },
  "primary_beneficiaries": { "persons": ["Daniel HOLLOWAY"], "vesting": "joint tenants with the common law right of survivorship" },
  "revocation_block": "RIGHT TO REVOKE AND METHOD TO REVOKE DEED:\n\nBefore my death, I have the right to revoke this deed.\n\nUnder the Uniform Real Property Transfer on Death Act, an instrument is effective to revoke a recorded transfer on death deed, or any part of it, only if the instrument:\n\n1. Is one of the following: (a). A transfer on death deed that revokes the transfer on death deed or part of the transfer on death deed expressly; (b). A transfer on death deed that names a designated beneficiary that is inconsistent with the designated beneficiary in a prior transfer on death deed; (d). An inter vivos deed that expressly revokes the transfer on death deed or part of the transfer on death deed."
}
```

**EXPECTED BEHAVIOR:** FAIL CLOSED.
- The revocation block must match the canonical verbatim block EXACTLY (item 1 with all four sub-clauses (a)-(d); item 2; and all three trailing paragraphs).
- Detect: sub-clause (c) is missing; the (b)→(d) jump skips (c); item 2 is absent; the recorded-only / inter-vivos / takes-subject-to trailing paragraphs are absent.
- Do NOT emit any deed using a partial revocation block, and do NOT silently splice in the canonical block over a garbled input (that would mask a corrupted source). Flag: `REVOCATION_BLOCK_INCOMPLETE` — withhold; route to attorney. The statutory revocation block is verbatim-complete-or-withheld; it is the load-bearing operative content of a TOD deed.

---

### NEG N3 — Real-corpus typo: stray period in an address ("2231.4") → FLAG / NORMALIZE, never emit as authoritative

**INPUT (defective — mirrors the Exemplar-B-corpus "2231.4" typo):**

```json
{
  "category": "TOD",
  "transferor": { "name": "GERALD WINSTEAD", "capacity": "Grantor whose address is 2208 Lockwood Mews Lane, Unit 44, Alexandria, VA 2230.1" },
  "primary_beneficiary": { "designation": "the Successor Trustee of my revocable trust", "trust": "THE GERALD R. WINSTEAD TRUST AGREEMENT, DATED FEBRUARY 14, 2021" },
  "property_address": "2208 Lockwood Mews Lane Alexandria, VA 2230.1"
}
```

**EXPECTED BEHAVIOR:** FLAG (do not silently emit).
- Detect the malformed ZIP `2230.1` (stray period; a 5-digit ZIP cannot contain a period). The canonical value is almost certainly `22301`.
- Do NOT emit the address verbatim with the stray period as authoritative output, and do NOT silently "correct" it without surfacing the change. Flag: `ADDRESS_ZIP_MALFORMED` with the suggested normalization `22301`, and require attorney confirmation before the normalized value becomes authoritative. (A stray period in a ZIP is a known real-corpus OCR/typo class; never propagate it.)

---

### NEG N4 — Hyphenated surname MUST be captured intact (no truncation / split) → assert EXACT

**INPUT:** beneficiary with a hyphenated surname (mirrors the Exemplar-D-corpus GHETIE-Exemplar-D class).

```json
{
  "category": "TOD",
  "transferor": { "name": "Margaret T. HOLLOWAY", "capacity": "surviving joint tenant" },
  "primary_beneficiaries": {
    "persons": ["Daniel HOLLOWAY", "Rebecca HOLLOWAY-MERCER", "Theodore HOLLOWAY"],
    "vesting": "joint tenants with the common law right of survivorship"
  }
}
```

**EXPECTED BEHAVIOR:** EXACT capture (this is a positive must-not-corrupt assertion).
- The hyphenated surname `HOLLOWAY-MERCER` must appear in the assembled deed exactly — single hyphen, no surrounding spaces, not truncated to `HOLLOWAY`, not split into `HOLLOWAY MERCER`, not split across two beneficiaries.
- If the parser would split or truncate a hyphenated surname, that is a FAILURE — flag `HYPHENATED_NAME_INTEGRITY` and halt. Hyphenated names are load-bearing identity data; corrupting one mis-designates a beneficiary.

---

## SECTION 3 — EXACT-MATCH ASSERTION NOTES

**OCR-B1 lesson: use whole-value equality (`toBe` / `toEqual`), never substring/`contains` on load-bearing content.** Substring matching let corrupted/extra text slip past in OCR-B1; exact equality is the contract.

**Positive exact-match assertions (per GOLDEN):**
- `expect(out.exemptionLine).toBe("THIS DEED IS EXEMPT FROM RECORDATION TAXES PURSUANT TO § 58.1-811(J) Va. Code.")` — exact, including the `§` glyph and `Va. Code.` terminal.
- `expect(out.title).toBe("REVOCABLE TRANSFER ON DEATH DEED")`.
- `expect(out.actRecital).toBe(CANON.actRecital)` where `CANON.actRecital` is the full `Uniform Real Property Transfer on Death Act, Virginia Code § 64.2-621 et seq.` paragraph verbatim (one whitespace-normalized string).
- `expect(out.revocationBlock).toBe(CANON.revocationBlock)` — the ENTIRE `RIGHT TO REVOKE AND METHOD TO REVOKE DEED` block: heading, "Before my death…", the "Under the Uniform…only if the instrument:" lead, item 1 with sub-clauses (a)(b)(c)(d) in order, item 2, and all three trailing paragraphs. Single `toBe` against the canonical constant — NOT four separate substring checks. (Preserve the exemplar's double-space inside item 2: `clerk’s office   of the circuit court` — three spaces — and the curly apostrophe `office’s`/`transferor’s`. Normalize the canonical constant to whatever the assembler emits and assert equality against THAT exact constant.)
- `expect(out.legalDescription).toBe(input.legal_description)` — verbatim legal, exact equality (no normalization of casing, punctuation, or Deed Book / Page values).
- G1 only: `expect(out.beingRecital).toBe(input.being_recital)` — exact, including the double space before "Arthur P. Holloway departed this life".
- G2 only: `expect(out.condoSubjectTo).toBe(input.condo_subject_to)` and `expect(out.legalPreamble).toBe(input.legal_description_preamble)`.
- Vesting: `expect(out.vesting).toBe("joint tenants with the common law right of survivorship")` (G1, G3) / `toBe("sole owner")` (G2) — exact, not substring.
- Designation count: G1 heading `PRIMARY BENEFICIARIES`; G2 heading `PRIMARY BENEFICIARY`; G3 heading `PRIMARY BENEFICIARIES` (the trust-beneficiary exemplar uses the plural heading even with one beneficiary — assert the exact heading per fixture, do not infer from count).

**Whole-document assertion (recommended belt-and-suspenders):**
- `expect(out.fullText).toEqual(GOLDEN_EXPECTED_FULLTEXT)` — one `toEqual` against the complete expected deed string per GOLDEN. This is the strongest contract; the per-section asserts above localize failures.

**Negative-assertion family (short — must all hold):**
- `expect(out.fullText).not.toMatch(/Grantee/)` when no Grantee is named in the premise (G1, G3) — no fabricated party. Conversely, for G2 assert the Grantee IS present exactly: `expect(out.premise).toContain` is FORBIDDEN; use `toBe` on the whole premise line.
- No fabricated beneficiary: the set of designated beneficiaries equals the input set exactly — `expect(out.beneficiaries).toEqual(input.primary_beneficiaries.persons)` (deep equal, order-preserving). Never add, drop, or reorder.
- No dropped revocation sub-clause: the revocation block contains `(a).`, `(b).`, `(c).`, `(d).` in order — covered by the single `toBe(CANON.revocationBlock)`; a sub-clause drop fails it. (Do NOT replace this with four independent substring checks — that was the OCR-B1 trap.)
- Hyphenated names intact: `expect(out.fullText).toContain("HOLLOWAY-MERCER")` AND `expect(out.fullText).not.toMatch(/HOLLOWAY MERCER/)` AND the beneficiary array contains the single token `"Rebecca HOLLOWAY-MERCER"` (not two).
- No stray-period address propagation (N3): `expect(out.fullText).not.toMatch(/\bVA 2230\.1\b/)` — the malformed ZIP must never reach output as authoritative.
- Fail-closed sentinels (N1, N2): the assembler returns a withhold/flag result, not a deed — `expect(out.status).toBe("WITHHELD")` and `expect(out.flags).toContain("REVOCATION_BLOCK_INCOMPLETE")` / `toContain("LEGAL_DESCRIPTION_TRUNCATED")`; `expect(out.deed).toBeUndefined()`.

---

## SECTION 4 — PII-FREE GUARANTEE

All names, addresses, tax IDs, ZIPs, legal descriptions, Deed Book/Page references, dates, and trust names in this pack are INVENTED and synthetic; no real client data from any Mason exemplar (Exemplar-A, Exemplar-B, Exemplar-C, Exemplar-D, or any other) is reproduced — only the verbatim STANDARD clauses (the § 58.1-811(J) exemption line, the § 64.2-621 Act recital, and the full RIGHT TO REVOKE block) are carried faithfully, as those are non-client statutory boilerplate.
