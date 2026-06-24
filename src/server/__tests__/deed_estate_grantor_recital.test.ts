/**
 * deed_estate_grantor_recital.test.ts — DEED-DRAFT-AGENT-1 module B2: estate-source grantor-recital INPUT
 * CONTRACT acceptance bar. Grounded on docs/deed/DEED_KB_SEED__B2_grantor-recital-input-contract.md (§2 worked
 * example + §3 the one surviving guardrail, inverted fail-closed). NO B2 GOLD/fixture pack exists, so these cases
 * are CONSTRUCTED (non-circular) — they do not read a pack; they assert the contract directly.
 *
 * Contract under test:
 *  - Mode A (PRIMARY) places the dictated clause BYTE-IDENTICAL into recital.text (no rewording / normalization /
 *    cleanup); per-deed dictationScope is carried through.
 *  - Mode B (FALLBACK) assembles from the four supplied fields ONLY, with the "assembled — attorney must approve"
 *    advisory; it never infers a missing field.
 *  - GATE B2 fail-closed: absence/partial input or an unknown mode → WITHHELD, no recital. The engine never
 *    fabricates a signer, capacity, or authority.
 *  - PURE/deterministic: same input twice → identical output.
 *
 * Synthetic data only (PII-free).
 */

import { describe, it, expect } from 'vitest';
import {
  buildEstateGrantorRecital,
  type EstateGrantorModeAInput,
  type EstateGrantorModeBInput,
  type EstateGrantorRecitalInput,
} from '../deed/deedEstateGrantorRecital.js';

// ── Mode-A fixtures (the spec §2 worked example, synthetic) ─────────────────────────────────────────────

const GOLD_CLAUSE =
  'John Q. Smith, Executor of the Estate of Jane A. Smith, deceased, under the power of sale granted in ' +
  'Article IV of her will admitted to probate in the Circuit Court of Fairfax County on March 3, 2026, ' +
  'Will Book 412, Page 88.';

function modeA(
  dictatedClause: string,
  dictationScope: EstateGrantorModeAInput['dictationScope'],
): EstateGrantorModeAInput {
  return { mode: 'A', dictatedClause, dictationScope };
}

// ── Mode-B fixtures (the spec §2 Mode-B table, synthetic) ───────────────────────────────────────────────

function modeBFields(): EstateGrantorModeBInput['fields'] {
  return {
    signerNames: 'John Q. Smith',
    capacity: 'Executor of the Estate of Jane A. Smith, deceased',
    authorityBasis: 'power of sale granted in Article IV of her will',
    probateReference: 'Circuit Court of Fairfax County, Will Book 412, Page 88',
  };
}

