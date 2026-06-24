# DEED CATEGORY C3 — DEED INTO AN LLC · Synthetic Fixture Pack

**Category:** C3 — DEED INTO AN LLC (Virginia, attorney-supervised deterministic deed assembler).
**Firm:** The Mason Law Firm, PLC · Kelly Satterwhite, Esq., VSB #91049.
**Grounded from:** real Mason exemplars Exemplar-A / Exemplar-B / Exemplar-C (structure only — all data below is SYNTHETIC).
**Exemption cite:** § 58.1-811(A)(10), 1950 Code of Virginia.
**Granting contract (load-bearing):** "quitclaim release and convey ... in fee simple ... all of the Grantor's right, title and interest" — **NO warranty** (quitclaim into LLC). General/Special Warranty language MUST NOT appear.
**Style match:** seller-side / OCR-B1 synthetic-fixture conventions — exact-match (`toBe` / `toEqual`), fail-closed NEG family, PII-free.

Variant axes covered by the three GOLDEN fixtures:
- Grantor cardinality / marital status: single unmarried · single unmarried · married couple (both sign).
- Property type: SFH · CONDO (Declaration + amendments recital) · SFH.
- Legal-description casing: title-case · title-case · ALL-CAPS.
- Derivation-of-title form: blank-slot DB/Page · Instrument Number · populated DB/Page.

---

## 1. GOLDEN FIXTURES

### GOLDEN G1 — single unmarried grantor → LLC, SFH, title-case legal

#### INPUT (consolidated matter facts)

```json
{
  "category": "DEED_INTO_LLC",
  "exemption_cite": "58.1-811(A)(10)",
  "prepared_by": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "title_search": "Prepared without benefit of title search",
  "tax_id": "1184-55-0027",
  "grantee_address_return": "7720 Marlowe Glen Court, Springfield, VA 22150",
  "assessed_value": "$612,400.00",
  "consideration": "$0.00",
  "instrument_date_phrase": "____ day of April, 2026",
  "grantors": [
    { "name": "Dahlia OKONKWO", "marital_status": "unmarried" }
  ],
  "grantor_cardinality": "single",
  "grantee_llc": "Marlowe Glen Holdings LLC, a Virginia Limited Liability Company",
  "property_jurisdiction": "County of Fairfax, Virginia",
  "legal_description": "Lot TWENTY-SEVEN (27), HAWTHORNE RIDGE, as the same appears duly dedicated, platted and recorded per Deed of Dedication, Subdivision, Vacation and Easement in Deed Book 8412, at Page 0337, among the land records of Fairfax County, Virginia.",
  "legal_casing": "title-case",
  "property_type": "SFH",
  "derivation_of_title": "For derivation of title, see Deed recorded in Deed Book _________, at page __________, among the aforesaid land records.",
  "subject_to": "This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.",
  "notary_jurisdiction": { "commonwealth": "COMMONWEALTH OF VIRGINIA", "locality": "CITY OF ALEXANDRIA" }
}
```

#### EXPECTED ASSEMBLED DEED (full house style)

