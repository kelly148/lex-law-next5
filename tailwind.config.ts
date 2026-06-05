import type { Config } from 'tailwindcss';

/**
 * Whereas R1 — the Tailwind colour/type/radius layer maps onto the design
 * tokens in src/client/styles/whereas-tokens.css. The legacy firm-* names are
 * RETAINED (the app uses them ~230 times) but now resolve to Whereas tokens via
 * CSS variables, so the whole app re-themes from one place and dark mode follows
 * the token layer automatically.
 *
 * Brand colours that take Tailwind opacity modifiers (firm-navy, firm-gold, and
 * the ink/accent aliases) use the `rgb(var(--wa-*-rgb) / <alpha-value>)` channel
 * form so that the slash opacity syntax (bg-firm-navy/10, text-firm-navy/50, …)
 * keeps working. The channel vars live in globals.css. firm-light (page bg) has
 * no opacity usage, so it can reference the hex token directly.
 *
 * Type principle: chrome = sans (Inter); the law = serif (Fraunces). The legacy
 * `garamond` family name now resolves to Fraunces so existing font-garamond
 * titles become the brand serif with no per-file change.
 */
const config: Config = {
  content: [
    './index.html',
    './src/client/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy brand names -> Whereas tokens.
        'firm-navy': 'rgb(var(--wa-ink-rgb) / <alpha-value>)',    // ink: headings, labels, primary fills
        'firm-gold': 'rgb(var(--wa-accent-rgb) / <alpha-value>)', // oxblood accent
        'firm-light': 'var(--wa-paper)',                          // page background (no opacity usage)

        // Whereas semantic palette — use these for R2 / new UI.
        paper: 'var(--wa-paper)',
        surface: 'var(--wa-surface)',
        'surface-2': 'var(--wa-surface-2)',
        ink: 'rgb(var(--wa-ink-rgb) / <alpha-value>)',
        'ink-secondary': 'var(--wa-text-secondary)',
        'ink-hint': 'var(--wa-text-hint)',
        line: 'var(--wa-border)',
        'line-strong': 'var(--wa-border-strong)',
        accent: 'rgb(var(--wa-accent-rgb) / <alpha-value>)',
        'accent-hover': 'var(--wa-accent-hover)',
        'accent-tint': 'var(--wa-accent-tint)',
        'on-accent': 'var(--wa-on-accent)',
        success: 'var(--wa-success)',
        'success-tint': 'var(--wa-success-tint)',
        warning: 'var(--wa-warning)',
        'warning-tint': 'var(--wa-warning-tint)',
        danger: 'var(--wa-danger)',
        'danger-tint': 'var(--wa-danger-tint)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
        // Legacy name kept so existing font-garamond usages become the brand serif.
        garamond: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // Whereas radius is 8px for cards/buttons/pills. Tailwind's bare `rounded`
        // defaults to 4px; bump it to the token. rounded-lg already equals 8px.
        DEFAULT: 'var(--wa-radius)',
      },
    },
  },
  plugins: [],
};

export default config;
