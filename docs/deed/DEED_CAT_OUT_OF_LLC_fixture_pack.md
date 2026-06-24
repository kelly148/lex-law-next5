# DEED OUT OF AN LLC — Synthetic Fixture Pack (C4)

**Category:** C4 — DEED OUT OF AN LLC (Virginia, Mason house style)
**Assembler:** deterministic deed-drafting assembler (sibling of the deed-of-gift assembler), The Mason Law Firm, PLC — Kelly Satterwhite, VSB #91049
**Grounded from:** `DEED_KB_CATEGORY_GROUNDING.md` §C4 + real exemplar `VA - Deed out of LLC (1).docx` (Exemplar-C4 Exemplar-C4) — STRUCTURE replicated, **all data invented**.
**Status:** SYNTHETIC / PII-FREE. Every LLC name, member name, address, tax id, file number, legal description, instrument reference, and assessed value below is fabricated and matches no real person, entity, or parcel.

---

## 0. Category invariants (what every GOLDEN must satisfy)

| Element | Required value (out-of-LLC) |
| :-- | :-- |
| Exemption recital | `Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended` (normalized — see NEG-B) |
| Pre-title banner | `THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE` |
| Title | plain `DEED` |
| Premise form | **name-before-parenthetical-label**: `[[LLC]], A Virginia Limited Liability Company, (the "Grantor"), and [[members]], collectively being the members of the Grantor LLC, (the "Grantees")` |
| Recital lead-in | `Witnesseth, that:` |
| Granting verb | `grant and convey, with Special Warranty of title` |
| Vesting | `in fee simple, as tenants in common` |
| Warranty | **SPECIAL** (never General) |
| Consideration | `$0.00` |
| Legal description | carried through **UNCHANGED / verbatim** |
| Derivation | `For derivation of title see Deed recorded as instrument number [[N]] among the aforesaid land records.` |
| Subject-to | `This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.` |
| Signature block | LLC by **each** member |
| Return block | Universal Title `After recording return to:` block |

**Name-bleed discipline (OCR-B1 failure class):** the captured `[[LLC]]` grantor name and each `[[member]]` grantee name must be the **bare proper name only**. The `(the "Grantor")` / `(the "Grantees")` parenthetical labels and the `"), and` bridge fragment are assembled by the template — they are NEVER part of a captured party name. Any captured name carrying a label or bridge fragment FAILS CLOSED (see NEG-A).

---

## 1. GOLDEN FIXTURES

---

### GOLDEN-1 — two-member LLC, single-family home, Special Warranty

```json
{
  "fixture_id": "C4-GOLDEN-1",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "MAPLEHURST HOLDINGS LLC",
    "members": [
      { "name": "Desmond R. Okafor", "signature_title": "Member" },
      { "name": "Priya N. Venkataraman", "signature_title": "Member" }
    ],
    "exemption_cite": "58.1-811(A)(11)",
    "file_number": "41-2026-7720",
    "grantee_address": "8814 Larkspur Meadow Lane, Aldie, Virginia 20105",
    "tax_id": "22-4-61",
    "assessed_value": "1,275,400.00",
    "consideration": "0.00",
    "execution_month": "July",
    "execution_year": "2026",
    "locality_type": "County",
    "locality_name": "Loudoun",
    "legal_description": "Lot 61, Section 3, HAWKSLEY GLEN, as the same appears duly dedicated, platted and recorded by Deed of Subdivision and Dedication recorded in Deed Book 2207 at page 0844, among the land records of Loudoun County, Virginia.",
    "derivation_instrument_number": "202401090012744",
    "notary_commonwealth": "VIRGINIA",
    "notary_locality": "COUNTY OF LOUDOUN",
    "return_to": {
      "company": "Universal Title",
      "line1": "3031 Fairview Park Drive",
      "line2": "Suite 375",
      "city_state_zip": "Falls Church, VA 22042",
      "phone": "(703) 354-2100"
    }
  },
  "expected_deed": "Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended\n\nPrepared by: Kelly Satterwhite, Esquire, VSB #91049\nThe Mason Law Firm, PLC\n\nFile Number: 41-2026-7720\n\nGrantee's Address: 8814 Larkspur Meadow Lane, Aldie, Virginia 20105\n\nTax I.D. Number: 22-4-61\n\nAssessed value: $1,275,400.00\n\nConsideration: $0.00\n\nTHIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE\n\nDEED\n\nTHIS DEED, made this _____ day of July, 2026, by and between MAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company, (the \"Grantor\"), and Desmond R. Okafor and Priya N. Venkataraman, collectively being the members of the Grantor LLC, (the \"Grantees\"),\n\nWitnesseth, that:\n\nFor and in consideration of valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with Special Warranty of title, unto the said Grantees, in fee simple, as tenants in common, all of the following parcel of real property, with improvements thereon, located in the County of Loudoun, Commonwealth of Virginia, to wit:\n\nLot 61, Section 3, HAWKSLEY GLEN, as the same appears duly dedicated, platted and recorded by Deed of Subdivision and Dedication recorded in Deed Book 2207 at page 0844, among the land records of Loudoun County, Virginia.\n\nFor derivation of title see Deed recorded as instrument number 202401090012744 among the aforesaid land records.\n\nThis conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.\n\nWITNESS the following signatures and seals:\n\nMAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company\nBy: ______________________________     Desmond R. Okafor, Member\nBy: ______________________________     Priya N. Venkataraman, Member\n\nCOMMONWEALTH OF VIRGINIA\nCOUNTY OF LOUDOUN\nThe foregoing instrument was subscribed and sworn before me this _____ day of July, 2026, by Desmond R. Okafor and Priya N. Venkataraman, Members of MAPLEHURST HOLDINGS LLC.\n______________________________\nNotary Public's signature\nNotary registration number: ______________\nMy commission expires: ______________\n\nAfter recording return to:\nUniversal Title\n3031 Fairview Park Drive\nSuite 375\nFalls Church, VA 22042\n(703) 354-2100"
}
```

