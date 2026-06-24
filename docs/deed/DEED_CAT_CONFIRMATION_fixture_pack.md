# DEED CATEGORY FIXTURE PACK — C1: DEED OF CONFIRMATION (Virginia)

**Category:** C1 — DEED OF CONFIRMATION
**Assembler:** deterministic Mason deed-drafting assembler (sibling of the deed-of-gift assembler)
**Firm:** The Mason Law Firm, PLC · Kelly Satterwhite, Esq., VSB #91049
**Grounding:** `DEED_KB_CATEGORY_GROUNDING.md` §C1 (authoritative) + real exemplars Exemplar-A (survivorship) / Exemplar-B (testate-devise), structure replicated, data invented.
**Exemption:** § 58.1-810(1), 1950 Code of Virginia. **Warranty:** General Warranty + English Covenants. **Vesting:** sole owner. **Consideration:** $0.00. **Parties:** same person, party of the first part (Grantor) → party of the second part (Grantee). Confirms record title; does NOT transfer.

> **PII-FREE GUARANTEE:** Every name, address, tax ID, legal description, date, instrument number, probate/fiduciary number, will date, and assessed value in this pack is INVENTED. No real client data appears anywhere in this file.

---

## 0. EXACT-MATCH ASSERTION DOCTRINE (read first — the OCR-B1 lesson)

Every field captured from the input AND every clause emitted in the output is asserted by **exact string equality** (`toBe` / `toEqual`), **never** `toContain` / substring / regex-loose. The two highest-risk strings:

1. **The § 58.1-810(1) exemption recital** — asserted character-for-character.
2. **The verbatim legal description** — carried through the assembler UNCHANGED and asserted character-for-character (including casing, punctuation, "Lot Numbered Eight (8)" spell-outs, Deed Book / Page numbers).

A NEG family of **negative assertions** also applies to every produced deed: it must NOT contain a fabricated date, must NOT silently drop a WHEREAS link, must NOT invent a probate number, must NOT truncate a legal description.

---

# PART 1 — GOLDEN FIXTURES (must assemble exactly)

---

## GOLDEN G1 — C1-a SURVIVORSHIP (SFH; co-owner died; survivor confirms by operation of law)

Granting verb: **"grant and convey, with General Warranty"**. Vesting: sole owner. Archetype: Exemplar-A.

### G1 INPUT (synthetic consolidated matter facts)

```json
{
  "fixture_id": "C1-GOLDEN-G1-survivorship-sfh",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-a-survivorship",
  "exemption_code": "58.1-810(1)",
  "preparer": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "prepared_note": "Prepared without benefit of title search",
  "tax_id": "7244-09-3185",
  "grantee_return_address": "4820 Hollow Reed Lane, Manassas, VA 20112",
  "assessed_value": "$398,000.00",
  "consideration": "$0.00",
  "granting_month_year": "March, 2026",
  "party_name": "Marcus DELACROIX",
  "grantor_grantee_same": true,
  "vesting": "sole owner",
  "granting_verb": "grant and convey",
  "warranty": "General Warranty and English Covenants of title",
  "locality": "Prince William",
  "chain_of_title": {
    "took_title_as": "joint tenants with the common law right of survivorship",
    "co_owners": ["Marcus Delacroix", "Helene Quintero"],
    "vesting_deed_date": "August 12, 2011",
    "vesting_deed_recorded": "August 15, 2011",
    "vesting_instrument_number": "201108150029471",
    "records_county": "Prince William County, Virginia"
  },
  "decedent": {
    "name": "Helene Quintero",
    "aka": "Helene Marie Quintero",
    "date_of_death": "October 3, 2019"
  },
  "legal_description": "Lot 47, STONEBRIAR MEADOWS, Phase 2, Section 1, as the same appears duly dedicated, platted and recorded in Deed Book 1987 at Page 0442, among the Land Records of Prince William County, Virginia.",
  "being_recital_prior_instrument": "201108150029471",
  "subject_to": "the covenants, conditions, restrictions, easements and rights-of-way of record"
}
```

### G1 EXPECTED OUTPUT (full house-style assembled deed)

