# DEED INTO TRUST — Synthetic Fixture Pack (C2)

**Category:** C2 — DEED INTO TRUST · **Firm:** The Mason Law Firm, PLC · **Drafter:** Kelly Satterwhite, Esq. VSB# 91049
**Purpose:** Test fixtures for the deterministic Mason deed assembler (DEED INTO TRUST sibling of the deed-of-gift assembler). Each GOLDEN supplies synthetic consolidated matter facts (INPUT) and the full house-style assembled deed the assembler must produce (EXPECTED). NEG fixtures verify fail-closed behavior.

**Grounding:** Structure replicated from real Mason exemplars (Exemplar-A, Exemplar-B, Exemplar-C) per `DEED_KB_CATEGORY_GROUNDING.md` §C2. **All parties, addresses, tax IDs, legal descriptions, dates, trust names, and instrument references below are INVENTED and PII-free.** Verbatim STANDARD clauses (exemption recital, granting language, trustee-powers block, §55.1-136(C) immunity note) are reproduced faithfully from the corpus.

---

## VARIANT-AXIS COVERAGE MAP

| Axis | GOLDEN-1 (HARLOW) | GOLDEN-2 (PRENDERGAST) | GOLDEN-3 (VOSS) |
| :--- | :--- | :--- | :--- |
| Marital status | married couple | married couple | divorced, not remarried |
| Trust structure | ONE joint revocable trust, both as trustees | his-and-hers DUAL trusts | one spouse as trustee (both sign) |
| Granting verb | quitclaim, release and convey | grant, bargain, sell and convey | quitclaim, release and convey |
| Exemption cite | §58.1-811(A)(12) | §58.1-811(A)(12) | §58.1-811(A)(15) AND (A)(12) |
| §55.1-136(C) TBE note | YES (Exemplar-A phrasing) | YES (Exemplar-C phrasing) | NO (omit — divorced) |
| BEING / divorce recital | NO (derivation line) | NO (derivation line) | YES (marital-separation-agreement) |
| Property | condo (unit + parking/storage LCE) | SFH | SFH |

---

## GOLDEN-1 — HARLOW (married couple → ONE joint revocable trust; condo; quitclaim/release/convey; §55.1-136(C) NOTE)

### INPUT (synthetic consolidated matter facts)

```json
{
  "category": "DEED_INTO_TRUST",
  "exemption_basis": ["58.1-811(A)(12)"],
  "title_search_performed": false,
  "preparer": { "name": "Kelly Satterwhite, Esq.", "vsb": "91049", "firm": "The Mason Law Firm, PLC" },
  "tax_id": "041.07-0C-204",
  "grantee_return_address": "2140 Carnaby Court Unit 204 Reston, VA 20191",
  "consideration": "$0.00",
  "assessed_value": "$553,200.00",
  "instrument_date": { "day": "9th", "month": "April", "year": "2026" },
  "grantors": [
    { "full": "Theodore James HARLOW" },
    { "full": "Priya Anne HARLOW" }
  ],
  "grantor_marital_status": "a married couple",
  "held_as": "tenants_by_entirety",
  "trust_structure": "single_joint_trust",
  "trustees_recital": "Theodore J. HARLOW and Priya A. HARLOW, Trustees of the THE HARLOW FAMILY REVOCABLE LIVING TRUST, dated August 14, 2021",
  "grantee_plurality": "GRANTEES",
  "granting_verb": "quitclaim, release and convey",
  "grantee_object_plurality": "GRANTEES",
  "jurisdiction_situs": "County of Fairfax Virginia",
  "legal_description": "Condominium Unit No. 204, THE CARNABY AT WIEHLE STATION Condominium, and together with the limited common elements appurtenant thereto, including limited common element parking space(s) RPT-12, and storage space RS-77, established by condominium instruments recorded on June 9, 2008, Instrument No. 080014507 (\"Declaration\"), and any supplemental declarations and/or amendments recorded subsequent thereto, among the land records of the County of Fairfax, Virginia.",
  "lce_identification_footnote": true,
  "derivation": "For derivation of title, see Deed intended to be recorded immediately prior hereto, among the aforesaid land records.",
  "tbe_immunity_note": "Exemplar-A",
  "notary_jurisdiction": { "type": "CITY", "name": "ALEXANDRIA" }
}
```

### EXPECTED (full assembled deed — exact-match target)