---

### GOLDEN-2 — three-member LLC, condominium unit, Special Warranty

```json
{
  "fixture_id": "C4-GOLDEN-2",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "CEDAR & STONE VENTURES LLC",
    "members": [
      { "name": "Marguerite A. Delacroix", "signature_title": "Member" },
      { "name": "Tobias E. Hargreaves", "signature_title": "Member" },
      { "name": "Lin Wei Chang", "signature_title": "Member" }
    ],
    "exemption_cite": "58.1-811(A)(11)",
    "file_number": "41-2026-8195",
    "grantee_address": "1190 Brindle Commons Way, Unit 412, Reston, Virginia 20190",
    "tax_id": "0173-19-0412",
    "assessed_value": "642,900.00",
    "consideration": "0.00",
    "execution_month": "August",
    "execution_year": "2026",
    "locality_type": "County",
    "locality_name": "Fairfax",
    "legal_description": "Unit 412, Building 11, together with the limited common elements appurtenant thereto, of BRINDLE COMMONS, A Condominium, established pursuant to the Condominium Act of Virginia by Declaration recorded in Deed Book 19844 at page 0021, as amended by First Amendment recorded in Deed Book 19902 at page 1106, among the land records of Fairfax County, Virginia.",
    "derivation_instrument_number": "202312050099318",
    "notary_commonwealth": "VIRGINIA",
    "notary_locality": "COUNTY OF FAIRFAX",
    "return_to": {
      "company": "Universal Title",
      "line1": "4031 University Drive",
      "line2": "Suite 200",
      "city_state_zip": "Fairfax, VA 22030",
      "phone": "(703) 354-2100"
    }
  },
  "expected_deed": "Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended\n\nPrepared by: Kelly Satterwhite, Esquire, VSB #91049\nThe Mason Law Firm, PLC\n\nFile Number: 41-2026-8195\n\nGrantee's Address: 1190 Brindle Commons Way, Unit 412, Reston, Virginia 20190\n\nTax I.D. Number: 0173-19-0412\n\nAssessed value: $642,900.00\n\nConsideration: $0.00\n\nTHIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE\n\nDEED\n\nTHIS DEED, made this _____ day of August, 2026, by and between CEDAR & STONE VENTURES LLC, A Virginia Limited Liability Company, (the \"Grantor\"), and Marguerite A. Delacroix, Tobias E. Hargreaves and Lin Wei Chang, collectively being the members of the Grantor LLC, (the \"Grantees\"),\n\nWitnesseth, that:\n\nFor and in consideration of valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with Special Warranty of title, unto the said Grantees, in fee simple, as tenants in common, all of the following parcel of real property, with improvements thereon, located in the County of Fairfax, Commonwealth of Virginia, to wit:\n\nUnit 412, Building 11, together with the limited common elements appurtenant thereto, of BRINDLE COMMONS, A Condominium, established pursuant to the Condominium Act of Virginia by Declaration recorded in Deed Book 19844 at page 0021, as amended by First Amendment recorded in Deed Book 19902 at page 1106, among the land records of Fairfax County, Virginia.\n\nFor derivation of title see Deed recorded as instrument number 202312050099318 among the aforesaid land records.\n\nThis conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.\n\nWITNESS the following signatures and seals:\n\nCEDAR & STONE VENTURES LLC, A Virginia Limited Liability Company\nBy: ______________________________     Marguerite A. Delacroix, Member\nBy: ______________________________     Tobias E. Hargreaves, Member\nBy: ______________________________     Lin Wei Chang, Member\n\nCOMMONWEALTH OF VIRGINIA\nCOUNTY OF FAIRFAX\nThe foregoing instrument was subscribed and sworn before me this _____ day of August, 2026, by Marguerite A. Delacroix, Tobias E. Hargreaves and Lin Wei Chang, Members of CEDAR & STONE VENTURES LLC.\n______________________________\nNotary Public's signature\nNotary registration number: ______________\nMy commission expires: ______________\n\nAfter recording return to:\nUniversal Title\n4031 University Drive\nSuite 200\nFairfax, VA 22030\n(703) 354-2100"
}
```