```
Exempt from recording tax pursuant to Sec 58.1-810(1), 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No.: 7244-09-3185

Grantee Address and return to: 4820 Hollow Reed Lane, Manassas, VA 20112

Assessed Value:$398,000.00

Consideration: $0.00
_____________________________________________________________________________

DEED OF CONFIRMATION

THIS DEED OF CONFIRMATION made and entered this _____ day of March, 2026, by and between Marcus DELACROIX, party of the first part, and Marcus DELACROIX, party of the second part;

WHEREAS, Marcus Delacroix and Helene Quintero took title to the subject property as joint tenants with the common law right of survivorship by deed dated August 12, 2011, and recorded on August 15, 2011 as Instrument Number 201108150029471 among the land records of Prince William County, Virginia, AND

WHEREAS Helene Quintero, Also known as Helene Marie Quintero, departed this life on or about October 3, 2019, AND

WHEREAS, by operation of law Marcus Delacroix became the sole owner of the subject property upon the death of Helene Quintero,


NOW, THEREFORE, WITNESSETH:

For good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in the County of Prince William, Commonwealth of Virginia, to wit:

Lot 47, STONEBRIAR MEADOWS, Phase 2, Section 1, as the same appears duly dedicated, platted and recorded in Deed Book 1987 at Page 0442, among the Land Records of Prince William County, Virginia.

BEING the same property conveyed unto Marcus Delacroix and Helene Quintero, as joint tenants with the common law right of survivorship by Deed recorded as Instrument Number 201108150029471 among the aforesaid land records.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.


Witness the following signatures and seals:


__________________________(seal)
Marcus DELACROIX




State of VIRGINIA

County/City of _____________________________, to wit:

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Marcus DELACROIX , who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this _____ day of March, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

## GOLDEN G2 — C1-b TESTATE / DEVISE (title vested in a devisee by will; probate FI; devise article)

Granting verb: **"grant, confirm, and convey, with General Warranty"**. Vesting: sole owner. Archetype: Exemplar-B. Longer WHEREAS chain: prior deed → TBE survivorship → testator died testate + probate FI → devise article vests title in devisee → Grantor desires to confirm.

### G2 INPUT (synthetic consolidated matter facts)

```json
{
  "fixture_id": "C1-GOLDEN-G2-testate-devise-sfh",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-b-testate-devise",
  "exemption_code": "58.1-810(1)",
  "exemption_parenthetical": "(Deed of Confirmation — no consideration; grantee already holds title by devise)",
  "preparer": "Kelly Satterwhite, Esq., VSB #91049, The Mason Law Firm, PLC",
  "prepared_note": "Prepared without benefit of title examination",
  "tax_map": "0714 06B 0023",
  "grantee_return_address": "Priya N. Abernathy, 2918 Larkspur Court, Springfield, Virginia 22152",
  "assessed_value": "$612,500.00",
  "consideration": "$0.00",
  "granting_day_month_year": "______ day of ______________, 2026",
  "party_name": "PRIYA N. ABERNATHY",
  "grantor_grantee_same": true,
  "vesting": "sole owner",
  "granting_verb": "grant, confirm, and convey",
  "warranty": "General Warranty and English Covenants of Title",
  "locality": "Fairfax",
  "chain_of_title": {
    "original_grantors": "Edmund R. Hollings and Marianne T. Hollings, his wife",
    "original_deed_date": "April 9, 1962",
    "original_deed_recorded": "April 11, 1962",
    "original_deed_book_page": "Deed Book 2204 at Page 318",
    "original_grantees": "Walter S. Penhallow and Doris E. Penhallow, his wife",
    "original_grantees_tenancy": "tenants by the entirety with the common law right of survivorship"
  },
  "first_decedent": {
    "name": "Doris E. Penhallow",
    "date_of_death": "February 22, 1998",
    "survivor": "Walter S. Penhallow"
  },
  "testator": {
    "name": "Walter S. Penhallow",
    "died_testate_date": "September 7, 2015",
    "will_date": "March 18, 2011",
    "probate_court": "Clerk of the Circuit Court of Fairfax County, Virginia",
    "fiduciary_number": "FI-2015-0002736",
    "possessive_pronoun": "his",
    "subject_pronoun": "he"
  },
  "devise": {
    "article": "Article V",
    "devisee": "Priya N. Abernathy",
    "devisee_status": "sole residuary beneficiary and devisee",
    "devisee_possessive": "her",
    "devisee_object": "her"
  },
  "legal_description": "Lot Numbered Twenty-Three (23), in Block C, of the subdivision known and designated as \"CROWN RIDGE ESTATES, SECTION TWO,\" as the same is duly dedicated, platted and recorded among the land records of Fairfax County, Virginia, in Deed Book 1842 at Page 671.",
  "tax_map_street_line": "The said property is identified as Tax Map No. 0714 06B 0023 and has a street address of 2918 Larkspur Court, Springfield, Virginia 22152.",
  "being_recital_book_page": "Deed Book 2204 at Page 318",
  "subject_to": "the covenants, conditions, restrictions, easements, and rights-of-way of record"
}
```

### G2 EXPECTED OUTPUT (full house-style assembled deed)

```
Exempt from recordation tax pursuant to Va. Code § 58.1-810(1)
(Deed of Confirmation — no consideration; grantee already holds title by devise)
Prepared without benefit of title examination

