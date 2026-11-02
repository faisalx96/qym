/**
 * Descriptor union across the selected environments, model slots, leaf-kind
 * classification, input parsing and zod schemas per leaf.
 */
import { z } from 'zod';
import { checkValues } from './sweeps';
import { isPlainObject, isSweepValue, matchPointer, sameValue, splitPointer } from './pointers';
import type {
  DescriptorEntry,
  DescriptorGroup,
  EnvData,
  EvaluatorPanel,
  FormContext,
  FormDescriptor,
  FormResponse,
  JsonValue,
  ModelOptions,
  ModelSlot,
  UnionModel,
  UnionSlot,
} from './types';

// ── Loading helpers ──────────────────────────────────────────────────────

/** Confirmed slots of a model-slots response. */
export function confirmedSlots(slots: readonly ModelSlot[] | undefined): ModelSlot[] {
  return (slots ?? []).filter((s) => s.status === undefined || s.status === 'confirmed');
}

/**
 * The descriptor without the platform-owned top-level fields (`read_only`, e.g. the dataset read
 * token the platform fills at dispatch): the launch form never shows them (spec-b B4-7).
 */
export function withoutPlatformOwned(form: FormDescriptor | null | undefined): FormDescriptor | null {
  if (!form) return null;
  const owned = Object.keys(form.fields).filter((p) => form.fields[p]?.read_only && !form.fields[p]?.parent);
  if (!owned.length) return form;
  const drop = new Set(owned);
  return {
    ...form,
    root: form.root.filter((p) => !drop.has(p)),
    fields: Object.fromEntries(Object.entries(form.fields).filter(([p]) => !drop.has(p))),
    groups: form.groups.map((g) => ({ ...g, pointers: g.pointers.filter((p) => !drop.has(p)) })),
  };
}

/** EnvData from the raw responses of one environment (any of them may be missing). */
export function envDataFrom(input: {
  id: string;
  name: string;
  form?: FormResponse | null;
  formError?: string;
  slots?: { slots?: ModelSlot[]; needs_confirmation?: boolean } | null;
  options?: ModelOptions | null;
  optionsError?: string;
  maxPriority?: EnvData['maxPriority'];
  defaultPriority?: EnvData['defaultPriority'];
  latencyMinRole?: EnvData['latencyMinRole'];
  schemaHash?: string | null;
  extra?: EnvData['extra'];
}): EnvData {
  return {
    id: input.id,
    name: input.name,
    maxPriority: input.maxPriority,
    defaultPriority: input.defaultPriority,
    latencyMinRole: input.latencyMinRole,
    schemaHash: input.schemaHash ?? input.form?.schema_hash ?? null,
    form: withoutPlatformOwned(input.form?.descriptor),
    formError: input.formError,
    evaluator: input.form?.evaluator ?? null,
    slots: confirmedSlots(input.slots?.slots),
    needsConfirmation: Boolean(input.slots?.needs_confirmation),
    options: input.options ?? null,
    optionsError: input.optionsError,
    extra: input.extra,
  };
}

// ── Union of the selected environments (§6 multi-environment) ────────────

export function buildUnion(envs: ReadonlyArray<Pick<EnvData, 'id' | 'form'>>): UnionModel {
  const fields: Record<string, DescriptorEntry> = {};
  const presence: Record<string, string[]> = {};
  const groups: DescriptorGroup[] = [];
  const groupIndex: Record<string, DescriptorGroup> = {};
  const ids: string[] = [];
  for (const env of envs) {
    const d = env.form;
    if (!d) continue;
    ids.push(env.id);
    for (const pointer of Object.keys(d.fields ?? {})) {
      const entry = d.fields[pointer] as DescriptorEntry;
      (presence[pointer] ??= []).push(env.id);
      const merged = fields[pointer];
      if (!merged) {
        fields[pointer] = {
          ...entry,
          ...(entry.rows ? { rows: entry.rows.slice() } : {}),
          ...(entry.required_keys ? { required_keys: entry.required_keys.slice() } : {}),
        };
        continue;
      }
      for (const row of entry.rows ?? []) {
        if (merged.rows && !merged.rows.some((r) => r.key === row.key)) merged.rows.push(row);
      }
      for (const key of entry.required_keys ?? []) {
        if (merged.required_keys && !merged.required_keys.includes(key)) merged.required_keys.push(key);
      }
    }
    for (const group of d.groups ?? []) {
      let target = groupIndex[group.id];
      if (!target) {
        target = { id: group.id, label: group.label, pointers: [] };
        groupIndex[group.id] = target;
        groups.push(target);
      }
      for (const p of group.pointers ?? []) if (!target.pointers.includes(p)) target.pointers.push(p);
    }
  }
  return { fields, presence, groups, envs: ids };
}