---

### GOLDEN-3 — single-member LLC, single-family home, Special Warranty

```json
{
  "fixture_id": "C4-GOLDEN-3",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "QUILLON RIDGE PROPERTIES LLC",
    "members": [
      { "name": "Anselm J. Fairweather", "signature_title": "Member" }
    ],
    "exemption_cite": "58.1-811(A)(11)",
    "file_number": "41-2026-6037",
    "grantee_address": "305 Tallowwood Court, Manassas Park, Virginia 20111",
    "tax_id": "16-2-09",
    "assessed_value": "498,150.00",
    "consideration": "0.00",
    "execution_month": "September",
    "execution_year": "2026",
    "locality_type": "City",
    "locality_name": "Manassas Park",
    "legal_description": "Lot 9, Block C, TALLOWWOOD STATION, as the same appears duly dedicated, platted and recorded in Deed Book 1188 at page 0457, among the land records of the City of Manassas Park, Virginia.",
    "derivation_instrument_number": "202209140071602",
    "notary_commonwealth": "VIRGINIA",
    "notary_locality": "CITY OF MANASSAS PARK",
    "return_to": {
      "company": "Universal Title",
      "line1": "3031 Fairview Park Drive",
      "line2": "Suite 375",
      "city_state_zip": "Falls Church, VA 22042",
      "phone": "(703) 354-2100"
    }
  },
  "expected_deed": "Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended\n\nPrepared by: Kelly Satterwhite, Esquire, VSB #91049\nThe Mason Law Firm, PLC\n\nFile Number: 41-2026-6037\n\nGrantee's Address: 305 Tallowwood Court, Manassas Park, Virginia 20111\n\nTax I.D. Number: 16-2-09\n\nAssessed value: $498,150.00\n\nConsideration: $0.00\n\nTHIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE\n\nDEED\n\nTHIS DEED, made this _____ day of September, 2026, by and between QUILLON RIDGE PROPERTIES LLC, A Virginia Limited Liability Company, (the \"Grantor\"), and Anselm J. Fairweather, collectively being the members of the Grantor LLC, (the \"Grantees\"),\n\nWitnesseth, that:\n\nFor and in consideration of valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantor does hereby grant and convey, with Special Warranty of title, unto the said Grantees, in fee simple, as tenants in common, all of the following parcel of real property, with improvements thereon, located in the City of Manassas Park, Commonwealth of Virginia, to wit:\n\nLot 9, Block C, TALLOWWOOD STATION, as the same appears duly dedicated, platted and recorded in Deed Book 1188 at page 0457, among the land records of the City of Manassas Park, Virginia.\n\nFor derivation of title see Deed recorded as instrument number 202209140071602 among the aforesaid land records.\n\nThis conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.\n\nWITNESS the following signatures and seals:\n\nQUILLON RIDGE PROPERTIES LLC, A Virginia Limited Liability Company\nBy: ______________________________     Anselm J. Fairweather, Member\n\nCOMMONWEALTH OF VIRGINIA\nCITY OF MANASSAS PARK\nThe foregoing instrument was subscribed and sworn before me this _____ day of September, 2026, by Anselm J. Fairweather, Member of QUILLON RIDGE PROPERTIES LLC.\n______________________________\nNotary Public's signature\nNotary registration number: ______________\nMy commission expires: ______________\n\nAfter recording return to:\nUniversal Title\n3031 Fairview Park Drive\nSuite 375\nFalls Church, VA 22042\n(703) 354-2100"
}
```

