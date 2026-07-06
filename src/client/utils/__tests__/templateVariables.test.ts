/**
 * templateVariables — TEMPLATE-PIPELINE-1 (FL-17) inc 2 (pure derivation helper).
 *
 * Proves the client derivation recognises ONLY bare {{identifier}} placeholders and skips block helpers,
 * inverse sections, comments, partials, helper calls, dotted paths, and @-data.
 */
import { describe, it, expect } from 'vitest';
import { deriveTemplateVariables, defaultFieldLabel } from '../templateVariables.js';

describe('deriveTemplateVariables', () => {
  it('extracts bare {{identifier}} placeholders, de-duplicated, in order', () => {
    const src = 'Dear {{client_name}}, re {{matter_title}}. Again: {{client_name}}.';
    expect(deriveTemplateVariables(src)).toEqual(['client_name', 'matter_title']);
  });

  it('skips block helpers, inverse sections, comments, and partials', () => {
    const src = '{{#if active}}x{{/if}} {{^empty}}y{{/empty}} {{! a comment }} {{> partial}} {{keep_me}}';
    expect(deriveTemplateVariables(src)).toEqual(['keep_me']);
  });

  it('skips helper calls (spaces), dotted paths, and @-data', () => {
    const src = '{{formatDate signing_date}} {{party.name}} {{@index}} {{plain}}';
    expect(deriveTemplateVariables(src)).toEqual(['plain']);
  });

  it('handles triple-mustache (no-escape) and & no-escape as the same variable', () => {
    expect(deriveTemplateVariables('{{{raw_html}}} and {{& also_raw}}')).toEqual(['raw_html', 'also_raw']);
  });

  it('returns an empty list when there are no fillable variables', () => {
    expect(deriveTemplateVariables('No variables here. {{#each rows}}{{/each}}')).toEqual([]);
  });
});

describe('defaultFieldLabel', () => {
  it('humanises snake_case and camelCase', () => {
    expect(defaultFieldLabel('client_name')).toBe('Client name');
    expect(defaultFieldLabel('signingDate')).toBe('Signing Date'); // camelCase splits, second word keeps its cap
    expect(defaultFieldLabel('grantee')).toBe('Grantee');
  });
});