```
Exempt from recording tax pursuant to Sec 58.1-811(A)(12) 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No: 041.07-0C-204

Grantee Address and return to: 2140 Carnaby Court Unit 204 Reston, VA 20191
Consideration: $0.00

Assessed Value: $553,200.00
_____________________________________________________________________________

DEED INTO TRUST

THIS DEED INTO TRUST, made and entered this 9th day of April, 2026, by and between Theodore James HARLOW and Priya Anne HARLOW, a married couple, GRANTORS, and Theodore J. HARLOW and Priya A. HARLOW, Trustees of the THE HARLOW FAMILY REVOCABLE LIVING TRUST, dated August 14, 2021, GRANTEES;

W I T N E S S E T H

That, for estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the GRANTORS do hereby quitclaim, release and convey unto the GRANTEES, in fee simple, with General Warranty and English covenants of title, all of the Grantors' right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the County of Fairfax Virginia, to-wit:

Condominium Unit No. 204, THE CARNABY AT WIEHLE STATION Condominium, and together with the limited common elements appurtenant thereto, including limited common element parking space(s) RPT-12, and storage space RS-77, established by condominium instruments recorded on June 9, 2008, Instrument No. 080014507 ("Declaration"), and any supplemental declarations and/or amendments recorded subsequent thereto, among the land records of the County of Fairfax, Virginia.

*Reference to Parking Space(s) and Storage Space(s) are for identification purposes only; right to use the space(s) is subject to the terms of the governing documents, and any and all amendments thereto.

For derivation of title, see Deed intended to be recorded immediately prior hereto, among the aforesaid land records. The GRANTORS herein wish to preserve the protection from creditors afforded to property held as tenants by the entirety pursuant to Virginia Code § 55.1-136(C). After this transfer, this property shall have the same immunity from the claims of their separate creditors as it would if it had remained a tenancy by the entirety

This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.
Witness the following signatures and seals:


__________________________(seal)
Theodore James HARLOW


__________________________(seal)
Priya Anne HARLOW


COMMONWEALTH OF VIRGINIA

CITY OF ALEXANDRIA, to wit:

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Theodore James HARLOW and Priya Anne HARLOW, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this 9th day of April, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

## GOLDEN-2 — PRENDERGAST (married couple → his-and-hers DUAL trusts; SFH; grant/bargain/sell/convey; §55.1-136(C) NOTE)

### INPUT (synthetic consolidated matter facts)

```json
{
  "category": "DEED_INTO_TRUST",
  "exemption_basis": ["58.1-811(A)(12)"],
  "exemption_style": "NELSON_HEADER",
  "title_search_performed": false,
  "preparer": { "name": "Kelly Satterwhite, Esq.", "vsb": "91049", "firm": "The Mason Law Firm, PLC" },
  "file_number": "22-71845-26",
  "tax_id": "48-019-014",
  "grantee_return_address": "1118 Brentmoor Lane, Vienna, VA 22182",
  "assessed_value": "$1,247,300.00",
  "instrument_date": { "day": "_____", "month": "October", "year": "2026" },
  "grantors": [
    { "full": "Marguerite Helen PRENDERGAST" },
    { "full": "Desmond Carl PRENDERGAST" }
  ],
  "grantor_marital_status": "a married couple",
  "held_as": "tenants_by_entirety",
  "trust_structure": "dual_his_and_hers_trusts",
  "trustees_recital": "Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST, Trustees under THE MARGUERITE HELEN PRENDERGAST LIVING TRUST, dated February 3, 2026 and Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST, Trustees under THE DESMOND CARL PRENDERGAST LIVING TRUST, dated February 3, 2026",
  "granting_verb": "grant, bargain, sell and convey",
  "jurisdiction_situs": "County of Loudoun, Commonwealth of Virginia",
  "legal_description": "Lot Fourteen (14), Block C, Section Two (2), \"BRENTMOOR FARMS,\" as the same appears duly dedicated, platted and recorded in Deed Book 1486, at page 203, among the land records of Loudoun County, Virginia.",
  "derivation": "For derivation of title, see Deed intended to be recorded immediately prior hereto among the aforesaid land records.",
  "tbe_immunity_note": "Exemplar-C",
  "notary_jurisdiction": { "type": "COUNTY", "name": "_____________________________" },
  "return_block": "Universal Title\n4031 University Drive\nSuite 300\nFairfax, VA 22030\n(703) 354-2100"
}
```

### EXPECTED (full assembled deed — exact-match target)

```
EXEMPT FROM COUNTY AND STATE RECORDING TAXES PURSUANT TO VA CODE SECTION 58.1-811(A)(12)