/** Selected environments (form loaded) that do not have the template. */
export function missingFrom(model: UnionModel, template: string): string[] {
  if (model.envs.length < 2) return [];
  const present = model.presence[template] ?? [];
  return model.envs.filter((id) => !present.includes(id));
}

/** Loaded environments whose schema has no entry for a concrete pointer (§6 "not in env"). */
export function envsMissing(envs: readonly EnvData[], pointer: string): string[] {
  return envs.filter((e) => e.form && !matchPointer(e.form, pointer)).map((e) => e.id);
}

export function notInEnvMessage(pointer: string, envName: string): string {
  const segments = splitPointer(pointer);
  return `${segments[segments.length - 1] ?? pointer} is not in environment "${envName}": reset it or deselect ${envName}.`;
}

/** Confirmed slots across the selected environments plus this experiment's extra endpoints. */
export function buildUnionSlots(envs: readonly EnvData[], extraEndpoints: readonly string[]): UnionSlot[] {
  const slots: UnionSlot[] = [];
  const index: Record<string, UnionSlot> = {};
  const merge = (envId: string, slot: ModelSlot, extra: boolean) => {
    let merged = index[slot.slot_key];
    if (!merged) {
      merged = {
        slot_key: slot.slot_key,
        label: slot.label || slot.slot_key,
        kind: slot.kind,
        required: Boolean(slot.required),
        field_map: {},
        extra_field_maps: [],
        pointers: [],
        envs: [],
        extra,
      };
      index[slot.slot_key] = merged;
      slots.push(merged);
    }
    if (!merged.envs.includes(envId)) merged.envs.push(envId);
    merged.extra = merged.extra && extra; // confirmed on any environment wins
    merged.required = merged.required || Boolean(slot.required);
    for (const role of Object.keys(slot.field_map ?? {})) {
      const p = slot.field_map[role];
      if (p) merged.field_map[role] = p;
    }
    for (const set of slot.extra_field_maps ?? []) {
      const clean: Record<string, string> = {};
      for (const r of Object.keys(set)) if (set[r]) clean[r] = set[r] as string;
      if (!merged.extra_field_maps.some((m) => JSON.stringify(m) === JSON.stringify(clean)))
        merged.extra_field_maps.push(clean);
    }
    for (const set of [slot.field_map ?? {}, ...(slot.extra_field_maps ?? [])]) {
      for (const role of Object.keys(set)) {
        const p = set[role];
        if (p && !merged.pointers.includes(p)) merged.pointers.push(p);
      }
    }
  };
  for (const env of envs) for (const slot of env.slots) merge(env.id, slot, false);
  for (const name of extraEndpoints) {
    for (const env of envs) {
      const slot = env.extra?.[name];
      if (slot) merge(env.id, slot, true);
    }
  }
  slots.sort((a, b) => (a.slot_key === 'endpoint:primary' ? -1 : b.slot_key === 'endpoint:primary' ? 1 : 0));
  return slots;
}

export interface ContextInput {
  /** The selected environments, in selection order. */
  envs: readonly EnvData[];
  extraEndpoints?: readonly string[];
  datasetNames?: readonly string[];
  evaluatorPanel?: EvaluatorPanel | null;
  maxJobs?: number | null;
  isManager?: boolean;
  envNames?: Readonly<Record<string, string>>;
}

/** Everything the pure functions need to know about the loaded environments. */
export function buildContext(input: ContextInput): FormContext {
  const envs = input.envs.slice();
  return {
    envs,
    union: buildUnion(envs),
    slots: buildUnionSlots(envs, input.extraEndpoints ?? []),
    datasetNames: (input.datasetNames ?? []).slice(),
    evaluatorPanel: input.evaluatorPanel ?? null,
    maxJobs: input.maxJobs ?? null,
    isManager: Boolean(input.isManager),
    envNames: { ...(input.envNames ?? {}) },
  };
}

