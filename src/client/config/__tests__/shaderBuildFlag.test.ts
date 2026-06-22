/**
 * SHADER-BUILD-FLAG-FIX-1 — regression-lock for the shader-flag BUILD plumbing + verifiability hooks.
 *
 * WHEREAS-POLISH-1 shipped dark on prod because VITE_UI_SHADER_POLISH_ENABLED is a Vite build-time var
 * and the Docker build never received it: the builder stage declared no matching ARG, so Railway's
 * build-arg could not reach `vite build`, the flag resolved undefined, and the shader path was
 * tree-shaken out. The read site was correct; only the build plumbing was missing.
 *
 * These are source-audit assertions (no build/runtime needed). They fail loudly if the plumbing or the
 * verifiability tells regress — which is the whole point, since the failure mode is silent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
const mainTsx = readFileSync(resolve(__dirname, '../../main.tsx'), 'utf8');
const serverIndex = readFileSync(resolve(__dirname, '../../../server/index.ts'), 'utf8');
const shaderPolish = readFileSync(resolve(__dirname, '../shaderPolish.ts'), 'utf8');

describe('Dockerfile: shader flag reaches `vite build` (root-cause fix)', () => {
  it('declares ARG + ENV for VITE_UI_SHADER_POLISH_ENABLED BEFORE the vite build step', () => {
    const argIdx = dockerfile.indexOf('ARG VITE_UI_SHADER_POLISH_ENABLED');
    const envIdx = dockerfile.indexOf('ENV VITE_UI_SHADER_POLISH_ENABLED=$VITE_UI_SHADER_POLISH_ENABLED');
    // Anchor on the exact build COMMAND, not a bare "vite build" (which also appears in the comment above).
    const viteBuildCmdIdx = dockerfile.indexOf('pnpm exec vite build');

    expect(argIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(viteBuildCmdIdx).toBeGreaterThan(0);
    // The promote-to-ENV must precede the build command, or Vite cannot inline the value.
    expect(argIdx).toBeLessThan(viteBuildCmdIdx);
    expect(envIdx).toBeLessThan(viteBuildCmdIdx);
  });

  it('re-declares the ARG in the runner stage so version.json can stamp it (separate build stage)', () => {
    const argCount = dockerfile.split('ARG VITE_UI_SHADER_POLISH_ENABLED').length - 1;
    expect(argCount).toBeGreaterThanOrEqual(2); // builder stage + runner stage
  });
});

describe('Verifiability hook A: /api/version build-env tell', () => {
  it('Dockerfile bakes shaderPolishBuildFlag into version.json from the build env', () => {
    expect(dockerfile).toContain('"shaderPolishBuildFlag":"%s"');
    expect(dockerfile).toContain('"${VITE_UI_SHADER_POLISH_ENABLED}"');
  });
  it('the /api/version route types + returns shaderPolishBuildFlag', () => {
    expect(serverIndex).toContain('shaderPolishBuildFlag');
  });
});

describe('Verifiability hook B: client ground-truth console tell', () => {
  it('main.tsx imports the baked flag and logs it at startup', () => {
    expect(mainTsx).toContain("import { SHADER_POLISH_ENABLED } from './config/shaderPolish.js'");
    expect(mainTsx).toContain('console.info');
    expect(mainTsx).toContain('[shader-polish] baked enabled');
  });
});

describe('cross-lock: the build var name matches the code read site', () => {
  it('shaderPolish.ts reads import.meta.env.VITE_UI_SHADER_POLISH_ENABLED with an exact "true" compare', () => {
    // If the Dockerfile ARG name and this read ever drift apart, the flag silently goes dark again.
    expect(shaderPolish).toContain("import.meta.env.VITE_UI_SHADER_POLISH_ENABLED === 'true'");
  });
});