Prepared by:Kelly Satterwhite, Esq. VSB# 91049
The Mason Law Firm, PLC

File Number:22-71845-26

Grantee's Address:1118 Brentmoor Lane, Vienna, VA 22182

Tax I.D. Number:48-019-014

Assessed Value:$1,247,300.00

PREPARED WITHOUT THE BENEFIT OF A TITLE EXAMINATION



DEED INTO TRUST

THIS DEED INTO TRUST, made this _____ day of October, 2026, by and between Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST, a married couple, (the "Grantors"), and Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST, Trustees under THE MARGUERITE HELEN PRENDERGAST LIVING TRUST, dated February 3, 2026 and Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST, Trustees under THE DESMOND CARL PRENDERGAST LIVING TRUST, dated February 3, 2026,  (the "Grantees"),

Witnesseth, that:

For estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Grantors do hereby grant, bargain, sell and convey, with General Warranty and English Covenants of title, unto the said Grantees, in fee simple, all of the following parcel of real property, with improvements thereon, located in the County of Loudoun, Commonwealth of Virginia, to wit:

Lot Fourteen (14), Block C, Section Two (2), "BRENTMOOR FARMS," as the same appears duly dedicated, platted and recorded in Deed Book 1486, at page 203, among the land records of Loudoun County, Virginia.

For derivation of title, see Deed intended to be recorded immediately prior hereto among the aforesaid land records. NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code Section 55.1-136(C).

This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.


This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.

WITNESS the following signatures and seals:



______________________________Marguerite Helen PRENDERGAST


______________________________Desmond Carl PRENDERGAST


COMMONWEALTH OF VIRGINIA
COUNTY OF___________________________The foregoing instrument was subscribed and sworn before me this _____ day of October, 2026, by Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST.______________________________Notary SignatureNotary's Registration Number: ______________My Commission Expires:


After recording return to:
Universal Title
4031 University Drive
Suite 300
Fairfax, VA 22030
(703) 354-2100
```

---

## GOLDEN-3 — VOSS (divorced, not remarried → one spouse as trustee; SFH; quitclaim/release/convey; §58.1-811(A)(15) AND (A)(12); marital-separation BEING recital; NO §55.1-136(C))

### INPUT (synthetic consolidated matter facts)

```json
{
  "category": "DEED_INTO_TRUST",
  "exemption_basis": ["58.1-811(A)(15)", "58.1-811(A)(12)"],
  "title_search_performed": false,
  "preparer": { "name": "Kelly Satterwhite, Esq.", "vsb": "91049", "firm": "The Mason Law Firm, PLC" },
  "tax_id": "0774-02-0061",
  "grantee_return_address": "4509 Tillington Court, Annandale, VA 22003",
  "consideration": "$0.00",
  "assessed_value": "$689,400.00",
  "instrument_date": { "day": "_____", "month": "July", "year": "2026" },
  "grantors": [
    { "full": "Nathaniel Oscar VOSS" },
    { "full": "Helena Marie VOSS" }
  ],
  "grantor_marital_status": "both divorced and not remarried",
  "held_as": "former_tenants_by_entirety_post_divorce",
  "trust_structure": "single_spouse_trust_both_sign",
  "trustees_recital": "Nathaniel O. VOSS, Trustee of the Nathaniel O. Voss Living Trust, dated June 18, 2026",
  "grantee_object_plurality": "GRANTEE",
  "granting_verb": "quitclaim, release and convey",
  "jurisdiction_situs": "County of Fairfax",
  "legal_description": "Lot Sixty One (61), Section Five (5), \"TILLINGTON WOODS,\" as the same appears duly dedicated, platted and recorded in Deed Book 3104, at page 88 among the Land Records of Fairfax County, Virginia.",
  "being_recital": {
    "prior_conveyance": "BEING the same property conveyed unto Nathaniel O. Voss and Helena M. Voss, a married couple, as tenants by the entirety, by Deed recorded in Deed Book 31508 at page 412 among the aforesaid land records.",
    "divorce_order": "Nathaniel O. Voss and Helena M. Voss were divorced, see Order dated April 22, 2026 recorded at the Fairfax County Circuit Court as document 2026 05912.",
    "msa": "Pursuant to the Grantors' Marital Separation Agreement, Helena Marie Voss agreed to relinquish all of her right, title and interest in and to the subject property to Nathaniel O. Voss."
  },
  "tbe_immunity_note": null,
  "notary_jurisdiction": { "type": "CITY", "name": "ALEXANDRIA" }
}
```

### EXPECTED (full assembled deed — exact-match target)

```
Exempt from recording tax pursuant to Sec 58.1-811(A) (15) and (A)(12) 1950 Code of Virginia
Prepared without benefit of title search

