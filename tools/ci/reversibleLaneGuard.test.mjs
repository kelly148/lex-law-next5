import { describe, it, expect } from 'vitest';
import { isProtectedPath, classifyChangedFiles } from './reversibleLaneGuard.mjs';

/**
 * GOV-MECH-1 Part A acceptance grid (dispatch v2). These are the "workflow-level tests" the guard's own first PR
 * MUST carry — proving the reversible-lane classifier trips on every protected surface and passes clean lanes.
 */
describe('reversible-lane-guard: reversible (clean) lanes pass', () => {
  it('docs-only diff is NOT protected', () => {
    const { isProtected, protectedHits } = classifyChangedFiles([
      'docs/STATE.md',
      'docs/engagements/FOO-1-dispatch.md',
      'COWORK_MAP.md',
    ]);
    expect(isProtected).toBe(false);
    expect(protectedHits).toEqual([]);
  });

  it('ordinary source + tests are NOT protected', () => {
    expect(isProtectedPath('src/client/pages/QuickDeedPage.tsx')).toBe(false);
    expect(isProtectedPath('src/server/procedures/deedDraftAgent.ts')).toBe(false);
    expect(isProtectedPath('src/server/db/queries/deedGate.ts')).toBe(false); // queries, NOT migrations/schema
    expect(isProtectedPath('tools/ci/reversibleLaneGuard.mjs')).toBe(false); // tools/ci is not tools/deploy
  });
});

describe('reversible-lane-guard: protected surfaces trip the guard', () => {
  it('a migration file is protected', () => {
    expect(isProtectedPath('src/server/db/migrations/0056_new_table.sql')).toBe(true);
  });
  it('schema.ts and featureFlags.ts (whole file) are protected', () => {
    expect(isProtectedPath('src/server/db/schema.ts')).toBe(true);
    expect(isProtectedPath('src/server/config/featureFlags.ts')).toBe(true); // red-team item 4: no default carve-out
  });
  it('the prod-migration runner and deploy/infra config are protected', () => {
    expect(isProtectedPath('scripts/apply-prod-migrations.mjs')).toBe(true);
    expect(isProtectedPath('railway.json')).toBe(true);
    expect(isProtectedPath('nixpacks.toml')).toBe(true);
    expect(isProtectedPath('Dockerfile')).toBe(true);
    expect(isProtectedPath('tools/deploy/smokeCore.mjs')).toBe(true);
  });
  it('.github/** is protected — the guard protects itself (red-team item 5)', () => {
    expect(isProtectedPath('.github/workflows/ci.yml')).toBe(true);
    expect(isProtectedPath('.github/workflows/new-workflow.yml')).toBe(true);
    expect(isProtectedPath('.github/dependabot.yml')).toBe(true);
  });
});

describe('reversible-lane-guard: rename / move / delete of a protected file trips it (red-team item 3)', () => {
  it('a renamed protected file (old AND new both surfaced by the diff) is protected', () => {
    // git diff --name-status -M surfaces both the old and new path for a rename; either being protected trips it.
    const renamedProtected = classifyChangedFiles(['railway.json', 'infra/railway.json']);
    expect(renamedProtected.isProtected).toBe(true);
    const movedIntoInfra = classifyChangedFiles(['src/app.ts', 'infra/app.ts']);
    expect(movedIntoInfra.isProtected).toBe(true); // the destination lands under infra/**
  });
  it('deleting a migration (path surfaced) is protected', () => {
    expect(classifyChangedFiles(['src/server/db/migrations/0055_x.sql']).isProtected).toBe(true);
  });
});

describe('reversible-lane-guard: NEW deployment/infra/hosting/env files are protected even though none exist today', () => {
  it('a new docker-compose.prod.yml-style file is protected', () => {
    expect(isProtectedPath('docker-compose.prod.yml')).toBe(true);
    expect(isProtectedPath('ops/docker-compose.production.yaml')).toBe(true); // basename match anywhere
  });
  it('new prod/production/env/hosting files are protected', () => {
    expect(isProtectedPath('config.prod.json')).toBe(true);
    expect(isProtectedPath('server/settings.production.ts')).toBe(true);
    expect(isProtectedPath('.env.production')).toBe(true);
    expect(isProtectedPath('.env')).toBe(true);
    expect(isProtectedPath('fly.toml')).toBe(true);
    expect(isProtectedPath('render.yaml')).toBe(true);
    expect(isProtectedPath('Procfile')).toBe(true);
    expect(isProtectedPath('infra/terraform/main.tf')).toBe(true);
    expect(isProtectedPath('deploy/rollout.sh')).toBe(true);
    expect(isProtectedPath('scripts/deploy/push.sh')).toBe(true);
    expect(isProtectedPath('scripts/build-prod-bundle.sh')).toBe(true); // scripts/*prod*
  });
});

describe('reversible-lane-guard: a mixed diff reports every protected hit, deduped + sorted', () => {
  it('surfaces only the protected members of a mixed change set', () => {
    const { protectedHits, isProtected } = classifyChangedFiles([
      'docs/STATE.md',
      'src/client/pages/QuickDeedPage.tsx',
      'src/server/db/migrations/0056_x.sql',
      'src/server/config/featureFlags.ts',
      'src/server/config/featureFlags.ts', // duplicate → deduped
    ]);
    expect(isProtected).toBe(true);
    expect(protectedHits).toEqual([
      'src/server/config/featureFlags.ts',
      'src/server/db/migrations/0056_x.sql',
    ]);
  });
});
