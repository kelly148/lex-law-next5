# Dependency Debt Register

This file tracks deferred dependency upgrades and technical debt items that must be resolved
before or during Phase 7 handoff. Each entry includes the rationale for deferral and the
upgrade path.

---

## DD-001 — drizzle-orm generatedAlwaysAs() API

**Deferred from:** Phase 4b (D.1.2 resolution)
**Target resolution:** Future cleanup (post-Phase 7)

Upgrade drizzle-orm to 0.32+ and migrate raw-SQL generated columns (`activeMatterKey`,
`activeSessionKey`) to native `generatedAlwaysAs()` builder API. Deferred from Phase 4b per
D.1.2 resolution — upgrade mid-build carries cascade risk across four merged phases
disproportionate to the compile-time gap being closed.

**Compensating controls in place (Phase 4b):**

1. Raw SQL migration uses MySQL/TiDB-compatible `GENERATED ALWAYS AS (...) STORED` syntax.
2. `schema.ts` column declarations carry explicit DO-NOT-WRITE comment blocks referencing R10,
   Ch 4.10, and Ch 4.8.
3. The Zod Wall treats these columns as read-only (no write path in any procedure).
4. Regression tests assert that any INSERT or UPDATE supplying an explicit value for either
   generated column is rejected by the database engine.
5. This file is included in the Phase 7 Known-Issue List (HANDOFF.md).

**Upgrade path:**

```bash
pnpm add drizzle-orm@^0.32
# Replace activeMatterKey and activeSessionKey declarations in schema.ts
# with .generatedAlwaysAs(sql`...`, { mode: 'stored' })
# Drop the raw-SQL ADD COLUMN / ADD INDEX statements from the migration
# Run: pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

---