This Deed was prepared by: Kelly Satterwhite, Esq. VSB# 91049, The Mason Law Firm, PLC

Tax ID No: 0774-02-0061

Grantee Address and return to: 4509 Tillington Court, Annandale, VA 22003
Consideration: $0.00

Assessed Value: $689,400.00
_____________________________________________________________________________

DEED INTO TRUST

THIS DEED INTO TRUST, made and entered this _____  day of July, 2026, by and between Nathaniel Oscar VOSS and Helena Marie VOSS, both divorced and not remarried, GRANTORS, and Nathaniel O. VOSS , Trustee of the Nathaniel O. Voss Living Trust, dated June 18, 2026, GRANTEES;

W I T N E S S E T H

That, for estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the GRANTORS do hereby quitclaim, release and convey unto the GRANTEE, in fee simple, with General Warranty and English covenants of title, all of the Grantors' right, title and interest in and to the following described property, together with improvements thereon, situate, lying and being in the County of Fairfax, to-wit:

Lot Sixty One (61), Section Five (5), "TILLINGTON WOODS," as the same appears duly dedicated, platted and recorded in Deed Book 3104, at page 88 among the Land Records of Fairfax County, Virginia.

BEING the same property conveyed unto Nathaniel O. Voss and Helena M. Voss, a married couple, as tenants by the entirety, by Deed recorded in Deed Book 31508 at page 412 among the aforesaid land records. Nathaniel O. Voss and Helena M. Voss were divorced, see Order dated April 22, 2026 recorded at the Fairfax County Circuit Court as document 2026 05912.  Pursuant to the Grantors' Marital Separation Agreement, Helena Marie Voss agreed to relinquish all of her right, title and interest in and to the subject property to Nathaniel O. Voss.

This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.

This conveyance is made subject to the covenants, conditions, restrictions, easements and rights-of-way of record.

Witness the following signatures and seals:



__________________________(seal)
Nathaniel Oscar VOSS


 __________________________(seal)
Helena Marie VOSS


COMMONWEALTH OF VIRGINIA

CITY OF ALEXANDRIA, to wit:

I, the undersigned, a Notary Public for the jurisdiction aforesaid, do certify that Nathaniel Oscar VOSS and Helena Marie VOSS, who signed the aforesaid document acknowledged the same before me in my jurisdiction aforesaid, this _____ day of July, 2026.

My commission expires: ______________

