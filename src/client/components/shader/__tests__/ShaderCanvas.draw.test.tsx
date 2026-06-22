// @vitest-environment jsdom
/**
 * SHADER-RENDER-BUG-1 — the WebGL DRAW path (previously untested: jsdom has no WebGL, so the existing
 * fallback test only exercised the no-context branch). The effects rendered opaque BLACK on prod because
 * WebGL auto-clears an alpha:false buffer to (0,0,0,0) → black between the throttled draws, and the buffer
 * was not preserved. This drives the harness with a MOCK WebGL context and asserts the three guarantees of
 * the fix: preserveDrawingBuffer, a non-black cream clearColor floor, and a synchronous first draw on mount.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup } from '@testing-library/react';
import ShaderCanvas, { parseCssColor } from '../ShaderCanvas.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeFakeGl(): { gl: Record<string, unknown>; calls: { clearColor: number[][]; drawArrays: number; clear: number } } {
  const calls = { clearColor: [] as number[][], drawArrays: 0, clear: 0 };
  const gl: Record<string, unknown> = {
    // GL enum constants the harness references (arbitrary distinct values).
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, COLOR_BUFFER_BIT: 8, TRIANGLE_STRIP: 9,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true, // compile OK
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true, // link OK
    useProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: (_p: unknown, name: string) => ({ name }), // truthy → uniform uploads fire
    viewport: () => {},
    clearColor: (r: number, g: number, b: number, a: number) => { calls.clearColor.push([r, g, b, a]); },
    clear: () => { calls.clear++; },
    uniform1f: () => {},
    uniform2f: () => {},
    drawArrays: () => { calls.drawArrays++; },
    deleteProgram: () => {},
    deleteBuffer: () => {},
    deleteShader: () => {},
  };
  return { gl, calls };
}

describe('ShaderCanvas draw path (mock WebGL) — SHADER-RENDER-BUG-1', () => {
  it('requests preserveDrawingBuffer, sets a non-black cream clearColor, and draws on mount', () => {
    const { gl, calls } = makeFakeGl();
    let ctxOpts: { alpha?: boolean; preserveDrawingBuffer?: boolean } | undefined;
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((type: string, opts?: unknown) => {
        if (type === 'webgl') {
          ctxOpts = opts as typeof ctxOpts;
          return gl;
        }
        return null;
      }) as typeof HTMLCanvasElement.prototype.getContext);

    render(
      <ShaderCanvas
        fragmentShader="void main(){ gl_FragColor=vec4(0.9,0.9,0.85,1.0); }"
        intensity={1.0}
        className="absolute inset-0"
        fallbackVar="--wa-surface-2"
      />,
    );

    expect(spy).toHaveBeenCalled();
    // (1) preserveDrawingBuffer — so a throttled/skipped rAF frame is NOT composited as auto-cleared black.
    expect(ctxOpts?.preserveDrawingBuffer).toBe(true);
    expect(ctxOpts?.alpha).toBe(false);
    // (2) a non-black cream clearColor floor with full opacity (default would be 0,0,0 → black).
    expect(calls.clearColor.length).toBeGreaterThan(0);
    const last = calls.clearColor[calls.clearColor.length - 1]!;
    expect(last[3]).toBe(1); // opaque
    expect((last[0] ?? 0) + (last[1] ?? 0) + (last[2] ?? 0)).toBeGreaterThan(1.5); // clearly light, not black
    // (3) at least one synchronous draw on mount — the surface paints immediately, not after the first tick.
    expect(calls.drawArrays).toBeGreaterThan(0);
  });

  it('still degrades to the hidden canvas / static fallback when WebGL is unavailable', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { getByTestId } = render(
      <ShaderCanvas fragmentShader="void main(){ gl_FragColor=vec4(1.0); }" intensity={0.62} fallbackVar="--wa-paper" />,
    );
    expect((getByTestId('shader-canvas') as HTMLElement).style.visibility).toBe('hidden');
  });
});

describe('parseCssColor — the cream-floor color resolution (the real prod path)', () => {
  const approx = (got: [number, number, number] | null, want: [number, number, number]): void => {
    expect(got).not.toBeNull();
    const g = got!;
    expect(g[0]).toBeCloseTo(want[0], 4);
    expect(g[1]).toBeCloseTo(want[1], 4);
    expect(g[2]).toBeCloseTo(want[2], 4);
  };
  it('parses 6-digit hex (a WA token value)', () => {
    approx(parseCssColor('#F3EFE4'), [243 / 255, 239 / 255, 228 / 255]); // --wa-surface-2
  });
  it('parses 3-digit shorthand hex', () => {
    approx(parseCssColor('#abc'), [0xaa / 255, 0xbb / 255, 0xcc / 255]);
  });
  it('parses rgb() and rgba() (what getComputedStyle often returns)', () => {
    approx(parseCssColor('rgb(243, 239, 228)'), [243 / 255, 239 / 255, 228 / 255]);
    approx(parseCssColor('rgba(110, 36, 54, 1)'), [110 / 255, 36 / 255, 54 / 255]);
  });
  it('returns null for empty / unrecognized input (→ the cream default fires)', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('   ')).toBeNull();
    expect(parseCssColor('not-a-color')).toBeNull();
  });
});

describe('effect D placement (source-audit) — SHADER-RENDER-BUG-1', () => {
  const src = readFileSync(resolve(__dirname, '../../DeedGatePanel.tsx'), 'utf8');
  it('left-anchors the ring beside the title (no justify-between pushing it offscreen)', () => {
    expect(src).toContain('relative z-10 flex items-center gap-2');
    expect(src).not.toContain('relative z-10 flex items-center justify-between gap-2');
    // the ring is still the real effect-D mount, wired to the live gate:
    expect(src).toContain('RECORDABILITY_RING_FRAG');
    expect(src).toContain('u_prog: ringProg');
  });
});
