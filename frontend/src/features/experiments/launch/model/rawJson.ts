/**
 * Raw JSON: the §8.1 document as text, two-way synced with the form and fully
 * validated before it is applied. Temporary-model keys show as `{"$secret": ref}` and
 * a literal key typed into the text is refused (never applied, stored or sent).
 */
import { deriveGlobalModel, pruneSecrets } from './bindings';
import { leafSchema } from './descriptor';
import {
  baseConfig,
  baseValue,
  configEntry,
  isReservedKey,
  metadataText,
  PLACEHOLDER_PREFIX,
  platformOwnedConfig,
  platformOwnedEvaluator,
  reservedPrefix,
  syncMetaSeed,
} from './evaluator';
import {
  deepCopy,
  escapeSegment,
  has,
  isPlainObject,
  isSweepValue,
  matchTemplate,
  sameValue,
  splitPointer,
} from './pointers';
import type { SecretStore } from './secrets';
import { buildSpec } from './spec';
import { checkLinks, checkValues, sweepItemKey } from './sweeps';
import type {
  Bindings,
  DatasetChoice,
  DescriptorEntry,
  EvaluatorPanel,
  FormContext,
  JsonObject,
  JsonValue,
  LaunchDocument,
  SlotBinding,
  SweepModelItem,
  Values,
} from './types';

const DOCUMENT_KEYS = ['schema_hash', 'evaluator', 'slot_bindings', 'env_overrides', 'links', 'base_source'];
const EVALUATOR_KEYS = ['dataset', 'dataset_version', 'config', 'report_k', 'model'];
const TEMPORARY_KEYS = ['label', 'model', 'base_url', 'api_key'];
const CONNECTION_KEYS = ['connection_id', 'name', 'model'];
const DATASET_SWEEP_MESSAGE = 'The dataset cannot be swept in this form';

export interface RawJsonError {
  pointer: string;
  message: string;
}

export interface ReadEvaluator {
  dataset: string | null;
  dataset_version: string | null;
  report_k: number | null;
  config: JsonObject;
  meta: Array<{ key: string; raw: string }>;
}

export interface RawJsonRead {
  errors: RawJsonError[];
  evaluator?: ReadEvaluator;
  bindings?: Bindings;
  values?: Values;
  links?: string[][] | null;
}

function jsonErr(e: unknown): string {
  return e instanceof Error ? e.message : 'parse error';
}

function placeholderPointers(value: unknown, pointer: string, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.includes(PLACEHOLDER_PREFIX)) out.push(pointer);
  } else if (Array.isArray(value)) {
    value.forEach((child, i) => placeholderPointers(child, pointer + '/' + i, out));
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const child = pointer + '/' + escapeSegment(key);
      if (key.includes(PLACEHOLDER_PREFIX)) out.push(child);
      else placeholderPointers(value[key], child, out);
    }
  }
  return out;
}

function sweepErrors(
  entry: DescriptorEntry,
  value: unknown,
  pointer: string,
  errors: RawJsonError[],
): boolean {
  const problems = checkValues(entry, value);
  problems.forEach((p) =>
    errors.push({ pointer: p.index == null ? pointer : pointer + '/sweep/' + p.index, message: p.message }),
  );
  return !problems.length;
}

function roleRowProblem(ctx: Pick<FormContext, 'union'>, template: string, pointer: string): string | null {
  let problem: string | null = null;
  for (const table of Object.values(ctx.union.fields)) {
    if (table.kind !== 'role_table' || !template.startsWith(table.pointer + '/')) continue;
    const depth = splitPointer(table.pointer).length;
    const key = splitPointer(pointer)[depth - 1];
    if (!(table.rows ?? []).some((r) => r.key === key))
      problem = 'Unknown role for the selected environments';
  }
  return problem;
}