This Deed was prepared by: Kelly Satterwhite, Esq., VSB #91049, The Mason Law Firm, PLC
Tax Map No.: 0714 06B 0023
Grantee Address and return to: Priya N. Abernathy, 2918 Larkspur Court, Springfield, Virginia 22152
Assessed Value: $612,500.00
Consideration: $0.00

DEED OF CONFIRMATION
THIS DEED OF CONFIRMATION is made and entered into this ______ day of ______________, 2026, by and between PRIYA N. ABERNATHY, party of the first part ("Grantor"), and PRIYA N. ABERNATHY, party of the second part ("Grantee").
WHEREAS, by Deed dated April 9, 1962, and recorded April 11, 1962, in Deed Book 2204 at Page 318 among the land records of Fairfax County, Virginia, Edmund R. Hollings and Marianne T. Hollings, his wife, conveyed the hereinafter-described real property unto Walter S. Penhallow and Doris E. Penhallow, his wife, as tenants by the entirety with the common law right of survivorship; AND
WHEREAS, Doris E. Penhallow departed this life on or about February 22, 1998, whereupon, by operation of the common law right of survivorship, Walter S. Penhallow became the sole owner of the said real property; AND
WHEREAS, Walter S. Penhallow departed this life testate on September 7, 2015, and his Last Will and Testament dated March 18, 2011, was duly admitted to probate before the Clerk of the Circuit Court of Fairfax County, Virginia, as Fiduciary No. FI-2015-0002736; AND
WHEREAS, under Article V of the said Last Will and Testament, Priya N. Abernathy, having survived the Testator, is the sole residuary beneficiary and devisee of the said real property, and title thereto vested in her as devisee upon the death of the Testator; AND
WHEREAS, the Grantor desires by this Deed of Confirmation to confirm, and to place of record, her title to the said real property;
NOW, THEREFORE, WITNESSETH:
For good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant, confirm, and convey, with General Warranty and English Covenants of Title, unto the said Grantee, in fee simple, as sole owner, all of the following described real property, with the improvements thereon and the appurtenances thereunto belonging, situate, lying and being in the County of Fairfax, Commonwealth of Virginia, to wit:
Lot Numbered Twenty-Three (23), in Block C, of the subdivision known and designated as "CROWN RIDGE ESTATES, SECTION TWO," as the same is duly dedicated, platted and recorded among the land records of Fairfax County, Virginia, in Deed Book 1842 at Page 671.
The said property is identified as Tax Map No. 0714 06B 0023 and has a street address of 2918 Larkspur Court, Springfield, Virginia 22152.
BEING the same real property conveyed unto Walter S. Penhallow and Doris E. Penhallow, his wife, as tenants by the entirety with the common law right of survivorship, by Deed recorded in Deed Book 2204 at Page 318 among the aforesaid land records; the said Doris E. Penhallow having predeceased the said Walter S. Penhallow, whereby he became sole owner by survivorship; and the said Walter S. Penhallow having thereafter died testate, devising the said real property to the Grantor, Priya N. Abernathy, under Article V of his Last Will and Testament admitted to probate in the Circuit Court of Fairfax County, Virginia (Fiduciary No. FI-2015-0002736).
This conveyance is made subject to the covenants, conditions, restrictions, easements, and rights-of-way of record.
WITNESS the following signature and seal:
	_______________________________ (SEAL)
	PRIYA N. ABERNATHY
