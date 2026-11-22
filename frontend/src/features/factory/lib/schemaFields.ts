/**
 * The category schema builder's model: a flat list of fields (name, type, description, required, the choices of a
 * choice field) that maps to and from a JSON schema of the shape the agent fills best: one object whose properties
 * are scalars, choices or lists of text. A schema that says more than that (nested objects, formats, conditions)
 * is still accepted as JSON, but `fieldsFromSchema` returns null for it and the editor stays in JSON mode.
 */

export type FieldType = 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'list';

export interface SchemaField {
  /** A stable key for React; never written to the schema. */
  id: string;
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
  /** The allowed values of a choice field, as typed: one comma-separated line (`parseChoices` reads it). */
  choices: string;
}

export interface SchemaModel {
  fields: SchemaField[];
  /** `additionalProperties: false`: a body carries these keys and no other. */
  strict: boolean;
}

export const FIELD_TYPES: { key: FieldType; label: string; description: string }[] = [
  { key: 'text', label: 'Text', description: 'A sentence or a word' },
  { key: 'number', label: 'Number', description: 'Any number, 12.5 or 3' },
  { key: 'integer', label: 'Whole number', description: '0, 1, 2 …' },
  { key: 'boolean', label: 'Yes / no', description: 'true or false' },
  { key: 'choice', label: 'One of', description: 'One of the values you list' },
  { key: 'list', label: 'List of text', description: 'Several words or sentences' },
];

let counter = 0;
export function newField(over: Partial<SchemaField> = {}): SchemaField {
  counter += 1;
  return {
    id: `field-${counter}-${Date.now().toString(36)}`,
    name: '',
    type: 'text',
    description: '',
    required: true,
    choices: '',
    ...over,
  };
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

const ROOT_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'title', 'description', '$schema']);
const PROPERTY_KEYS = new Set(['type', 'description', 'enum', 'items', 'title']);

/** The fields of a schema the builder can show, or null when it says more than the builder covers. */
export function fieldsFromSchema(schema: Dict | null | undefined): SchemaModel | null {
  if (!schema) return { fields: [], strict: false };
  if (schema.type !== 'object') return null;
  if (!Object.keys(schema).every((k) => ROOT_KEYS.has(k))) return null;
  const properties = schema.properties ?? {};
  if (!isDict(properties)) return null;
  const required = schema.required ?? [];
  if (!isStringList(required)) return null;
  const additional = schema.additionalProperties;
  if (additional !== undefined && typeof additional !== 'boolean') return null;
  const fields: SchemaField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!isDict(raw) || !Object.keys(raw).every((k) => PROPERTY_KEYS.has(k))) return null;
    const description = typeof raw.description === 'string' ? raw.description : raw.description === undefined ? '' : null;
    if (description === null) return null;
    const base = { name, description, required: required.includes(name) };
    if (raw.enum !== undefined) {
      if (!isStringList(raw.enum) || raw.enum.length === 0) return null;
      if (raw.type !== undefined && raw.type !== 'string') return null;
      fields.push(newField({ ...base, type: 'choice', choices: raw.enum.join(', ') }));
      continue;
    }
    if (raw.type === 'array') {
      const items = raw.items;
      if (!isDict(items) || items.type !== 'string' || !Object.keys(items).every((k) => k === 'type')) return null;
      fields.push(newField({ ...base, type: 'list' }));
      continue;
    }
    if (raw.items !== undefined) return null;
    const type =
      raw.type === 'string'
        ? 'text'
        : raw.type === 'number'
          ? 'number'
          : raw.type === 'integer'
            ? 'integer'
            : raw.type === 'boolean'
              ? 'boolean'
              : null;
    if (!type) return null;
    fields.push(newField({ ...base, type }));
  }
  if (required.some((name) => !(name in properties))) return null;
  return { fields, strict: additional === false };
}

/** The problem with the fields as they stand, or undefined when a schema can be written from them. */
export function fieldsProblem(model: SchemaModel): string | undefined {
  const names = new Set<string>();
  for (const field of model.fields) {
    const name = field.name.trim();
    if (!name) return 'Every field needs a name';
    if (names.has(name)) return `Two fields are named “${name}”`;
    names.add(name);
    if (field.type === 'choice' && parseChoices(field.choices).length === 0)
      return `List the values “${name}” may take`;
  }
  return undefined;
}

/** The JSON schema of the fields; null without a field (no body schema). */
export function schemaFromFields(model: SchemaModel): Dict | null {
  if (model.fields.length === 0) return null;
  const properties: Dict = {};
  const required: string[] = [];
  for (const field of model.fields) {
    const name = field.name.trim();
    const property: Dict = {};
    if (field.type === 'choice') {
      property.type = 'string';
      property.enum = Array.from(new Set(parseChoices(field.choices)));
    } else if (field.type === 'list') {
      property.type = 'array';
      property.items = { type: 'string' };
    } else if (field.type === 'text') property.type = 'string';
    else property.type = field.type;
    if (field.description.trim()) property.description = field.description.trim();
    properties[name] = property;
    if (field.required) required.push(name);
  }
  const schema: Dict = { type: 'object', properties };
  if (required.length) schema.required = required;
  if (model.strict) schema.additionalProperties = false;
  return schema;
}

/** The choices typed as one comma-separated line. */
export function parseChoices(text: string): string[] {
  return text
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}
