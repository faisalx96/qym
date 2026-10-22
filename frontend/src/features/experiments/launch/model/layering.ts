/**
 * Base layering: the base (preset, best run, clone, scratch) fills `baseline`; the
 * user's edits are whatever differs from it. Switching base replays the edits that
 * still fit and reports the dropped ones. All functions are pure.
 */
import {
  bindingFromSpec,
  bindingKey,
  deriveGlobalModel,
  pruneSecrets,
  setBinding,
  stripBoundFields,
  unconfirmedEndpoints,
} from './bindings';
import {
  changedTasks,
  copySelection,
  datasetsListChanged,
  pairCount,
  runShapeChanged,
} from './datasets';
import { datasetValue, emptyBaseInfo, emptySelection } from './document';
import { evaluatorChangedCount, resetInputs, syncMetaSeed } from './evaluator';
import { bestRunHeader } from './bestRun';
import {
  containsSweep,
  deepCopy,
  flattenOverrides,
  has,
  isPlainObject,
  isSweepValue,
  matchPointer,
  matchTemplate,
  sameValue,
  splitPointer,
} from './pointers';
import { jsonFallback, parseInput } from './descriptor';
import type { SecretStore } from './secrets';
import type {
  Baseline,
  BaseInfo,
  BaseKind,
  BestRunBaseResponse,
  Bindings,
  CloneInfo,
  CloneResponse,
  DatasetChoice,
  DescriptorEntry,
  FormContext,
  InvalidText,
  JsonObject,
  JsonValue,
  LaunchConfig,
  LaunchDocument,
  LaunchSelection,
  Preset,
  PresetRemap,
  PresetVersionResponse,
  RemapDropped,
  SlotBinding,
  StepId,
  UnionSlot,
} from './types';

// ── Changed selectors ("changed dot", counts) ────────────────────────────

/** A setting differs from the base (or holds text that did not parse). */
export function isChanged(doc: LaunchDocument, pointer: string): boolean {
  return has(doc.invalid, pointer) || !sameValue(doc.values[pointer], doc.baseline.values[pointer]);
}

export function changedPointers(doc: LaunchDocument): string[] {
  const seen = new Set<string>();
  for (const p of [
    ...Object.keys(doc.values),
    ...Object.keys(doc.baseline.values),
    ...Object.keys(doc.invalid),
  ]) {
    if (!seen.has(p) && isChanged(doc, p)) seen.add(p);
  }
  return Array.from(seen);
}

export function bindingChanged(doc: LaunchDocument, slotKey: string): boolean {
  return bindingKey(doc.bindings[slotKey]) !== bindingKey(doc.baseline.bindings[slotKey]);
}

export function changedSlots(doc: LaunchDocument): string[] {
  const seen = new Set<string>();
  for (const k of [...Object.keys(doc.bindings), ...Object.keys(doc.baseline.bindings)]) {
    if (!seen.has(k) && bindingChanged(doc, k)) seen.add(k);
  }
  return Array.from(seen);
}

export function datasetChanged(doc: LaunchDocument): boolean {
  if (datasetsListChanged(doc, doc.baseline.selection)) return true;
  const b = doc.baseline.dataset;
  if (!b) return false;
  const c = doc.dataset;
  if (b.mode !== c.mode) return true;
  return b.mode === 'custom' ? b.custom.trim() !== c.custom.trim() : b.name !== c.name || b.ref !== c.ref;
}

export interface DiffCount {
  settings: number;
  models: number;
  dataset: number;
  /** The run shape differs from the starting point (counted only with two or more dataset versions). */
  shape: number;
  /** Environments whose task differs from the starting point. */
  tasks: number;
  total: number;
}

/** "Diff vs base": changed settings, model bindings, datasets, run shape and tasks (evaluation inputs excluded, B19). */
export function diffCount(doc: LaunchDocument): DiffCount {
  const settings = changedPointers(doc).length;
  const models = changedSlots(doc).length;
  const dataset = datasetChanged(doc) ? 1 : 0;
  const shape = pairCount(doc) >= 2 && runShapeChanged(doc, doc.baseline.selection) ? 1 : 0;
  const tasks = changedTasks(doc, doc.baseline.selection).length;
  return { settings, models, dataset, shape, tasks, total: settings + models + dataset + shape + tasks };
}

export function diffText(doc: LaunchDocument, editor = false): string {
  const total = diffCount(doc).total;
  return `${total} change${total === 1 ? '' : 's'}${editor ? ' vs this version' : ' on top'}`;
}

/** Badge counts on the wizard steps: env_overrides on "env", evaluation inputs on "eval". */
export function stepChangeCount(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'evaluatorPanel'>,
  step: StepId,
): number {
  if (step === 'env') return changedPointers(doc).length;
  if (step === 'eval') return evaluatorChangedCount(doc, ctx.evaluatorPanel);
  return 0;
}

