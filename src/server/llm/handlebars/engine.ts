/**
 * Handlebars Render Engine — Ch 12, Ch 14, Ch 15, Appendix D
 *
 * This module provides:
 *   1. A configured Handlebars environment with the full Appendix D helper registry.
 *   2. Phase-1 validation (Ch 12.4): parse + helper registry check.
 *   3. Synchronous deterministic render (Ch 14.2, Ch 15.2).
 *   4. Sandbox render with mandatory watermark (Ch 12.6, Decision #40).
 *
 * SECURITY: Custom helpers and partials are explicitly disabled.
 * Any helper not in the Appendix D registry causes a validation error.
 *
 * DETERMINISM: The render is a pure function of (handlebarsSource, variableMap).
 * No LLM involvement. Same inputs → same output on every call.
 */
import Handlebars from 'handlebars';
import {
  registerComparisonHelpers,
  registerLogicalHelpers,
  registerFormattingHelpers,
} from './comparison-helpers.js';

// ============================================================
// Registered helper names (Appendix D)
// ============================================================

/**
 * The complete set of allowed helper names in v1.
 * Template validation (Ch 12.4) fails for any helper not in this set.
 * Native Handlebars block helpers (if, unless, each, with, lookup) are
 * always available and do not need to be registered.
 */
export const ALLOWED_HELPERS = new Set([
  // Native block helpers (always available)
  'if',
  'unless',
  'each',
  'with',
  'lookup',
  // Application-provided comparison helpers
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  // Application-provided logical helpers
  'and',
  'or',
  'not',
  // Application-provided formatting helpers
  'formatDate',
  'formatCurrency',
  'titleCase',
  'uppercase',
  'lowercase',
  'defaultValue',
]);

// ============================================================
// Handlebars environment
// ============================================================

/**
 * Create a fresh Handlebars environment with all Appendix D helpers registered.
 * A fresh environment is used per-render to prevent cross-request state leakage.
 */
function createHandlebarsEnv(): typeof Handlebars {
  const hbs = Handlebars.create();
  registerComparisonHelpers(hbs);
  registerLogicalHelpers(hbs);
  registerFormattingHelpers(hbs);
  return hbs;
}

// ============================================================
// Validation types
// ============================================================

export interface ValidationError {
  type: 'unknown_helper' | 'partial_disallowed' | 'parse_error';
  message: string;
  helperName?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ============================================================
// Phase-1 validation (Ch 12.4)
// ============================================================

/**
 * Walk a Handlebars AST and collect all helper/partial usages.
 * Returns the set of helper names and partial names found.
 */
function collectUsages(ast: hbs.AST.Program): {
  helpers: Set<string>;
  partials: Set<string>;
} {
  const helpers = new Set<string>();
  const partials = new Set<string>();

  function walk(node: hbs.AST.Node): void {
    if (!node) return;

    if (node.type === 'MustacheStatement' || node.type === 'SubExpression') {
      const stmt = node as hbs.AST.MustacheStatement;
      if (stmt.path.type === 'PathExpression') {
        const pathExpr = stmt.path as hbs.AST.PathExpression;
        // A mustache with params is a helper call; without params it's a variable
        if (stmt.params.length > 0 || (stmt.hash?.pairs?.length ?? 0) > 0) {
          helpers.add(pathExpr.original);
        }
      }
    }

    if (node.type === 'BlockStatement') {
      const block = node as hbs.AST.BlockStatement;
      if (block.path.type === 'PathExpression') {
        const pathExpr = block.path as hbs.AST.PathExpression;
        helpers.add(pathExpr.original);
      }
      if (block.program) walk(block.program);
      if (block.inverse) walk(block.inverse);
    }

    if (node.type === 'PartialStatement') {
      const partial = node as hbs.AST.PartialStatement;
      if (partial.name.type === 'PathExpression') {
        const pathExpr = partial.name as hbs.AST.PathExpression;
        partials.add(pathExpr.original);
      } else {
        partials.add('(dynamic)');
      }
    }

    if (node.type === 'Program') {
      const program = node as hbs.AST.Program;
      for (const stmt of program.body) {
        walk(stmt);
      }
    }
  }

  walk(ast);
  return { helpers, partials };
}

/**
 * Phase-1 validation (Ch 12.4):
 *   1. Parse the Handlebars source.
 *   2. Check for disallowed constructs (partials, unknown helpers).
 *
 * Returns a ValidationResult with all errors found.
 * A template must have valid=true to proceed to schema authoring.
 */
export function validateHandlebarsSource(handlebarsSource: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Step 1: Parse
  let ast: hbs.AST.Program;
  try {
    ast = Handlebars.parse(handlebarsSource);
  } catch (err) {
    errors.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, errors };
  }

  // Step 2: Collect usages
  const { helpers, partials } = collectUsages(ast);

  // Check for disallowed partials
  for (const partial of partials) {
    errors.push({
      type: 'partial_disallowed',
      message: `Partials are not allowed in v1 templates (found: {{> ${partial}}})`,
    });
  }

  // Check for unknown helpers
  for (const helper of helpers) {
    if (!ALLOWED_HELPERS.has(helper)) {
      errors.push({
        type: 'unknown_helper',
        message: `Unknown helper "{{${helper}}}" — not in the Appendix D registry`,
        helperName: helper,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Render
// ============================================================

export interface RenderResult {
  content: string;
}

/**
 * Synchronous deterministic Handlebars render (Ch 14.2, Ch 15.2).
 *
 * Throws with code 'TEMPLATE_CORRUPT' if the source fails to parse at render time
 * (should never happen for a validated+activated template, but guarded per spec).
 * Throws with code 'RENDER_FAILED' for any other render error.
 *
 * @param handlebarsSource - The stored Handlebars template text
 * @param variableMap - The attorney-confirmed variable map (JSON object)
 */
export function renderTemplate(
  handlebarsSource: string,
  variableMap: Record<string, unknown>,
): RenderResult {
  const hbs = createHandlebarsEnv();

  let template: HandlebarsTemplateDelegate;
  try {
    template = hbs.compile(handlebarsSource, { strict: false, noEscape: true });
  } catch (err) {
    const e = new Error(
      `Template source failed to parse at render time: ${err instanceof Error ? err.message : String(err)}`,
    );
    (e as NodeJS.ErrnoException).code = 'TEMPLATE_CORRUPT';
    throw e;
  }

  let content: string;
  try {
    content = template(variableMap);
  } catch (err) {
    const e = new Error(
      `Template render failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    (e as NodeJS.ErrnoException).code = 'RENDER_FAILED';
    throw e;
  }

  return { content };
}

// ============================================================
// Sandbox render (Ch 12.6, Decision #40)
// ============================================================

/**
 * Mandatory watermark text per Decision #40.
 * Must appear at the top of every sandbox render output.
 * Cannot be disabled by configuration.
 */
export const SANDBOX_WATERMARK =
  'SANDBOX PREVIEW — NOT FOR CLIENT USE\n\n';

/**
 * Sandbox render: same as renderTemplate but prepends the mandatory watermark.
 * No version row is created; no document is created.
 * The watermark is prepended unconditionally — Decision #40 is a hard requirement.
 */
export function renderTemplateSandbox(
  handlebarsSource: string,
  mockData: Record<string, unknown>,
): RenderResult {
  const { content } = renderTemplate(handlebarsSource, mockData);
  return { content: SANDBOX_WATERMARK + content };
}

// ============================================================
// Type alias for Handlebars template delegate
// ============================================================
type HandlebarsTemplateDelegate = (context: unknown, options?: Handlebars.RuntimeOptions) => string;
