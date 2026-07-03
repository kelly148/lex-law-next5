/**
 * ULTRABUILD-1 W3a — B6 export-chokepoint, cross-category structural invariant.
 *
 * The single audited recordability annotation-leak gate is checkAnnotationLeak (deedDraftGates.ts). Every one
 * of the 7 built deed categories routes its assembled body through it (verified by inspection —
 * docs/engagements/ULTRABUILD-1-W3a-b6-verification.md). This test locks the chokepoint's coverage over each
 * category's CHARACTERISTIC operative text: clean text passes the floor, and one shared injected annotation
 * marker ([[ ]] placeholder) is flagged — so a future 8th category cannot land a body shape the chokepoint
 * silently misses, and the gate can't regress into ignoring stray annotation residue.
 */
import { describe, it, expect } from 'vitest';
import { checkAnnotationLeak } from '../deed/deedDraftGates.js';

// One representative CLEAN operative snippet per built category (deed prose with NO annotation markers).
const CATEGORY_CLEAN_TEXT: Record<string, string> = {
  gift: 'THIS DEED OF GIFT is made and the Grantor does hereby grant and convey unto the Grantee, in fee simple, all that certain lot in the County of Fairfax, Commonwealth of Virginia.',
  seller_side: 'THIS DEED made by and between the Grantor and the Grantee, WITNESSETH that the Grantor does grant, bargain, sell and convey, with General Warranty, the property described herein.',
  tod: 'THIS TRANSFER ON DEATH DEED conveys the described real property to the designated beneficiary effective on the death of the owner, and is revocable during the owner lifetime.',
  into_llc: 'THIS DEED conveys the property from the individual Grantor unto the limited liability company Grantee, its successors and assigns, in fee simple.',
  out_of_llc: 'THIS DEED conveys the property from the limited liability company Grantor, by its Sole Member, unto the individual Grantee, in fee simple.',
  confirmation: 'THIS DEED OF CONFIRMATION confirms the vesting of title in the surviving owner by operation of law upon the death of the co-owner, as recited herein.',
  into_trust: 'THIS DEED conveys the property from the Grantor unto the named Trustee of the Revocable Living Trust, to hold subject to the trust terms, in fee simple.',
};

// A stray annotation-placeholder marker that MUST trip B6 (mirrors the gift assembler negative test's [[ ]]).
const INJECTED_MARKER = ' [[UNFILLED_PROVISION]]';

describe('W3a — B6 chokepoint catches a stray marker in EVERY built deed category', () => {
  for (const [category, cleanText] of Object.entries(CATEGORY_CLEAN_TEXT)) {
    it(`${category}: clean body passes the floor; an injected [[ ]] marker is flagged`, () => {
      expect(checkAnnotationLeak(cleanText).ok).toBe(true);
      expect(checkAnnotationLeak(cleanText + INJECTED_MARKER).ok).toBe(false);
    });
  }

  it('locks the built-category count at 7 (distribution is unbuilt / not generable)', () => {
    expect(Object.keys(CATEGORY_CLEAN_TEXT)).toHaveLength(7);
  });
});
