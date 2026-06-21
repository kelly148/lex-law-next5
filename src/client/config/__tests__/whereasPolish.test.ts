/**
 * WHEREAS-POLISH-1 Inc 1 — config flag + reconciled tokens + effect-A shader + LoginPage flag-gating.
 *
 * The flag is the build-time env VITE_UI_SHADER_POLISH_ENABLED (default OFF). The §3.1 reconciled brand
 * vec3s and the effect-A GLSL are locked here so a future re-hardcode can't silently drift, and a
 * source-audit confirms LoginPage gates effect A behind the flag (OFF → byte-for-byte its current self).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHADER_POLISH_ENABLED, SHADER_POLISH, WA } from '../shaderPolish.js';
import {
  INK_LANDING_FRAG,
  GUILLOCHE_HEADER_FRAG,
  GENERATING_SHIMMER_FRAG,
  RECORDABILITY_RING_FRAG,
} from '../../components/shader/shaders.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shaderPolish flag', () => {
  it('defaults OFF (env unset)', () => {
    expect(SHADER_POLISH_ENABLED).toBe(false);
  });
  it('is ON only for the exact string "true"', async () => {
    vi.stubEnv('VITE_UI_SHADER_POLISH_ENABLED', 'true');
    vi.resetModules();
    expect((await import('../shaderPolish.js')).SHADER_POLISH_ENABLED).toBe(true);
    for (const v of ['false', 'TRUE', '1', '']) {
      vi.stubEnv('VITE_UI_SHADER_POLISH_ENABLED', v);
      vi.resetModules();
      expect((await import('../shaderPolish.js')).SHADER_POLISH_ENABLED).toBe(false);
    }
  });
});

describe('reconciled tokens + intensities (§3.1 / §4.4)', () => {
  it('uses the reference-reconciled brand vec3s', () => {
    expect(WA.paper).toBe('vec3(0.980, 0.973, 0.949)'); // #FAF8F2
    expect(WA.surface).toBe('vec3(1.000, 0.992, 0.973)'); // #FFFDF8
    expect(WA.surface2).toBe('vec3(0.953, 0.937, 0.894)'); // #F3EFE4
    expect(WA.accent).toBe('vec3(0.431, 0.141, 0.212)'); // #6E2436
    expect(WA.success).toBe('vec3(0.180, 0.420, 0.310)'); // #2E6B4F
  });
  it('carries the operator-set intensities', () => {
    expect(SHADER_POLISH.effects.inkLanding.intensity).toBe(0.62);
    expect(SHADER_POLISH.effects.guillocheHeader.intensity).toBe(1.0);
    expect(SHADER_POLISH.effects.recordabilityRing.intensity).toBe(1.0);
    expect(SHADER_POLISH.effects.generatingShimmer.intensity).toBe(1.0);
  });
});

describe('effect A shader', () => {
  it('uses the reconciled cream/maroon (not the pre-reconciliation hardcodes) and omits the central uniforms', () => {
    expect(INK_LANDING_FRAG).toContain(WA.paper);
    expect(INK_LANDING_FRAG).toContain(WA.accent);
    // the pre-reconciliation literals must be gone:
    expect(INK_LANDING_FRAG).not.toContain('0.957,0.941,0.906');
    expect(INK_LANDING_FRAG).not.toContain('0.40,0.12,0.17');
    // the standard uniforms are declared centrally by ShaderCanvas, not in the body:
    expect(INK_LANDING_FRAG).not.toContain('uniform ');
    expect(INK_LANDING_FRAG).toContain('void main()');
  });
});

describe('effect B shader (Inc 2)', () => {
  it('uses the surface-2 base + reconciled accent, and omits the central uniforms', () => {
    expect(GUILLOCHE_HEADER_FRAG).toContain(WA.surface2);
    expect(GUILLOCHE_HEADER_FRAG).toContain(WA.accent);
    expect(GUILLOCHE_HEADER_FRAG).not.toContain('0.984,0.972,0.949'); // pre-reconciliation cream gone
    expect(GUILLOCHE_HEADER_FRAG).not.toContain('uniform ');
    expect(GUILLOCHE_HEADER_FRAG).toContain('void main()');
  });
});

describe('DeedGatePanel effect-B header (source-audit)', () => {
  const src = readFileSync(resolve(__dirname, '../../components/DeedGatePanel.tsx'), 'utf8');
  it('gates the guilloché header strip behind SHADER_POLISH_ENABLED; OFF keeps the plain title', () => {
    expect(src).toContain('SHADER_POLISH_ENABLED ?');
    expect(src).toContain('<ShaderCanvas');
    expect(src).toContain('GUILLOCHE_HEADER_FRAG');
    expect(src).toContain('deed-guilloche-header');
    expect(src).toContain("fallbackVar=\"--wa-surface-2\""); // the strip sits on surface-2 (§3.1)
    expect(src).toContain('Deed recordability'); // the title is preserved in both branches
  });
});

describe('effect G + D shaders (Inc 3)', () => {
  it('G (generating shimmer) uses the surface base + reconciled accent, central uniforms omitted', () => {
    expect(GENERATING_SHIMMER_FRAG).toContain(WA.surface);
    expect(GENERATING_SHIMMER_FRAG).toContain(WA.accent);
    expect(GENERATING_SHIMMER_FRAG).not.toContain('uniform ');
  });
  it('D (recordability ring) declares its extra u_prog/u_alert uniforms + the green terminal tip', () => {
    expect(RECORDABILITY_RING_FRAG).toContain('uniform float u_prog;');
    expect(RECORDABILITY_RING_FRAG).toContain('uniform float u_alert;');
    expect(RECORDABILITY_RING_FRAG).toContain(WA.paper);
    expect(RECORDABILITY_RING_FRAG).toContain(WA.accent);
    expect(RECORDABILITY_RING_FRAG).toContain(WA.success); // §3.2#2 green terminal tip
    expect(RECORDABILITY_RING_FRAG).not.toContain('0.957,0.941,0.906'); // pre-reconciliation cream gone
  });
});

describe('DocumentCanvas effect-G mount (source-audit)', () => {
  const src = readFileSync(resolve(__dirname, '../../components/DocumentCanvas.tsx'), 'utf8');
  it('mounts the shimmer behind the generating card only when the flag is on AND generating', () => {
    expect(src).toContain('SHADER_POLISH_ENABLED && isGenerating');
    expect(src).toContain('GENERATING_SHIMMER_FRAG');
    expect(src).toContain('fallbackVar="--wa-surface"');
  });
});

describe('DeedGatePanel effect-D ring (source-audit)', () => {
  const src = readFileSync(resolve(__dirname, '../../components/DeedGatePanel.tsx'), 'utf8');
  it('wires u_prog from the REAL gate evaluation (acceptance #8) and hardwires u_alert to 0 in v1', () => {
    expect(src).toContain('RECORDABILITY_RING_FRAG');
    // u_prog derived from the real ev.* gate verdicts, not a mock/local stepper:
    expect(src).toContain('ev.recordable ? 1.0');
    expect(src).toContain('ev.legalReview.passed ? 0.67');
    expect(src).toContain('ev.assembly.passed ? 0.34');
    expect(src).toContain('u_prog: ringProg');
    expect(src).toContain('u_alert: 0.0'); // no conflict pulse in v1 (operator-locked)
    expect(src).toContain('TODO(FOLD-INTEG follow-up): wire u_alert');
  });
});

describe('LoginPage flag-gating (source-audit)', () => {
  const src = readFileSync(resolve(__dirname, '../../pages/LoginPage.tsx'), 'utf8');
  it('gates effect A behind SHADER_POLISH_ENABLED; OFF keeps "Lex Law Next", ON renders the canvas + foil', () => {
    expect(src).toContain('SHADER_POLISH_ENABLED');
    expect(src).toContain('const polish = SHADER_POLISH_ENABLED');
    expect(src).toContain('<ShaderCanvas');
    expect(src).toContain('INK_LANDING_FRAG');
    expect(src).toContain('wa-foil-wordmark');
    expect(src).toContain("'Lex Law Next'"); // the flag-OFF wordmark is preserved
    expect(src).toContain('{polish &&'); // the canvas only mounts when on
  });
});
