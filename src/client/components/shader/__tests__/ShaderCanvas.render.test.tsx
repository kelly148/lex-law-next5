// @vitest-environment jsdom
/**
 * ShaderCanvas — fallback-first harness (WHEREAS-POLISH-1 §4.3). jsdom has no WebGL, so a mount degrades
 * to the static CSS fallback (never a blank/black canvas), which is exactly the no-WebGL acceptance path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ShaderCanvas from '../ShaderCanvas.js';

afterEach(() => cleanup());

describe('ShaderCanvas — degrades to the static fallback when WebGL is unavailable (jsdom)', () => {
  it('renders the static fallback behind the canvas, decorative + with the surface background; hides the canvas with no WebGL', () => {
    const { getByTestId } = render(
      <ShaderCanvas fragmentShader="void main(){ gl_FragColor=vec4(1.0); }" intensity={0.62} className="absolute inset-0" fallbackVar="--wa-paper" />
    );
    const mount = getByTestId('shader-mount');
    expect(mount.getAttribute('aria-hidden')).toBe('true');
    expect(mount.className).toContain('absolute inset-0');
    // The static fallback div is always present, flat brand-color — never blank/black.
    const fallback = getByTestId('shader-fallback') as HTMLElement;
    expect(fallback.tagName).toBe('DIV');
    expect(fallback.style.background).toContain('--wa-paper');
    // The canvas exists but, after the effect probes WebGL (null in jsdom), is hidden so the fallback shows.
    const canvas = getByTestId('shader-canvas') as HTMLElement;
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.style.visibility).toBe('hidden');
  });

  it('does not throw on mount/unmount with extra uniforms (D-style) or interactive mouse', () => {
    expect(() =>
      render(
        <ShaderCanvas
          fragmentShader="void main(){ gl_FragColor=vec4(u_prog); }"
          intensity={1.0}
          uniforms={{ u_prog: 0.5, u_alert: 0 }}
          interactive="mouse"
          className="x"
        />
      )
    ).not.toThrow();
  });
});