/** True while any selected environment's form is still loading (or none is selected). */
export function contextLoading(ctx: Pick<FormContext, 'envs'>): boolean {
  return ctx.envs.length === 0 || ctx.envs.some((e) => e.loading);
}

export function envName(ctx: Pick<FormContext, 'envs'>, id: string): string {
  return ctx.envs.find((e) => e.id === id)?.name ?? id;
}

/** The endpoints collection of the selected environments' settings, if any. */
export function endpointsCollection(model: UnionModel): DescriptorEntry | null {
  return (
    Object.values(model.fields).find((e) => e.kind === 'collection' && e.key_param === 'endpoint') ?? null
  );
}

/** Project models for one slot: union across envs, available only if usable on all. */
export interface SlotConnection {
  id: string;
  name: string;
  model: string | null;
  available: boolean;
  reasons: string[];
}

export function slotConnections(
  ctx: Pick<FormContext, 'envs'>,
  slot: Pick<UnionSlot, 'slot_key' | 'envs'>,
): SlotConnection[] {
  const byId: Record<string, SlotConnection> = {};
  const list: SlotConnection[] = [];
  for (const envId of slot.envs) {
    const env = ctx.envs.find((e) => e.id === envId);
    for (const conn of env?.options?.connections ?? []) {
      const perSlot = conn.slots?.[slot.slot_key] ?? { available: conn.available, reason: conn.reason };
      let merged = byId[conn.connection_id];
      if (!merged) {
        merged = { id: conn.connection_id, name: conn.name, model: conn.model, available: true, reasons: [] };
        byId[conn.connection_id] = merged;
        list.push(merged);
      }
      if (!perSlot.available) {
        merged.available = false;
        merged.reasons.push(
          (perSlot.reason || 'Not available') + (slot.envs.length > 1 ? ` (${env?.name ?? envId})` : ''),
        );
      }
    }
  }
  return list;
}

/** Project models usable on every endpoint (the global picker). */
export function globalConnections(
  ctx: Pick<FormContext, 'envs'>,
  slots: readonly UnionSlot[],
): SlotConnection[] {
  const byId: Record<string, SlotConnection & { seen: number }> = {};
  const list: Array<SlotConnection & { seen: number }> = [];
  for (const slot of slots) {
    for (const conn of slotConnections(ctx, slot)) {
      let merged = byId[conn.id];
      if (!merged) {
        merged = { ...conn, reasons: [], seen: 0 };
        byId[conn.id] = merged;
        list.push(merged);
      }
      merged.seen += 1;
      if (!conn.available) {
        merged.available = false;
        merged.reasons = merged.reasons.concat(
          conn.reasons.map((r) => (slots.length > 1 ? slot.label + ': ' : '') + r),
        );
      }
    }
  }
  return list.map(({ seen, ...conn }) => {
    if (seen < slots.length)
      return { ...conn, available: false, reasons: [...conn.reasons, 'Not offered for every endpoint'] };
    return conn;
  });
}

/** Whether model API keys may be sent to every selected environment. */
export function temporaryKeysAllowed(ctx: Pick<FormContext, 'envs'>): {
  allowed: boolean;
  reason: string | null;
} {
  let allowed = true;
  let reason: string | null = null;
  for (const env of ctx.envs) {
    if (env.options && env.options.temporary_keys_allowed === false) {
      allowed = false;
      reason ??= `${env.options.temporary_keys_reason || 'Model API keys are not sent to this environment'} (${env.name})`;
    }
  }
  return { allowed, reason };
}

// ── Leaf classification ──────────────────────────────────────────────────

export type LeafKind =
  'secret' | 'boolean' | 'enum' | 'endpoint-ref' | 'json' | 'array' | 'object' | 'number' | 'text';

export function leafKind(entry: DescriptorEntry): LeafKind {
  if (entry.secret || entry.widget === 'secret') return 'secret';
  if (entry.type === 'boolean') return 'boolean';
  if (entry.type === 'enum') return 'enum';
  if (entry.widget === 'endpoint-ref') return 'endpoint-ref';
  if (entry.type === 'json') return 'json';
  if (entry.type === 'array') return 'array';
  if (entry.type === 'object') return 'object';
  if (entry.type === 'integer' || entry.type === 'number') return 'number';
  return 'text';
}