// ── Editing values ───────────────────────────────────────────────────────

/** Set (or unset with undefined) a setting; clears any invalid text for it. */
export function setValue(doc: LaunchDocument, pointer: string, value: JsonValue | undefined): LaunchDocument {
  const values = { ...doc.values };
  const invalid = { ...doc.invalid };
  delete invalid[pointer];
  if (value === undefined) delete values[pointer];
  else values[pointer] = value;
  return { ...doc, values, invalid };
}

/**
 * Control text -> edit. Empty = unset (inherit); text that does not parse is kept in
 * `invalid` (and reported). `asJson` when the control is the JSON fallback (B20).
 */
export function setLeafInput(
  doc: LaunchDocument,
  entry: DescriptorEntry,
  pointer: string,
  raw: string,
  asJson = false,
): LaunchDocument {
  const edit = asJson ? jsonFallback(entry) : entry;
  const parsed = parseInput(edit, raw);
  if ('error' in parsed) {
    const values = { ...doc.values };
    delete values[pointer];
    const invalid: Record<string, InvalidText> = {
      ...doc.invalid,
      [pointer]: { message: parsed.error, raw, json: Boolean(edit.fallback) },
    };
    return { ...doc, values, invalid };
  }
  return setValue(doc, pointer, 'unset' in parsed ? undefined : parsed.value);
}

/** An "All …" control: one text written to every target pointer. */
export function setAllInput(
  doc: LaunchDocument,
  entry: DescriptorEntry,
  pointers: readonly string[],
  raw: string,
): { doc: LaunchDocument; error?: string } {
  const parsed = parseInput(entry, raw);
  if ('error' in parsed) return { doc, error: parsed.error };
  const values = { ...doc.values };
  const invalid = { ...doc.invalid };
  for (const p of pointers) {
    delete invalid[p];
    if ('unset' in parsed) delete values[p];
    else values[p] = deepCopy(parsed.value);
  }
  return { doc: { ...doc, values, invalid } };
}

/** Remove every value at or under `pointer`. */
export function dropValuesUnder(doc: LaunchDocument, pointer: string): LaunchDocument {
  const under = (p: string) => p === pointer || p.startsWith(pointer + '/');
  const values = Object.fromEntries(Object.entries(doc.values).filter(([p]) => !under(p)));
  const invalid = Object.fromEntries(Object.entries(doc.invalid).filter(([p]) => !under(p)));
  return { ...doc, values, invalid };
}

/** Add a key to a collection (`pointer`) or an open object (`<pointer>#extra`). */
export function addKey(doc: LaunchDocument, listKey: string, key: string): LaunchDocument {
  const list = doc.addedKeys[listKey] ?? [];
  if (list.includes(key)) return doc;
  return { ...doc, addedKeys: { ...doc.addedKeys, [listKey]: [...list, key] } };
}

/** Remove an added key (and the values under it). */
export function removeKey(
  doc: LaunchDocument,
  listKey: string,
  itemPointer: string,
  key: string,
): LaunchDocument {
  const list = (doc.addedKeys[listKey] ?? []).filter((k) => k !== key);
  return dropValuesUnder({ ...doc, addedKeys: { ...doc.addedKeys, [listKey]: list } }, itemPointer);
}

// ── Reset ────────────────────────────────────────────────────────────────

export function resetField(doc: LaunchDocument, pointer: string): LaunchDocument {
  const values = { ...doc.values };
  const invalid = { ...doc.invalid };
  delete invalid[pointer];
  if (has(doc.baseline.values, pointer))
    values[pointer] = deepCopy(doc.baseline.values[pointer] as JsonValue);
  else delete values[pointer];
  return { ...doc, values, invalid };
}

export function resetSlot(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  slotKey: string,
  secrets?: SecretStore,
): LaunchDocument {
  const base = doc.baseline.bindings[slotKey];
  return setBinding(doc, ctx, slotKey, base ? deepCopy(base) : null, secrets);
}

/** "Reset all" on the settings toolbar: every setting back to the base. */
export function resetSettings(doc: LaunchDocument, ctx: Pick<FormContext, 'slots'>): LaunchDocument {
  return {
    ...doc,
    values: stripBoundFields(deepCopy(doc.baseline.values), doc.bindings, ctx.slots),
    invalid: {},
  };
}

/** "Reset roles": drops every value under the given role-table rows. */
export function resetRoles(doc: LaunchDocument, rowPointers: readonly string[]): LaunchDocument {
  let next = doc;
  for (const p of rowPointers) next = dropValuesUnder(next, p);
  return next;
}