function flattenDoc(
  value: unknown,
  pointer: string,
  ctx: Pick<FormContext, 'union'>,
  out: Values,
  errors: RawJsonError[],
): void {
  const docPointer = '/env_overrides' + pointer;
  if (value === null) return; // unset: inherit
  const template = pointer ? matchTemplate(ctx.union.fields, pointer) : null;
  const entry = template ? ctx.union.fields[template] : undefined;
  if (pointer && !entry) {
    errors.push({ pointer: docPointer, message: 'Unknown setting for the selected environments' });
    return;
  }
  if (isSweepValue(value)) {
    if (!entry || entry.kind !== 'field') {
      errors.push({ pointer: docPointer, message: 'Only a single setting can be swept' });
      return;
    }
    const role = roleRowProblem(ctx, template as string, pointer);
    if (role) {
      errors.push({ pointer: docPointer, message: role });
      return;
    }
    if (entry.secret || entry.widget === 'secret') {
      errors.push({
        pointer: docPointer,
        message: 'Keys are never entered here: bind a model slot (project or temporary model) instead',
      });
      return;
    }
    if (sweepErrors(entry, value, docPointer, errors)) out[pointer] = deepCopy(value as unknown as JsonValue);
    return;
  }
  if (isPlainObject(value) && (!entry || entry.kind !== 'field')) {
    for (const key of Object.keys(value))
      flattenDoc(value[key], pointer + '/' + escapeSegment(key), ctx, out, errors);
    return;
  }
  if (!entry || entry.kind !== 'field') {
    errors.push({ pointer: docPointer, message: 'Must be an object' });
    return;
  }
  const role = roleRowProblem(ctx, template as string, pointer);
  if (role) {
    errors.push({ pointer: docPointer, message: role });
    return;
  }
  if (entry.secret || entry.widget === 'secret') {
    errors.push({
      pointer: docPointer,
      message: 'Keys are never entered here: bind a model slot (project or temporary model) instead',
    });
    return;
  }
  const result = leafSchema(entry).safeParse(value);
  if (!result.success) {
    errors.push({ pointer: docPointer, message: result.error.issues[0]?.message ?? 'Invalid value' });
    return;
  }
  out[pointer] = value as JsonValue;
}

/** One `{connection_id}` / `{temporary}` binding, or null (errors pushed). Refuses literal keys. */
function readBinding(
  b: unknown,
  pointer: string,
  slotKey: string,
  doc: LaunchDocument,
  secrets: SecretStore,
  errors: RawJsonError[],
): SlotBinding | null {
  const shape = 'Must be {"connection_id": …}, {"temporary": …} or null';
  if (!isPlainObject(b)) {
    errors.push({ pointer, message: shape });
    return null;
  }
  if (has(b, 'connection_id') && !has(b, 'temporary')) {
    const extra = Object.keys(b).filter((k) => !CONNECTION_KEYS.includes(k));
    if (extra.length) {
      errors.push({ pointer, message: 'Unknown binding keys: ' + extra.join(', ') });
      return null;
    }
    if (typeof b['connection_id'] !== 'string' || !b['connection_id']) {
      errors.push({ pointer: pointer + '/connection_id', message: 'Must be a project model id' });
      return null;
    }
    return { kind: 'connection', id: b['connection_id'] };
  }
  const t = b['temporary'];
  if (has(b, 'temporary') && Object.keys(b).length === 1 && isPlainObject(t)) {
    const extra = Object.keys(t).filter((k) => !TEMPORARY_KEYS.includes(k));
    if (extra.length) {
      errors.push({
        pointer: pointer + '/temporary',
        message: 'Unknown temporary model keys: ' + extra.join(', '),
      });
      return null;
    }
    if (typeof t['model'] !== 'string' || !t['model']) {
      errors.push({ pointer: pointer + '/temporary/model', message: 'A temporary model needs a model name' });
      return null;
    }
    if (
      (t['label'] != null && typeof t['label'] !== 'string') ||
      (t['base_url'] != null && typeof t['base_url'] !== 'string')
    ) {
      errors.push({ pointer: pointer + '/temporary', message: 'label and base_url must be strings' });
      return null;
    }
    let ref: string | null = null;
    const key = t['api_key'];
    if (key != null) {
      const valid = isPlainObject(key) && Object.keys(key).length === 1 && typeof key['$secret'] === 'string';
      if (!valid) {
        errors.push({
          pointer: pointer + '/temporary/api_key',
          message: 'Keys are never typed into JSON: use "+ Temporary model" on the model card',
        });
        return null;
      }
      ref = (key as { $secret: string })['$secret'];
      if (!secrets.has(ref)) {
        errors.push({
          pointer: pointer + '/temporary/api_key',
          message: 'Unknown key reference: add the temporary model again to enter its key',
        });
        return null;
      }
    }
    const prev = doc.bindings[slotKey];
    const save = Boolean(prev && prev.kind === 'temporary' && ref && prev.secretRef === ref && prev.save);
    return {
      kind: 'temporary',
      label: typeof t['label'] === 'string' ? t['label'] : undefined,
      model: t['model'],
      baseUrl: typeof t['base_url'] === 'string' ? t['base_url'] : undefined,
      secretRef: ref,
      save,
      needsKey: false,
    };
  }
  errors.push({ pointer, message: shape });
  return null;
}