> **GOLDEN coverage note.** Member count varies 2 / 3 / 1; property varies SFH / condo / SFH; locality varies County / County / City; both Universal Title return addresses are exercised. Singular-member premise still reads `collectively being the members of the Grantor LLC` and the granting clause still says `as tenants in common` — these are house-style invariants carried verbatim regardless of member count (the assembler does NOT grammar-"fix" them; that would be a substantive rewrite). Notary clause pluralizes `Member`/`Members` by count.

---

## 2. NEG / POISON FIXTURES (must FAIL CLOSED — never silently emit)

Each NEG asserts the assembler **rejects, withholds, or flags** rather than producing a deed. Fail-closed = no assembled deed is returned for that field/document; an explicit error/flag is raised for attorney review.

---

### NEG-A — PARTY-NAME LABEL BLEED (the OCR-B1 name-bleed failure class — CRITICAL)

The captured grantor/grantee name wrongly carries the parenthetical label or the bridge fragment. Three sub-cases, all MUST fail closed.

```json
{
  "fixture_id": "C4-NEG-A1-grantor-label-bleed",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "MAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company, (the \"Grantor\")",
    "members": [
      { "name": "Desmond R. Okafor", "signature_title": "Member" },
      { "name": "Priya N. Venkataraman", "signature_title": "Member" }
    ]
  },
  "expected_behavior": "FAIL_CLOSED",
  "expected_error_code": "PARTY_NAME_LABEL_BLEED",
  "expected_flag": "Captured Grantor name contains the parenthetical label '(the \"Grantor\")' and/or the entity descriptor. Reject — the name field must be the bare entity name only ('MAPLEHURST HOLDINGS LLC'). NO deed emitted.",
  "must_not_emit": true
}
```

```json
{
  "fixture_id": "C4-NEG-A2-bridge-fragment-bleed",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "MAPLEHURST HOLDINGS LLC",
    "members": [
      { "name": "Desmond R. Okafor", "signature_title": "Member" },
      { "name": "Priya N. Venkataraman\"), and", "signature_title": "Member" }
    ]
  },
  "expected_behavior": "FAIL_CLOSED",
  "expected_error_code": "PARTY_NAME_BRIDGE_FRAGMENT",
  "expected_flag": "Captured Grantee name contains the bridge fragment '\"), and'. Reject — bridge text is template-assembled, never part of a captured name. NO deed emitted.",
  "must_not_emit": true
}
```

```json
{
  "fixture_id": "C4-NEG-A3-grantees-label-bleed",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "MAPLEHURST HOLDINGS LLC",
    "members": [
      { "name": "Desmond R. Okafor", "signature_title": "Member" },
      { "name": "Priya N. Venkataraman, collectively being the members of the Grantor LLC, (the \"Grantees\")", "signature_title": "Member" }
    ]
  },
  "expected_behavior": "FAIL_CLOSED",
  "expected_error_code": "PARTY_NAME_LABEL_BLEED",
  "expected_flag": "Captured Grantee name contains the descriptor clause 'collectively being the members of the Grantor LLC' and the '(the \"Grantees\")' label. Reject — name field must be the bare member name only. NO deed emitted.",
  "must_not_emit": true
}
```

---

### NEG-B — EXEMPTION TYPO `58-1-811(A)(11)` (real-corpus poison — flag/normalize, never reproduce)

The real Exemplar-C4 Exemplar-C4 exemplar typos the section as `58-1-811(A)(11)` (hyphen instead of the `58.1-811` dot form). The assembler must NEVER reproduce the malformed cite; it normalizes to `§ 58.1-811(A)(11)` and flags the input.

