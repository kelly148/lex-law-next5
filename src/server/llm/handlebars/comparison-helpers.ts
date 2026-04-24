/**
 * Handlebars Comparison Helpers — Appendix D
 *
 * Application-provided comparison and logical helpers registered at
 * Handlebars initialization. Not native to Handlebars.
 *
 * These are the ONLY non-native helpers permitted in v1 templates.
 * Template validation (Ch 12.4) fails for any helper not in the registry.
 */
import type Handlebars from 'handlebars';

type HelperOptions = Handlebars.HelperOptions;

// ============================================================
// Comparison helpers
// ============================================================

export function registerComparisonHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hbs.registerHelper('neq', (a: unknown, b: unknown) => a !== b);
  hbs.registerHelper('lt', (a: unknown, b: unknown) => (a as number) < (b as number));
  hbs.registerHelper('lte', (a: unknown, b: unknown) => (a as number) <= (b as number));
  hbs.registerHelper('gt', (a: unknown, b: unknown) => (a as number) > (b as number));
  hbs.registerHelper('gte', (a: unknown, b: unknown) => (a as number) >= (b as number));
}

// ============================================================
// Logical helpers
// ============================================================

export function registerLogicalHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('and', (...args: unknown[]) => {
    // Last arg is the Handlebars options object — exclude it
    const values = args.slice(0, -1);
    return values.every(Boolean);
  });

  hbs.registerHelper('or', (...args: unknown[]) => {
    const values = args.slice(0, -1);
    return values.some(Boolean);
  });

  hbs.registerHelper('not', (a: unknown) => !a);
}

// ============================================================
// Formatting helpers
// ============================================================

export function registerFormattingHelpers(hbs: typeof Handlebars): void {
  /**
   * formatDate: formats a date value.
   * format values: 'long' (default, "January 8, 2026"), 'short' ("01/08/2026"), 'iso' ("2026-01-08")
   */
  hbs.registerHelper('formatDate', (dateField: unknown, format: unknown) => {
    if (dateField === null || dateField === undefined || dateField === '') return '';
    const d = new Date(String(dateField));
    if (isNaN(d.getTime())) return String(dateField);
    const fmt = typeof format === 'string' ? format : 'long';
    if (fmt === 'iso') {
      return d.toISOString().slice(0, 10);
    } else if (fmt === 'short') {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } else {
      // 'long' is the default
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
  });

  /**
   * formatCurrency: formats a numeric value as USD.
   * v1 assumes USD only (Appendix D).
   */
  hbs.registerHelper('formatCurrency', (amountField: unknown) => {
    if (amountField === null || amountField === undefined || amountField === '') return '';
    const n = Number(amountField);
    if (isNaN(n)) return String(amountField);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  });

  /** titleCase: transforms to Title Case */
  hbs.registerHelper('titleCase', (stringField: unknown) => {
    if (stringField === null || stringField === undefined) return '';
    return String(stringField).replace(
      /\w\S*/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase(),
    );
  });

  /** uppercase: transforms to uppercase */
  hbs.registerHelper('uppercase', (stringField: unknown) => {
    if (stringField === null || stringField === undefined) return '';
    return String(stringField).toUpperCase();
  });

  /** lowercase: transforms to lowercase */
  hbs.registerHelper('lowercase', (stringField: unknown) => {
    if (stringField === null || stringField === undefined) return '';
    return String(stringField).toLowerCase();
  });

  /**
   * defaultValue: uses fallback when primary is null/undefined/empty.
   * {{defaultValue primaryField "fallback"}}
   */
  hbs.registerHelper('defaultValue', (primaryField: unknown, fallback: unknown, _options: HelperOptions) => {
    if (primaryField === null || primaryField === undefined || primaryField === '') {
      return fallback;
    }
    return primaryField;
  });
}