function readBindings(
  raw: unknown,
  doc: LaunchDocument,
  ctx: FormContext,
  secrets: SecretStore,
  errors: RawJsonError[],
): Bindings {
  const next: Bindings = {};
  const source = raw == null ? {} : raw;
  if (!isPlainObject(source)) {
    errors.push({ pointer: '/slot_bindings', message: 'Must be an object' });
    return next;
  }
  for (const slotKey of Object.keys(source)) {
    const pointer = '/slot_bindings/' + escapeSegment(slotKey);
    const b = source[slotKey];
    const slot = ctx.slots.find((s) => s.slot_key === slotKey);
    if (!slot) {
      errors.push({ pointer, message: 'Unknown model slot for the selected environments' });
      continue;
    }
    if (b === null || (isPlainObject(b) && Object.keys(b).length === 1 && b['inherit'] === true)) continue;
    if (isSweepValue(b)) {
      // A model sweep: each value is a whole binding (or inherit).
      if (!b.sweep.length) {
        errors.push({ pointer, message: 'A sweep needs a non-empty list of models' });
        continue;
      }
      const items: SweepModelItem[] = [];
      const seen = new Set<string>();
      let ok = true;
      b.sweep.forEach((item, i) => {
        const at = pointer + '/sweep/' + i;
        let value: SweepModelItem | null = null;
        if (isPlainObject(item) && Object.keys(item).length === 1 && item['inherit'] === true) {
          value = { inherit: true };
        } else {
          const read = readBinding(item, at, slotKey, doc, secrets, errors);
          if (read) {
            value =
              read.kind === 'connection'
                ? { connection_id: read.id }
                : read.kind === 'temporary'
                  ? { temporary: temporaryItem(read) }
                  : null;
          }
        }
        if (!value) {
          ok = false;
          return;
        }
        const key = sweepItemKey(value);
        if (seen.has(key)) {
          errors.push({ pointer: at, message: 'Duplicate model' });
          ok = false;
          return;
        }
        seen.add(key);
        items.push(value);
      });
      if (ok) next[slotKey] = { kind: 'sweep', items };
      continue;
    }
    const read = readBinding(b, pointer, slotKey, doc, secrets, errors);
    if (read) next[slotKey] = read;
  }
  return next;
}

function temporaryItem(b: Extract<SlotBinding, { kind: 'temporary' }>) {
  const t: { label?: string; model: string; base_url?: string; api_key?: { $secret: string } } = {
    model: b.model,
  };
  if (b.label) t.label = b.label;
  if (b.baseUrl) t.base_url = b.baseUrl;
  if (b.secretRef) t.api_key = { $secret: b.secretRef };
  return t;
}

