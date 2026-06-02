/**
 * FOLD-AUTH-1 Increment 2 (Fork B) — owner-access chokepoint + baseline ratchet.
 *
 * GUARD (baseline ratchet): freezes the per-file count of pre-existing inline
 * `eq(<table>.userId, ...)` owner filters. The guard FAILS CI if a file's count
 * rises above its baseline, or a new file introduces one — forcing NEW owner-scoped
 * queries to route through ownerScope() instead. Migrating an existing inline filter
 * to ownerScope() lowers that file's count; the baseline must then be lowered to
 * match (baseline only shrinks; never grows). When a file reaches 0 it is removed
 * from the baseline.
 *
 * DETECTION: a static text scan of every src/server/**\/*.ts (excluding tests and the
 * ownerScope helper) for the regex /eq\(\w+\.userId/g. That pattern is, by
 * construction, an owner filter on a userId-bearing table (the only columns named
 * `userId` are the per-row owner keys; see the schema sanity check below).
 *
 * CANNOT CATCH (no false confidence): a query that omits an owner predicate ENTIRELY;
 * dynamically-built predicates; raw SQL; ownership via joins/aliases. Those need review.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ownerScope, assertOwned } from '../db/ownerScope.js';
import { documents } from '../db/schema.js';

// src/server (the test lives in src/server/__tests__/)
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Frozen baseline of grandfathered inline owner filters (total matches per file),
// captured at FOLD-AUTH-1 Increment 2. Paths are relative to src/server, '/'-normalized.
// RATCHET RULE: this map may only SHRINK. Lower an entry (or remove it at 0) when you
// migrate that file's inline eq(table.userId,...) filters to ownerScope(); never raise it.
const BASELINE: Record<string, number> = {
  'db/queries/documents.ts': 12,
  'db/queries/jobs.ts': 10,
  'db/queries/materials.ts': 9,
  'db/queries/matters.ts': 9,
  'db/queries/phase4b.ts': 33,
  'db/queries/references.ts': 5,
  'db/queries/templates.ts': 7,
  'db/queries/userPreferences.ts': 4,
  'db/queries/versions.ts': 5,
};

const INLINE_OWNER_FILTER = /eq\(\w+\.userId/g;

// Manual recursive walk (no reliance on readdirSync {recursive:true} / Node >=18.17).
function collectTsFiles(dir: string, base: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectTsFiles(join(dir, entry.name), rel, acc);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      acc.push(rel);
    }
  }
}

function scanInlineOwnerFilters(): Record<string, number> {
  const out: Record<string, number> = {};
  const files: string[] = [];
  collectTsFiles(SERVER_ROOT, '', files);
  for (const rel of files) {
    if (rel === 'db/ownerScope.ts') continue; // the helper itself is the sanctioned site
    const src = readFileSync(join(SERVER_ROOT, rel), 'utf8');
    const n = (src.match(INLINE_OWNER_FILTER) ?? []).length;
    if (n > 0) out[rel] = n;
  }
  return out;
}

describe('FOLD-AUTH-1 Inc2 — owner-filter baseline ratchet', () => {
  it('no inline owner filter exceeds the frozen baseline (new owner-scoped queries must use ownerScope)', () => {
    const actual = scanInlineOwnerFilters();

    const offenders: string[] = [];
    for (const [file, count] of Object.entries(actual)) {
      const allowed = BASELINE[file] ?? 0;
      if (count > allowed) {
        offenders.push(
          `${file}: ${count} inline eq(table.userId,...) filters > baseline ${allowed} ` +
            `— route new owner-scoped queries through ownerScope(table.userId, userId).`,
        );
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);
  });

  it('baseline only shrinks — lower/remove a baseline entry after migrating its file to ownerScope', () => {
    const actual = scanInlineOwnerFilters();
    const stale: string[] = [];
    for (const [file, allowed] of Object.entries(BASELINE)) {
      const count = actual[file] ?? 0;
      if (count < allowed) {
        stale.push(
          `${file}: baseline ${allowed} but only ${count} inline filters remain ` +
            `— migration done; lower BASELINE['${file}'] to ${count}${count === 0 ? ' (or remove it)' : ''}.`,
        );
      }
    }
    expect(stale, stale.join('\n')).toHaveLength(0);
  });

  it('sanity: the schema defines per-row userId owner columns the pattern targets', () => {
    const schema = readFileSync(join(SERVER_ROOT, 'db/schema.ts'), 'utf8');
    expect(schema).toMatch(/userId:\s*char\('userId'/);
  });
});

describe('FOLD-AUTH-1 Inc2 — ownerScope / assertOwned helpers', () => {
  it('ownerScope returns a SQL predicate for an owner column', () => {
    const predicate = ownerScope(documents.userId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(predicate).toBeDefined();
    expect(typeof predicate).toBe('object');
  });

  it('assertOwned returns the row when owned by the user', () => {
    const row = { userId: 'u1', id: 'x' };
    expect(assertOwned(row, 'u1')).toBe(row);
  });

  it('assertOwned throws NOT_FOUND when the row is null', () => {
    expect(() => assertOwned(null, 'u1')).toThrowError(/Not found/);
  });

  it('assertOwned throws NOT_FOUND when the owner differs (no existence leak)', () => {
    expect(() => assertOwned({ userId: 'other', id: 'x' }, 'u1')).toThrowError(/Not found/);
  });
});