/** The baseline's list, shape and tasks; tasks of environments that are not ticked are not carried. */
function restoreSelection(doc: LaunchDocument): LaunchDocument['selection'] {
  const base = copySelection(doc.baseline.selection ?? emptySelection());
  base.tasks = Object.fromEntries(Object.entries(base.tasks).filter(([id]) => doc.environmentIds.includes(id)));
  return base;
}

/** Undo every change: settings, models, datasets, tasks, links (clone) and evaluation inputs. */
export function resetAll(doc: LaunchDocument, ctx: FormContext, secrets?: SecretStore): LaunchDocument {
  const bindings: Bindings = {};
  for (const k of Object.keys(doc.baseline.bindings)) {
    // Keep a re-entered key when the model itself is unchanged.
    const keep = !bindingChanged(doc, k) ? doc.bindings[k] : undefined;
    bindings[k] = keep ?? deepCopy(doc.baseline.bindings[k] as SlotBinding);
  }
  let next: LaunchDocument = {
    ...doc,
    values: deepCopy(doc.baseline.values),
    invalid: {},
    bindings,
    links: doc.base.kind === 'clone' && doc.clone ? deepCopy(doc.clone.linkedGroups) : doc.links,
    dataset: doc.baseline.dataset ? { ...doc.baseline.dataset } : doc.dataset,
    selection: restoreSelection(doc),
  };
  next = resetInputs(next, ctx.evaluatorPanel);
  next = deriveGlobalModel(next, ctx);
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

// ── Base -> baseline ─────────────────────────────────────────────────────

export interface BaselineResult extends Baseline {
  evaluatorExtra: JsonObject;
  notes: string[];
}

export interface BaselineOptions {
  /**
   * A preset's `evaluator.task` is a string that belongs to its own environment: only that
   * environment's row is seeded. Without it a string applies to every ticked environment that
   * offers tasks (a clone).
   */
  taskEnvId?: string | null;
}

/** `evaluator.datasets` / `run_shape` / `task` of a base config -> selection (the primary entry is returned separately). */
function selectionFrom(
  evaluator: JsonObject,
  ctx: FormContext,
  options: BaselineOptions,
  notes: string[],
): { entries: Array<{ name: string; refs: string[] }>; selection: LaunchSelection } {
  const selection = emptySelection();
  const entries: Array<{ name: string; refs: string[] }> = [];
  const list = evaluator['datasets'];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!isPlainObject(item) || typeof item['dataset'] !== 'string') continue;
      const name = item['dataset'] as string;
      const ref =
        typeof item['version'] === 'string' && item['version']
          ? `v:${item['version']}`
          : typeof item['alias'] === 'string' && item['alias']
            ? `a:${item['alias']}`
            : '';
      const known = entries.find((e) => e.name === name);
      if (known) {
        if (!known.refs.includes(ref)) known.refs.push(ref);
      } else entries.push({ name, refs: [ref] });
    }
  }
  const shape = evaluator['run_shape'];
  if (shape === 'one_each' || shape === 'combined') selection.runShape = shape;
  const task = evaluator['task'];
  const accepting = ctx.envs.filter((e) => e.capabilities?.task);
  const listed = (e: (typeof ctx.envs)[number], id: string) =>
    !e.taskList || e.taskList.status !== 'ok' || e.taskList.ids.includes(id);
  if (typeof task === 'string' && task) {
    const targets = options.taskEnvId ? accepting.filter((e) => e.id === options.taskEnvId) : accepting;
    for (const e of targets) {
      if (listed(e, task)) selection.tasks[e.id] = task;
      else notes.push(`The task “${task}” is not listed by ${e.name}; it was left at the worker default.`);
    }
  } else if (isPlainObject(task)) {
    for (const [envId, value] of Object.entries(task)) {
      if (typeof value !== 'string' || !value) continue;
      const env = ctx.envs.find((e) => e.id === envId);
      if (!env) {
        notes.push(`Task for ${ctx.envNames?.[envId] ?? 'an environment'} was not carried (environment not selected)`);
      } else if (!env.capabilities?.task) {
        notes.push(`Task for ${env.name} was not carried (it does not offer task selection)`);
      } else if (!listed(env, value)) {
        notes.push(`The task “${value}” is not listed by ${env.name}; it was left at the worker default.`);
      } else selection.tasks[envId] = value;
    }
  }
  return { entries, selection };
}