```
Exempt from recording tax pursuant to Sec 58.1-811(A)(10), 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No.: 1184-55-0027

Grantee Address and return to:  7720 Marlowe Glen Court, Springfield, VA 22150

Assessed Value: $612,400.00

Consideration: $0.00

_____________________________________________________________________________

DEED

THIS DEED made and entered this ____ day of April, 2026, by and between Dahlia OKONKWO, unmarried, GRANTOR, and Marlowe Glen Holdings LLC, a Virginia Limited Liability Company, GRANTEE;

W I T N E S S E T H

That, for a good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the GRANTOR does hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:

Lot TWENTY-SEVEN (27), HAWTHORNE RIDGE, as the same appears duly dedicated, platted and recorded per Deed of Dedication, Subdivision, Vacation and Easement in Deed Book 8412, at Page 0337, among the land records of Fairfax County, Virginia.

For derivation of title, see Deed recorded in Deed Book _________, at page __________, among the aforesaid land records.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.


SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE
Witness the following signatures and seals:


__________________________(seal)
Dahlia OKONKWO







COMMONWEALTH OF VIRGINIA
CITY OF ALEXANDRIA

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Dahlia OKONKWO, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this ____ day of April, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

### GOLDEN G2 — single unmarried grantor → LLC, CONDO (Declaration + amendments recital)

#### INPUT (consolidated matter facts)

```json
{
  "category": "DEED_INTO_LLC",
  "exemption_cite": "58.1-811(A)(10)",
  "prepared_by": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "title_search": "Prepared without benefit of title search",
  "tax_id": "44-013-088",
  "grantee_address_return": "880 N Pollard Street, Unit 612, Arlington, VA 22203",
  "assessed_value": "$341,900",
  "consideration": "$0.00",
  "instrument_date_phrase": "____ day of May, 2026",
  "grantors": [
    { "name": "Soren VALLECILLO", "marital_status": "unmarried" }
  ],
  "grantor_cardinality": "single",
  "grantee_llc": "Pollard Street Capital, LLC, a Virginia Limited Liability Company",
  "property_jurisdiction": "County of Arlington, Virginia",
  "legal_description": "All of Apartment Unit Six Hundred Twelve (612), Phase II, THE WINDERMERE, A CONDOMINIUM, together with the undivided interest in the General and Limited Common Elements and all other rights and privileges which attach to said Apartment Unit, as described in that certain Declaration, with Plats and Plans attached thereto, recorded the 14th of August 1984, in Deed Book 2188, at Page 0451, et seq., and by First Amendment to Declaration recorded in Deed Book 2201 at page 0907, and by Second Amendment to Declaration recorded in Deed Book 2214 at page 0188, and by Third Amendment to Declaration recorded in Deed Book 2214 at page 0193, and any and all amendments thereto, among the Land Records of Arlington County, Virginia.",
  "legal_casing": "title-case",
  "property_type": "CONDO",
  "derivation_of_title": "For derivation of title, see Deed recorded as Instrument Number 20240700014488, among the aforesaid land records.",
  "subject_to": "This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.",
  "notary_jurisdiction": { "commonwealth": "COMMONWEALTH OF VIRGINIA", "locality": "CITY OF ALEXANDRIA" }
}
```

#### EXPECTED ASSEMBLED DEED (full house style)

```
Exempt from recording tax pursuant to Sec 58.1-811(A)(10), 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No.: 44-013-088

Grantee Address and return to:  880 N Pollard Street, Unit 612, Arlington, VA 22203

Assessed Value: $341,900

Consideration: $0.00

_____________________________________________________________________________

DEED

THIS DEED made and entered this ____ day of May, 2026, by and between Soren VALLECILLO, unmarried, GRANTOR, and Pollard Street Capital, LLC, a Virginia Limited Liability Company, GRANTEE;

W I T N E S S E T H

That, for a good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the GRANTOR does hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Arlington, Virginia, to-wit:

All of Apartment Unit Six Hundred Twelve (612), Phase II, THE WINDERMERE, A CONDOMINIUM, together with the undivided interest in the General and Limited Common Elements and all other rights and privileges which attach to said Apartment Unit, as described in that certain Declaration, with Plats and Plans attached thereto, recorded the 14th of August 1984, in Deed Book 2188, at Page 0451, et seq., and by First Amendment to Declaration recorded in Deed Book 2201 at page 0907, and by Second Amendment to Declaration recorded in Deed Book 2214 at page 0188, and by Third Amendment to Declaration recorded in Deed Book 2214 at page 0193, and any and all amendments thereto, among the Land Records of Arlington County, Virginia.

For derivation of title, see Deed recorded as Instrument Number 20240700014488, among the aforesaid land records.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.


SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE
Witness the following signatures and seals:


__________________________(seal)
Soren VALLECILLO







COMMONWEALTH OF VIRGINIA
CITY OF ALEXANDRIA

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Soren VALLECILLO, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this ____ day of May, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

### GOLDEN G3 — married couple (both grantors) → LLC, SFH, ALL-CAPS legal

#### INPUT (consolidated matter facts)

