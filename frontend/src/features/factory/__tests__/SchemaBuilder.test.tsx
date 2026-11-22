/**
 * The category schema builder: fields map to and from a JSON schema, a schema beyond the fields stays JSON, and
 * the category dialog saves what the fields say.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryWrite, FactoryCategory } from '@/api/factory';
import { ToastProvider } from '@/ui';
import { CategoryDialog } from '../dialogs';
import { fieldsFromSchema, fieldsProblem, newField, schemaFromFields } from '../lib/schemaFields';

describe('schema fields', () => {
  it('reads a flat object schema into fields and writes it back', () => {
    const schema = {
      type: 'object',
      properties: {
        max_amount: { type: 'number', description: 'The cap' },
        currency: { type: 'string', enum: ['SAR', 'USD'] },
        tags: { type: 'array', items: { type: 'string' } },
        strict: { type: 'boolean' },
        count: { type: 'integer' },
      },
      required: ['max_amount', 'currency'],
      additionalProperties: false,
    };
    const model = fieldsFromSchema(schema);
    expect(model).not.toBeNull();
    expect(model!.strict).toBe(true);
    expect(model!.fields.map((f) => [f.name, f.type, f.required, f.description, f.choices])).toEqual([
      ['max_amount', 'number', true, 'The cap', ''],
      ['currency', 'choice', true, '', 'SAR, USD'],
      ['tags', 'list', false, '', ''],
      ['strict', 'boolean', false, '', ''],
      ['count', 'integer', false, '', ''],
    ]);
    expect(schemaFromFields(model!)).toEqual(schema);
    expect(fieldsFromSchema(null)).toEqual({ fields: [], strict: false });
    expect(schemaFromFields({ fields: [], strict: false })).toBeNull();
  });

  it('refuses what the fields cannot say and names the problems of a draft', () => {
    expect(fieldsFromSchema({ type: 'object', properties: { nested: { type: 'object' } } })).toBeNull();
    expect(fieldsFromSchema({ type: 'object', properties: { d: { type: 'string', format: 'date' } } })).toBeNull();
    expect(fieldsFromSchema({ type: 'object', properties: {}, oneOf: [] })).toBeNull();
    expect(fieldsFromSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] })).toBeNull();
    expect(fieldsFromSchema({ type: 'array' })).toBeNull();
    expect(fieldsProblem({ fields: [newField({ name: '' })], strict: false })).toBe('Every field needs a name');
    expect(fieldsProblem({ fields: [newField({ name: 'a' }), newField({ name: ' a' })], strict: false })).toBe(
      'Two fields are named “a”',
    );
    expect(fieldsProblem({ fields: [newField({ name: 'a', type: 'choice' })], strict: false })).toBe(
      'List the values “a” may take',
    );
    expect(fieldsProblem({ fields: [newField({ name: 'a', type: 'choice', choices: 'x, ' })], strict: false })).toBeUndefined();
  });
});

function mount(existing: FactoryCategory | null) {
  const onSave = vi.fn<(values: CategoryWrite) => Promise<unknown>>(async () => ({}));
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <CategoryDialog open onOpenChange={() => undefined} existing={existing} onSave={onSave} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onSave;
}

describe('CategoryDialog', () => {
  it('builds the body schema from fields', async () => {
    const onSave = mount(null);
    const dialog = await screen.findByTestId('category-dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Pricing');
    expect(screen.getByTestId('schema-builder')).toHaveAttribute('data-mode', 'fields');
    await userEvent.click(screen.getByTestId('schema-add-field'));
    // A field without a name blocks saving.
    expect(screen.getByTestId('factory-dialog-submit')).toBeDisabled();
    expect(screen.getByTestId('schema-problem')).toHaveTextContent('Every field needs a name');
    await userEvent.type(within(screen.getByTestId('schema-field-name')).getByRole('textbox'), 'max_amount');
    await userEvent.type(within(screen.getByTestId('schema-field-description')).getByRole('textbox'), 'The cap');
    await userEvent.click(screen.getByTestId('schema-add-field'));
    const second = screen.getAllByTestId('schema-field')[1]!;
    await userEvent.type(within(within(second).getByTestId('schema-field-name')).getByRole('textbox'), 'currency');
    await userEvent.click(within(second).getByRole('button', { name: /Type/ }));
    await userEvent.click(await screen.findByRole('option', { name: /One of/ }));
    await userEvent.type(within(within(second).getByTestId('schema-field-choices')).getByRole('textbox'), 'SAR, USD');
    await userEvent.click(within(second).getByRole('checkbox', { name: 'Required' }));
    await userEvent.click(screen.getByTestId('schema-strict'));
    await userEvent.click(screen.getByTestId('factory-dialog-submit'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toEqual({
      name: 'Pricing',
      description: '',
      json_schema: {
        type: 'object',
        properties: {
          max_amount: { type: 'string', description: 'The cap' },
          currency: { type: 'string', enum: ['SAR', 'USD'] },
        },
        required: ['max_amount'],
        additionalProperties: false,
      },
    });
  });

  it('opens a schema beyond the fields as JSON and keeps it there', async () => {
    const schema = { type: 'object', properties: { nested: { type: 'object', properties: {} } } };
    const onSave = mount({
      id: 'c1',
      factory_id: 'f1',
      key: 'format',
      name: 'Format',
      description: '',
      json_schema: schema,
      position: 0,
      rule_count: 0,
      created_at: null,
      updated_at: null,
    });
    await screen.findByTestId('category-dialog');
    expect(screen.getByTestId('schema-builder')).toHaveAttribute('data-mode', 'json');
    expect(within(screen.getByTestId('category-schema')).getByRole('textbox')).toHaveValue(
      JSON.stringify(schema, null, 2),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Fields' }));
    expect(await screen.findByTestId('schema-json-only')).toHaveTextContent('more than the field editor covers');
    expect(screen.getByTestId('schema-builder')).toHaveAttribute('data-mode', 'json');
    await userEvent.click(screen.getByTestId('factory-dialog-submit'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ json_schema: schema });
  });
});