COMMONWEALTH OF VIRGINIA
CITY/COUNTY OF _______________________, to wit:
I, the undersigned, a Notary Public in and for the jurisdiction aforesaid, do hereby certify that Priya N. Abernathy, whose name is signed to the foregoing and annexed Deed of Confirmation, has acknowledged the same before me in my jurisdiction aforesaid this ______ day of ______________, 2026.
My commission expires: __________________
Registration No.: __________________
	_______________________________
	Notary Public
```

---

## GOLDEN G3 — C1-a SURVIVORSHIP (CONDO variant; contrasts G1's SFH)

Second survivorship variant on a **condominium** unit to exercise the unit/condo legal-description carry-through. Granting verb: **"grant and convey, with General Warranty"**. Vesting: sole owner. Archetype: Exemplar-A form.

### G3 INPUT (synthetic consolidated matter facts)

```json
{
  "fixture_id": "C1-GOLDEN-G3-survivorship-condo",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-a-survivorship",
  "exemption_code": "58.1-810(1)",
  "preparer": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "prepared_note": "Prepared without benefit of title search",
  "tax_id": "8160-44-0271.07",
  "grantee_return_address": "Unit 412, 7705 Cobalt Spring Way, Falls Church, VA 22042",
  "assessed_value": "$289,750.00",
  "consideration": "$0.00",
  "granting_month_year": "June, 2026",
  "party_name": "Theodore O. NAKASHIMA",
  "grantor_grantee_same": true,
  "vesting": "sole owner",
  "granting_verb": "grant and convey",
  "warranty": "General Warranty and English Covenants of title",
  "locality": "Fairfax",
  "chain_of_title": {
    "took_title_as": "joint tenants with the common law right of survivorship",
    "co_owners": ["Theodore O. Nakashima", "Constance R. Ferraro"],
    "vesting_deed_date": "May 30, 2016",
    "vesting_deed_recorded": "June 1, 2016",
    "vesting_instrument_number": "201606010044128",
    "records_county": "Fairfax County, Virginia"
  },
  "decedent": {
    "name": "Constance R. Ferraro",
    "aka": "Constance Rose Ferraro",
    "date_of_death": "December 14, 2022"
  },
  "legal_description": "Condominium Unit No. 412, Phase 3, of COBALT SPRING CONDOMINIUM, together with the undivided percentage interest in the common elements appurtenant thereto, as established by the Declaration recorded in Deed Book 21044 at Page 0911, and as shown on the plats and plans recorded in Deed Book 21044 at Page 0998, among the Land Records of Fairfax County, Virginia.",
  "being_recital_prior_instrument": "201606010044128",
  "subject_to": "the covenants, conditions, restrictions, easements and rights-of-way of record"
}
```

### G3 EXPECTED OUTPUT (full house-style assembled deed)

```
Exempt from recording tax pursuant to Sec 58.1-810(1), 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No.: 8160-44-0271.07

Grantee Address and return to: Unit 412, 7705 Cobalt Spring Way, Falls Church, VA 22042

Assessed Value:$289,750.00

Consideration: $0.00
_____________________________________________________________________________

DEED OF CONFIRMATION

THIS DEED OF CONFIRMATION made and entered this _____ day of June, 2026, by and between Theodore O. NAKASHIMA, party of the first part, and Theodore O. NAKASHIMA, party of the second part;

WHEREAS, Theodore O. Nakashima and Constance R. Ferraro took title to the subject property as joint tenants with the common law right of survivorship by deed dated May 30, 2016, and recorded on June 1, 2016 as Instrument Number 201606010044128 among the land records of Fairfax County, Virginia, AND

WHEREAS Constance R. Ferraro, Also known as Constance Rose Ferraro, departed this life on or about December 14, 2022, AND

WHEREAS, by operation of law Theodore O. Nakashima became the sole owner of the subject property upon the death of Constance R. Ferraro,


NOW, THEREFORE, WITNESSETH:

For good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with General Warranty and English Covenants of title, unto the said Grantee, in fee simple, as sole owner, all of the following parcel of real property, with improvements thereon, located in the County of Fairfax, Commonwealth of Virginia, to wit:

Condominium Unit No. 412, Phase 3, of COBALT SPRING CONDOMINIUM, together with the undivided percentage interest in the common elements appurtenant thereto, as established by the Declaration recorded in Deed Book 21044 at Page 0911, and as shown on the plats and plans recorded in Deed Book 21044 at Page 0998, among the Land Records of Fairfax County, Virginia.

BEING the same property conveyed unto Theodore O. Nakashima and Constance R. Ferraro, as joint tenants with the common law right of survivorship by Deed recorded as Instrument Number 201606010044128 among the aforesaid land records.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.


Witness the following signatures and seals:


__________________________(seal)
Theodore O. NAKASHIMA




State of VIRGINIA

County/City of _____________________________, to wit:

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Theodore O. NAKASHIMA , who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this _____ day of June, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

# PART 2 — NEG / POISON FIXTURES (must FAIL CLOSED)

These prove the assembler refuses to fabricate, silently truncate, or paper over a mismatch. Each must withhold + flag rather than emit a plausible-but-wrong deed.

---

## NEG N1 — TRUNCATED / MULTI-LINE LEGAL DESCRIPTION (must withhold, never silently cut)

### N1 INPUT

```json
{
  "fixture_id": "C1-NEG-N1-legal-description-truncated",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-a-survivorship",
  "party_name": "Rosalind T. KESTREL",
  "legal_description_raw": "Lot 9, Block B, HARMON GLEN, Section 4, as recorded in Deed Book 3201 at Page 88, TOGETHER WITH a perpetual non-exclusive easement for ingress and egress over the 30-foot private road shown on the plat recorded in Deed Book 3201 at Page 90, AND LESS AND EXCEPT that portion conveyed to the Virginia Department of Transportation by Deed recorded as Instrument No. 20180",
  "legal_description_truncation_detected": true,
  "note": "Source legal ends mid-instrument-number ('20180') with no terminating period — input is incomplete/cut."
}
```

### N1 EXPECTED BEHAVIOR — **FAIL CLOSED**
- Assembler MUST detect the legal description is incomplete (no terminating period; trailing fragment `20180`; unbalanced LESS-AND-EXCEPT clause) and **WITHHOLD the deed**.
- It MUST NOT emit a deed with a truncated legal description, and MUST NOT fabricate the missing instrument number or invent a terminating period.
- Required output: a flag, e.g. `FLAG: LEGAL_DESCRIPTION_INCOMPLETE — source legal description appears truncated (ends "…Instrument No. 20180"); withholding deed. Re-capture the full legal description verbatim from the source instrument (Deed Book 3201, Pg 88 + Pg 90) before assembly.`
- A `[[ ]]` placeholder MUST NOT be used to paper over the middle of a legal description — the legal description is carried verbatim or the deed is withheld.

---

## NEG N2 — PARTIES MISMATCH (party-of-first-part ≠ party-of-second-part)

### N2 INPUT

```json
{
  "fixture_id": "C1-NEG-N2-parties-mismatch",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-a-survivorship",
  "party_of_first_part": "Gregory A. WINSLOW",
  "party_of_second_part": "Gregory A. WINSLOW, Jr.",
  "grantor_grantee_same": false,
  "note": "First and second part are NOT the same person (father vs. son). A deed of confirmation requires identical Grantor and Grantee."
}
```

### N2 EXPECTED BEHAVIOR — **FAIL CLOSED**
- Assembler MUST detect that party of the first part and party of the second part are not the same person and **WITHHOLD the deed**.
- It MUST NOT normalize, "correct," or assume them identical, and MUST NOT emit a confirmation deed transferring between two different people (a confirmation records existing title; it is not a conveyance between distinct parties).
- Required output: a flag, e.g. `FLAG: PARTIES_NOT_IDENTICAL — Deed of Confirmation requires party of the first part and party of the second part to be the SAME person; received "Gregory A. WINSLOW" vs. "Gregory A. WINSLOW, Jr." Withholding deed. Confirm intended grantor/grantee identity; if a transfer between distinct persons is intended, this is not a Deed of Confirmation.`