____________________________
Notary Public
```

---

## NEG / POISON FIXTURES (must FAIL CLOSED — withhold + flag, never silently emit)

### NEG-1 — Truncated multi-line condo legal description

**INPUT (defect injected):** Condo legal arrives cut off mid-clause; the parking/storage limited-common-element identification and the recorded-Declaration instrument number are missing.

```json
{
  "category": "DEED_INTO_TRUST",
  "tax_id": "041.07-0C-204",
  "legal_description": "Condominium Unit No. 204, THE CARNABY AT WIEHLE STATION Condominium, and together with the limited common elements appurtenant thereto, including limited common element parking space(s)",
  "lce_identification_footnote": true
}
```

**EXPECTED fail-closed behavior:**
- **DO NOT** assemble or emit a deed.
- Flag: `LEGAL_DESCRIPTION_TRUNCATED — condo description ends mid-clause; missing storage space ID and recorded Declaration instrument number. Verbatim legal must be complete or the deed is withheld.`
- The verbatim legal is load-bearing for a condo conveyance; a truncated LCE/Declaration string is never auto-completed or guessed.
- Status: `WITHHELD`. Operator must supply the complete legal.

---

### NEG-2 — Real-corpus "Zqxborn" stray word in the notary block

**INPUT (defect injected — mirrors Exemplar-C corpus typo):** Notary acknowledgment carries a stray word before the first grantor name.

```json
{
  "category": "DEED_INTO_TRUST",
  "grantors": [
    { "full": "Marguerite Helen PRENDERGAST" },
    { "full": "Desmond Carl PRENDERGAST" }
  ],
  "notary_block_raw": "The foregoing instrument was subscribed and sworn before me this _____ day of October, 2026, by Zqxborn Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST."
}
```

**EXPECTED fail-closed behavior:**
- Flag: `STRAY_TOKEN_IN_NOTARY_BLOCK — unexpected token "Zqxborn" precedes a grantor name; does not match any grantor of record. Known real-corpus typo; assembler must NOT reproduce it.`
- The assembler must **never** emit "Zqxborn" (or any unmatched stray token) into the acknowledgment. Names in the notary block are derived from the structured `grantors` list, not from free-text passthrough.
- Status: `FLAGGED` — withhold the notary block; require the names to derive solely from the grantor list. The clean expected acknowledgment is GOLDEN-2's: `...by Marguerite Helen PRENDERGAST and Desmond Carl PRENDERGAST.`

---

### NEG-3 — Married/TBE grantors but §55.1-136(C) immunity note is MISSING

**INPUT (defect injected):** Grantors are a married couple who held as tenants by the entirety, conveying into trust, but the consolidated facts omit the §55.1-136(C) immunity note.

```json
{
  "category": "DEED_INTO_TRUST",
  "grantor_marital_status": "a married couple",
  "held_as": "tenants_by_entirety",
  "trust_structure": "single_joint_trust",
  "tbe_immunity_note": null
}
```

**EXPECTED fail-closed behavior:**
- Flag: `TBE_IMMUNITY_NOTE_REQUIRED — married grantors holding as tenants by the entirety are conveying into trust, but the §55.1-136(C) creditor-immunity note is absent. For a TBE→trust transfer this note must be present.`
- **DO NOT** emit a finished deed missing the immunity note. The note is mandatory whenever (married/TBE) AND (transfer into trust); it is only properly omitted in the divorced/single case (cf. GOLDEN-3).
- Status: `WITHHELD` pending the §55.1-136(C) note (Exemplar-A or Exemplar-C phrasing).

---

### NEG-4 — Trustee-powers clause garbled / partial

**INPUT (defect injected):** The IN TRUST trustee-powers block arrives truncated — it cuts off inside the second sentence and never reaches the no-inquiry / no-liability protective language.

```json
{
  "category": "DEED_INTO_TRUST",
  "trustee_powers_clause_raw": "This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the \"Property\"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees"
}
```

**EXPECTED fail-closed behavior:**
- Flag: `TRUSTEE_POWERS_CLAUSE_INCOMPLETE — IN TRUST powers block is truncated; missing the subdivide/dedicate/easement grant, the execute-and-deliver-instruments grant, and the no-obligation/no-inquiry protective language. The trustee-powers clause must be verbatim-complete or the deed is withheld.`
- **DO NOT** assemble with a partial powers clause. The trustee-powers block is a fixed verbatim standard clause; the assembler supplies it whole from the canonical template, and any inbound partial/garbled version is rejected — never patched or completed by inference.
- Status: `WITHHELD`. Either inject the canonical verbatim block or fail closed.

---

## EXACT-MATCH ASSERTION NOTES (toBe / toEqual — never substring)

> **OCR-B1 lesson:** assert with `toBe` / `toEqual` on the full string, never `toContain` / substring. Substring matching hid name-bleed and stray-token defects in the OCR-B1 corpus. Verbatim standard clauses are compared character-for-character (including the corpus's punctuation/spacing quirks — e.g. GOLDEN-1's immunity NOTE has **no terminal period**; GOLDEN-3 has a **double space** before the MSA sentence and a space before the comma in `Nathaniel O. VOSS ,`).

### POSITIVE assertions (each GOLDEN's assembled output)

```js
// Whole-document exact match — the strongest assertion.
expect(assemble(GOLDEN_1_INPUT)).toBe(GOLDEN_1_EXPECTED);
expect(assemble(GOLDEN_2_INPUT)).toBe(GOLDEN_2_EXPECTED);
expect(assemble(GOLDEN_3_INPUT)).toBe(GOLDEN_3_EXPECTED);

// Verbatim legal description carried through UNCHANGED (character-for-character).
expect(out.legalDescription).toBe(INPUT.legal_description);

