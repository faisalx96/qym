/**
 * Evaluation inputs (steps "Evaluation configurations", B19/B23): `evaluator.config`
 * fields shown on top of the base's own config, and the `run_metadata` key/value
 * rows. Edits are stored on top of the base: a value, or `null` for a base input the
 * user cleared. What the fields show is what is launched.
 */
import { editEntry, jsonFallback, parseInput } from './descriptor';
import { deepCopy, has, isPlainObject, sameValue } from './pointers';
import type {
  DescriptorEntry,
  EvaluatorEdits,
  EvaluatorPanel,
  FormContext,
  InvalidText,
  JsonObject,
  JsonValue,
  LaunchDocument,
  MetaRow,
} from './types';

export const PLACEHOLDER_PREFIX = '{{qym:';
export const METADATA_POINTER = '/evaluator/config/run_metadata';
const DEFAULT_PLATFORM_CONFIG = [
  'run_name',
  'live_mode',
  'model',
  'models',
  'model_full',
  'versioning_details',
];

export function reservedPrefix(panel?: EvaluatorPanel | null): string {
  return panel?.reserved_metadata_prefix || 'qym_';
}

export function isReservedKey(key: string, prefix = 'qym_'): boolean {
  return String(key).toLowerCase().startsWith(prefix.toLowerCase());
}

/** Display text for a run_metadata value; `parseMetadataValue` reads it back. */
export function metadataText(value: unknown): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return JSON.stringify(value); // "123" stays a string, not a number
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

