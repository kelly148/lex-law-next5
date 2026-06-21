/**
 * ShaderCanvas — WHEREAS-POLISH-1 shared WebGL harness (spec §4).
 *
 * One fullscreen-quad fragment shader per instance, driven by a SINGLE shared rAF ticker (one loop for
 * all mounted instances, not N loops). Decorative only (aria-hidden); the effect surfaces position the
 * canvas absolutely behind content.
 *
 * Fallback-first (all required, spec §4.3): the static brand-color fallback <div> is ALWAYS behind the
 * <canvas>; the canvas is simply HIDDEN (imperatively, via the ref — no React state, no setState-in-effect)
 * whenever WebGL is unavailable / context-lost / fails to compile, or under dark theme (v1, §3.3). So the
 * surface is never a blank/black canvas, and flag-OFF mounts nothing at all (the call site gates the mount).
 * prefers-reduced-motion → u_motion=0 (the field renders static). Perf guards: ~30fps throttle, pause when
 * document.hidden, pause when scrolled offscreen (IntersectionObserver), DPR capped at 1.5, ResizeObserver.
 *
 * Client-only; no server, DB, or egress.
 */
import React from 'react';

export interface ShaderCanvasProps {
  /** GLSL ES 1.0 fragment-shader BODY. The component prepends `precision highp float;` and declares the
   *  standard uniforms (u_res, u_time, u_intensity, u_motion, u_mouse) — do not redeclare them. */
  fragmentShader: string;
  /** 0..1 base intensity → u_intensity. */
  intensity: number;
  /** Extra dynamic uniforms beyond the standard set. number → uniform1f; [x,y] → uniform2f. Re-uploaded
   *  each frame. Used by D for { u_prog, u_alert }. */
  uniforms?: Record<string, number | [number, number]>;
  /** 'mouse' enables the eased u_mouse uniform (A only). */
  interactive?: 'mouse' | false;
  /** Forwarded to the wrapper (the effect surface positions it). */
  className?: string;
  /** CSS custom-property name for the static fallback fill (the surface this sits on). Default --wa-paper. */
  fallbackVar?: string;
}

