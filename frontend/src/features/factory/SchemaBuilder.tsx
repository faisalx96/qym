/**
 * The rule body schema of a category, built from fields (name, type, description, required, the values of a
 * choice) or edited as JSON. Fields cover what the agent fills best: a flat object of scalars, choices and lists of
 * text; a schema that says more (nested objects, formats) opens in JSON mode and stays there. Both modes edit one
 * value: switching to JSON writes the fields out, switching back parses the text.
 */
import { useState } from 'react';
import { Button, Checkbox, Icon, IconButton, InlineNotice, SegmentedControl, Select, Text, TextField, Textarea } from '@/ui';
import { parseJsonObject } from './dialogs';
import {
  FIELD_TYPES,
  fieldsFromSchema,
  fieldsProblem,
  newField,
  schemaFromFields,
  type FieldType,
  type SchemaField,
  type SchemaModel,
} from './lib/schemaFields';
import styles from './SchemaBuilder.module.css';

export type SchemaMode = 'fields' | 'json';

export interface SchemaState {
  mode: SchemaMode;
  model: SchemaModel;
  text: string;
}

/** The editor's opening state for a stored schema: fields when the builder can show it, JSON otherwise. */
export function initialSchemaState(schema: Record<string, unknown> | null): SchemaState {
  const model = fieldsFromSchema(schema);
  return {
    mode: model ? 'fields' : 'json',
    model: model ?? { fields: [], strict: false },
    text: schema ? JSON.stringify(schema, null, 2) : '',
  };
}

/** What the state says: the schema to save, or the problem that blocks saving. */
export function schemaOutcome(state: SchemaState): {
  schema: Record<string, unknown> | null;
  problem: string | undefined;
} {
  if (state.mode === 'fields') {
    const problem = fieldsProblem(state.model);
    return { schema: problem ? null : schemaFromFields(state.model), problem };
  }
  const parsed = parseJsonObject(state.text);
  return { schema: parsed.value, problem: parsed.error ?? undefined };
}

const MODES: { value: SchemaMode; label: string; title: string }[] = [
  { value: 'fields', label: 'Fields', title: 'Name the keys of a rule body and their types' },
  { value: 'json', label: 'JSON', title: 'Write the JSON schema yourself' },
];

export function SchemaBuilder({ state, onChange }: { state: SchemaState; onChange: (next: SchemaState) => void }) {
  const [jsonOnly, setJsonOnly] = useState<string | null>(null);

  function setMode(mode: SchemaMode) {
    if (mode === state.mode) return;
    if (mode === 'json') {
      const schema = fieldsProblem(state.model) ? null : schemaFromFields(state.model);
      onChange({ ...state, mode, text: schema ? JSON.stringify(schema, null, 2) : '' });
      return;
    }
    const parsed = parseJsonObject(state.text);
    if (parsed.error) {
      setJsonOnly('Fix the JSON first, or clear it, to go back to fields.');
      return;
    }
    const model = fieldsFromSchema(parsed.value);
    if (!model) {
      setJsonOnly(
        'This schema uses more than the field editor covers (nested objects, formats or conditions). Keep editing it as JSON, or clear it to start from fields.',
      );
      return;
    }
    setJsonOnly(null);
    onChange({ ...state, mode, model });
  }

  function update(id: string, patch: Partial<SchemaField>) {
    onChange({
      ...state,
      model: { ...state.model, fields: state.model.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
    });
  }

  function remove(id: string) {
    onChange({ ...state, model: { ...state.model, fields: state.model.fields.filter((f) => f.id !== id) } });
  }

  const problem = state.mode === 'fields' ? fieldsProblem(state.model) : undefined;
  return (
    <div className={styles.builder} data-testid="schema-builder" data-mode={state.mode}>
      <div className={styles.head}>
        <Text as="span" variant="base" weight={600}>
          Rule body
        </Text>
        <SegmentedControl<SchemaMode> label="Schema editor" value={state.mode} onChange={setMode} options={MODES} />
      </div>
      {state.mode === 'fields' ? (
        <>
          {state.model.fields.length ? (
            <ul className={styles.fields} aria-label="Body fields">
              {state.model.fields.map((field) => (
                <li key={field.id} className={styles.field} data-testid="schema-field">
                  <div className={styles.fieldRow}>
                    <TextField
                      label="Key"
                      value={field.name}
                      onChange={(name) => update(field.id, { name })}
                      placeholder="max_amount"
                      mono
                      width="100%"
                      data-testid="schema-field-name"
                    />
                    <Select
                      label="Type"
                      items={FIELD_TYPES.map((t) => ({ key: t.key, label: t.label, description: t.description }))}
                      value={field.type}
                      onChange={(key) => {
                        if (key) update(field.id, { type: key as FieldType });
                      }}
                      searchable={false}
                      width="100%"
                    />
                    <TextField
                      label="Meaning"
                      value={field.description}
                      onChange={(description) => update(field.id, { description })}
                      placeholder="What the agent puts here"
                      width="100%"
                      data-testid="schema-field-description"
                    />
                    <span className={styles.fieldEnd}>
                      <Checkbox
                        isSelected={field.required}
                        onChange={(checked) => update(field.id, { required: checked })}
                        data-testid="schema-field-required"
                      >
                        Required
                      </Checkbox>
                      <IconButton
                        tile
                        tone="danger"
                        icon="trash"
                        label={`Remove the field ${field.name || 'without a name'}`}
                        onPress={() => remove(field.id)}
                        data-testid="schema-field-remove"
                      />
                    </span>
                  </div>
                  {field.type === 'choice' ? (
                    <TextField
                      label="Allowed values, comma-separated"
                      value={field.choices}
                      onChange={(choices) => update(field.id, { choices })}
                      placeholder="low, medium, high"
                      width="100%"
                      data-testid="schema-field-choices"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Text as="p" variant="sm" tone="muted" className={styles.empty}>
              No body yet: a rule of this category is a title and a sentence. Add a field to make every rule carry
              a structured body the agent fills.
            </Text>
          )}
          <div className={styles.foot}>
            <Button
              variant="neutral"
              icon={<Icon name="plus" size={12} />}
              onPress={() =>
                onChange({ ...state, model: { ...state.model, fields: [...state.model.fields, newField()] } })
              }
              data-testid="schema-add-field"
            >
              Add field
            </Button>
            {state.model.fields.length ? (
              <Checkbox
                isSelected={state.model.strict}
                onChange={(strict) => onChange({ ...state, model: { ...state.model, strict } })}
                data-testid="schema-strict"
              >
                No other keys
              </Checkbox>
            ) : null}
            {problem ? (
              <Text as="span" variant="sm" tone="danger" role="alert" data-testid="schema-problem">
                {problem}
              </Text>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {jsonOnly ? (
            <InlineNotice tone="info" data-testid="schema-json-only">
              {jsonOnly}
            </InlineNotice>
          ) : null}
          <Textarea
            label="JSON schema"
            hideLabel
            value={state.text}
            onChange={(text) => onChange({ ...state, text })}
            rows={10}
            mono
            spellCheck={false}
            placeholder={'{"type": "object", "required": ["field"], "properties": {"field": {"type": "string"}}}'}
            help="Draft 2020-12. Empty means no body schema."
            errorMessage={parseJsonObject(state.text).error ?? undefined}
            data-testid="category-schema"
          />
        </>
      )}
    </div>
  );
}