export function parseMetadataValue(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

export function platformOwnedConfig(panel?: EvaluatorPanel | null): string[] {
  return panel?.platform_owned?.config ?? DEFAULT_PLATFORM_CONFIG;
}
export function platformOwnedEvaluator(panel?: EvaluatorPanel | null): string[] {
  return panel?.platform_owned?.evaluator ?? ['model'];
}

/** The panel's descriptor entry for an evaluator.config name. */
export function configEntry(panel: EvaluatorPanel | null | undefined, name: string): DescriptorEntry | null {
  return panel?.descriptor?.fields?.['/' + name] ?? null;
}

// ── Base inputs ──────────────────────────────────────────────────────────

export function baseConfig(doc: Pick<LaunchDocument, 'evaluatorExtra'>): JsonObject {
  const config = doc.evaluatorExtra['config'];
  return isPlainObject(config) ? config : {};
}

export function baseValue(doc: Pick<LaunchDocument, 'evaluatorExtra'>, name: string): JsonValue | undefined {
  const base = baseConfig(doc);
  return has(base, name) && base[name] != null ? base[name] : undefined;
}

/** What a field shows and sends: the edit, else the base value. */
export function configValue(
  doc: Pick<LaunchDocument, 'evaluatorExtra' | 'evaluator'>,
  name: string,
): JsonValue | undefined {
  if (has(doc.evaluator.config, name)) {
    const v = doc.evaluator.config[name];
    return v === null ? undefined : v;
  }
  return baseValue(doc, name);
}

export function configChanged(
  doc: Pick<LaunchDocument, 'evaluatorExtra' | 'evaluator'>,
  name: string,
): boolean {
  return (
    has(doc.evaluator.invalid, name) ||
    (has(doc.evaluator.config, name) && !sameValue(configValue(doc, name), baseValue(doc, name)))
  );
}

function withEvaluator(doc: LaunchDocument, patch: Partial<EvaluatorEdits>): LaunchDocument {
  return { ...doc, evaluator: { ...doc.evaluator, ...patch } };
}

/** An edit: undefined unsets the field (null over a base value); the base value itself is no edit. */
export function setConfig(doc: LaunchDocument, name: string, value: JsonValue | undefined): LaunchDocument {
  const base = baseValue(doc, name);
  const config = { ...doc.evaluator.config };
  const invalid = { ...doc.evaluator.invalid };
  delete invalid[name];
  if (value === undefined) {
    if (base !== undefined) config[name] = null;
    else delete config[name];
  } else if (base !== undefined && sameValue(value, base)) {
    delete config[name];
  } else {
    config[name] = value;
  }
  return withEvaluator(doc, { config, invalid });
}

/** Control text -> edit (invalid text is kept in `evaluator.invalid`). */
export function setConfigInput(
  doc: LaunchDocument,
  entry: DescriptorEntry,
  name: string,
  raw: string,
  asJson = false,
): LaunchDocument {
  const edit = asJson ? jsonFallback(entry) : entry;
  const parsed = parseInput(edit, raw);
  if ('error' in parsed) {
    const config = { ...doc.evaluator.config };
    delete config[name];
    const invalid: Record<string, InvalidText> = {
      ...doc.evaluator.invalid,
      [name]: { message: parsed.error, raw, json: Boolean(edit.fallback) },
    };
    return withEvaluator(doc, { config, invalid });
  }
  return setConfig(doc, name, 'unset' in parsed ? undefined : parsed.value);
}

/** The entry an evaluator input is edited with (JSON when the value does not fit). */
export function configEditEntry(doc: LaunchDocument, entry: DescriptorEntry, name: string): DescriptorEntry {
  return editEntry(entry, configValue(doc, name), doc.evaluator.invalid[name] ?? null);
}

// ── run_metadata rows ────────────────────────────────────────────────────

export function baseMeta(doc: Pick<LaunchDocument, 'evaluatorExtra'>): JsonObject {
  const meta = baseConfig(doc)['run_metadata'];
  return isPlainObject(meta) ? meta : {};
}

function rowsFrom(values: JsonObject, startId: number, prefix: string): MetaRow[] {
  let id = startId;
  return Object.keys(values)
    .filter((key) => !isReservedKey(key, prefix))
    .map((key) => ({ id: id++, key, raw: metadataText(values[key]) }));
}

/** run_metadata rows follow the base's keys until the user edits them. */
export function syncMetaSeed(doc: LaunchDocument, panel?: EvaluatorPanel | null): LaunchDocument {
  const seed = JSON.stringify(baseMeta(doc));
  if (seed === doc.evaluator.metaSeed) return doc;
  if (doc.evaluator.metaTouched) return withEvaluator(doc, { metaSeed: seed });
  const meta = rowsFrom(baseMeta(doc), doc.evaluator.nextMetaId, reservedPrefix(panel));
  return withEvaluator(doc, { metaSeed: seed, meta, nextMetaId: doc.evaluator.nextMetaId + meta.length });
}

/** The rows shown now (the base's, until the user edits them). Pure. */
export function metaRowsOf(doc: LaunchDocument, panel?: EvaluatorPanel | null): MetaRow[] {
  const seed = JSON.stringify(baseMeta(doc));
  if (doc.evaluator.metaTouched || seed === doc.evaluator.metaSeed) return doc.evaluator.meta;
  return rowsFrom(baseMeta(doc), doc.evaluator.nextMetaId, reservedPrefix(panel));
}

function withRows(doc: LaunchDocument, rows: MetaRow[], nextId?: number): LaunchDocument {
  return withEvaluator(doc, {
    meta: rows,
    metaTouched: true,
    metaSeed: JSON.stringify(baseMeta(doc)),
    nextMetaId: nextId ?? doc.evaluator.nextMetaId,
  });
}

export function addMetaRow(doc: LaunchDocument, panel?: EvaluatorPanel | null): LaunchDocument {
  const rows = metaRowsOf(doc, panel);
  const id = doc.evaluator.nextMetaId + rows.length;
  return withRows(doc, [...rows, { id, key: '', raw: '' }], id + 1);
}

export function updateMetaRow(
  doc: LaunchDocument,
  id: number,
  patch: Partial<Pick<MetaRow, 'key' | 'raw'>>,
  panel?: EvaluatorPanel | null,
): LaunchDocument {
  return withRows(
    doc,
    metaRowsOf(doc, panel).map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
}

export function removeMetaRow(
  doc: LaunchDocument,
  id: number,
  panel?: EvaluatorPanel | null,
): LaunchDocument {
  return withRows(
    doc,
    metaRowsOf(doc, panel).filter((r) => r.id !== id),
  );
}

export interface MetadataState {
  values: JsonObject;
  errors: Array<{ pointer: string; message: string }>;
  rowErrors: Record<number, string>;
}

/** Values and problems of the rows: reserved prefix, duplicates, placeholders. */
export function metadataState(doc: LaunchDocument, panel?: EvaluatorPanel | null): MetadataState {
  const values: JsonObject = {};
  const errors: MetadataState['errors'] = [];
  const rowErrors: Record<number, string> = {};
  const seen = new Set<string>();
  const prefix = reservedPrefix(panel);
  for (const row of metaRowsOf(doc, panel)) {
    const key = row.key.trim();
    let message = '';
    if (!key && !row.raw.trim()) continue;
    if (!key) message = 'Enter a key';
    else if (isReservedKey(key, prefix))
      message = `Keys starting with ${prefix} are reserved for the platform`;
    else if (seen.has(key)) message = 'Duplicate key';
    else if (key.includes(PLACEHOLDER_PREFIX) || row.raw.includes(PLACEHOLDER_PREFIX)) {
      message = `${PLACEHOLDER_PREFIX} is reserved for platform placeholders`;
    }
    if (message) {
      rowErrors[row.id] = message;
      errors.push({
        pointer: key
          ? METADATA_POINTER + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')
          : METADATA_POINTER,
        message: 'run_metadata: ' + message,
      });
      continue;
    }
    seen.add(key);
    values[key] = parseMetadataValue(row.raw);
  }
  return { values, errors, rowErrors };
}

// ── Spec contribution ────────────────────────────────────────────────────

/** Is the dataset an alias picked in the Dataset section (it wins over the inputs)? */
function pickerAlias(doc: Pick<LaunchDocument, 'dataset'>): boolean {
  return doc.dataset.mode === 'project' && doc.dataset.ref.startsWith('a:');
}

/**
 * Lays the evaluation-input edits over the base's `evaluator` (already holding the
 * dataset and the base extras): the panel's edits win over the base's inputs, the
 * Dataset section's `dataset_alias` wins over both.
 */
export function applyEvaluatorEdits(
  doc: LaunchDocument,
  evaluator: JsonObject,
  panel?: EvaluatorPanel | null,
): JsonObject {
  const config: JsonObject = {};
  const removed: string[] = [];
  for (const name of Object.keys(doc.evaluator.config)) {
    if (has(doc.evaluator.invalid, name)) continue;
    const v = doc.evaluator.config[name] as JsonValue | null;
    if (v === null) removed.push(name);
    else config[name] = deepCopy(v);
  }
  // The rows are the whole run_metadata (they start as the base's keys).
  const meta = metadataState(doc, panel).values;
  if (Object.keys(meta).length) config['run_metadata'] = meta;
  else removed.push('run_metadata');
  const current = isPlainObject(evaluator['config']) ? evaluator['config'] : {};
  const merged: JsonObject = { ...current, ...config };
  for (const name of removed) delete merged[name];
  if (has(current, 'dataset_alias') && pickerAlias(doc))
    merged['dataset_alias'] = current['dataset_alias'] as JsonValue;
  const out: JsonObject = { ...evaluator };
  if (Object.keys(merged).length) out['config'] = merged;
  else delete out['config'];
  const extra = doc.evaluator.extra;
  if (extra.report_k != null) out['report_k'] = extra.report_k;
  if (extra.dataset_version != null && out['dataset_version'] == null)
    out['dataset_version'] = extra.dataset_version;
  return out;
}

export function evaluatorLocalErrors(
  doc: LaunchDocument,
  panel?: EvaluatorPanel | null,
): Array<{ pointer: string; message: string }> {
  const errors: Array<{ pointer: string; message: string }> = [];
  for (const name of Object.keys(doc.evaluator.invalid)) {
    errors.push({
      pointer: '/evaluator/config/' + name,
      message: `${name}: ${(doc.evaluator.invalid[name] as InvalidText).message}`,
    });
  }
  for (const e of metadataState(doc, panel).errors) errors.push(e);
  return errors;
}

/** Changed evaluation inputs (the step 5 badge): edited fields plus one for run_metadata. */
export function evaluatorChangedCount(doc: LaunchDocument, panel?: EvaluatorPanel | null): number {
  const names = new Set<string>();
  for (const name of [...Object.keys(doc.evaluator.config), ...Object.keys(doc.evaluator.invalid)]) {
    if (configChanged(doc, name)) names.add(name);
  }
  const state = metadataState(doc, panel);
  const baseNonReserved: JsonObject = {};
  const prefix = reservedPrefix(panel);
  for (const [k, v] of Object.entries(baseMeta(doc))) if (!isReservedKey(k, prefix)) baseNonReserved[k] = v;
  const metaChanged = state.errors.length > 0 || !sameValue(state.values, baseNonReserved);
  return names.size + (metaChanged ? 1 : 0);
}

/** "Undo all changes": back to the base's inputs. */
export function resetInputs(doc: LaunchDocument, panel?: EvaluatorPanel | null): LaunchDocument {
  return syncMetaSeed(
    {
      ...doc,
      evaluator: { ...doc.evaluator, config: {}, invalid: {}, extra: {}, metaTouched: false, metaSeed: null },
    },
    panel,
  );
}

// ── The panel's fields ───────────────────────────────────────────────────

export interface EvaluatorFieldView {
  name: string;
  entry: DescriptorEntry;
  /** The entry the value is edited with (JSON fallback when it does not fit). */
  editEntry: DescriptorEntry;
  value: JsonValue | undefined;
  changed: boolean;
  invalid: InvalidText | null;
  /** Environment ids whose evaluator schema lacks this field ("not in <env>"). */
  missingEnvs: string[];
  /** dataset_alias is set by the Dataset section when an alias is picked. */
  locked: boolean;
  baseValue: JsonValue | undefined;
}

/** The fields of the "Evaluation inputs" card (platform-owned ones excluded). */
export function evaluatorFields(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'evaluatorPanel'>,
): EvaluatorFieldView[] {
  const panel = ctx.evaluatorPanel;
  if (!panel) return [];
  const out: EvaluatorFieldView[] = [];
  for (const name of panel.fields ?? []) {
    const entry = configEntry(panel, name);
    if (!entry) continue;
    out.push({
      name,
      entry,
      editEntry: configEditEntry(doc, entry, name),
      value: configValue(doc, name),
      changed: configChanged(doc, name),
      invalid: doc.evaluator.invalid[name] ?? null,
      missingEnvs: panel.missing?.[name] ?? [],
      locked: name === 'dataset_alias' && pickerAlias(doc),
      baseValue: baseValue(doc, name),
    });
  }
  return out;
}

/** evaluator.config keys with a value that no field of the panel shows ("Other values", B20). */
export function unmatchedConfig(doc: LaunchDocument, panel: EvaluatorPanel | null | undefined): string[] {
  if (!panel) return [];
  const shown = panel.fields ?? [];
  const owned = platformOwnedConfig(panel);
  const names: string[] = [];
  for (const name of [
    ...Object.keys(baseConfig(doc)),
    ...Object.keys(doc.evaluator.config),
    ...Object.keys(doc.evaluator.invalid),
  ]) {
    if (names.includes(name) || name === 'run_metadata' || owned.includes(name) || shown.includes(name))
      continue;
    if (configValue(doc, name) !== undefined || has(doc.evaluator.invalid, name)) names.push(name);
  }
  return names.sort();
}

/** Read-only list: what the platform sets itself. */
export function platformOwnedList(panel: EvaluatorPanel | null | undefined): {
  config: string[];
  evaluator: string[];
  metadata: string[];
} {
  return {
    config: platformOwnedConfig(panel),
    evaluator: platformOwnedEvaluator(panel),
    metadata: panel?.platform_metadata_keys ?? ['qym_launch', 'qym_config'],
  };
}

/** "Also sent": evaluator keys from the base or Raw JSON the fields do not show. */
export function alsoSent(doc: LaunchDocument): Array<{ key: string; value: JsonValue }> {
  const out: Array<{ key: string; value: JsonValue }> = [];
  const report = doc.evaluator.extra.report_k ?? doc.evaluatorExtra['report_k'];
  if (report != null) out.push({ key: 'report_k', value: report as JsonValue });
  const version = doc.evaluator.extra.dataset_version ?? doc.evaluatorExtra['dataset_version'];
  if (version != null) out.push({ key: 'dataset_version', value: version as JsonValue });
  return out;
}

/** Remove a base `report_k` / `dataset_version` the user does not want to send. */
export function removeAlsoSent(doc: LaunchDocument, key: 'report_k' | 'dataset_version'): LaunchDocument {
  const evaluatorExtra = { ...doc.evaluatorExtra };
  delete evaluatorExtra[key];
  const extra = { ...doc.evaluator.extra };
  delete extra[key];
  return { ...doc, evaluatorExtra, evaluator: { ...doc.evaluator, extra } };
}