/** Form state of a base config (preset, run, clone): settings, bindings, dataset, extras. */
export function baselineFrom(
  config: LaunchConfig | null | undefined,
  ctx: FormContext,
  options: BaselineOptions = {},
): BaselineResult {
  const cfg: LaunchConfig = isPlainObject(config) ? config : {};
  const fields = ctx.union.fields;
  const values = flattenOverrides(isPlainObject(cfg.env_overrides) ? cfg.env_overrides : {}, fields);
  const notes: string[] = [];
  if (ctx.union.envs.length) {
    // Settings no selected environment knows are dropped, and said so.
    for (const p of Object.keys(values)) {
      if (matchTemplate(fields, p)) continue;
      delete values[p];
      notes.push(`${splitPointer(p).join('.')} was dropped: not in any selected environment.`);
    }
  }
  const bindings: Bindings = {};
  const raw = isPlainObject(cfg.slot_bindings) ? cfg.slot_bindings : {};
  for (const key of Object.keys(raw)) {
    const b = raw[key];
    if (b == null || !isPlainObject(b) || b['inherit'] === true) continue;
    const slot = ctx.slots.find((s) => s.slot_key === key);
    if (!slot) {
      notes.push(`Model slot ${key} is not confirmed on the selected environments; it is left to Inherit.`);
      continue;
    }
    const read = bindingFromSpec(b, slot, ctx);
    if (read.binding) bindings[key] = read.binding;
    if (read.note) notes.push(read.note);
  }
  const stripped = stripBoundFields(values, bindings, ctx.slots);
  const evaluator: JsonObject = isPlainObject(cfg.evaluator) ? (deepCopy(cfg.evaluator) as JsonObject) : {};
  const evConfig: JsonObject = isPlainObject(evaluator['config']) ? (evaluator['config'] as JsonObject) : {};
  let dataset: DatasetChoice | null = null;
  const multi = selectionFrom(evaluator, ctx, options, notes);
  delete evaluator['datasets'];
  delete evaluator['run_shape'];
  delete evaluator['task'];
  const known = multi.entries.filter((e) => ctx.datasetNames.includes(e.name));
  if (multi.entries.length >= 1 && known.length) {
    // The list wins over the mirrored scalars: its first entry is the primary dataset.
    const [first, ...rest] = known;
    for (const e of multi.entries)
      if (!known.includes(e)) notes.push(`${e.name} was dropped: not a dataset of this project.`);
    const [ref = '', ...extraRefs] = (first as { refs: string[] }).refs;
    dataset = { mode: 'project', name: (first as { name: string }).name, custom: '', ref };
    multi.selection.extraRefs = extraRefs;
    multi.selection.more = rest.map((e) => ({ name: e.name, refs: e.refs.slice() }));
    delete evaluator['dataset'];
    delete evaluator['dataset_version'];
    delete evConfig['dataset_alias'];
  }
  const evDataset = evaluator['dataset'];
  if (!dataset && typeof evDataset === 'string' && evDataset) {
    if (ctx.datasetNames.includes(evDataset)) {
      const alias =
        typeof evConfig['dataset_alias'] === 'string' ? (evConfig['dataset_alias'] as string) : '';
      const version = evaluator['dataset_version'];
      dataset = {
        mode: 'project',
        name: evDataset,
        custom: '',
        ref: version ? `v:${String(version)}` : alias ? `a:${alias}` : '',
      };
      delete evaluator['dataset_version'];
      delete evConfig['dataset_alias'];
    } else {
      dataset = { mode: 'custom', name: '', ref: '', custom: evDataset };
    }
  }
  delete evaluator['dataset'];
  if (isPlainObject(evaluator['config']) && !Object.keys(evaluator['config']).length)
    delete evaluator['config'];
  return { values: stripped, bindings, dataset, selection: multi.selection, evaluatorExtra: evaluator, notes };
}

export interface LoadedBase {
  base: BaselineResult;
  info: BaseInfo;
}

/** Lays a loaded base under the document: baseline, values, bindings, extras, dataset, info. */
export function applyBaseline(
  doc: LaunchDocument,
  loaded: LoadedBase,
  links?: string[][] | undefined | 'keep',
): LaunchDocument {
  const { base, info } = loaded;
  const next: LaunchDocument = {
    ...doc,
    baseline: {
      values: deepCopy(base.values),
      bindings: deepCopy(base.bindings),
      dataset: base.dataset ? { ...base.dataset } : null,
      selection: copySelection(base.selection ?? emptySelection()),
    },
    values: deepCopy(base.values),
    invalid: {},
    bindings: deepCopy(base.bindings),
    evaluatorExtra: deepCopy(base.evaluatorExtra),
    dataset: base.dataset ? { ...base.dataset } : doc.dataset,
    selection: base.dataset
      ? copySelection(base.selection ?? emptySelection())
      : { ...copySelection(base.selection ?? emptySelection()), extraRefs: [], more: [] },
    base: info,
    links: links === 'keep' || links === undefined ? doc.links : links,
  };
  return syncMetaSeed(next);
}

// ── Capturing and replaying edits ────────────────────────────────────────