```json
{
  "category": "DEED_INTO_LLC",
  "exemption_cite": "58.1-811(A)(10)",
  "prepared_by": "Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC",
  "title_search": "Prepared without benefit of title search",
  "tax_id": "0317-09-0145",
  "grantee_address_return": "10545 Briar Hollow Lane, Fairfax, VA, 22032, USA",
  "assessed_value": "$793,200.00",
  "consideration": "$0.00",
  "instrument_date_phrase": "____ day of June, 2026",
  "grantors": [
    { "name": "Rosalind A. TREMAINE", "marital_status": "married" },
    { "name": "Desmond P. TREMAINE", "marital_status": "married" }
  ],
  "grantor_cardinality": "married_couple",
  "grantee_llc": "Briar Hollow Family LLC, a Virginia Limited Liability Company",
  "property_jurisdiction": "County of Fairfax, Virginia",
  "legal_description": "LOT NUMBERED FORTY-ONE (41), SECTION THREE (3), STONELEIGH GROVE, AS THE SAME APPEARS DULY DEDICATED, PLATTED AND RECORDED IN DEED BOOK 6021, AT PAGE 0742, AMONG THE LAND RECORDS OF FAIRFAX COUNTY, VIRGINIA.",
  "legal_casing": "ALL-CAPS",
  "property_type": "SFH",
  "derivation_of_title": "For derivation of title, see Deed recorded in Deed Book 28104, at page 0668, among the aforesaid land records.",
  "subject_to": "This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.",
  "notary_jurisdiction": { "commonwealth": "COMMONWEALTH OF VIRGINIA", "locality": "CITY OF ALEXANDRIA" }
}
```

#### EXPECTED ASSEMBLED DEED (full house style)

