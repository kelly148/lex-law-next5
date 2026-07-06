/**
 * templateVariables — TEMPLATE-PIPELINE-1 (FL-17) inc 2.
 *
 * A PURE client helper that derives the fillable variable list from a Handlebars template source, so the
 * schema-authoring UI can pre-fill an editable field table. It intentionally recognises ONLY bare
 * `{{identifier}}` placeholders: block helpers (`{{#if}}` / `{{/each}}`), inverse sections (`{{^…}}`),
 * comments (`{{!…}}`), partials (`{{>…}}`), helper calls (anything with a space), dotted paths, and
 * `@`-data (`{{@index}}`) are all skipped — those are not attorney-fillable fields. The SERVER's phase-2
 * validation (template.confirmSchema) remains authoritative; this is a convenience derivation only.
 */
export function deriveTemplateVariables(handlebarsSource: string): string[] {
  const names = new Set<string>();
  // {{ optional-third-brace  expr  optional-third-brace }}  — first char of expr is not a block/section/
  // comment/partial sigil.
  const re = /\{\{\{?([^#/^!>][^}]*?)\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(handlebarsSource)) !== null) {
    // strip a leading '&' (no-escape) or stray '{' from a triple-mustache, then trim.
    const expr = (m[1] ?? '').replace(/^[&{]/, '').trim();
    // Only bare identifiers are fillable variables; helpers/paths/this/@data are skipped.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expr)) names.add(expr);
  }
  return Array.from(names);
}

/** Humanise a snake_case / camelCase variable name into a default field label. */
export function defaultFieldLabel(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.length === 0 ? name : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