export interface CapturedEdits {
  values: Record<string, { value: JsonValue } | { invalid: InvalidText } | { unset: true }>;
  bindings: Record<string, SlotBinding | null>;
  dataset: DatasetChoice | null;
  /** The parts of the selection the user changed: the list, the run shape, tasks by environment. */
  list: Pick<LaunchSelection, 'extraRefs' | 'more'> | null;
  runShape: LaunchSelection['runShape'] | null;
  tasks: Record<string, string | null>;
}

/** The user's edits relative to the current base. */
export function captureEdits(doc: LaunchDocument): CapturedEdits {
  const values: CapturedEdits['values'] = {};
  for (const p of changedPointers(doc)) {
    if (has(doc.invalid, p)) values[p] = { invalid: deepCopy(doc.invalid[p] as InvalidText) };
    else if (doc.values[p] === undefined) values[p] = { unset: true };
    else values[p] = { value: deepCopy(doc.values[p] as JsonValue) };
  }
  const bindings: CapturedEdits['bindings'] = {};
  for (const k of changedSlots(doc))
    bindings[k] = doc.bindings[k] ? deepCopy(doc.bindings[k] as SlotBinding) : null;
  const dataset =
    datasetValue(doc) && (datasetChanged(doc) || !doc.baseline.dataset) ? { ...doc.dataset } : null;
  const list = datasetsListChanged(doc, doc.baseline.selection)
    ? { extraRefs: doc.selection.extraRefs.slice(), more: copySelection(doc.selection).more }
    : null;
  const runShape = runShapeChanged(doc, doc.baseline.selection) ? doc.selection.runShape : null;
  const tasks: Record<string, string | null> = {};
  for (const id of changedTasks(doc, doc.baseline.selection)) tasks[id] = doc.selection.tasks[id] ?? null;
  return { values, bindings, dataset, list, runShape, tasks };
}

export interface ReplayResult {
  doc: LaunchDocument;
  kept: number;
  dropped: number;
  /** What did not fit: setting pointers and slot keys. */
  droppedItems: string[];
}

/** Re-apply edits whose setting or slot exists on the new base (§8.2). */
export function replayEdits(
  doc: LaunchDocument,
  edits: CapturedEdits,
  ctx: Pick<FormContext, 'union' | 'slots'>,
): ReplayResult {
  const fields = ctx.union.fields;
  const slotKeys = ctx.slots.map((s) => s.slot_key);
  let kept = 0;
  const droppedItems: string[] = [];
  const values = { ...doc.values };
  const invalid = { ...doc.invalid };
  const bindings = { ...doc.bindings };
  for (const p of Object.keys(edits.values)) {
    if (!matchTemplate(fields, p)) {
      droppedItems.push(p);
      continue;
    }
    const edit = edits.values[p] as CapturedEdits['values'][string];
    delete invalid[p];
    delete values[p];
    if ('invalid' in edit) invalid[p] = edit.invalid;
    else if ('value' in edit) values[p] = edit.value;
    kept += 1;
  }
  for (const k of Object.keys(edits.bindings)) {
    if (!slotKeys.includes(k)) {
      droppedItems.push('/slot_bindings/' + k);
      continue;
    }
    const b = edits.bindings[k];
    if (b) bindings[k] = b;
    else delete bindings[k];
    kept += 1;
  }
  let next: LaunchDocument = {
    ...doc,
    values: stripBoundFields(values, bindings, ctx.slots),
    invalid,
    bindings,
  };
  if (edits.dataset) next = { ...next, dataset: { ...edits.dataset } };
  if (edits.list) next = { ...next, selection: { ...next.selection, ...copySelection({ ...next.selection, ...edits.list }) } };
  if (edits.runShape) next = { ...next, selection: { ...next.selection, runShape: edits.runShape } };
  for (const id of Object.keys(edits.tasks)) {
    if (!next.environmentIds.includes(id)) continue;
    const tasks = { ...next.selection.tasks };
    const value = edits.tasks[id];
    if (value) tasks[id] = value;
    else delete tasks[id];
    next = { ...next, selection: { ...next.selection, tasks } };
  }
  return { doc: next, kept, dropped: droppedItems.length, droppedItems };
}

export type ApplyBaseResult = ReplayResult;

/**
 * Switch the starting point: the loaded base replaces the baseline and the user's
 * edits that still fit are replayed on top. `dropped` lists what did not fit (toast:
 * "N changes did not fit the new starting point and were dropped").
 */
export function applyBase(
  doc: LaunchDocument,
  ctx: FormContext,
  loaded: LoadedBase,
  secrets?: SecretStore,
): ApplyBaseResult {
  const edits = captureEdits(doc);
  const links = loaded.info.kind === 'clone' && doc.clone ? deepCopy(doc.clone.linkedGroups) : doc.links;
  const laid = applyBaseline(doc, loaded, links);
  const replay = replayEdits(laid, edits, ctx);
  const withGlobal = deriveGlobalModel(replay.doc, ctx);
  if (secrets) pruneSecrets(withGlobal, secrets);
  return { ...replay, doc: withGlobal };
}

