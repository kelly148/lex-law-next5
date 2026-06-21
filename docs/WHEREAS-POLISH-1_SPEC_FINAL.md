# WHEREAS-POLISH-1 — Implementation Spec (FINAL, CLI handoff)

**Subtle GLSL/WebGL UI polish for the Whereas app**
Status: **ready for CLI implementation** · Author: Cowork lane · Date: 2026-06-21
Tokens reconciled against `docs/brand/whereas-reference-mockup.html` (reference wins) — see §3.

---

## 0. CLI handoff header

- **Repo:** `kelly148/lex-law-next5`. **Prod:** `https://lex-law-next-app-production.up.railway.app`.
- **Scope:** client-only, confined to `src/client/`. No server, DB, migration, or data-egress surface.
- **FIRE determination: NOT a FIRE.** No access-control, ethics, send-safety, or data-destruction surface. Standard reversible build-and-PR; auto-merge on green CI; deploy operator-gated.
- **Flag:** `UI_SHADER_POLISH_ENABLED`, **default OFF** — ships dark.
- **Lanes:** CLI is sole committer. Cowork verifies before merge and signs off on green (§9). Cowork never commits.
- **Increments:** three, each independently shippable behind the flag (§7).
- **Operator-locked decisions (do not re-ask):** D alert = **red** (§3.2 #1 keep); D terminal "recordable" = **small green tip** at u_prog≈1.0 (§3.2 #2); dark theme = **static CSS fallback, no canvas** in v1 (§3.3).
- **Pre-build action items the CLI must do first:** (a) apply the reconciled token constants in §3.1; (b) implement the dark-theme static-fallback arm per §3.3; (c) use **Fraunces** for the A wordmark (§5.A).

---

## 1. Summary

Add four subtle WebGL shader effects to the Whereas (Lex Law Next) client so the UI reads as materially more refined — "felt, not noticed." Client-only, reversible, flag-gated, no server/DB/migration/egress surface.

| ID | Effect | Where it mounts | Default intensity |
| :-- | :-- | :-- | :-- |
| A | Flowing-ink landing + foil wordmark | login / landing hero | **0.62** |
| B | Guilloché deed header | deed/certificate section headers, finalize/recorded views | **1.00** |
| D | State-reactive recordability ring | accent **beside** the recordability panel (never behind it) | **1.00** |
| G | Generating shimmer | the 60–90s draft/review generating state | **1.00** |

Intensity defaults are operator-set and live in one config module (`shaderPolish.ts`); they are the only knob product retunes later.

---

## 2. Operating model (unchanged)

- Cowork lane writes this spec, supplies the GLSL, and **verifies**. It never commits.
- The Code/Ultracode CLI is the **sole committer**. Reversible build-and-PR; auto-merge on green CI; deploy is operator-gated; flag defaults OFF so it can ship dark.
- All changes confined to `src/client/`.

---

## 3. Brand tokens — RECONCILED (reference wins)

Source of truth: `docs/brand/whereas-reference-mockup.html`, `:root` light-default block (lines 11–19). The spec's original §3 table contained four mismatches; the reconciled values below are authoritative. vec3 = sRGB component / 255, rounded to 3 places.

| Role | Reference token | Hex (light) | vec3 | vs. original spec |
| :-- | :-- | :-- | :-- | :-- |
| Page background ("paper") | `--wa-paper` | `#FAF8F2` | `vec3(0.980, 0.973, 0.949)` | **CHANGED** from `#F4F0E7` / `vec3(0.957,0.941,0.906)` |
| Card surface | `--wa-surface` | `#FFFDF8` | `vec3(1.000, 0.992, 0.973)` | **CHANGED** from `#FBF8F2` (card cream) |
| Secondary surface (header strips) | `--wa-surface-2` | `#F3EFE4` | `vec3(0.953, 0.937, 0.894)` | new — B header strips sit on this |
| Accent (maroon) | `--wa-accent` | `#6E2436` | `vec3(0.431, 0.141, 0.212)` | **CHANGED** from `#6E2230` / `vec3(0.43,0.13,0.19)` |
| Accent tint | `--wa-accent-tint` | `#EFE3E6` | `vec3(0.937, 0.890, 0.902)` | new |
| Success (green) | `--wa-success` | `#2E6B4F` | `vec3(0.180, 0.420, 0.310)` | new — used for D terminal green tip (§3.2 #2) |
| Warning (amber) | `--wa-warning` | `#9A6B1F` | `vec3(0.604, 0.420, 0.122)` | new — D alert stays red, not amber (§3.2 #1) |
| Ink text | `--wa-ink` | `#17191C` | `vec3(0.090, 0.098, 0.110)` | **CHANGED** from `#2A2420` |
| Muted rose | *(no brand token)* | `#C2999C` | `vec3(0.76, 0.60, 0.61)` | **effect-local only** — keep, but it is NOT from the brand sheet |

### 3.1 Reconciled shader constants — apply these (patch list)

The original GLSL in §5 hardcodes the old cream/card/maroon. Replace the named constants as follows. Effect-tuned maroon variants stay tuned, but re-anchor to the corrected accent.

- **A (ink landing):** `cream` `vec3(0.957,0.941,0.906)` → `vec3(0.980,0.973,0.949)`; `maroon` `vec3(0.40,0.12,0.17)` → `vec3(0.431,0.141,0.212)`.
- **B (guilloché header):** base `cream` `vec3(0.984,0.972,0.949)` → **surface-2** `vec3(0.953,0.937,0.894)` (header strips sit on `--wa-surface-2`); `maroon` `vec3(0.43,0.16,0.21)` → `vec3(0.431,0.141,0.212)`.
- **D (recordability ring):** `cream` `vec3(0.957,0.941,0.906)` → `vec3(0.980,0.973,0.949)`; `warm` `vec3(0.43,0.16,0.21)` → `vec3(0.431,0.141,0.212)`; `calm` (`vec3(0.76,0.60,0.61)`, muted rose) → **keep** (effect-local). `al` stays **red** per §3.2 #1; add the green terminal tip per §3.2 #2.
- **G (generating shimmer):** `card` `vec3(0.984,0.972,0.949)` → **surface** `vec3(1.000,0.992,0.973)` (the generating card uses `--wa-surface`); `warm` `vec3(0.43,0.16,0.21)` → `vec3(0.431,0.141,0.212)`.

### 3.2 Design calls (OPERATOR-LOCKED — build as stated)

1. **D alert color — KEEP RED.** Use `al = vec3(0.66,0.18,0.12)`. A conflict is a hard stop; red reads more urgent than the brand amber. (Do not swap to amber.)
2. **D terminal "recordable" — ADD A SMALL GREEN TIP.** At `u_prog≈1.0`, tint the fully-filled ring toward success `vec3(0.180,0.420,0.310)` so "recordable" reads green to match the gate chips — keep maroon as the fill body so it stays on-brand (green tip only at the terminal). Cowork verifies against the live gate.

### 3.3 Dark theme — STATIC FALLBACK IN v1 (operator-locked)

The brand reference ships a **full dark theme** (`[data-theme="dark"]`, lines 20–26: paper `#181A1D`, surface `#232529`, accent `#8A3147`). The shaders hardcode cream backgrounds; under dark theme those canvases would clash.

**Build this:** in Inc 1, `ShaderCanvas` detects `document.documentElement.dataset.theme === 'dark'` and routes to the **static CSS fallback** (flat `var(--wa-paper)`) — treat dark mode like the no-WebGL path: no animated canvas, no clash, fully legible. Re-check `data-theme` on the same `MutationObserver`/event the app already uses for theme switches so a mid-session toggle is handled. Dark-theme shader variants are a **follow-up increment**, out of scope here.

---

## 4. Architecture

### 4.1 One shared component: `ShaderCanvas`

All four effects render through a single reusable component. ~60% of total effort is this component; once it exists, each effect is a shader string plus a mount.

**Location:** `src/client/components/shader/ShaderCanvas.tsx`

**Props contract:**

```ts
interface ShaderCanvasProps {
  /** GLSL ES 1.0 fragment-shader body. The component prepends `precision highp float;`
   *  and declares the standard uniforms — do not redeclare them. */
  fragmentShader: string;
  /** 0..1 base intensity. Passed to the shader as u_intensity. */
  intensity: number;
  /** Extra dynamic uniforms beyond the standard set. Numbers -> uniform1f,
   *  [x,y] -> uniform2f. Re-uploaded each frame when the value changes.
   *  Used by D for { u_prog, u_alert }. */
  uniforms?: Record<string, number | [number, number]>;
  /** 'mouse' enables the eased u_mouse uniform (A only). Default: false. */
  interactive?: 'mouse' | false;
  /** Forwarded to the <canvas>. Effect surfaces position it absolutely behind content. */
  className?: string;
  /** Decorative by default -> aria-hidden="true". Always true for these effects. */
  ariaHidden?: boolean;
}
```

**Standard uniforms the component always provides** (shaders may use any subset):

| Uniform | Type | Meaning |
| :-- | :-- | :-- |
| `u_res` | `vec2` | drawing-buffer size in px |
| `u_time` | `float` | seconds since mount |
| `u_intensity` | `float` | the `intensity` prop, 0..1 |
| `u_motion` | `float` | 1.0 normally, 0.0 under reduced-motion |
| `u_mouse` | `vec2` | eased pointer, 0..1, y-up (only meaningful when `interactive='mouse'`) |

Shared vertex shader (fullscreen quad, `TRIANGLE_STRIP` `[-1,-1, 1,-1, -1,1, 1,1]`):

```glsl
attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }
```

### 4.2 Harness behavior (non-negotiable)

- **One fragment shader on a fullscreen quad per instance.** No three.js, no scene graph.
- **Single shared rAF ticker** drives all mounted instances (one loop, not N loops).
- **Throttle to ~30fps** (skip frames < 33ms apart).
- **Pause when `document.hidden`.**
- **Pause when offscreen** via `IntersectionObserver`.
- **Cap DPR at 1.5** (`canvas.width = clientWidth * min(devicePixelRatio, 1.5)`).
- **Resize** via `ResizeObserver` on the canvas.
- **Context:** `getContext('webgl', { alpha:false, antialias:true })`. Handle `webglcontextlost` → static fallback; attempt restore on `webglcontextrestored`.
- **Ease `u_mouse`** toward the pointer target (`cur += (target - cur) * 0.08`) when interactive.

### 4.3 Fallbacks (all required)

1. **`prefers-reduced-motion: reduce`** → set `u_motion = 0.0`. Field still renders (static); nothing animates. Default-safe path.
2. **WebGL unavailable / context lost / compile failure** → render a **static CSS fallback** (flat `var(--wa-paper)`, or `--wa-surface`/`--wa-surface-2` on card surfaces) so layout/contrast are unaffected. Never a blank or black canvas.
3. **Dark theme** (per §3.3) → same static CSS fallback as (2) until dark shader variants ship.
4. **Flag OFF** → `ShaderCanvas` renders nothing; surface shows its normal flat background. No canvas created.

### 4.4 Flag + config (single source of truth)

**Location:** `src/client/config/shaderPolish.ts`

```ts
export const SHADER_POLISH = {
  // bound to UI_SHADER_POLISH_ENABLED; default OFF so it can ship dark
  enabled: false,
  effects: {
    inkLanding:        { intensity: 0.62 },
    guillocheHeader:   { intensity: 1.00 },
    recordabilityRing: { intensity: 1.00 },
    generatingShimmer: { intensity: 1.00 },
  },
} as const;
```

Every mount reads `SHADER_POLISH.enabled` and its per-effect intensity from this module. No intensity literals anywhere else.

---

## 5. Effect specs

GLSL below is GLSL ES 1.0, validated in mockups. Each is the fragment-shader **body**. **Apply the §3.1 reconciled constants** when transcribing — the literals below are the original (pre-reconciliation) values, kept for reference. If the harness declares the standard uniforms centrally, strip the `uniform` lines from these bodies.

### A — Flowing-ink landing + foil wordmark (intensity 0.62)

**Mounts:** login / "Whereas," landing hero only. `interactive='mouse'`. Canvas sits absolutely behind the wordmark + subtitle + sign-in CTA.

**Foil wordmark:** CSS, not WebGL — a slow specular sweep across the serif "Whereas," via `background-clip: text` with an animated linear-gradient highlight. **Use `--wa-font-serif` (Fraunces), weight 500.** Under reduced-motion, the sweep stops and the wordmark is solid accent `#6E2436`.

```glsl
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float s=0.,a=0.5;for(int i=0;i<5;i++){s+=a*vn(p);p*=2.02;a*=0.5;}return s;}
uniform vec2 u_res; uniform float u_time; uniform float u_intensity; uniform float u_motion; uniform vec2 u_mouse;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float a=u_res.x/u_res.y; vec2 p=uv; p.x*=a;
  vec2 m=u_mouse; m.x*=a; float t=u_time*0.05*u_motion;
  vec2 q=vec2(fbm(p*2.0+t), fbm(p*2.0+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p*2.0+4.0*q+vec2(1.7,9.2)+0.15*t), fbm(p*2.0+4.0*q+vec2(8.3,2.8)-0.12*t));
  float md=exp(-2.5*length(p-m)); float f=fbm(p*2.0+4.0*r+md*1.3);
  float ink=smoothstep(0.34,0.78,f);
  vec3 cream=vec3(0.957,0.941,0.906), maroon=vec3(0.40,0.12,0.17); // → §3.1: cream=vec3(0.980,0.973,0.949), maroon=vec3(0.431,0.141,0.212)
  vec3 col=mix(cream,maroon,ink*0.32*u_intensity);
  col=mix(col,maroon,md*0.07*u_intensity);
  gl_FragColor=vec4(col,1.0);
}
```

### B — Guilloché deed header (intensity 1.00)

**Mounts:** section headers for deed/certificate views, plus finalize/recorded views. Canvas behind the header strip (sits on `--wa-surface-2`); document title + "RECORDED" stamp render on top. **Not** interactive.

```glsl
uniform vec2 u_res; uniform float u_time; uniform float u_intensity; uniform float u_motion;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float a=u_res.x/u_res.y; vec2 c=(uv-0.5); c.x*=a;
  float t=u_time*0.05*u_motion; float r=length(c), th=atan(c.y,c.x);
  float f1=sin(18.0*th+9.0*sin(6.2831*6.0*r-t));
  float f2=sin(11.0*th-7.0*cos(6.2831*9.0*r+t*0.8));
  float field=0.5*f1+0.5*f2;
  float lines=smoothstep(0.10,0.0,abs(fract(field*3.0)-0.5));
  float vign=smoothstep(0.02,0.14,r)*smoothstep(0.66,0.40,r);
  vec3 cream=vec3(0.984,0.972,0.949), maroon=vec3(0.43,0.16,0.21); // → §3.1: cream=surface-2 vec3(0.953,0.937,0.894), maroon=vec3(0.431,0.141,0.212)
  vec3 col=mix(cream,maroon,lines*vign*0.55*u_intensity);
  gl_FragColor=vec4(col,1.0);
}
```

### D — State-reactive recordability ring (intensity 1.00)

**Mounts:** a small dedicated canvas **beside** the recordability panel — NEVER as a background behind the form (that surface is flat/dense and had renderer-freeze issues in UAT). Wired to the live gate state.

**Dynamic uniforms** via the `uniforms` prop:
- `u_prog` (float 0..1): map gate progress — not started `0.0`, Assembly complete `0.34`, Legal review passed `0.67`, Recordable `1.0`. **Source from the existing recordability gate state selector, not a local stepper** (acceptance criterion #8).
- `u_alert` (float 0/1): the conflict gate. `1.0` when a conflict is flagged → ring pulses warm-red. **Source from the live conflict gate state** (the same FOLD-L0-1 conflicts-at-intake signal).

```glsl
uniform vec2 u_res; uniform float u_time; uniform float u_intensity; uniform float u_motion;
uniform float u_prog; uniform float u_alert;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float a=u_res.x/u_res.y; vec2 c=uv-0.5; c.x*=a;
  float r=length(c); float ang=atan(c.y,c.x); float frac=(ang/6.2831)+0.5; float pf=mod(0.75-frac,1.0);
  float R=0.30, w=0.05; float ring=smoothstep(w,w*0.4,abs(r-R));
  float filled=smoothstep(0.004,0.0,pf-u_prog);
  vec3 cream=vec3(0.957,0.941,0.906), calm=vec3(0.76,0.60,0.61), warm=vec3(0.43,0.16,0.21), al=vec3(0.66,0.18,0.12);
  // → §3.1: cream=vec3(0.980,0.973,0.949), warm=vec3(0.431,0.141,0.212); calm (muted rose) keep; al stays red (§3.2 #1)
  vec3 base=mix(calm,warm,u_prog);
  // §3.2 #2 green terminal tip: blend toward success green only as u_prog approaches 1.0
  vec3 success=vec3(0.180,0.420,0.310);
  base=mix(base, success, smoothstep(0.92,1.0,u_prog)*0.6);
  base=mix(base,al,u_alert*(0.55+0.45*sin(u_time*4.0*u_motion)));
  vec3 col=cream;
  col=mix(col,vec3(0.87,0.81,0.80),ring*0.55);
  col=mix(col,base,ring*filled);
  float glow=exp(-7.0*abs(r-R))*filled; col=mix(col,base,glow*0.22*u_intensity);
  gl_FragColor=vec4(col,1.0);
}
```

Under reduced-motion, the conflict pulse term collapses (`u_motion=0`), leaving a steady warm-red ring — still legible, just not animated. The percentage and gate chips around the ring are normal DOM, driven by the same state.

### G — Generating shimmer (intensity 1.00)

**Mounts:** the draft/review generating state card (the 60–90s wait, sits on `--wa-surface`). Canvas behind the "Reviewing…" copy. Not interactive.

```glsl
uniform vec2 u_res; uniform float u_time; uniform float u_intensity; uniform float u_motion;
void main(){
  vec2 uv=gl_FragCoord.xy/u_res.xy; float d=(uv.x+uv.y)*0.5; float t=u_time*0.22*u_motion;
  float band=exp(-pow((fract(d-t)-0.5)*4.0,2.0));
  vec3 card=vec3(0.984,0.972,0.949), warm=vec3(0.43,0.16,0.21); // → §3.1: card=surface vec3(1.000,0.992,0.973), warm=vec3(0.431,0.141,0.212)
  vec3 col=mix(card,warm,band*0.16*u_intensity);
  gl_FragColor=vec4(col,1.0);
}
```

---

## 6. Where it lives vs. stays flat

**Lives:** login/landing (A), deed/certificate + finalize/recorded headers (B), beside the recordability panel (D), generating states (G).

**Stays flat — never mount a canvas here:** the drafting content pane, reviewer cards, the recordability **input form** (D sits beside it, not behind), and settings. Readability and perf first. These are also the pages that froze under load in UAT — keep canvases off them entirely.

---

## 7. Increment plan

- **Inc 1 — harness + A.** Build `ShaderCanvas`, the shared ticker, all fallbacks (incl. the §3.3 dark-theme arm), the flag, and `shaderPolish.ts`; mount A (ink + foil, Fraunces) on the landing hero at 0.62. Foundation every later effect reuses.
- **Inc 2 — B.** Guilloché on deed/certificate + finalize/recorded headers at 1.00 (surface-2 base).
- **Inc 3 — G then D.** Shimmer on generating states (1.00, surface base), then the recordability ring (1.00) wired to **real gate + conflict state** as a beside-the-panel accent.

Each increment is independently shippable behind the flag.

---

## 8. Acceptance criteria

1. With `UI_SHADER_POLISH_ENABLED` OFF (default), no canvas is created anywhere and the app is byte-for-byte its current self on the affected surfaces.
2. With the flag ON, A/B/D/G render at their configured intensities (0.62 / 1.0 / 1.0 / 1.0) on the correct surfaces only, using the **reconciled §3 tokens**.
3. `prefers-reduced-motion: reduce` freezes all motion (static field renders; foil sweep stops; ring pulse stops). Verified in browser + OS-level setting.
4. With WebGL disabled or a forced context-loss, every surface shows its static CSS fallback — no blank/black canvas, no layout shift.
5. **Dark theme** (`data-theme="dark"`) shows the static CSS fallback (per §3.3) — no bright cream canvas clash — and a mid-session light↔dark toggle is handled without a stuck canvas.
6. No `ShaderCanvas` mounts on the drafting pane, reviewer cards, recordability input form, or settings.
7. Frame rate is capped ~30fps; canvases pause when the tab is hidden and when scrolled offscreen; DPR is capped at 1.5.
8. D's `u_prog`/`u_alert` reflect the **real** recordability gate + conflict state, not a local mock.
9. No measurable regression in page-load or interaction perf on the heavy pages (they carry no canvas — guard against accidental global cost).

---

## 9. Verification (Cowork lane)

The Cowork lane verifies before merge per the companion matrix (`WHEREAS-POLISH-1_VERIFICATION_MATRIX.md`): Chrome/Safari/Firefox + at least one integrated-GPU device (fbm in A is the cost hotspot), flag ON/OFF, reduced-motion ON/OFF, forced WebGL-off, and dark-theme fallback. Capture short screen recordings of each effect plus the fallback states and attach to the PR. The CLI commits; the lane signs off on green.

---

## 10. Out of scope (this engagement)

Round-1 alternates (mesh landing, paper grain), the full-document guilloché watermark (E), ink-bleed page transitions, letterpress emboss, scroll/parallax grain, **and dark-theme shader variants** (§3.3 — fallback only in v1). All remain on the menu for a later increment.

---

## Appendix — Reconciliation log (Cowork, 2026-06-21)

Read `docs/brand/whereas-reference-mockup.html` (light `:root` block, lines 11–19; dark block 20–26). Findings:

- **Background** `#F4F0E7` → `#FAF8F2` (`--wa-paper`). Spec value was darker/greener than brand.
- **Card cream** `#FBF8F2` → `#FFFDF8` (`--wa-surface`); header strips use `--wa-surface-2` `#F3EFE4`.
- **Accent maroon** `#6E2230` → `#6E2436` (`--wa-accent`). Minor; effect-tuned variants re-anchored.
- **Ink** `#2A2420` → `#17191C` (`--wa-ink`).
- **Muted rose** `#C2999C` — **no brand token**; retained as effect-local D "calm" color.
- **New signals available:** `--wa-success #2E6B4F`, `--wa-warning #9A6B1F` — D alert stays red; D terminal gets a green tip (§3.2).
- **Dark theme exists** and was unaddressed by the original spec — added as §3.3 (static fallback in v1) and acceptance criterion #5.
- **Brand serif is Fraunces** (`--wa-font-serif`) — specified for the A foil wordmark (§5.A).
