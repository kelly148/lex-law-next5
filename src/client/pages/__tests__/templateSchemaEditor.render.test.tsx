// @vitest-environment jsdom
/**
 * TEMPLATE-PIPELINE-1 (FL-17) inc 2 — VersionSchemaEditor render test (ci-gotchas #10: render, don't
 * trust tsc).
 *
 * Proves the schema-authoring flow: variables are DERIVED from the Handlebars source into an editable
 * field table; Save calls template.updateSchema with the field schema; Confirm (enabled only after Save)
 * calls template.confirmSchema. Mocked mutations — no live calls.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

const updateSchemaSpy = vi.hoisted(() => vi.fn((_input: unknown) => Promise.resolve({})));
const confirmSchemaSpy = vi.hoisted(() => vi.fn((_input: unknown) => Promise.resolve({})));

vi.mock('../../trpc.js', () => {
  const client = {
    template: {
      updateSchema: { mutate: updateSchemaSpy },
      confirmSchema: { mutate: confirmSchemaSpy },
    },
  };
  return { trpc: { useUtils: () => ({ client }) } };
});

vi.mock('../../hooks/useGuardedMutation.js', () => ({
  useGuardedMutation: (fn: (i: unknown) => unknown, opts?: { onSuccess?: (d: unknown, i: unknown) => void }) => ({
    mutate: (input: unknown) => { void fn(input); opts?.onSuccess?.(undefined, input); },
    isPending: false,
    error: null,
  }),
}));

import { VersionSchemaEditor } from '../TemplatesPage.js';

const SRC = 'Dear {{client_name}}, this {{document_kind}} is dated {{signing_date}}. {{#if x}}{{/if}}';

afterEach(() => cleanup());
beforeEach(() => { updateSchemaSpy.mockClear(); confirmSchemaSpy.mockClear(); });

describe('VersionSchemaEditor', () => {
  it('derives one editable field per bare variable (skipping helpers/blocks)', () => {
    const { getByTestId, queryByTestId } = render(<VersionSchemaEditor versionId="v-1" handlebarsSource={SRC} />);
    expect(getByTestId('schema-editor')).toBeTruthy();
    expect(getByTestId('schema-field-client_name')).toBeTruthy();
    expect(getByTestId('schema-field-document_kind')).toBeTruthy();
    expect(getByTestId('schema-field-signing_date')).toBeTruthy();
    // the {{#if x}} block variable is not a fillable field
    expect(queryByTestId('schema-field-x')).toBeNull();
  });

  it('Save calls template.updateSchema with the derived field schema', () => {
    const { getByTestId } = render(<VersionSchemaEditor versionId="v-1" handlebarsSource={SRC} />);
    fireEvent.click(getByTestId('schema-save'));
    expect(updateSchemaSpy).toHaveBeenCalledTimes(1);
    const arg = updateSchemaSpy.mock.calls[0]![0] as { versionId: string; schema: { fields: Array<{ name: string; type: string; required: boolean }>; schemaVersion: number } };
    expect(arg.versionId).toBe('v-1');
    expect(arg.schema.schemaVersion).toBe(1);
    expect(arg.schema.fields.map((f) => f.name)).toEqual(['client_name', 'document_kind', 'signing_date']);
    expect(arg.schema.fields[0]!.type).toBe('string');
    expect(arg.schema.fields[0]!.required).toBe(true);
  });

  it('Confirm is disabled until Save, then calls template.confirmSchema', () => {
    const { getByTestId } = render(<VersionSchemaEditor versionId="v-1" handlebarsSource={SRC} />);
    const confirm = getByTestId('schema-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(getByTestId('schema-save'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(confirmSchemaSpy).toHaveBeenCalledTimes(1);
    expect((confirmSchemaSpy.mock.calls[0]![0] as { versionId: string }).versionId).toBe('v-1');
    expect(getByTestId('schema-confirmed')).toBeTruthy();
  });

  it('an edited label/type/required flows into the saved schema', () => {
    const { getByTestId } = render(<VersionSchemaEditor versionId="v-1" handlebarsSource={SRC} />);
    const row = getByTestId('schema-field-signing_date');
    fireEvent.change(row.querySelector('select') as HTMLSelectElement, { target: { value: 'date' } });
    fireEvent.click(row.querySelector('input[type="checkbox"]') as HTMLInputElement); // toggle required off
    fireEvent.click(getByTestId('schema-save'));
    const arg = updateSchemaSpy.mock.calls[0]![0] as { schema: { fields: Array<{ name: string; type: string; required: boolean }> } };
    const dateField = arg.schema.fields.find((f) => f.name === 'signing_date')!;
    expect(dateField.type).toBe('date');
    expect(dateField.required).toBe(false);
  });
});