function readEvaluator(raw: unknown, panel: EvaluatorPanel | null, errors: RawJsonError[]): ReadEvaluator {
  const out: ReadEvaluator = { dataset: null, dataset_version: null, report_k: null, config: {}, meta: [] };
  if (!isPlainObject(raw)) {
    errors.push({ pointer: '/evaluator', message: 'evaluator must be an object' });
    return out;
  }
  const ev = raw;
  for (const key of Object.keys(ev)) {
    if (!EVALUATOR_KEYS.includes(key))
      errors.push({ pointer: '/evaluator/' + escapeSegment(key), message: 'Unknown key' });
  }
  for (const key of platformOwnedEvaluator(panel)) {
    if (ev[key] != null)
      errors.push({
        pointer: '/evaluator/' + key,
        message: `${key} is set by the platform (from the primary model slot); remove it`,
      });
  }
  for (const key of ['dataset', 'dataset_version'] as const) {
    const v = ev[key];
    if (v == null) continue;
    if (isSweepValue(v)) errors.push({ pointer: '/evaluator/' + key, message: DATASET_SWEEP_MESSAGE });
    else if (typeof v !== 'string')
      errors.push({ pointer: '/evaluator/' + key, message: 'Must be a string' });
    else out[key] = v;
  }
  if (ev['report_k'] != null) {
    const k = ev['report_k'];
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 1)
      errors.push({ pointer: '/evaluator/report_k', message: 'Must be a whole number ≥ 1' });
    else out.report_k = k;
  }
  const config = ev['config'] == null ? {} : ev['config'];
  if (!isPlainObject(config)) {
    errors.push({ pointer: '/evaluator/config', message: 'Must be an object' });
    return out;
  }
  if (!panel && Object.keys(config).length) {
    errors.push({
      pointer: '/evaluator/config',
      message: 'The evaluation inputs are still loading; try again',
    });
    return out;
  }
  const owned = platformOwnedConfig(panel);
  const prefix = reservedPrefix(panel);
  for (const name of Object.keys(config)) {
    const pointer = '/evaluator/config/' + escapeSegment(name);
    const value = config[name] as JsonValue;
    if (name === 'run_metadata') {
      if (value == null) continue;
      if (!isPlainObject(value)) {
        errors.push({ pointer, message: 'Must be an object' });
        continue;
      }
      for (const key of Object.keys(value)) {
        if (isReservedKey(key, prefix))
          errors.push({
            pointer: pointer + '/' + escapeSegment(key),
            message: `Keys starting with ${prefix} are reserved for the platform`,
          });
        else out.meta.push({ key, raw: metadataText(value[key]) });
      }
      continue;
    }
    if (owned.includes(name)) {
      if (value != null) errors.push({ pointer, message: `${name} is set by the platform; remove it` });
      continue;
    }
    const entry = configEntry(panel, name);
    if (!entry) {
      const fromEnv = panel?.source && panel.source !== 'static';
      errors.push({
        pointer,
        message: fromEnv
          ? "Not in the selected environments' evaluator schema"
          : 'Unknown key (EvaluatorRequestConfig rejects extra keys)',
      });
      continue;
    }
    if (value == null) continue;
    if (isSweepValue(value)) {
      if (name === 'dataset_alias' || name === 'dataset_version') {
        errors.push({ pointer, message: DATASET_SWEEP_MESSAGE });
        continue;
      }
      if (sweepErrors(entry, value, pointer, errors))
        out.config[name] = deepCopy(value as unknown as JsonValue);
      continue;
    }
    const result = leafSchema(entry).safeParse(value);
    if (!result.success) {
      errors.push({ pointer, message: result.error.issues[0]?.message ?? 'Invalid value' });
      continue;
    }
    out.config[name] = value;
  }
  return out;
}