> Note the plural normalizations carried by the assembler for two grantors: caption label **GRANTORS**; granting verb **do hereby** (vs. "does hereby"); two signature seal-blocks; both names in the notary acknowledgment. The possessive body phrase stays **"all of the Grantor's right, title and interest"** in the assembled output ONLY because that is the verbatim STANDARD granting clause (see assertion note A6 and NEG-2 — the assembler must surface the singular-with-two-grantors mismatch as an advisory lint, not silently treat the source typo as authoritative; for the GOLDEN expected output we carry the firm's standard clause text unchanged and rely on the lint flag, never a silent rewrite).

```
Exempt from recording tax pursuant to Sec 58.1-811(A)(10), 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No.: 0317-09-0145

Grantee Address and return to:  10545 Briar Hollow Lane, Fairfax, VA, 22032, USA

Assessed Value: $793,200.00

Consideration: $0.00

_____________________________________________________________________________

DEED

THIS DEED made and entered this ____ day of June, 2026, by and between Rosalind A. TREMAINE and Desmond P. TREMAINE, a married couple, GRANTORS, and Briar Hollow Family LLC, a Virginia Limited Liability Company, GRANTEE;

W I T N E S S E T H

That, for a good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the GRANTORS do hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:

LOT NUMBERED FORTY-ONE (41), SECTION THREE (3), STONELEIGH GROVE, AS THE SAME APPEARS DULY DEDICATED, PLATTED AND RECORDED IN DEED BOOK 6021, AT PAGE 0742, AMONG THE LAND RECORDS OF FAIRFAX COUNTY, VIRGINIA.

For derivation of title, see Deed recorded in Deed Book 28104, at page 0668, among the aforesaid land records.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.


SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE
Witness the following signatures and seals:


__________________________(seal)
Rosalind A. TREMAINE

__________________________(seal)
Desmond P. TREMAINE





COMMONWEALTH OF VIRGINIA
CITY OF ALEXANDRIA

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Rosalind A. TREMAINE and Desmond P. TREMAINE, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this ____ day of June, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

## 2. NEG / POISON FIXTURES (must FAIL CLOSED — withhold + flag, never silently emit)

> Fail-closed contract: on any NEG trigger the assembler MUST NOT produce a finished deed. It returns a structured refusal `{ status: "WITHHELD", flags: [...] }` (or equivalent) and surfaces the flag for attorney review. No partial/best-effort deed is emitted.

### NEG-1 — truncated condo legal (multi-amendment Declaration cut mid-list)

#### INPUT (defective)

```json
{
  "category": "DEED_INTO_LLC",
  "grantors": [{ "name": "Soren VALLECILLO", "marital_status": "unmarried" }],
  "grantee_llc": "Pollard Street Capital, LLC, a Virginia Limited Liability Company",
  "property_type": "CONDO",
  "legal_description": "All of Apartment Unit Six Hundred Twelve (612), Phase II, THE WINDERMERE, A CONDOMINIUM, together with the undivided interest in the General and Limited Common Elements and all other rights and privileges which attach to said Apartment Unit, as described in that certain Declaration, with Plats and Plans attached thereto, recorded the 14th of August 1984, in Deed Book 2188, at Page 0451, et seq., and by First Amendment to Declaration recorded in Deed Book 2201 at page 0907, and by Second Amendment to Declaration recorded in Deed Book 2214 at page",
  "legal_casing": "title-case"
}
```

#### EXPECTED FAIL-CLOSED BEHAVIOR

- `status: "WITHHELD"`.
- Flag: `TRUNCATED_LEGAL_DESCRIPTION` — the condo legal terminates mid-amendment ("Second Amendment ... at page" with no page number, no "and any and all amendments thereto, among the Land Records of ...", no trailing period). A condo legal that recites amendments must terminate in the closing "...among the Land Records of <County> County, Virginia." clause.
- The assembler MUST NOT pad, guess, or complete the missing page number / amendment list, and MUST NOT emit a deed with a partial legal.

### NEG-2 — singular "Grantor's" used with TWO grantors (real-corpus typo from Exemplar-C)

> This is the real Exemplar-C negative-lint target: source said "all of the **Grantor's**" (singular) with two grantors. The point of this fixture is that the assembler must FLAG/normalize the cardinality mismatch and NEVER silently reproduce a source typo as authoritative.

#### INPUT (defective — caller passes pre-baked body asserting two grantors but a singular possessive treated as authoritative source text)

```json
{
  "category": "DEED_INTO_LLC",
  "grantor_cardinality": "married_couple",
  "grantors": [
    { "name": "Rosalind A. TREMAINE", "marital_status": "married" },
    { "name": "Desmond P. TREMAINE", "marital_status": "married" }
  ],
  "source_granting_body_override": "the GRANTORS do hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property",
  "override_marked_authoritative": true
}
```

#### EXPECTED FAIL-CLOSED BEHAVIOR

- `status: "WITHHELD"` (because an authoritative override carrying a cardinality typo is being asked to pass through unreviewed).
- Flag: `GRANTOR_CARDINALITY_MISMATCH` — two grantors present but the granting body uses singular possessive "Grantor's" while marked authoritative. The assembler must surface this for attorney decision (normalize to the firm-standard clause vs. accept) and MUST NOT silently emit the source typo as if it were vetted.
- Distinction from GOLDEN G3: in G3 the assembler builds the body from the firm's STANDARD clause template (which itself reads "Grantor's") and emits a lint advisory — it is not blindly copying an authoritative-marked source string. Here the defective input demands pass-through of an authoritative override; that path fails closed.

### NEG-3 — malformed / non-Virginia LLC designator (missing ", a Virginia Limited Liability Company")

#### INPUT (defective)

```json
{
  "category": "DEED_INTO_LLC",
  "grantors": [{ "name": "Dahlia OKONKWO", "marital_status": "unmarried" }],
  "grantee_llc": "Marlowe Glen Holdings LLC",
  "property_type": "SFH"
}
```

(Variant B: `"grantee_llc": "Marlowe Glen Holdings, a Delaware Limited Liability Company"` — wrong jurisdiction.)

#### EXPECTED FAIL-CLOSED BEHAVIOR

- `status: "WITHHELD"`.
- Flag: `INVALID_LLC_DESIGNATOR` — the grantee entity string lacks the required Virginia designator ", a Virginia Limited Liability Company" (Variant A), or asserts a non-Virginia jurisdiction inconsistent with the § 58.1-811(A)(10) Virginia-LLC exemption basis (Variant B).
- The assembler MUST NOT append/guess the designator nor emit the caption with a bare or foreign-jurisdiction LLC name.

### NEG-4 — warranty bleed ("General Warranty" injected into a quitclaim-into-LLC)

#### INPUT (defective)

```json
{
  "category": "DEED_INTO_LLC",
  "grantors": [{ "name": "Dahlia OKONKWO", "marital_status": "unmarried" }],
  "grantee_llc": "Marlowe Glen Holdings LLC, a Virginia Limited Liability Company",
  "granting_verb_override": "does hereby grant and convey, with General Warranty and English Covenants of Title,",
  "property_type": "SFH"
}
```

#### EXPECTED FAIL-CLOSED BEHAVIOR

- `status: "WITHHELD"` / REJECTED.
- Flag: `WARRANTY_BLEED_INTO_QUITCLAIM` — a warranty token ("General Warranty" / "Special Warranty" / "English Covenants") appeared in a DEED_INTO_LLC, which is a quitclaim with NO warranty. The required verb is "quitclaim release and convey ... in fee simple ... all of the Grantor's right, title and interest" with no warranty covenant.
- The assembler MUST reject and MUST NOT emit any deed containing warranty language for this category.

---

## 3. EXACT-MATCH ASSERTION NOTES (`toBe` / `toEqual` — never substring)

Positive assertions (full-string equality on the assembled output / its segments):

- **A1 — Exemption recital (verbatim):**
  `expect(deed.exemptionLine).toBe("Exempt from recording tax pursuant to Sec 58.1-811(A)(10), 1950 Code of Virginia")`
- **A2 — Title (plain DEED):**
  `expect(deed.title).toBe("DEED")`
- **A3 — Granting clause core (quitclaim, no warranty), single grantor:**
  `expect(deed.grantingClause).toBe("the GRANTOR does hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:")`
  (Note the DOUBLE space before "County" — preserve verbatim from the corpus.)
- **A4 — Granting clause core, married couple (plural):**
  `expect(deed.grantingClause).toBe("the GRANTORS do hereby quitclaim release and convey unto the GRANTEE, in fee simple, all of the Grantor's right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the  County of Fairfax, Virginia, to-wit:")`
- **A5 — Verbatim legal description carried UNCHANGED (per fixture):**
  `expect(deed.legalDescription).toBe(input.legal_description)` — byte-for-byte equality; casing (title-case vs ALL-CAPS) preserved; condo Declaration + all amendment recitals preserved in order; no normalization.
- **A6 — Caption parties line (G3 plural):**
  `expect(deed.captionParties).toBe("Rosalind A. TREMAINE and Desmond P. TREMAINE, a married couple, GRANTORS, and Briar Hollow Family LLC, a Virginia Limited Liability Company, GRANTEE;")`
- **A7 — WITNESSETH spacing (verbatim):**
  `expect(deed.witnesseth).toBe("W I T N E S S E T H")`
- **A8 — Pagination marker (verbatim):**
  `expect(deed.paginationMarker).toBe("SIGNATURES AND SEALS TO APPEAR ON THE FOLLOWING PAGE")`
- **A9 — Derivation-of-title line equals the slot input exactly:**
  `expect(deed.derivationLine).toBe(input.derivation_of_title)`
- **A10 — Subject-to clause (verbatim):**
  `expect(deed.subjectTo).toBe("This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.")`
- **A11 — Full document equality (strongest):**
  `expect(deed.fullText).toBe(GOLDEN_G1_EXPECTED)` (and G2, G3 respectively) — the entire assembled string equals the EXPECTED block above, exactly.
- **A12 — Signature blocks count (G3):**
  `expect(deed.sealBlocks).toEqual(["__________________________(seal)\nRosalind A. TREMAINE", "__________________________(seal)\nDesmond P. TREMAINE"])`

Negative-assertion family (NO warranty / no bleed — assert ABSENCE, exact-token):

- **N1:** `expect(deed.fullText).not.toContain("General Warranty")`
- **N2:** `expect(deed.fullText).not.toContain("Special Warranty")`
- **N3:** `expect(deed.fullText).not.toContain("English Covenants")`
- **N4:** `expect(deed.fullText).not.toContain("with warranty")`
- **N5:** `expect(deed.fullText.toLowerCase()).not.toContain("covenants of title")`
- **N6 (positive presence of quitclaim verb, to pair with the negatives):** `expect(deed.fullText).toContain("quitclaim release and convey")`

Fail-closed assertions (NEG fixtures):

- **F1:** `expect(result.status).toBe("WITHHELD")`
- **F2:** `expect(result.flags).toContain("TRUNCATED_LEGAL_DESCRIPTION")` (NEG-1)
- **F3:** `expect(result.flags).toContain("GRANTOR_CARDINALITY_MISMATCH")` (NEG-2)
- **F4:** `expect(result.flags).toContain("INVALID_LLC_DESIGNATOR")` (NEG-3)
- **F5:** `expect(result.flags).toContain("WARRANTY_BLEED_INTO_QUITCLAIM")` (NEG-4)
- **F6 (every NEG must emit no deed):** `expect(result.deed).toBeUndefined()` / `expect(result.fullText).toBeUndefined()`

---

## 4. PII-FREE GUARANTEE

Every party name, address, tax ID, assessed value, LLC name, legal description, derivation reference, and notary jurisdiction in this pack is INVENTED and synthetic; only the verbatim Virginia statutory recitals, standard Mason house-style clauses, and firm/attorney identity (Mason Law Firm, PLC / Kelly Satterwhite, VSB #91049) are real, and no real client data from the Exemplar-A / Exemplar-B / Exemplar-C exemplars (or any other source) is reproduced.