export function droppedChangesMessage(dropped: number): string {
  return `${dropped} change${dropped === 1 ? '' : 's'} did not fit the new starting point and ${dropped === 1 ? 'was' : 'were'} dropped`;
}

/** The "Change the starting point?" confirm, or `needed: false` when there are no edits. */
export function describeBaseChange(
  doc: LaunchDocument,
  baseLabelText: string,
): {
  needed: boolean;
  count: number;
  title: string;
  description: string[];
  confirmLabel: string;
  cancelLabel: string;
} {
  const count = diffCount(doc).total;
  return {
    needed: count > 0,
    count,
    title: 'Change the starting point?',
    description: [
      `You have ${count} change${count === 1 ? '' : 's'} on top of ${baseLabelText}.`,
      'Changes to settings and models that also exist in the new starting point are kept; the others are dropped.',
    ],
    confirmLabel: 'Change starting point',
    cancelLabel: 'Keep current',
  };
}

// ── Loaded bases from server responses ───────────────────────────────────

function dropMessages(remap: PresetRemap | undefined): { dropped: RemapDropped[]; errors: string[] } {
  const dropped = remap?.dropped ?? [];
  const errors = (remap?.errors ?? []).map((e) =>
    typeof e === 'string' ? e : e.message || e.reason || e.pointer || 'Invalid value',
  );
  return { dropped, errors };
}

/** "Start from scratch": nothing under the form. */
export function scratchBase(ctx: FormContext): LoadedBase {
  return { base: baselineFrom({}, ctx), info: { ...emptyBaseInfo('scratch'), loaded: true } };
}

/** A default/saved preset version (GET …/versions/{n}?remap=current) as a base. */
export function loadedBaseFromPreset(
  kind: 'default' | 'saved',
  envId: string,
  preset: Pick<Preset, 'id' | 'name'>,
  res: PresetVersionResponse,
  ctx: FormContext,
): LoadedBase {
  const info = { ...emptyBaseInfo(kind), envId };
  if (!res.remap) {
    return {
      base: baselineFrom({}, ctx),
      info: { ...info, loaded: false, error: 'Failed to load the preset' },
    };
  }
  const version = res.version;
  const { dropped, errors } = dropMessages(res.remap);
  const base = baselineFrom(res.remap.config, ctx, { taskEnvId: envId });
  return {
    base,
    info: {
      ...info,
      loaded: true,
      versionId: version.id,
      version: version.version,
      presetId: preset.id,
      presetName: kind === 'saved' ? preset.name : null,
      releaseNotes: version.notes ?? '',
      summary: res.remap.summary ?? null,
      dropped,
      errors,
      // The schema_hash warning is what the remap just resolved.
      warnings: (version.warnings ?? []).filter((w) => w.rule !== 'schema_hash').map((w) => w.message),
      notes: base.notes,
    },
  };
}

/** A best run's base (GET …/best-runs/{run}/base). */
export function loadedBaseFromBestRun(envId: string, res: BestRunBaseResponse, ctx: FormContext): LoadedBase {
  const { dropped, errors } = dropMessages(res.remap);
  const base = baselineFrom(res.config, ctx, { taskEnvId: envId });
  const info: BaseInfo = {
    ...emptyBaseInfo('best_run'),
    envId,
    loaded: true,
    runId: res.run.id,
    runName: res.run.run_name,
    metric: res.metric,
    score: res.score ?? null,
    summary: res.remap?.summary ?? null,
    dropped,
    errors,
    warnings: (res.warnings ?? []).map((w) => w.message),
    notes: base.notes,
    prompts: res.prompts ?? [],
    drift: res.drift,
    versioning: res.versioning,
  };
  info.label = bestRunHeader(info);
  return { base, info };
}

/** A best run not chosen yet (the scope prompt comes first, B15): blank, pending. */
export function pendingBestRunBase(envId: string, ctx: FormContext): LoadedBase {
  return {
    base: baselineFrom({}, ctx),
    info: { ...emptyBaseInfo('best_run'), envId, loaded: false, pending: true },
  };
}

/** The error state of a base that failed to load (the form starts blank). */
export function failedBase(
  kind: BaseKind,
  envId: string | null,
  error: string,
  ctx: FormContext,
): LoadedBase {
  return { base: baselineFrom({}, ctx), info: { ...emptyBaseInfo(kind), envId, loaded: false, error } };
}