// ── shared rAF ticker (one loop for every mounted instance) ───────────────────────────────────────────
type Ticker = (now: number) => void;
const _tickers = new Set<Ticker>();
let _rafId: number | null = null;
let _lastFrame = 0;
function _loop(now: number): void {
  _rafId = requestAnimationFrame(_loop);
  if (now - _lastFrame < 33) return; // ~30fps throttle
  _lastFrame = now;
  if (typeof document !== 'undefined' && document.hidden) return; // pause when the tab is hidden
  for (const t of _tickers) t(now);
}
function addTicker(t: Ticker): void {
  _tickers.add(t);
  if (_rafId === null && typeof requestAnimationFrame !== 'undefined') _rafId = requestAnimationFrame(_loop);
}
function removeTicker(t: Ticker): void {
  _tickers.delete(t);
  if (_tickers.size === 0 && _rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────
/** Matches the CSS dark rule: explicit [data-theme="dark"], OR (not explicit-light AND OS prefers dark). */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

const VERTEX_SRC = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const STD_UNIFORMS =
  'uniform vec2 u_res; uniform float u_time; uniform float u_intensity; uniform float u_motion; uniform vec2 u_mouse;';

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function ShaderCanvas({
  fragmentShader,
  intensity,
  uniforms,
  interactive = false,
  className,
  fallbackVar = '--wa-paper',
}: ShaderCanvasProps): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const uniformsRef = React.useRef(uniforms);
  // Bump-counters that observer / event callbacks raise so the WebGL effect re-runs (full re-setup):
  // themeTick on a mid-session light↔dark toggle; restoreTick on a webglcontextrestored (the prior GL
  // program/buffer are invalid after a real context loss, so the effect must rebuild them). setState lives
  // in callbacks, never in an effect body.
  const [themeTick, setThemeTick] = React.useState(0);
  const [restoreTick, setRestoreTick] = React.useState(0);

  // keep the latest extra-uniforms reachable from the render loop without re-running the WebGL effect
  React.useEffect(() => {
    uniformsRef.current = uniforms;
  });

  // theme observers: bump themeTick when data-theme or the OS color-scheme changes
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const bump = (): void => setThemeTick((n) => n + 1);
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mql?.addEventListener('change', bump);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(bump) : null;
    if (mo && typeof document !== 'undefined') {
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
      mql?.removeEventListener('change', bump);
      mo?.disconnect();
    };
  }, []);

  // WebGL setup + the per-instance render registration. Re-runs on shader/intensity/interactive/theme change.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const showCanvas = (on: boolean): void => {
      canvas.style.visibility = on ? 'visible' : 'hidden'; // hidden → the static fallback div shows through
    };

    if (isDarkTheme()) {
      showCanvas(false); // dark theme → static fallback (v1, §3.3)
      return;
    }

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: true }) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) {
      showCanvas(false); // no WebGL (jsdom / unsupported) → static fallback
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, `precision highp float;\n${STD_UNIFORMS}\n${fragmentShader}`);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      gl.deleteShader(vs); // null-safe no-ops; release any survivor of a partial compile
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      showCanvas(false); // compile failure → static fallback
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(program);
      showCanvas(false); // link failure → static fallback
      return;
    }
    gl.useProgram(program);
    showCanvas(true);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pLoc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

    const loc = {
      res: gl.getUniformLocation(program, 'u_res'),
      time: gl.getUniformLocation(program, 'u_time'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      motion: gl.getUniformLocation(program, 'u_motion'),
      mouse: gl.getUniformLocation(program, 'u_mouse'),
    };

    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    const motion = prefersReducedMotion() ? 0 : 1;
    let visible = true;
    let contextLost = false;
    const mouse: [number, number] = [0.5, 0.5];
    const mouseTarget: [number, number] = [0.5, 0.5];

    const resize = (): void => {
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const render = (now: number): void => {
      if (!visible || contextLost) return;
      mouse[0] += (mouseTarget[0] - mouse[0]) * 0.08; // ease u_mouse toward the pointer
      mouse[1] += (mouseTarget[1] - mouse[1]) * 0.08;
      const t = (now - start) / 1000;
      if (loc.res) gl.uniform2f(loc.res, canvas.width, canvas.height);
      if (loc.time) gl.uniform1f(loc.time, t);
      if (loc.intensity) gl.uniform1f(loc.intensity, intensity);
      if (loc.motion) gl.uniform1f(loc.motion, motion);
      if (loc.mouse) gl.uniform2f(loc.mouse, mouse[0], mouse[1]);
      const extra = uniformsRef.current;
      if (extra) {
        for (const key of Object.keys(extra)) {
          const ul = gl.getUniformLocation(program, key);
          if (!ul) continue;
          const v = extra[key]!;
          if (Array.isArray(v)) gl.uniform2f(ul, v[0], v[1]);
          else gl.uniform1f(ul, v);
        }
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    addTicker(render);

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
          })
        : null;
    io?.observe(canvas);

    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      mouseTarget[0] = (e.clientX - r.left) / r.width;
      mouseTarget[1] = 1 - (e.clientY - r.top) / r.height; // y-up
    };
    if (interactive === 'mouse' && typeof window !== 'undefined') {
      window.addEventListener('pointermove', onMove, { passive: true });
    }

    const onLost = (e: Event): void => {
      e.preventDefault();
      contextLost = true;
      showCanvas(false); // → static fallback while lost
    };
    const onRestored = (): void => {
      // The lost context's program/buffer are gone — re-run the whole effect to rebuild on the fresh context.
      setRestoreTick((n) => n + 1);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      removeTicker(render);
      ro?.disconnect();
      io?.disconnect();
      if (interactive === 'mouse' && typeof window !== 'undefined') window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
    };
  }, [fragmentShader, intensity, interactive, themeTick, restoreTick]);

  return (
    <div data-testid="shader-mount" aria-hidden="true" className={className}>
      <div
        data-testid="shader-fallback"
        style={{ position: 'absolute', inset: 0, background: `var(${fallbackVar})` }}
      />
      <canvas
        ref={canvasRef}
        data-testid="shader-canvas"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: `var(${fallbackVar})` }}
      />
    </div>
  );
}