/** Parse and validate the editor text. On success `errors` is empty and the parts to apply are set. */
export function readRawDocument(
  text: string,
  doc: LaunchDocument,
  ctx: FormContext,
  secrets: SecretStore,
): RawJsonRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { errors: [{ pointer: '', message: 'Invalid JSON: ' + jsonErr(err) }] };
  }
  if (!isPlainObject(parsed))
    return { errors: [{ pointer: '', message: 'The document must be a JSON object' }] };
  const body = parsed;
  const errors: RawJsonError[] = [];
  for (const key of Object.keys(body)) {
    if (!DOCUMENT_KEYS.includes(key))
      errors.push({ pointer: '/' + escapeSegment(key), message: 'Unknown key' });
  }
  for (const pointer of placeholderPointers(body, '')) {
    errors.push({ pointer, message: PLACEHOLDER_PREFIX + ' is reserved for platform slot placeholders' });
  }
  const panel = ctx.evaluatorPanel;
  const evaluator = readEvaluator(body['evaluator'], panel, errors);
  const bindings = readBindings(body['slot_bindings'], doc, ctx, secrets, errors);
  const values: Values = {};
  const env = body['env_overrides'] == null ? {} : body['env_overrides'];
  if (!isPlainObject(env)) errors.push({ pointer: '/env_overrides', message: 'Must be an object' });
  else if (Object.keys(env).length && !ctx.union.envs.length) {
    errors.push({
      pointer: '/env_overrides',
      message: 'Pick an environment (and wait for its settings) first',
    });
  } else {
    for (const key of Object.keys(env)) flattenDoc(env[key], '/' + escapeSegment(key), ctx, values, errors);
  }
  // A bound slot fills its fields: a raw value there is a binding_conflict.
  for (const slot of ctx.slots) {
    if (!bindings[slot.slot_key]) continue;
    for (const p of slot.pointers) {
      if (has(values, p))
        errors.push({
          pointer: '/env_overrides' + p,
          message: `Filled by the ${slot.label} binding; remove this value or unbind the slot`,
        });
    }
  }
  let links: string[][] | null = null;
  if (body['links'] != null) {
    const problems = checkLinks({ ...(body as object), links: body['links'] } as never);
    problems.forEach((e) => errors.push(e));
    if (!problems.length && Array.isArray(body['links']) && body['links'].length)
      links = deepCopy(body['links']) as string[][];
  }
  return { errors, evaluator, bindings, values, links };
}

function datasetFrom(
  ev: ReadEvaluator,
  config: JsonObject,
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'datasetNames'>,
): { dataset: DatasetChoice; leftoverVersion: string | null } {
  let version = ev.dataset_version;
  const name = ev.dataset;
  if (name && ctx.datasetNames.includes(name)) {
    let ref = '';
    if (version) {
      ref = 'v:' + version;
      version = null;
    } else if (typeof config['dataset_alias'] === 'string' && config['dataset_alias']) {
      ref = 'a:' + config['dataset_alias'];
      delete config['dataset_alias'];
    }
    return { dataset: { mode: 'project', name, ref, custom: '' }, leftoverVersion: version };
  }
  if (name) return { dataset: { mode: 'custom', name: '', ref: '', custom: name }, leftoverVersion: version };
  if (doc.dataset.mode === 'custom')
    return { dataset: { ...doc.dataset, custom: '' }, leftoverVersion: version };
  return { dataset: { ...doc.dataset, name: '', ref: '' }, leftoverVersion: version };
}

/**
 * Apply a successful read to the document. Only what differs from the starting point is
 * an edit; a base input the document leaves out is cleared (null), so Raw JSON can
 * remove it too. The document is the whole truth: base extras it leaves out are dropped.
 */