function modeB(fields: EstateGrantorModeBInput['fields']): EstateGrantorModeBInput {
  return { mode: 'B', fields };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B2 — Mode A (PRIMARY): verbatim placement', () => {
  it('grantor_recital scope: verbatim in = recital.text out (byte-identical); scope + placement tagged', () => {
    const r = buildEstateGrantorRecital(modeA(GOLD_CLAUSE, 'grantor_recital'));
    expect(r.status).toBe('OK');
    expect(r.flags).toEqual([]);
    expect(r.recital).toBeDefined();
    expect(r.recital!.mode).toBe('A');
    expect(r.recital!.scope).toBe('grantor_recital');
    // byte-identical
    expect(r.recital!.text).toBe(GOLD_CLAUSE);
    // grantor-recital-only → caller still owns the surrounding granting language
    expect(r.recital!.placement).toBe('grantor_block');
    // no Mode-B advisory on a dictated clause
    expect(r.advisories).toEqual([]);
  });

  it('full_granting_clause scope: verbatim in = out; placement is the whole granting clause', () => {
    const r = buildEstateGrantorRecital(modeA(GOLD_CLAUSE, 'full_granting_clause'));
    expect(r.status).toBe('OK');
    expect(r.recital!.scope).toBe('full_granting_clause');
    expect(r.recital!.text).toBe(GOLD_CLAUSE);
    expect(r.recital!.placement).toBe('granting_clause');
  });

  // messy fixture: double spaces, odd caps, trailing/odd punctuation, internal line breaks, AND Unicode that NFC/
  // NFKC normalization would alter — a curly apostrophe (U+2019), an em dash (U+2014), and a non-breaking space
  // (U+00A0). Leading AND trailing whitespace lock outer-whitespace preservation on both ends.
  const MESSY_CLAUSE =
    '   john Q.  SMITH ’s ,  exECUTOR  of the  estate of  jane a. smith ,, deceased — under the\n' +
    'POWER  of   sale ( Article  IV )   ;;  Will Book   412 , Page   88 ...   ';

  // Parameterized over BOTH scopes so any future coupling of `placement` to `text` would break byte-identity here.
  for (const scope of ['grantor_recital', 'full_granting_clause'] as const) {
    it(`NO-NORMALIZATION (${scope}): messy+Unicode clause is byte-identical out (no cleanup, no NFC/NFKC)`, () => {
      const r = buildEstateGrantorRecital(modeA(MESSY_CLAUSE, scope));
      expect(r.status).toBe('OK');
      // the engine did NOT clean it: byte-for-byte identical, including outer whitespace and odd punctuation
      expect(r.recital!.text).toBe(MESSY_CLAUSE);
      // prove specific "cleanups" did NOT happen
      expect(r.recital!.text).toContain('  '); // double spaces preserved
      expect(r.recital!.text).toContain('\n'); // internal line break preserved
      expect(r.recital!.text.startsWith('   ')).toBe(true); // LEADING whitespace NOT trimmed
      expect(r.recital!.text.endsWith('   ')).toBe(true); // trailing whitespace NOT trimmed
      expect(r.recital!.text).toContain(',,'); // doubled comma preserved
      // Unicode preserved verbatim — no NFC/NFKC normalization
      expect(r.recital!.text).toContain('’'); // curly apostrophe
      expect(r.recital!.text).toContain('—'); // em dash
      expect(r.recital!.text).toContain(' '); // non-breaking space (NFKC would fold to a normal space)
      expect(r.recital!.text.length).toBe(MESSY_CLAUSE.length); // exact UTF-16 length — nothing added/removed
      expect([...r.recital!.text].length).toBe([...MESSY_CLAUSE].length); // exact codepoint length
    });
  }

  it('fail-closed: blank clause → WITHHELD + ESTATE_GRANTOR_CLAUSE_REQUIRED, no recital', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const r = buildEstateGrantorRecital(modeA(blank, 'grantor_recital'));
      expect(r.status).toBe('WITHHELD');
      expect(r.flags).toContain('ESTATE_GRANTOR_CLAUSE_REQUIRED');
      expect(r.recital).toBeUndefined();
    }
  });

  it('fail-closed: clause containing an unresolved [[ ]] placeholder → WITHHELD, no recital', () => {
    const r = buildEstateGrantorRecital(
      modeA('John Q. Smith, [[ MISSING capacity ]], under the power of sale.', 'grantor_recital'),
    );
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ESTATE_GRANTOR_CLAUSE_REQUIRED');
    expect(r.recital).toBeUndefined();
  });

  it('fail-closed (no throw): a non-string dictatedClause (numeric/garbage runtime payload) → WITHHELD', () => {
    // A loosely-typed runtime payload must fail closed, NOT raise a TypeError (the "never throws" contract).
    for (const bad of [123, null, undefined, {}, [], true]) {
      const input = { mode: 'A', dictatedClause: bad, dictationScope: 'grantor_recital' };
      let r: ReturnType<typeof buildEstateGrantorRecital>;
      expect(() => {
        r = buildEstateGrantorRecital(input as unknown as EstateGrantorRecitalInput);
      }).not.toThrow();
      expect(r!.status).toBe('WITHHELD');
      expect(r!.flags).toContain('ESTATE_GRANTOR_CLAUSE_REQUIRED');
      expect(r!.recital).toBeUndefined();
    }
  });

  it('fail-closed: invalid / blank dictationScope → WITHHELD + ESTATE_DICTATION_SCOPE_INVALID, no recital', () => {
    const bad = ['', '   ', 'whole_thing', 'GRANTOR_RECITAL', 'full', undefined as unknown as string];
    for (const scope of bad) {
      const r = buildEstateGrantorRecital(
        modeA(GOLD_CLAUSE, scope as EstateGrantorModeAInput['dictationScope']),
      );
      expect(r.status).toBe('WITHHELD');
      expect(r.flags).toContain('ESTATE_DICTATION_SCOPE_INVALID');
      expect(r.recital).toBeUndefined();
    }
  });

  it('fail-closed: both a blank clause AND an invalid scope flag BOTH gates, no recital', () => {
    const r = buildEstateGrantorRecital(
      modeA('', 'nonsense' as EstateGrantorModeAInput['dictationScope']),
    );
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ESTATE_GRANTOR_CLAUSE_REQUIRED');
    expect(r.flags).toContain('ESTATE_DICTATION_SCOPE_INVALID');
    expect(r.recital).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B2 — Mode B (FALLBACK): structured-facts assembly', () => {
  it('complete fields → OK; deterministic assembled recital.text + the "assembled — attorney must approve" advisory', () => {
    const r = buildEstateGrantorRecital(modeB(modeBFields()));
    expect(r.status).toBe('OK');
    expect(r.flags).toEqual([]);
    expect(r.recital).toBeDefined();
    expect(r.recital!.mode).toBe('B');
    // an assembled recital is the grantor-identification recital only
    expect(r.recital!.scope).toBe('grantor_recital');
    expect(r.recital!.placement).toBe('grantor_block');
    // exact deterministic assembly (spec §2 connect-the-dots order)
    expect(r.recital!.text).toBe(
      'John Q. Smith, Executor of the Estate of Jane A. Smith, deceased, under the power of sale granted in ' +
        'Article IV of her will, Circuit Court of Fairfax County, Will Book 412, Page 88.',
    );
    // the mandatory approval advisory is present
    expect(r.advisories).toContain('assembled — attorney must approve recital text before send.');
  });

  it('assembled text contains every supplied field and invents nothing beyond the template connectors', () => {
    const r = buildEstateGrantorRecital(modeB(modeBFields()));
    const text = r.recital!.text;
    const f = modeBFields();
    expect(text).toContain(f.signerNames);
    expect(text).toContain(f.capacity);
    expect(text).toContain(f.authorityBasis);
    expect(text).toContain(f.probateReference);
  });

  // one test per missing field — proves no field is inferred
  for (const field of ['signerNames', 'capacity', 'authorityBasis', 'probateReference'] as const) {
    it(`fail-closed: blank ${field} → WITHHELD + ESTATE_GRANTOR_FIELDS_INCOMPLETE, no recital`, () => {
      const fields = { ...modeBFields(), [field]: '' };
      const r = buildEstateGrantorRecital(modeB(fields));
      expect(r.status).toBe('WITHHELD');
      expect(r.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
      expect(r.recital).toBeUndefined();
      // the missing field is enumerated (surface which fact is absent) but never invented
      expect(r.advisories.join(' ')).toContain(field);
    });

    it(`fail-closed: [[ ]] placeholder in ${field} → WITHHELD (a placeholder is not a fact)`, () => {
      const fields = { ...modeBFields(), [field]: '[[ MISSING ]]' };
      const r = buildEstateGrantorRecital(modeB(fields));
      expect(r.status).toBe('WITHHELD');
      expect(r.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
      expect(r.recital).toBeUndefined();
    });
  }

  it('NO-INFERENCE: a missing capacity is NOT back-filled from signerNames (WITHHELD, not a guessed capacity)', () => {
    const fields = { ...modeBFields(), capacity: '' };
    const r = buildEstateGrantorRecital(modeB(fields));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
    expect(r.recital).toBeUndefined();
    // explicitly: nothing assembled, no derived capacity smuggled into an advisory
    expect(r.advisories.join(' ')).not.toContain('Executor');
  });

  it('fail-closed: multiple missing fields are all enumerated; still no recital', () => {
    const fields = { ...modeBFields(), capacity: '', probateReference: '   ' };
    const r = buildEstateGrantorRecital(modeB(fields));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
    expect(r.advisories.join(' ')).toContain('capacity');
    expect(r.advisories.join(' ')).toContain('probateReference');
    expect(r.recital).toBeUndefined();
  });

  it('fail-closed: an entirely missing fields object → WITHHELD, no crash', () => {
    const r = buildEstateGrantorRecital({ mode: 'B' } as EstateGrantorModeBInput);
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
    expect(r.recital).toBeUndefined();
  });

  it('fail-closed (no throw): a non-string field (numeric/garbage runtime payload) → WITHHELD', () => {
    // The isBlank hardening must treat any non-string field as blank rather than calling .trim() on it (which
    // would TypeError). A numeric field fails closed to WITHHELD, not a crash.
    for (const field of ['signerNames', 'capacity', 'authorityBasis', 'probateReference'] as const) {
      const fields = { ...modeBFields(), [field]: 123 };
      let r: ReturnType<typeof buildEstateGrantorRecital>;
      expect(() => {
        r = buildEstateGrantorRecital({ mode: 'B', fields } as unknown as EstateGrantorRecitalInput);
      }).not.toThrow();
      expect(r!.status).toBe('WITHHELD');
      expect(r!.flags).toContain('ESTATE_GRANTOR_FIELDS_INCOMPLETE');
      expect(r!.recital).toBeUndefined();
    }
  });

  it('OUTER-TRIM contract: field values are outer-trimmed for joining; interior content preserved exactly', () => {
    const fields = {
      signerNames: '  John Q. Smith  ',
      capacity: '\tExecutor of the  Estate of Jane A. Smith, deceased \n',
      authorityBasis: '  power of sale granted in Article  IV of her will  ',
      probateReference: '  Circuit Court of Fairfax County, Will Book 412, Page 88  ',
    };
    const r = buildEstateGrantorRecital(modeB(fields));
    expect(r.status).toBe('OK');
    // outer whitespace removed at each join seam; the double space INSIDE "Estate of  Jane"/"Article  IV" survives
    expect(r.recital!.text).toBe(
      'John Q. Smith, Executor of the  Estate of Jane A. Smith, deceased, under the ' +
        'power of sale granted in Article  IV of her will, Circuit Court of Fairfax County, Will Book 412, Page 88.',
    );
    // explicit: no leading/trailing padding leaked from a field; interior double space preserved
    expect(r.recital!.text.startsWith('John Q. Smith,')).toBe(true);
    expect(r.recital!.text).toContain('the  Estate'); // interior double space (capacity) NOT collapsed
    expect(r.recital!.text).toContain('Article  IV'); // interior double space (authorityBasis) NOT collapsed
    expect(r.recital!.text).not.toContain('  John Q. Smith'); // signerNames outer-trimmed
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B2 — unknown / absent mode', () => {
  it('unknown mode (not A or B) → WITHHELD + UNKNOWN_INPUT_MODE, no recital', () => {
    const r = buildEstateGrantorRecital({ mode: 'C' } as unknown as EstateGrantorRecitalInput);
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNKNOWN_INPUT_MODE');
    expect(r.recital).toBeUndefined();
  });

  it('absent mode → WITHHELD + UNKNOWN_INPUT_MODE, no crash', () => {
    for (const bad of [{}, null, undefined, { mode: '' }, { mode: 123 }]) {
      const r = buildEstateGrantorRecital(bad as unknown as EstateGrantorRecitalInput);
      expect(r.status).toBe('WITHHELD');
      expect(r.flags).toContain('UNKNOWN_INPUT_MODE');
      expect(r.recital).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B2 — purity / determinism', () => {
  it('Mode A: same input twice → identical output', () => {
    const input = modeA(GOLD_CLAUSE, 'full_granting_clause');
    const a = buildEstateGrantorRecital(input);
    const b = buildEstateGrantorRecital(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('Mode B: same input twice → identical output', () => {
    const input = modeB(modeBFields());
    const a = buildEstateGrantorRecital(input);
    const b = buildEstateGrantorRecital(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('WITHHELD path: same partial input twice → identical output', () => {
    const input = modeB({ ...modeBFields(), authorityBasis: '' });
    const a = buildEstateGrantorRecital(input);
    const b = buildEstateGrantorRecital(input);
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const input = modeB(modeBFields());
    const snapshot = JSON.stringify(input);
    buildEstateGrantorRecital(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