```json
{
  "fixture_id": "C4-NEG-B-exemption-typo",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "QUILLON RIDGE PROPERTIES LLC",
    "members": [ { "name": "Anselm J. Fairweather", "signature_title": "Member" } ],
    "exemption_cite_raw": "Sec. 58-1-811(A)(11)"
  },
  "expected_behavior": "FLAG_AND_NORMALIZE",
  "expected_error_code": "EXEMPTION_CITE_MALFORMED",
  "expected_flag": "Input exemption cite '58-1-811(A)(11)' is the known corpus typo (hyphen for dot). Normalize to '§ 58.1-811(A)(11)' before emit; do NOT reproduce the raw form. Flag for attorney confirmation.",
  "expected_normalized_value": "Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended",
  "must_not_emit_literal": "58-1-811(A)(11)"
}
```

---

### NEG-C — TRUNCATED LEGAL DESCRIPTION (withhold + flag — never emit a partial legal)

```json
{
  "fixture_id": "C4-NEG-C-truncated-legal",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "CEDAR & STONE VENTURES LLC",
    "members": [
      { "name": "Marguerite A. Delacroix", "signature_title": "Member" },
      { "name": "Tobias E. Hargreaves", "signature_title": "Member" }
    ],
    "legal_description": "Unit 412, Building 11, together with the limited common elements appurtenant thereto, of BRINDLE COMMONS, A Condominium, established pursuant to the Condominium Act of Virginia by Declaration recorded in Deed Book 19844 at page"
  },
  "expected_behavior": "FAIL_CLOSED",
  "expected_error_code": "LEGAL_DESCRIPTION_TRUNCATED",
  "expected_flag": "Legal description ends mid-clause ('...at page' with no page number / no closing 'among the land records of ... Virginia.'). Withhold — do NOT emit a deed with a partial legal. Flag for re-capture of the complete verbatim legal.",
  "must_not_emit": true
}
```

---

### NEG-D — WARRANTY MISMATCH (`General Warranty` where out-of-LLC requires SPECIAL — flag)

```json
{
  "fixture_id": "C4-NEG-D-warranty-mismatch",
  "category": "deed_out_of_llc",
  "input": {
    "grantor_llc": "MAPLEHURST HOLDINGS LLC",
    "members": [
      { "name": "Desmond R. Okafor", "signature_title": "Member" },
      { "name": "Priya N. Venkataraman", "signature_title": "Member" }
    ],
    "warranty_token": "grant and convey, with General Warranty of title"
  },
  "expected_behavior": "FAIL_CLOSED",
  "expected_error_code": "WARRANTY_MISMATCH",
  "expected_flag": "Input warranty token says 'General Warranty'; DEED OUT OF AN LLC house style requires 'Special Warranty of title'. Reject the General token — do NOT emit. Flag for attorney decision; if Special is correct, supply the Special token.",
  "must_not_emit_literal": "General Warranty",
  "expected_required_literal": "grant and convey, with Special Warranty of title"
}
```

---

## 3. EXACT-MATCH ASSERTION NOTES

**Lesson carried (OCR-B1):** assert with `toBe` / `toEqual` on the **full** value — NEVER `toContain`/substring. Substring matching is what let the name-bleed class slip through; a label-bleed string still "contains" the proper name.

### 3.1 GOLDEN positive assertions (whole-string `toBe`)

```js
// Full-document exact match — the single strongest assertion.
expect(assembleDeed(C4_GOLDEN_1.input)).toBe(C4_GOLDEN_1.expected_deed);
expect(assembleDeed(C4_GOLDEN_2.input)).toBe(C4_GOLDEN_2.expected_deed);
expect(assembleDeed(C4_GOLDEN_3.input)).toBe(C4_GOLDEN_3.expected_deed);

// Load-bearing clause-level exact matches (each toBe on the exact clause string):
expect(deed.exemptionRecital).toBe('Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended');
expect(deed.banner).toBe('THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE');
expect(deed.title).toBe('DEED');
expect(deed.grantingClause).toBe('the Grantor does hereby grant and convey, with Special Warranty of title, unto the said Grantees, in fee simple, as tenants in common,');
expect(deed.subjectTo).toBe('This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.');

// Premise must equal the assembled parenthetical-label form EXACTLY (GOLDEN-1):
expect(deed.premise).toBe('MAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company, (the "Grantor"), and Desmond R. Okafor and Priya N. Venkataraman, collectively being the members of the Grantor LLC, (the "Grantees"),');

// Verbatim legal carried UNCHANGED (toBe against the input legal, byte-for-byte):
expect(deed.legalDescription).toBe(C4_GOLDEN_1.input.legal_description);

// Derivation line exact:
expect(deed.derivation).toBe('For derivation of title see Deed recorded as instrument number 202401090012744 among the aforesaid land records.');
```

