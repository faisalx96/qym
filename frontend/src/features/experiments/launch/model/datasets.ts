/**
 * Several dataset versions and a task per environment (change request v1.4). Pure functions over
 * the document. The primary dataset stays `doc.dataset` (name, first reference); the rest lives in
 * `doc.selection`, so a one-dataset document is exactly what it was before this existed.
 */
import { datasetValue, emptySelection } from './document';
import type {
  DatasetChoice,
  DatasetEntry,
  EnvData,
  JsonObject,
  LaunchDocument,
  LaunchSelection,
  RunShape,
} from './types';

/** Dataset versions one experiment may name (`QYM_EVAL_MAX_DATASETS`). */
export const DATASETS_MAX = 20;
export const LATEST_REF = '';

export function copySelection(s: LaunchSelection): LaunchSelection {
  return {
    extraRefs: s.extraRefs.slice(),
    more: s.more.map((e) => ({ name: e.name, refs: e.refs.slice() })),
    runShape: s.runShape,
    task: s.task,
    mixedTasks: s.mixedTasks ? { ...s.mixedTasks } : null,
  };
}

export interface DatasetPair {
  dataset: string;
  version: string | null;
  alias: string | null;
}

export function refPair(name: string, ref: string): DatasetPair {
  return {
    dataset: name,
    version: ref.startsWith('v:') ? ref.slice(2) : null,
    alias: ref.startsWith('a:') ? ref.slice(2) : null,
  };
}

/** The wire form of a pair: only the keys that are set. */
export function pairToJson(pair: DatasetPair): JsonObject {
  const out: JsonObject = { dataset: pair.dataset };
  if (pair.version != null) out['version'] = pair.version;
  if (pair.alias != null) out['alias'] = pair.alias;
  return out;
}

/** `Latest version`, the version name, or `alias <name>`. */
export function refLabel(ref: string): string {
  if (ref.startsWith('v:')) return ref.slice(2);
  if (ref.startsWith('a:')) return `alias ${ref.slice(2)}`;
  return 'Latest version';
}

/** Dataset boxes in order: the primary project dataset, then the others. A custom dataset has none. */
export function datasetEntries(doc: Pick<LaunchDocument, 'dataset' | 'selection'>): DatasetEntry[] {
  const out: DatasetEntry[] = [];
  if (doc.dataset.mode === 'project' && doc.dataset.name)
    out.push({ name: doc.dataset.name, refs: [doc.dataset.ref, ...doc.selection.extraRefs] });
  for (const e of doc.selection.more) out.push({ name: e.name, refs: e.refs.slice() });
  return out;
}

/** Every (dataset, version) the experiment runs, in box order then reference order. */
export function datasetPairs(doc: Pick<LaunchDocument, 'dataset' | 'selection'>): DatasetPair[] {
  const entries = datasetEntries(doc);
  if (!entries.length) {
    const custom = doc.dataset.mode === 'custom' ? doc.dataset.custom.trim() : '';
    return custom ? [refPair(custom, '')] : [];
  }
  return entries.flatMap((e) => e.refs.map((ref) => refPair(e.name, ref)));
}

export function pairCount(doc: Pick<LaunchDocument, 'dataset' | 'selection'>): number {
  return datasetPairs(doc).length;
}

export function pairKey(p: DatasetPair): string {
  return `${p.dataset}\u0000${p.version ?? ''}\u0000${p.alias ?? ''}`;
}

/** Entries -> the primary choice + selection (the inverse of `datasetEntries`). */
export function withEntries(
  doc: LaunchDocument,
  entries: readonly DatasetEntry[],
): LaunchDocument {
  const [first, ...rest] = entries;
  if (!first)
    return {
      ...doc,
      dataset: { mode: 'project', name: '', ref: '', custom: '' },
      selection: { ...doc.selection, extraRefs: [], more: [] },
    };
  const [ref = LATEST_REF, ...extraRefs] = first.refs.length ? first.refs : [LATEST_REF];
  const dataset: DatasetChoice = { mode: 'project', name: first.name, ref, custom: '' };
  return {
    ...doc,
    dataset,
    selection: {
      ...doc.selection,
      extraRefs,
      more: rest.map((e) => ({ name: e.name, refs: e.refs.length ? e.refs.slice() : [LATEST_REF] })),
    },
  };
}