/** A temporary model a best run used, bound again; its key is asked for (§7.5). */
export function reuseTemporaryPrompt(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  prompt: { slot_key: string; label?: string; model?: string; base_url?: string },
  secrets?: SecretStore,
): { doc: LaunchDocument; error?: string } {
  const slot = ctx.slots.find((s) => s.slot_key === prompt.slot_key);
  if (!slot || !prompt.model)
    return { doc, error: `Model slot ${prompt.slot_key} is not confirmed on the selected environments` };
  const binding: SlotBinding = {
    kind: 'temporary',
    label: prompt.label || undefined,
    model: prompt.model,
    baseUrl: prompt.base_url || undefined,
    secretRef: null,
    save: false,
    needsKey: true,
  };
  return { doc: setBinding(doc, ctx, prompt.slot_key, binding, secrets) };
}

// ── Clone prefill (POST …/clone) ─────────────────────────────────────────

export interface ClonePrefill {
  /** Merge into the document with Object.assign / spread. */
  patch: Pick<
    LaunchDocument,
    | 'name'
    | 'description'
    | 'environmentIds'
    | 'priority'
    | 'latencySensitive'
    | 'clone'
    | 'base'
  >;
  notes: string[];
  /** Slot keys of temporary models that lose their key (re-enter under Models). */
  needsKeyReentry: string[];
  /** Environments of the original that are disabled or gone. */
  unavailableEnvironments: number;
}

export function jobSpecFromQymConfig(qymConfig: Record<string, unknown>): LaunchConfig {
  return {
    evaluator: (qymConfig['evaluator'] ?? {}) as JsonObject,
    slot_bindings: (qymConfig['slot_bindings'] ?? {}) as Record<string, JsonValue>,
    env_overrides: (qymConfig['env_overrides'] ?? {}) as JsonObject,
  };
}

/**
 * Prefill from `POST …/experiments/{xid}/clone[?job_id=]`. When a job was asked for but
 * the response carries no matching job, pass that job row (from the experiment detail)
 * and its `qym_config` is used instead.
 */
export function prefillFromClone(
  res: CloneResponse,
  args: {
    experimentId: string;
    jobId?: string | null;
    jobRow?: { id: string; environment_id: string; qym_config?: Record<string, unknown> | null } | null;
  },
): ClonePrefill {
  let spec: LaunchConfig = isPlainObject(res.spec) ? res.spec : {};
  let envIds = Array.isArray(res.environment_ids) ? res.environment_ids.slice() : [];
  const notes: string[] = [];
  const wantsJob = args.jobId ?? null;
  let job: string | null =
    wantsJob && (res.base_source as { job_id?: string })?.job_id === wantsJob ? wantsJob : null;
  if (wantsJob && !job) {
    const row = args.jobRow;
    if (row && row.id === wantsJob && isPlainObject(row.qym_config)) {
      spec = jobSpecFromQymConfig(row.qym_config);
      envIds = envIds.includes(row.environment_id) ? [row.environment_id] : [];
      job = row.id;
    } else {
      notes.push("That job's configuration was not found, so the whole experiment is cloned.");
    }
  }
  const unavailable = (res.unavailable_environment_ids ?? []).length;
  if (unavailable) {
    notes.push(
      `${unavailable} environment${unavailable === 1 ? ' of the original is' : 's of the original are'} disabled or gone and ${unavailable === 1 ? 'was' : 'were'} left out.`,
    );
  }
  const bindings = isPlainObject(spec.slot_bindings) ? spec.slot_bindings : {};
  const needsKeyReentry = Object.keys(bindings).filter((k) => {
    const b = bindings[k];
    return (isSweepValue(b) ? b.sweep : [b]).some((x) => isPlainObject(x) && isPlainObject(x['temporary']));
  });
  if (needsKeyReentry.length) {
    notes.push(
      `Temporary models are copied without their API keys: re-enter each key under Models (${needsKeyReentry.join(', ')}).`,
    );
  }
  if (containsSweep(spec))
    notes.push('Swept values are kept as they were, so the same combinations are launched.');
  const sourceName = String(res.name || '').replace(/ \((copy|rerun)\)$/, '');
  const clone: CloneInfo = {
    experimentId: args.experimentId,
    jobId: job,
    spec: deepCopy(spec),
    linkedGroups: !job && Array.isArray(spec.links) ? deepCopy(spec.links) : undefined,
    sourceName,
    notes,
  };
  return {
    patch: {
      name: String(res.name || '').slice(0, 200),
      description: String(res.description || ''),
      environmentIds: envIds,
      priority: res.priority ?? '',
      latencySensitive: Boolean(res.latency_sensitive),
      clone,
      base: { ...emptyBaseInfo('clone'), loaded: false, notes },
    },
    notes,
    needsKeyReentry,
    unavailableEnvironments: unavailable,
  };
}

/** Endpoint names of a clone's spec that no selected environment confirmed (load their proposals first). */
export function cloneExtraEndpoints(clone: CloneInfo, ctx: Pick<FormContext, 'envs'>): string[] {
  return unconfirmedEndpoints(clone.spec, ctx);
}