// §58.1-811(A)(12) exemption recital, verbatim (header form per house style).
expect(out.exemptionLine).toBe(
  "Exempt from recording tax pursuant to Sec 58.1-811(A)(12) 1950 Code of Virginia"
); // GOLDEN-1
expect(out.exemptionLine).toBe(
  "EXEMPT FROM COUNTY AND STATE RECORDING TAXES PURSUANT TO VA CODE SECTION 58.1-811(A)(12)"
); // GOLDEN-2 (Exemplar-C header style)
expect(out.exemptionLine).toBe(
  "Exempt from recording tax pursuant to Sec 58.1-811(A) (15) and (A)(12) 1950 Code of Virginia"
); // GOLDEN-3 (divorce — both cites, A(15) first, with the corpus's space inside "(A) (15)")

// Title is exactly "DEED INTO TRUST" (both as banner and in the THIS DEED INTO TRUST premise).
expect(out.title).toBe("DEED INTO TRUST");

// Estate-planning consideration opener, verbatim.
expect(out.considerationOpener).toBe(
  "for estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged,"
);

// Full trustee-powers (IN TRUST) block, verbatim-complete — the single canonical standard clause.
const TRUSTEE_POWERS = `This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.`;
expect(out.trusteePowersBlock).toBe(TRUSTEE_POWERS);

// §55.1-136(C) TBE creditor-immunity note, verbatim (the two corpus phrasings).
const TBE_NOTE_Exemplar-A = `The GRANTORS herein wish to preserve the protection from creditors afforded to property held as tenants by the entirety pursuant to Virginia Code § 55.1-136(C). After this transfer, this property shall have the same immunity from the claims of their separate creditors as it would if it had remained a tenancy by the entirety`;
expect(out.tbeImmunityNote).toBe(TBE_NOTE_Exemplar-A); // GOLDEN-1 (note: NO terminal period)

const TBE_NOTE_NELSON = `NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code Section 55.1-136(C).`;
expect(out.tbeImmunityNote).toBe(TBE_NOTE_NELSON); // GOLDEN-2

// Granting verb selected per axis (exact phrase).
expect(out.grantingVerb).toBe("quitclaim, release and convey");      // GOLDEN-1, GOLDEN-3
expect(out.grantingVerb).toBe("grant, bargain, sell and convey");    // GOLDEN-2

// Grantee object plurality tracks trust/grantee count (GRANTEES vs GRANTEE).
expect(out.granteeObject).toBe("GRANTEES"); // GOLDEN-1
expect(out.granteeObject).toBe("GRANTEE");  // GOLDEN-3 (single-trustee → singular object)
```

### NEGATIVE assertions (family — fail-closed + non-reproduction)

```js
// Truncated condo legal → no deed emitted; specific flag.
expect(() => assemble(NEG_1_INPUT)).toThrow("LEGAL_DESCRIPTION_TRUNCATED");
expect(assembleSafe(NEG_1_INPUT).status).toBe("WITHHELD");

// "Zqxborn" (and any unmatched stray token) is NEVER reproduced anywhere in output.
expect(assembleSafe(NEG_2_INPUT).flags).toContain("STRAY_TOKEN_IN_NOTARY_BLOCK");
expect(assembleSafe(NEG_2_INPUT).document ?? "").not.toContain("Zqxborn");

// Married/TBE → trust with no immunity note → withheld, never silently emitted.
expect(() => assemble(NEG_3_INPUT)).toThrow("TBE_IMMUNITY_NOTE_REQUIRED");
expect(assembleSafe(NEG_3_INPUT).status).toBe("WITHHELD");

// Garbled/partial trustee-powers block → withheld; never auto-completed.
expect(() => assemble(NEG_4_INPUT)).toThrow("TRUSTEE_POWERS_CLAUSE_INCOMPLETE");
expect(assembleSafe(NEG_4_INPUT).status).toBe("WITHHELD");

// Cross-cutting non-reproduction: known real-corpus lint targets never appear in any GOLDEN output.
for (const out of [GOLDEN_1_EXPECTED, GOLDEN_2_EXPECTED, GOLDEN_3_EXPECTED]) {
  expect(out).not.toContain("Zqxborn");        // Exemplar-C stray word
  expect(out).not.toContain("58-1-811");     // C4 mis-punctuated cite
  expect(out).not.toContain("FairfaxCounty");// missing-space corpus defect
}

// Divorced/single case must NOT carry a §55.1-136(C) note.
expect(GOLDEN_3_EXPECTED).not.toContain("55.1-136(C)");
```

---

## PII-FREE GUARANTEE

All grantors, trustees, addresses, tax IDs, legal descriptions, instrument/deed-book references, trust names, dates, and dollar amounts in this pack are INVENTED and contain no real client data; only the firm's standard verbatim clauses and the public statutory citations are reproduced from the corpus.