/** References of one dataset; unticking the last one snaps back to Latest (QD-7). */
export function setEntryRefs(doc: LaunchDocument, name: string, refs: readonly string[]): LaunchDocument {
  const unique = Array.from(new Set(refs));
  const next = unique.length ? unique : [LATEST_REF];
  return withEntries(
    doc,
    datasetEntries(doc).map((e) => (e.name === name ? { name, refs: next } : e)),
  );
}

/** Add a dataset on Latest version (it becomes the primary one when none is chosen yet). */
export function addDataset(doc: LaunchDocument, name: string): LaunchDocument {
  const entries = datasetEntries(doc);
  if (entries.some((e) => e.name === name)) return doc;
  return withEntries(doc, [...entries, { name, refs: [LATEST_REF] }]);
}

export function removeDataset(doc: LaunchDocument, name: string): LaunchDocument {
  return withEntries(
    doc,
    datasetEntries(doc).filter((e) => e.name !== name),
  );
}

export function setRunShape(doc: LaunchDocument, runShape: RunShape): LaunchDocument {
  return doc.selection.runShape === runShape
    ? doc
    : { ...doc, selection: { ...doc.selection, runShape } };
}

/** The experiment's one task; `null` = the worker's default task. Replaces a cloned per-environment mix. */
export function setTask(doc: LaunchDocument, taskId: string | null): LaunchDocument {
  return { ...doc, selection: { ...doc.selection, task: taskId || null, mixedTasks: null } };
}

/** The spec's `evaluator.task`: the mix of a cloned experiment (ticked environments only), else the one task. */
export function specTask(
  doc: Pick<LaunchDocument, 'environmentIds' | 'selection'>,
): string | Record<string, string> | null {
  const mixed = doc.selection.mixedTasks;
  if (mixed) {
    const out: Record<string, string> = {};
    for (const id of doc.environmentIds) if (mixed[id]) out[id] = mixed[id];
    return Object.keys(out).length ? out : null;
  }
  return doc.selection.task || null;
}

/** The task id one ticked environment receives (`null` = the worker's default). */
export function taskOfEnv(doc: Pick<LaunchDocument, 'selection'>, envId: string): string | null {
  const mixed = doc.selection.mixedTasks;
  return mixed ? mixed[envId] ?? null : doc.selection.task || null;
}

// ── Units per environment (section 3.3 of the spec) ──────────────────────

export type UnitMode = 'single' | 'combined' | 'fan_out';

export interface EnvUnits {
  environmentId: string;
  mode: UnitMode;
  units: number;
  /** Why a fan-out happens: an older service, or the user's choice. */
  reason: 'service_without_datasets' | 'run_shape' | null;
}

export function acceptsDatasets(env: Pick<EnvData, 'capabilities'> | undefined): boolean {
  return Boolean(env?.capabilities?.datasets);
}

export function acceptsTask(env: Pick<EnvData, 'capabilities'> | undefined): boolean {
  return Boolean(env?.capabilities?.task);
}

export function unitsFor(
  pairs: number,
  runShape: RunShape,
  accepts: boolean,
): { mode: UnitMode; units: number; reason: EnvUnits['reason'] } {
  if (pairs < 2) return { mode: 'single', units: 1, reason: null };
  if (runShape === 'combined' && accepts) return { mode: 'combined', units: 1, reason: null };
  return {
    mode: 'fan_out',
    units: pairs,
    reason: runShape === 'combined' ? 'service_without_datasets' : 'run_shape',
  };
}