/** Whether a value can be shown by the field's own widget (else it is edited as JSON). */
export function fitsWidget(entry: DescriptorEntry, value: unknown): boolean {
  if (value === undefined || isSweepValue(value)) return true;
  if (entry.secret || entry.widget === 'secret') return true;
  switch (entry.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return (entry.enum ?? []).some((v) => sameValue(v, value));
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

/** The entry as a JSON field (B20): used when a value does not fit the widget. */
export function jsonFallback(entry: DescriptorEntry): DescriptorEntry {
  if (entry.fallback) return entry;
  return { ...entry, type: 'json', widget: 'json', enum: null, fallback: entry.type };
}

/**
 * The entry a value is edited with: its own, or a JSON field when the value does not
 * fit the widget (a preset or clone may hold any value), so nothing is hidden.
 */
export function editEntry(
  entry: DescriptorEntry,
  value: unknown,
  invalid?: { json?: boolean } | null,
): DescriptorEntry {
  if (entry.type === 'json') return entry;
  if (invalid ? !invalid.json : fitsWidget(entry, value)) return entry;
  return jsonFallback(entry);
}

/** Whether text that is not JSON is kept as a string (a JSON field that takes strings). */
export function acceptsText(entry: DescriptorEntry, text: string): boolean {
  if (entry.type !== 'json' || entry.fallback) return false;
  if (entry.accepts && !entry.accepts.includes('string')) return false;
  // Text that looks like JSON is a typo, not a string.
  return !/^\s*[[{"]/.test(text);
}

export type ParsedInput = { unset: true } | { error: string } | { value: JsonValue };

/**
 * Raw control text -> value. Select controls pass: '' (inherit), 'true'/'false'
 * (boolean) or the option index (enum, see `enumOptions`).
 */
export function parseInput(entry: DescriptorEntry, raw: string): ParsedInput {
  const type = entry.type;
  if (type === 'boolean') return raw === '' ? { unset: true } : { value: raw === 'true' };
  if (type === 'enum') {
    if (raw === '') return { unset: true };
    const value = (entry.enum ?? [])[Number(raw)];
    return value === undefined ? { error: 'Choose one of the listed values' } : { value };
  }
  const text = String(raw);
  if (entry.widget === 'endpoint-ref') return text === '' ? { unset: true } : { value: text };
  if (type === 'integer' || type === 'number') {
    const trimmed = text.trim();
    if (!trimmed) return { unset: true };
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return { error: 'Enter a number' };
    if (type === 'integer' && !Number.isInteger(num)) return { error: 'Enter a whole number' };
    return { value: num };
  }
  if (type === 'json' || type === 'array' || type === 'object') {
    if (!text.trim()) return { unset: true };
    try {
      return { value: JSON.parse(text) as JsonValue };
    } catch {
      if (acceptsText(entry, text)) return { value: text };
      return { error: 'Enter valid JSON' };
    }
  }
  return text === '' ? { unset: true } : { value: text };
}

/** Options of an enum select: `value` is the index string `parseInput` reads back. */
export function enumOptions(entry: DescriptorEntry): Array<{ value: string; label: string; raw: JsonValue }> {
  return (entry.enum ?? []).map((raw, i) => ({
    value: String(i),
    label: typeof raw === 'string' ? (raw === '' ? '""' : raw) : JSON.stringify(raw),
    raw,
  }));
}

/** The control text for a value: the raw text of an invalid edit, else the value. */
export function formatInput(entry: DescriptorEntry, value: unknown, invalidRaw?: string): string {
  if (invalidRaw !== undefined) return invalidRaw;
  if (value === undefined) return '';
  if (entry.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  if (entry.type === 'enum') {
    const i = (entry.enum ?? []).findIndex((v) => sameValue(v, value));
    return i >= 0 ? String(i) : '';
  }
  if (entry.type === 'json' || entry.type === 'array' || entry.type === 'object')
    return JSON.stringify(value, null, 2);
  return String(value);
}

export function formatDefault(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '""' : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Placeholder / "unset" label of a control. */
export function placeholderFor(entry: DescriptorEntry, boundBy?: string | null): string {
  if (boundBy) return `Set by ${boundBy}`;
  return entry.has_default ? `Default: ${formatDefault(entry.default)}` : 'Inherited from environment';
}

/** Hint line under a field: description, bounds, format, JSON accepts. */
export function hintText(entry: DescriptorEntry): string {
  const parts: string[] = [];
  if (entry.hints?.text) parts.push(entry.hints.text);
  else if (entry.description) parts.push(entry.description);
  const b = entry.bounds ?? {};
  const range: string[] = [];
  if (b.minimum != null) range.push(`≥ ${b.minimum}`);
  if (b.exclusiveMinimum != null) range.push(`> ${b.exclusiveMinimum}`);
  if (b.maximum != null) range.push(`≤ ${b.maximum}`);
  if (b.exclusiveMaximum != null) range.push(`< ${b.exclusiveMaximum}`);
  if (range.length) parts.push(`Range ${range.join(', ')}.`);
  if (entry.format && entry.type === 'string' && !entry.secret) parts.push(`Format: ${entry.format}.`);
  if (entry.type === 'array' && entry.item_type) parts.push(`A JSON list of ${entry.item_type} values.`);
  if (entry.type === 'json' && !entry.fallback) {
    parts.push(
      entry.accepts && entry.accepts.length
        ? `JSON value: ${entry.accepts.join(' or ')}.${entry.accepts.includes('string') ? ' Plain text is sent as a string.' : ''}`
        : 'Any JSON value; plain text is sent as a string.',
    );
  }
  if (entry.fallback) parts.push(`This value is not a ${entry.fallback}, so it is edited as JSON.`);
  return parts.join(' ');
}

// ── zod schema per leaf ──────────────────────────────────────────────────

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function itemTypeProblem(itemType: string | null | undefined, value: unknown[]): string | null {
  if (!itemType) return null;
  const ok = (v: unknown) => {
    const t = jsonType(v);
    if (itemType === 'number') return t === 'number' || t === 'integer';
    return t === itemType;
  };
  return value.every(ok) ? null : `Every item must be ${itemType}`;
}

/** The value-level schema of a leaf (no sweeps). Messages are user-facing. */
export function valueSchema(entry: DescriptorEntry): z.ZodType<unknown> {
  const b = entry.bounds ?? {};
  switch (leafKind(entry)) {
    case 'secret':
      return z.never({
        error: 'Keys are never entered here: bind a model slot (project or temporary model) instead',
      });
    case 'boolean':
      return z.boolean({ error: 'Must be true or false' });
    case 'enum':
      return z.custom<unknown>((v) => (entry.enum ?? []).some((e) => sameValue(e, v)), {
        error: 'Must be one of the listed values',
      });
    case 'number': {
      const whole = entry.type === 'integer';
      return z
        .custom<unknown>(
          (v) => typeof v === 'number' && Number.isFinite(v) && (!whole || Number.isInteger(v)),
          {
            error: whole ? 'Must be a whole number' : 'Must be a number',
          },
        )
        .superRefine((v, ctx) => {
          const n = v as number;
          const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
          if (b.minimum != null && n < b.minimum) fail(`Must be at least ${b.minimum}`);
          if (b.exclusiveMinimum != null && n <= b.exclusiveMinimum)
            fail(`Must be greater than ${b.exclusiveMinimum}`);
          if (b.maximum != null && n > b.maximum) fail(`Must be at most ${b.maximum}`);
          if (b.exclusiveMaximum != null && n >= b.exclusiveMaximum)
            fail(`Must be less than ${b.exclusiveMaximum}`);
          if (b.multipleOf != null && b.multipleOf > 0) {
            const q = n / b.multipleOf;
            if (Math.abs(q - Math.round(q)) > 1e-9) fail(`Must be a multiple of ${b.multipleOf}`);
          }
        });
    }
    case 'endpoint-ref':
      return z.string({ error: 'Must be an endpoint name' }).min(1, { error: 'Must be an endpoint name' });
    case 'array':
      return z
        .custom<unknown>((v) => Array.isArray(v), { error: 'Must be a list' })
        .superRefine((v, ctx) => {
          const problem = itemTypeProblem(entry.item_type, v as unknown[]);
          if (problem) ctx.addIssue({ code: 'custom', message: problem });
        });
    case 'object':
      return z.custom<unknown>((v) => isPlainObject(v), { error: 'Must be an object' });
    case 'json': {
      const accepts = entry.accepts;
      if (!accepts || !accepts.length) return z.unknown();
      return z.custom<unknown>(
        (v) => {
          const kind = jsonType(v);
          return accepts.includes(kind) || (kind === 'integer' && accepts.includes('number'));
        },
        { error: `Must be ${accepts.join(' or ')}` },
      );
    }
    default: {
      return z
        .custom<unknown>((v) => typeof v === 'string', { error: 'Must be a string' })
        .superRefine((v, ctx) => {
          const s = v as string;
          if (b.minLength != null && s.length < b.minLength)
            ctx.addIssue({ code: 'custom', message: `Use at least ${b.minLength} characters` });
          if (b.maxLength != null && s.length > b.maxLength)
            ctx.addIssue({ code: 'custom', message: `Use at most ${b.maxLength} characters` });
          if (entry.pattern) {
            let re: RegExp | null = null;
            try {
              re = new RegExp(entry.pattern);
            } catch {
              re = null;
            }
            if (re && !re.test(s))
              ctx.addIssue({ code: 'custom', message: 'Does not match the expected format' });
          }
        });
    }
  }
}

/**
 * zod schema for a leaf's value, generated from type / bounds / enum / pattern /
 * accepts. A `{"sweep": [...]}` value is accepted when each item fits (`checkValues`);
 * `undefined` (unset: inherit) is always valid.
 */
export function leafSchema(entry: DescriptorEntry): z.ZodType<unknown> {
  const base = valueSchema(entry);
  return z.unknown().superRefine((value, ctx) => {
    if (value === undefined) return;
    if (isSweepValue(value)) {
      const problems = checkValues(entry, value);
      for (const problem of problems) {
        ctx.addIssue({
          code: 'custom',
          message: problem.message,
          path: problem.index == null ? ['sweep'] : ['sweep', problem.index],
        });
      }
      if (problems.length) return;
      // Types are fine: each value must also respect the bounds.
      value.sweep.forEach((item, i) => {
        if (item === null) return;
        const result = base.safeParse(item);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ code: 'custom', message: issue.message, path: ['sweep', i] });
          }
        }
      });
      return;
    }
    const result = base.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
  });
}

/** First problem of a value for a leaf, or null. */
export function validateLeafValue(entry: DescriptorEntry, value: unknown): string | null {
  const result = leafSchema(entry).safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Invalid value');
}

/**
 * Schema for the raw text of a control (for RHF `zodResolver`): parses with
 * `parseInput` (empty = unset) then validates the value.
 */
export function rawInputSchema(entry: DescriptorEntry): z.ZodType<string> {
  const edit = entry;
  return z.string().superRefine((raw, ctx) => {
    const parsed = parseInput(edit, raw);
    if ('unset' in parsed) return;
    if ('error' in parsed) {
      ctx.addIssue({ code: 'custom', message: parsed.error });
      return;
    }
    const problem = validateLeafValue(edit, parsed.value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
}

/** A descriptor-less value (no schema describes it): edited as JSON. */
export function unmatchedEntry(pointer: string): DescriptorEntry {
  const segs = splitPointer(pointer);
  return {
    pointer,
    name: segs[segs.length - 1] ?? pointer,
    label: pointer,
    description: 'A value this form has no setting for; edited as JSON.',
    path: segs,
    parent: null,
    params: [],
    kind: 'field',
    type: 'json',
    widget: 'json',
    group: null,
    required: false,
    has_default: false,
    default: null,
    secret: false,
    enum: null,
    bounds: {},
    pattern: null,
    format: null,
    accepts: null,
    item_type: null,
  };
}

/** Pointers of `values`/`invalid` that no selected schema describes as a field. */
export function unmatchedPointers(model: UnionModel, pointers: Iterable<string>): string[] {
  const descriptor: Pick<FormDescriptor, 'root' | 'fields'> = {
    root: model.groups.flatMap((g) => g.pointers),
    fields: model.fields,
  };
  const out: string[] = [];
  for (const p of pointers) {
    if (out.includes(p)) continue;
    const template = matchPointer(descriptor, p);
    const entry = template ? model.fields[template] : undefined;
    if (entry && entry.kind === 'field') continue;
    out.push(p);
  }
  return out.sort();
}