---

## NEG N3 — MISSING CHAIN-OF-TITLE FACT (testate case with no probate reference)

### N3 INPUT

```json
{
  "fixture_id": "C1-NEG-N3-missing-probate-ref",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-b-testate-devise",
  "party_name": "Amara J. OKONKWO",
  "testator": {
    "name": "Lionel P. Hargreave",
    "died_testate_date": "August 3, 2017",
    "will_date": "[[MISSING — will date not in matter file]]",
    "probate_court": "[[MISSING — probate court not stated]]",
    "fiduciary_number": "[[MISSING — no Fiduciary No. captured]]"
  },
  "devise": {
    "article": "[[MISSING — devise article not identified]]",
    "devisee": "Amara J. Okonkwo"
  },
  "note": "Testate/devise archetype but the probate facts (FI number, will date, devise article) are absent from the consolidated matter facts."
}
```

### N3 EXPECTED BEHAVIOR — **FAIL CLOSED**
- Assembler MUST NOT invent a Fiduciary No., a will date, a probate court, or a devise article. These are records facts; fabricating them is the single most dangerous failure mode for this category.
- It MUST emit the deed WITH explicit `[[ ]]` placeholders at every missing-fact site AND a research lead, OR withhold — never produce a deed that reads as complete with invented probate data.
- Required output: each missing site renders as a bracketed placeholder, e.g. `Fiduciary No. [[FIDUCIARY NUMBER — pull from Circuit Court probate record for Lionel P. Hargreave]]`, plus a flag: `FLAG: CHAIN_OF_TITLE_INCOMPLETE — testate-devise confirmation missing probate FI number, will date, probate court, and devise article. Placeholders inserted; do NOT record until the probate record is pulled and the devise article confirmed.`
- The produced text MUST NOT contain any concrete probate number, will date, or article number anywhere.

---

## NEG N4 — WRONG-EXEMPTION DECOY (LLC-into exemption pasted onto a confirmation)

### N4 INPUT

```json
{
  "fixture_id": "C1-NEG-N4-wrong-exemption",
  "category": "DEED OF CONFIRMATION",
  "archetype": "C1-a-survivorship",
  "party_name": "Beatrix L. SOMMERFELD",
  "exemption_code_supplied": "58.1-811(A)(10)",
  "note": "Matter facts carry a stray exemption code 58.1-811(A)(10) (deed INTO an LLC, C3) instead of the correct 58.1-810(1) for a confirmation."
}
```

### N4 EXPECTED BEHAVIOR — **FAIL CLOSED**
- Assembler MUST detect the supplied exemption code does not match the C1 confirmation category and **WITHHOLD the deed** (or flag for correction); it MUST NOT silently emit a confirmation deed reciting § 58.1-811(A)(10).
- It MUST NOT auto-substitute the correct code without surfacing the mismatch — the exemption recital is attorney-load-bearing.
- Required output: a flag, e.g. `FLAG: EXEMPTION_MISMATCH — Deed of Confirmation (C1) requires § 58.1-810(1) [alt § 58.1-811(K) for testamentary distribution]; received § 58.1-811(A)(10) (deed into an LLC). Withholding deed pending attorney confirmation of the correct exemption.`

---

# PART 3 — EXACT-MATCH ASSERTION NOTES (per fixture)

### Positive exact-equality assertions (GOLDEN) — `toBe` / `toEqual` only, NEVER substring

For **every** GOLDEN fixture (G1, G2, G3), assert by exact string equality:

| Field | Assertion | Notes |
|---|---|---|
| Full assembled deed text | `expect(out).toBe(EXPECTED)` | whole-document exact equality is the master assertion |
| Exemption recital line | `toBe` | G1/G3: `Exempt from recording tax pursuant to Sec 58.1-810(1), 1950 Code of Virginia` · G2: `Exempt from recordation tax pursuant to Va. Code § 58.1-810(1)` — the two house forms are NOT interchangeable; assert each verbatim |
| Verbatim legal description | `toBe` | carried through UNCHANGED incl. casing (`STONEBRIAR MEADOWS`, `"CROWN RIDGE ESTATES, SECTION TWO,"`), spell-outs (`Lot Numbered Twenty-Three (23)`), Deed Book / Page, condo Declaration book/pages |
| Title line | `toBe` | exactly `DEED OF CONFIRMATION` |
| Same-person premise | `toBe` | G1/G3 form (`party of the first part, and …, party of the second part;`) vs. G2 form (`party of the first part ("Grantor"), and …, party of the second part ("Grantee").`) — assert the right variant per fixture |
| Each WHEREAS recital | `toBe` (line-by-line) | exact connective: G1/G3 use trailing `, AND` / `AND`; G2 uses trailing `; AND` and the final `; ` before NOW THEREFORE |
| `NOW, THEREFORE, WITNESSETH:` | `toBe` | exact |
| Granting clause + verb + warranty + vesting | `toBe` | G1/G3: `grant and convey, with General Warranty and English Covenants of title, … as sole owner` · G2: `grant, confirm, and convey, with General Warranty and English Covenants of Title, … as sole owner` |
| BEING recital | `toBe` | exact, incl. the instrument number / Deed Book Page |
| Subject-to clause | `toBe` | exact |
| Signature + notary block | `toBe` | exact, incl. seal markers and notary certificate wording |
| Tax ID / Tax Map, assessed value, return address, consideration | `toBe` | each field exact |

### Negative-assertion family (applies to GOLDEN and NEG output)

Assert the produced deed does **NOT** contain fabricated or dropped content:

```
expect(out).not.toContain("[[")                 // no leftover placeholder in a GOLDEN (G1/G3/G2 complete)
expect(out).not.toMatch(/FI-20\d{2}-\d{7}/)     // N3: no invented Fiduciary No. anywhere
expect(out).not.toMatch(/\bArticle [IVXLC]+\b/) // N3: no invented devise article
// WHEREAS-link integrity: count must equal the input chain length (no silently dropped link)
expect((out.match(/WHEREAS/g) || []).length).toBe(EXPECTED_WHEREAS_COUNT) // G1/G3 = 3, G2 = 5
expect(out).not.toContain("58.1-811(A)(10)")    // N4: wrong exemption never emitted
// no fabricated date: every date in output must trace to an input fact (assert against the known date set)
expect(extractDates(out)).toEqual(INPUT_DATE_SET) // no date the input did not supply
```

### NEG fixtures — assert WITHHOLD/FLAG, not deed text

```
// N1 truncated legal
expect(result.status).toBe("WITHHELD")
expect(result.flags).toContain("LEGAL_DESCRIPTION_INCOMPLETE")
expect(result.deedText).toBeUndefined()           // no partial deed emitted
expect(result).not.toHaveProperty("fabricatedInstrumentNumber")

// N2 parties mismatch
expect(result.status).toBe("WITHHELD")
expect(result.flags).toContain("PARTIES_NOT_IDENTICAL")

// N3 missing probate facts
expect(result.flags).toContain("CHAIN_OF_TITLE_INCOMPLETE")
expect(result.deedText).toContain("[[FIDUCIARY NUMBER")  // placeholder present, exact-bracket
expect(result.deedText).not.toMatch(/FI-20\d{2}-\d{7}/)  // and NO concrete FI number invented

// N4 wrong exemption
expect(result.status).toBe("WITHHELD")
expect(result.flags).toContain("EXEMPTION_MISMATCH")
expect(result.deedText ?? "").not.toContain("58.1-811(A)(10)")
```

**Why exact-equality (OCR-B1 lesson):** a substring/`toContain` assertion passes even when the legal description is truncated, a WHEREAS is dropped, or a date is fabricated — the matched substring is still "present." Only whole-string `toBe` on the legal description and the exemption recital, plus the negative-assertion family above, catch silent corruption.

---

## PII-FREE GUARANTEE (restated)

Every party name, street address, tax ID / tax map, assessed value, legal description, date of death, deed date, instrument number, will date, Fiduciary No., devise article, and subdivision name in this pack is **INVENTED** for test purposes. No real Mason client data, and none of the real-exemplar (Exemplar-A / Exemplar-B) client facts, appear anywhere in this file. Only the firm/attorney identity (The Mason Law Firm, PLC; Kelly Satterwhite, VSB #91049) and the statutory citation (§ 58.1-810(1)) are real, and both are public/non-PII.
