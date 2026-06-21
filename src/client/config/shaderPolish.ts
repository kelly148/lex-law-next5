/**
 * shaderPolish.ts — WHEREAS-POLISH-1 single source of truth (config + flag).
 *
 * Client-only, no server. The flag is the build-time env VITE_UI_SHADER_POLISH_ENABLED (default OFF →
 * ships dark): set it to "true" on the Railway build env + redeploy to enable. Every shader mount reads
 * SHADER_POLISH_ENABLED and its per-effect intensity from here — no intensity literals anywhere else.
 *
 * Intensities are operator-set (spec §1/§4.4) and are the only knob product retunes later. The vec3 token
 * constants are the §3.1 reconciled brand values (reference `docs/brand/whereas-reference-mockup.html`
 * wins), kept here so each effect shader anchors to one place instead of re-hardcoding cream/maroon.
 */

/** Bound to VITE_UI_SHADER_POLISH_ENABLED; default OFF (absent/any non-"true" value → false). */
export const SHADER_POLISH_ENABLED: boolean =
  import.meta.env.VITE_UI_SHADER_POLISH_ENABLED === 'true';

export const SHADER_POLISH = {
  effects: {
    inkLanding: { intensity: 0.62 },
    guillocheHeader: { intensity: 1.0 },
    recordabilityRing: { intensity: 1.0 },
    generatingShimmer: { intensity: 1.0 },
  },
} as const;

/**
 * §3.1 reconciled shader constants (sRGB component / 255, 3 places). GLSL vec3 strings so effect bodies
 * read one named source instead of re-hardcoding. Effect-tuned variants (D's muted-rose "calm", red
 * "alert", green terminal "tip") live with their effect.
 */
export const WA = {
  paper: 'vec3(0.980, 0.973, 0.949)', //  --wa-paper   #FAF8F2
  surface: 'vec3(1.000, 0.992, 0.973)', // --wa-surface #FFFDF8
  surface2: 'vec3(0.953, 0.937, 0.894)', // --wa-surface-2 #F3EFE4
  accent: 'vec3(0.431, 0.141, 0.212)', //  --wa-accent  #6E2436
  success: 'vec3(0.180, 0.420, 0.310)', // --wa-success #2E6B4F
} as const;