export function applyRawDocument(
  doc: LaunchDocument,
  ctx: FormContext,
  read: RawJsonRead,
  secrets?: SecretStore,
): LaunchDocument {
  const ev = read.evaluator as ReadEvaluator;
  const config = deepCopy(ev.config);
  const { dataset, leftoverVersion } = datasetFrom(ev, config, doc, ctx);
  const edits: Record<string, JsonValue | null> = {};
  for (const name of Object.keys(config)) {
    if (!sameValue(config[name], baseValue(doc, name))) edits[name] = config[name] as JsonValue;
  }
  for (const name of Object.keys(baseConfig(doc))) {
    if (name !== 'run_metadata' && !has(config, name) && baseValue(doc, name) !== undefined)
      edits[name] = null;
  }
  let nextId = doc.evaluator.nextMetaId;
  const meta = ev.meta.map((row) => ({ id: nextId++, key: row.key, raw: row.raw }));
  const extra: { report_k?: number; dataset_version?: string } = {};
  if (ev.report_k != null) extra.report_k = ev.report_k;
  if (leftoverVersion) extra.dataset_version = leftoverVersion;
  const evaluatorExtra = { ...doc.evaluatorExtra };
  if (ev.report_k == null) delete evaluatorExtra['report_k'];
  if (!leftoverVersion) delete evaluatorExtra['dataset_version'];
  let next: LaunchDocument = {
    ...doc,
    dataset,
    bindings: read.bindings ?? {},
    values: read.values ?? {},
    invalid: {},
    evaluatorExtra,
    links: read.links ?? undefined,
    evaluator: {
      config: edits,
      invalid: {},
      meta,
      metaTouched: true,
      metaSeed: JSON.stringify(
        baseConfig(doc)['run_metadata'] && isPlainObject(baseConfig(doc)['run_metadata'])
          ? baseConfig(doc)['run_metadata']
          : {},
      ),
      nextMetaId: nextId,
      extra,
    },
  };
  next = deriveGlobalModel(next, ctx);
  if (secrets) pruneSecrets(next, secrets);
  return syncMetaSeed(next, ctx.evaluatorPanel);
}

// ── Text <-> form state ──────────────────────────────────────────────────

export type RawJsonStatus = 'in-sync' | 'unapplied' | 'errors';

export interface RawJsonState {
  /** What the editor shows. */
  text: string;
  /** The text generated from the form last time. */
  synced: string;
  /** The editor text differs from the form's. */
  dirty: boolean;
  errors: RawJsonError[];
}

/** The form's document as editor text (keys show as `{"$secret": ref}`). */
export function documentText(doc: LaunchDocument, panel?: EvaluatorPanel | null): string {
  return JSON.stringify(buildSpec(doc, panel), null, 2);
}

export function initRawJson(doc: LaunchDocument, panel?: EvaluatorPanel | null): RawJsonState {
  const text = documentText(doc, panel);
  return { text, synced: text, dirty: false, errors: [] };
}

export function rawJsonStatus(state: RawJsonState): RawJsonStatus {
  if (state.errors.length) return 'errors';
  return state.dirty ? 'unapplied' : 'in-sync';
}

/** Form edits flow into the editor while it has no unapplied text (or when forced). */
export function syncRawFromForm(
  state: RawJsonState,
  doc: LaunchDocument,
  panel?: EvaluatorPanel | null,
  force = false,
): RawJsonState {
  if (!force && (state.dirty || state.errors.length)) return state;
  const text = documentText(doc, panel);
  if (!force && text === state.text && text === state.synced) return state;
  return { text, synced: text, dirty: false, errors: [] };
}

export function editRawJson(state: RawJsonState, text: string): RawJsonState {
  return { ...state, text, dirty: text !== state.synced };
}

/** "Revert to form". */
export function revertRawJson(doc: LaunchDocument, panel?: EvaluatorPanel | null): RawJsonState {
  return initRawJson(doc, panel);
}

export interface ApplyRawResult {
  state: RawJsonState;
  doc: LaunchDocument;
  applied: boolean;
}

/** "Apply" (or leaving the editor): validate everything, then update the form. */
export function applyRawJson(
  state: RawJsonState,
  doc: LaunchDocument,
  ctx: FormContext,
  secrets: SecretStore,
  explicit = true,
): ApplyRawResult {
  if (!explicit && !state.dirty && !state.errors.length) return { state, doc, applied: false };
  const read = readRawDocument(state.text, doc, ctx, secrets);
  if (read.errors.length) return { state: { ...state, errors: read.errors }, doc, applied: false };
  const next = applyRawDocument(doc, ctx, read, secrets);
  return { state: initRawJson(next, ctx.evaluatorPanel), doc: next, applied: true };
}