/** The clone's spec as a base (settings, models, dataset, extras). */
export function loadedBaseFromClone(clone: CloneInfo, ctx: FormContext): LoadedBase {
  const base = baselineFrom(clone.spec, ctx);
  return {
    base,
    info: { ...emptyBaseInfo('clone'), loaded: true, notes: [...clone.notes, ...base.notes] },
  };
}

// ── Base availability / labels ───────────────────────────────────────────

export interface BaseEnvRecord {
  id: string;
  name: string;
  official_preset_id?: string | null;
  official_preset_version?: number | null;
}

export function hasOfficial(env: BaseEnvRecord | null | undefined): boolean {
  return Boolean(env && env.official_preset_id && env.official_preset_version != null);
}

/** The first selected environment with a default preset, else the first one. */
export function pickBaseEnv(selected: readonly BaseEnvRecord[]): string | null {
  const official = selected.find(hasOfficial);
  return official ? official.id : (selected[0]?.id ?? null);
}

export function baseAvailability(
  kind: BaseKind,
  env: BaseEnvRecord | null | undefined,
  opts: { savedPresets?: number | null; hasClone?: boolean } = {},
): { ok: boolean; reason?: string } {
  if (kind === 'scratch') return { ok: true };
  if (kind === 'clone') return { ok: Boolean(opts.hasClone) };
  if (!env) return { ok: false, reason: 'Pick an environment first' };
  if (kind === 'best_run') return { ok: true };
  if (kind === 'default') {
    return hasOfficial(env)
      ? { ok: true }
      : { ok: false, reason: `No default preset is published for ${env.name}` };
  }
  if (kind === 'saved') {
    if (opts.savedPresets == null) return { ok: false, reason: 'Loading saved presets…' };
    return opts.savedPresets > 0
      ? { ok: true }
      : { ok: false, reason: `No saved presets for ${env.name} yet` };
  }
  return { ok: false };
}

export const BASE_LABELS: Record<BaseKind, string> = {
  default: 'Default preset',
  best_run: 'Best past run',
  saved: 'Saved preset',
  scratch: 'From scratch',
  clone: 'Copy of experiment',
  'official-edit': 'Blank',
};

/** "Default preset v3 · production", "Saved preset “x” v2", "Clone of …", best-run header. */
export function baseLabel(
  doc: Pick<LaunchDocument, 'base' | 'clone' | 'environmentIds'>,
  envName?: (id: string) => string,
): string {
  const info = doc.base;
  const version = info.version != null ? ` v${info.version}` : '';
  switch (info.kind) {
    case 'default':
      return (
        'Default preset' +
        version +
        (doc.environmentIds.length > 1 && info.envId && envName ? ` · ${envName(info.envId)}` : '')
      );
    case 'saved':
      return 'Saved preset' + (info.presetName ? ` “${info.presetName}”` : '') + version;
    case 'clone': {
      const c = doc.clone;
      return 'Clone' + (c?.sourceName ? ` of ${c.sourceName}` : '') + (c?.jobId ? ' (one job)' : '');
    }
    case 'best_run':
      return (info.loaded && info.label) || 'Best run';
    case 'official-edit':
      return info.label || 'Blank';
    default:
      return BASE_LABELS.scratch;
  }
}

// ── Pruning after the environments change ────────────────────────────────

/** Drop bindings of slots no selected environment confirms (and their baseline copies). */
export function pruneBindings(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  secrets?: SecretStore,
): LaunchDocument {
  const keys = ctx.slots.map((s) => s.slot_key);
  const bindings = Object.fromEntries(Object.entries(doc.bindings).filter(([k]) => keys.includes(k)));
  const baselineBindings = Object.fromEntries(
    Object.entries(doc.baseline.bindings).filter(([k]) => keys.includes(k)),
  );
  const next: LaunchDocument = {
    ...doc,
    bindings,
    baseline: { ...doc.baseline, bindings: baselineBindings },
  };
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

/** Drop edits no selected environment knows; needs every form loaded. */
export function pruneOrphanValues(doc: LaunchDocument, ctx: Pick<FormContext, 'envs'>): LaunchDocument {
  if (!ctx.envs.length || ctx.envs.some((e) => !e.form)) return doc;
  const known = (p: string) => ctx.envs.some((e) => e.form && matchPointer(e.form, p) !== null);
  const values = Object.fromEntries(Object.entries(doc.values).filter(([p]) => known(p)));
  const invalid = Object.fromEntries(Object.entries(doc.invalid).filter(([p]) => known(p)));
  return { ...doc, values, invalid };
}

/** Slots of the union the document may bind (helper for selectors). */
export function slotsByKey(slots: readonly UnionSlot[]): Record<string, UnionSlot> {
  return Object.fromEntries(slots.map((s) => [s.slot_key, s]));
}