/** What each ticked environment receives, from the document and the loaded capabilities. */
export function envUnits(
  doc: Pick<LaunchDocument, 'dataset' | 'selection' | 'environmentIds'>,
  envs: ReadonlyArray<Pick<EnvData, 'id' | 'capabilities'>>,
): EnvUnits[] {
  const pairs = pairCount(doc);
  return doc.environmentIds.map((id) => {
    const env = envs.find((e) => e.id === id);
    return { environmentId: id, ...unitsFor(pairs, doc.selection.runShape, acceptsDatasets(env)) };
  });
}

/** Jobs one combination creates over all ticked environments. */
export function unitTotal(units: readonly EnvUnits[]): number {
  return units.reduce((n, u) => n + u.units, 0);
}

// ── Equality / change ────────────────────────────────────────────────────

export function selectionEqual(a: LaunchSelection, b: LaunchSelection): boolean {
  return (
    a.runShape === b.runShape &&
    JSON.stringify(a.extraRefs) === JSON.stringify(b.extraRefs) &&
    JSON.stringify(a.more) === JSON.stringify(b.more) &&
    (a.task || null) === (b.task || null) &&
    JSON.stringify(sortedMix(a.mixedTasks)) === JSON.stringify(sortedMix(b.mixedTasks))
  );
}

function sortedMix(tasks: Record<string, string> | null): Array<[string, string]> {
  return Object.entries(tasks ?? {}).sort(([x], [y]) => (x < y ? -1 : 1));
}

/** Datasets (references and the list) differ from the starting point. */
export function datasetsListChanged(
  doc: Pick<LaunchDocument, 'selection'>,
  base: LaunchSelection | undefined,
): boolean {
  const b = base ?? emptySelection();
  return (
    JSON.stringify(doc.selection.extraRefs) !== JSON.stringify(b.extraRefs) ||
    JSON.stringify(doc.selection.more) !== JSON.stringify(b.more)
  );
}

export function runShapeChanged(doc: Pick<LaunchDocument, 'selection'>, base: LaunchSelection | undefined): boolean {
  return doc.selection.runShape !== (base ?? emptySelection()).runShape;
}

/** The experiment's task differs from the starting point. */
export function taskChanged(
  doc: Pick<LaunchDocument, 'selection'>,
  base: LaunchSelection | undefined,
): boolean {
  const b = base ?? emptySelection();
  return (
    (doc.selection.task || null) !== (b.task || null) ||
    JSON.stringify(sortedMix(doc.selection.mixedTasks)) !== JSON.stringify(sortedMix(b.mixedTasks))
  );
}

/** The first dataset's name, for the best-run scope and card text (QD-D9). */
export function primaryDatasetName(doc: Pick<LaunchDocument, 'dataset'>): string {
  return datasetValue(doc);
}

/**
 * The environments part of the review's maths line: "(production: 1 combined run + staging: 4 runs)"
 * or "(2 environments × 4 dataset versions)"; null when every environment gets one job.
 */
export function unitsMath(
  units: readonly EnvUnits[],
  names: Readonly<Record<string, string>>,
  pairs: number,
): string | null {
  if (pairs < 2 || !units.length || units.every((u) => u.mode !== 'fan_out')) return null;
  if (units.every((u) => u.mode === 'fan_out'))
    return `(${units.length} environment${units.length === 1 ? '' : 's'} × ${pairs} dataset versions)`;
  const part = (u: EnvUnits) =>
    `${names[u.environmentId] ?? u.environmentId}: ${
      u.mode === 'combined' ? '1 combined run' : `${u.units} run${u.units === 1 ? '' : 's'}`
    }`;
  return `(${units.map(part).join(' + ')})`;
}

/** Units per environment, their total and the maths text, for the estimate and the review. */
export function unitsInfo(
  doc: Pick<LaunchDocument, 'dataset' | 'selection' | 'environmentIds'>,
  envs: ReadonlyArray<Pick<EnvData, 'id' | 'name' | 'capabilities'>>,
): { units: EnvUnits[]; total: number; text: string | null } {
  const units = envUnits(doc, envs);
  const names: Record<string, string> = {};
  for (const e of envs) names[e.id] = e.name;
  return { units, total: unitTotal(units), text: unitsMath(units, names, pairCount(doc)) };
}