### 3.2 Negative-assertion family — NO party name carries a label or bridge fragment

Applies to **every captured party name** (the LLC grantor name and each member grantee name), in BOTH the GOLDEN inputs (proving clean capture) and as the FAIL-CLOSED trigger in NEG-A. These assert on the **captured name field**, not the assembled premise.

```js
const POISON_FRAGMENTS = [
  '(the "Grantor")',
  '(the "Grantees")',
  '(the "Grantee")',
  '"), and',
  '", and',                                          // smart/straight-quote variant
  'A Virginia Limited Liability Company',
  'collectively being the members of the Grantor LLC'
];

function assertCleanPartyName(name) {
  for (const frag of POISON_FRAGMENTS) {
    expect(name.includes(frag)).toBe(false);   // negative: fragment must be ABSENT
  }
}

// GOLDEN: every captured name is clean.
assertCleanPartyName(C4_GOLDEN_1.input.grantor_llc);            // 'MAPLEHURST HOLDINGS LLC'
C4_GOLDEN_1.input.members.forEach(m => assertCleanPartyName(m.name));

// Equivalent positive identity assertions (the bare name, exact):
expect(C4_GOLDEN_1.input.grantor_llc).toBe('MAPLEHURST HOLDINGS LLC');
expect(C4_GOLDEN_1.input.members[0].name).toBe('Desmond R. Okafor');
expect(C4_GOLDEN_1.input.members[1].name).toBe('Priya N. Venkataraman');

// NEG-A: a name carrying a fragment must drive FAIL_CLOSED (assembler never emits).
expect(() => assembleDeed(C4_NEG_A1.input)).toThrowError('PARTY_NAME_LABEL_BLEED');
expect(assembleResult(C4_NEG_A1.input).emitted).toBe(false);
expect(assembleResult(C4_NEG_A2.input).errorCode).toBe('PARTY_NAME_BRIDGE_FRAGMENT');
expect(assembleResult(C4_NEG_A3.input).errorCode).toBe('PARTY_NAME_LABEL_BLEED');
```

### 3.3 NEG fail-closed assertions

```js
// NEG-B: never emit the typo; normalize exactly.
expect(assembleResult(C4_NEG_B.input).errorCode).toBe('EXEMPTION_CITE_MALFORMED');
expect(assembleResult(C4_NEG_B.input).normalizedExemption)
  .toBe('Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended');
expect(assembleResult(C4_NEG_B.input).emittedText.includes('58-1-811(A)(11)')).toBe(false);

// NEG-C: truncated legal withheld.
expect(assembleResult(C4_NEG_C.input).emitted).toBe(false);
expect(assembleResult(C4_NEG_C.input).errorCode).toBe('LEGAL_DESCRIPTION_TRUNCATED');

// NEG-D: General Warranty rejected; Special required.
expect(assembleResult(C4_NEG_D.input).errorCode).toBe('WARRANTY_MISMATCH');
expect(assembleResult(C4_NEG_D.input).emitted).toBe(false);

// Cross-cutting: every GOLDEN carries SPECIAL warranty and tenants in common, exact.
['C4_GOLDEN_1','C4_GOLDEN_2','C4_GOLDEN_3'].forEach(id => {
  expect(GOLDENS[id].expected_deed.includes('with Special Warranty of title')).toBe(true);
  expect(GOLDENS[id].expected_deed.includes('as tenants in common')).toBe(true);
  expect(GOLDENS[id].expected_deed.includes('General Warranty')).toBe(false);  // never General
  expect(GOLDENS[id].expected_deed.includes('58-1-811')).toBe(false);          // never the typo
});
```

---

## 4. PII-FREE GUARANTEE

Every LLC name, member name, address, tax I.D., file number, assessed value, instrument number, and legal description in this pack is **invented and synthetic** — it matches no real person, entity, or parcel, contains no real client PII, and was authored to replicate only the Mason house-style STRUCTURE of the grounded C4 exemplar.
