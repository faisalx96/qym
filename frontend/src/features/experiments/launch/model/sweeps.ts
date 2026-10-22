/**
 * Sweeps (plan §8.3): a swept value is stored as its spec value `{"sweep": [...]}` —
 * in `doc.values[pointer]`, in `doc.evaluator.config[name]`, or (models) as a
 * `{kind: 'sweep'}` binding — and linked (zipped) groups are `doc.links`. So the spec,
 * Raw JSON and the dry run all see the same thing. This module is the pure maths and
 * value editing; documents are changed through layering.ts / bindings.ts.
 */
import { escapeSegment, isPlainObject, isSweepValue, sameValue } from './pointers';
import type { DescriptorEntry, JsonValue, SlotBinding, SweepModelItem } from './types';

/** Values one range may add. */
export const RANGE_MAX = 100;
export const RUN_NAMES_SHOWN = 12;
export const SWEEP_EMPTY_MESSAGE = 'Add at least one value, or switch back to a single value';
const SECTIONS = ['slot_bindings', 'evaluator', 'env_overrides'] as const;
const SCALAR_TYPES = ['integer', 'number', 'boolean', 'enum', 'string'];

export function formatSweepValue(value: unknown): string {
  if (value === null || value === undefined) return 'inherit';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return JSON.stringify(value);
}

/** Fields whose values may be swept: single scalar settings (never keys). */
export function isSweepable(entry: DescriptorEntry | null | undefined): boolean {
  if (!entry || entry.kind !== 'field' || entry.secret || entry.widget === 'secret') return false;
  if (entry.widget === 'endpoint-ref') return true;
  return SCALAR_TYPES.includes(entry.type);
}

/** One sweep value against its field; null when valid (null itself = inherit). */
export function valueProblem(entry: DescriptorEntry, value: unknown): string | null {
  if (value === null) return null;
  if (entry.widget === 'endpoint-ref')
    return typeof value === 'string' && value ? null : 'Must be an endpoint name';
  switch (entry.type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : 'Must be a whole number';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Must be a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Must be true or false';
    case 'string':
      return typeof value === 'string' ? null : 'Must be a string';
    case 'enum':
      return (entry.enum ?? []).some((v) => sameValue(v, value)) ? null : 'Must be one of the listed values';
    default:
      return 'This setting cannot be swept';
  }
}

export interface SweepProblem {
  /** Index of the offending value; null for the list itself. */
  index: number | null;
  message: string;
}

/** Problems of a `{"sweep": [...]}` value. */
export function checkValues(entry: DescriptorEntry, value: unknown): SweepProblem[] {
  if (!isSweepable(entry)) return [{ index: null, message: 'This setting cannot be swept' }];
  const values =
    isPlainObject(value) && Array.isArray(value['sweep']) ? (value['sweep'] as JsonValue[]) : null;
  if (!values || !values.length)
    return [{ index: null, message: 'A sweep needs a non-empty list of values' }];
  const problems: SweepProblem[] = [];
  const seen = new Set<string>();
  values.forEach((v, i) => {
    const problem = valueProblem(entry, v);
    if (problem) {
      problems.push({ index: i, message: problem });
      return;
    }
    const key = JSON.stringify(v);
    if (seen.has(key)) problems.push({ index: i, message: 'Duplicate value' });
    seen.add(key);
  });
  return problems;
}

/** Comparable key of one swept model binding (names and key refs left out). */
export function sweepItemKey(item: unknown): string {
  if (!isPlainObject(item)) return 'x:' + JSON.stringify(item);
  if (item['inherit'] === true) return 'inherit';
  const t = item['temporary'];
  if (isPlainObject(t)) {
    const out: Record<string, JsonValue> = {};
    for (const k of ['label', 'model', 'base_url']) if (t[k] != null) out[k] = t[k] as JsonValue;
    return 't:' + JSON.stringify(out);
  }
  if (typeof item['connection_id'] === 'string') return 'c:' + item['connection_id'];
  return 'x:' + JSON.stringify(item);
}

// ── Finding sweeps in a spec (mirrors services/eval_sweeps.py) ────────────

export interface FoundSweep {
  pointer: string;
  values: JsonValue[];
}

type SpecLike = { links?: unknown } & Partial<Record<(typeof SECTIONS)[number], unknown>>;

function walk(node: unknown, pointer: string, out: FoundSweep[]): FoundSweep[] {
  if (isSweepValue(node)) {
    out.push({ pointer, values: node.sweep });
  } else if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, pointer + '/' + i, out));
  } else if (isPlainObject(node)) {
    for (const key of Object.keys(node)) walk(node[key], pointer + '/' + escapeSegment(key), out);
  }
  return out;
}

/** Swept values of a spec in axis order. */
export function findSweeps(spec: SpecLike | null | undefined): FoundSweep[] {
  const out: FoundSweep[] = [];
  for (const section of SECTIONS) if (spec && spec[section] != null) walk(spec[section], '/' + section, out);
  return out;
}

/** Linked groups that still point at swept values (claimed once, 2+ members). */
export function cleanLinks(links: unknown, swept: ReadonlySet<string> | Record<string, unknown>): string[][] {
  if (!Array.isArray(links)) return [];
  const isSwept = (p: string) =>
    swept instanceof Set ? swept.has(p) : Boolean((swept as Record<string, unknown>)[p]);
  const claimed = new Set<string>();
  const groups: string[][] = [];
  for (const group of links) {
    if (!Array.isArray(group)) continue;
    const members = group.filter((p): p is string => typeof p === 'string' && isSwept(p) && !claimed.has(p));
    if (members.length < 2) continue;
    members.forEach((p) => claimed.add(p));
    groups.push(members);
  }
  return groups;
}

export interface Axis {
  pointers: string[];
  lengths: number[];
  /** Combinations this axis contributes (linked: the shortest member). */
  length: number;
  linked: boolean;
  /** Index into `groups` when linked. */
  group: number | null;
}

export interface AxesModel {
  axes: Axis[];
  groups: string[][];
  found: FoundSweep[];
}

/** Grid axes of a spec (a linked group sits at its first member). */
export function axesOf(spec: SpecLike | null | undefined): AxesModel {
  const found = findSweeps(spec);
  const byPointer: Record<string, FoundSweep> = {};
  found.forEach((f) => {
    byPointer[f.pointer] = f;
  });
  const groups = cleanLinks(spec?.links, byPointer);
  const groupOf: Record<string, number> = {};
  groups.forEach((group, g) => group.forEach((p) => (groupOf[p] = g)));
  const axes: Axis[] = [];
  const done = new Set<number>();
  for (const f of found) {
    const g = groupOf[f.pointer];
    if (g === undefined) {
      axes.push({
        pointers: [f.pointer],
        lengths: [f.values.length],
        length: f.values.length,
        linked: false,
        group: null,
      });
      continue;
    }
    if (done.has(g)) continue;
    done.add(g);
    const pointers = found.filter((x) => groupOf[x.pointer] === g).map((x) => x.pointer);
    const lengths = pointers.map((p) => (byPointer[p] as FoundSweep).values.length);
    axes.push({ pointers, lengths, length: Math.min(...lengths), linked: true, group: g });
  }
  return { axes, groups, found };
}

export function comboCount(axes: readonly Axis[]): number {
  return axes.reduce((n, axis) => n * axis.length, 1);
}

/** Runs a form would create: product of axis lengths x environments. */
export function jobEstimate(spec: SpecLike | null | undefined, envCount: number): number {
  return comboCount(axesOf(spec).axes) * envCount;
}

export interface RunEstimate {
  combos: number;
  envs: number;
  runs: number;
  cap: number | null;
  over: boolean;
  /** "3 × 2 = 6 combinations × 2 environments = 12 runs" */
  math: string;
}

export function runEstimate(
  spec: SpecLike | null | undefined,
  envCount: number,
  cap: number | null,
  /** Jobs per combination over all environments (several dataset versions fan out) and their math text. */
  units?: { total: number; text: string | null },
): RunEstimate {
  const { axes } = axesOf(spec);
  const combos = comboCount(axes);
  const perCombo = units ? units.total : envCount;
  const runs = combos * perCombo;
  const where = units?.text ?? `${envCount} environment${envCount === 1 ? '' : 's'}`;
  const math =
    axes.map((a) => String(a.length)).join(' × ') +
    ` = ${combos} combination${combos === 1 ? '' : 's'} × ${where} = ${runs} run${runs === 1 ? '' : 's'}`;
  return { combos, envs: envCount, runs, cap, over: cap != null && runs > cap, math };
}

/** Linked groups written in a document (Raw JSON): errors like the service's. */
export function checkLinks(doc: SpecLike): Array<{ pointer: string; message: string }> {
  const errors: Array<{ pointer: string; message: string }> = [];
  const links = doc.links;
  if (links == null) return errors;
  if (!Array.isArray(links))
    return [{ pointer: '/links', message: 'links must be a list of lists of pointers' }];
  const swept: Record<string, number> = {};
  findSweeps(doc).forEach((f) => {
    swept[f.pointer] = f.values.length;
  });
  const claimed: Record<string, number> = {};
  links.forEach((group, g) => {
    const where = '/links/' + g;
    if (!Array.isArray(group) || !group.every((p) => typeof p === 'string')) {
      errors.push({ pointer: where, message: 'A linked group is a list of pointers' });
      return;
    }
    if (group.length < 2) errors.push({ pointer: where, message: 'A linked group needs two or more values' });
    (group as string[]).forEach((p, m) => {
      if (swept[p] === undefined)
        errors.push({ pointer: where + '/' + m, message: p + ' is not a swept value' });
      else if (claimed[p] !== undefined)
        errors.push({ pointer: where + '/' + m, message: p + ' is already linked in /links/' + claimed[p] });
      else claimed[p] = g;
    });
    const lengths = (group as string[]).filter((p) => swept[p] !== undefined).map((p) => swept[p] as number);
    if (lengths.some((n) => n !== lengths[0])) {
      errors.push({
        pointer: where,
        message: 'Linked values need the same number of values (got ' + lengths.join(', ') + ')',
      });
    }
  });
  return errors;
}

/** Problems the service would reject: empty sweeps and uneven linked groups. */
export function sweepLocalErrors(
  spec: SpecLike | null | undefined,
  label: (pointer: string) => string = (p) => p,
): Array<{ pointer: string; message: string }> {
  const errors: Array<{ pointer: string; message: string }> = [];
  const model = axesOf(spec);
  model.found.forEach((f) => {
    if (!f.values.length)
      errors.push({ pointer: f.pointer, message: `${label(f.pointer)}: ${SWEEP_EMPTY_MESSAGE}` });
  });
  model.axes.forEach((axis) => {
    if (!axis.linked || axis.lengths.every((n) => n === axis.lengths[0])) return;
    errors.push({
      pointer: '/links/' + axis.group,
      message:
        'Linked values need the same number of values: ' +
        axis.pointers.map((p, i) => `${label(p)} has ${axis.lengths[i]}`).join(', '),
    });
  });
  return errors;
}

// ── Editing a swept value ────────────────────────────────────────────────

function decimals(num: number): number {
  const text = String(num);
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export type Parsed<T> = { empty: true } | { error: string } | { value: T };

/** One typed chip value ("0.5", "gpt") for the field. */
export function parseTyped(entry: DescriptorEntry, raw: string): Parsed<JsonValue> {
  const text = String(raw).trim();
  if (!text) return { empty: true };
  if (entry.type === 'integer' || entry.type === 'number') {
    const num = Number(text);
    if (!Number.isFinite(num)) return { error: 'Enter numbers' };
    if (entry.type === 'integer' && !Number.isInteger(num)) return { error: 'Enter whole numbers' };
    return { value: num };
  }
  return { value: text };
}

/** Typed text of the chip input: numbers split on whitespace, commas and semicolons. */
export function parseTypedList(
  entry: DescriptorEntry,
  text: string,
): { values: JsonValue[] } | { error: string } {
  const numeric = entry.type === 'integer' || entry.type === 'number';
  const parts = numeric ? String(text).split(/[\s,;]+/) : [text];
  const values: JsonValue[] = [];
  for (const part of parts) {
    const parsed = parseTyped(entry, part);
    if ('empty' in parsed) continue;
    if ('error' in parsed) return { error: parsed.error };
    values.push(parsed.value);
  }
  return { values };
}

/** start/stop/step -> explicit values (at most RANGE_MAX), so the spec stays a list. */
export function expandRange(
  entry: DescriptorEntry,
  startRaw: string,
  stopRaw: string,
  stepRaw: string,
): { values: number[] } | { error: string } {
  const raws = [startRaw, stopRaw, stepRaw];
  const [start, stop, step] = raws.map((r) => Number(String(r).trim())) as [number, number, number];
  if (!raws.every((v) => String(v).trim()) || ![start, stop, step].every(Number.isFinite)) {
    return { error: 'Enter a start, stop and step' };
  }
  if (entry.type === 'integer' && ![start, stop, step].every(Number.isInteger))
    return { error: 'Use whole numbers' };
  if (step <= 0) return { error: 'The step must be above 0' };
  if (stop < start) return { error: 'Stop must not be below start' };
  const count = Math.floor((stop - start) / step + 1e-9) + 1;
  if (count > RANGE_MAX) return { error: `That range has ${count} values; the most is ${RANGE_MAX}` };
  const places = Math.max(decimals(start), decimals(step));
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(Number((start + i * step).toFixed(places)));
  return { values };
}

/** Append values, skipping duplicates. */
export function addSweepValues(
  current: readonly JsonValue[],
  list: readonly JsonValue[],
): { values: JsonValue[]; skipped: number } {
  const next = current.slice();
  let skipped = 0;
  for (const v of list) {
    if (next.some((x) => sameValue(x, v))) skipped += 1;
    else next.push(v);
  }
  return { values: next, skipped };
}

export function removeSweepValue(current: readonly JsonValue[], value: JsonValue): JsonValue[] {
  return current.filter((x) => !sameValue(x, value));
}

export interface ChoiceOption {
  value: JsonValue;
  text: string;
}

/** Fixed choices for a swept field (boolean, enum, endpoint-ref), else null (typed chips). */
export function choiceOptions(
  entry: DescriptorEntry,
  endpointKeys: readonly string[] = [],
): ChoiceOption[] | null {
  if (entry.widget === 'endpoint-ref') return endpointKeys.map((v) => ({ value: v, text: v }));
  if (entry.type === 'boolean')
    return [
      { value: true, text: 'true' },
      { value: false, text: 'false' },
    ];
  if (entry.type === 'enum') return (entry.enum ?? []).map((v) => ({ value: v, text: formatSweepValue(v) }));
  return null;
}

/** Toggle one option on or off, keeping the option order; unlisted values stay last. */
export function toggleChoice(
  options: readonly ChoiceOption[],
  current: readonly JsonValue[],
  value: JsonValue,
): JsonValue[] {
  const chosen = (v: JsonValue) => current.some((x) => sameValue(x, v));
  const on = !chosen(value);
  return options
    .filter((o) => (sameValue(o.value, value) ? on : chosen(o.value)))
    .map((o) => o.value)
    .concat(current.filter((v) => !options.some((o) => sameValue(o.value, v))));
}

/** "+ values": booleans become [true, false]; others start from their value. */
export function startSweep(entry: DescriptorEntry, current: JsonValue | undefined): { sweep: JsonValue[] } {
  if (entry.type === 'boolean') return { sweep: [true, false] };
  if (current !== undefined && current !== null && !isSweepValue(current)) return { sweep: [current] };
  return { sweep: [] };
}

/** "Single value": keep the first value (undefined when none/null: unset). */
export function stopSweep(value: unknown): JsonValue | undefined {
  const first = isSweepValue(value) ? value.sweep[0] : undefined;
  return first === undefined || first === null ? undefined : first;
}

/** Link the picked axes (zipped): they must have equal lengths. */
export function linkAxes(
  links: readonly string[][] | undefined,
  picked: readonly string[],
  found: readonly FoundSweep[],
  label: (pointer: string) => string = (p) => p,
): { links: string[][] } | { error: string } {
  if (picked.length < 2) return { error: 'Select two or more swept values to vary them together.' };
  const lengths = picked.map((p) => found.find((f) => f.pointer === p)?.values.length ?? 0);
  if (lengths.some((n) => n !== lengths[0])) {
    return {
      error: `Linked values need the same number of values (${picked.map((p, i) => `${label(p)} has ${lengths[i]}`).join(', ')}).`,
    };
  }
  const swept = new Set(found.map((f) => f.pointer));
  const kept = cleanLinks(links, swept)
    .map((g) => g.filter((p) => !picked.includes(p)))
    .filter((g) => g.length >= 2);
  return { links: kept.concat([picked.slice()]) };
}

/** Unlink one group (by its index in `links`); undefined when none are left. */
export function unlinkGroup(
  links: readonly string[][] | undefined,
  swept: ReadonlySet<string>,
  group: number,
): string[][] | undefined {
  const groups = cleanLinks(links, swept);
  groups.splice(group, 1);
  return groups.length ? groups : undefined;
}

/** Drop links whose values stopped being swept. */
export function pruneLinks(links: readonly string[][] | undefined, spec: SpecLike): string[][] | undefined {
  if (!links) return undefined;
  const swept = new Set(findSweeps(spec).map((f) => f.pointer));
  const groups = cleanLinks(links, swept);
  return groups.length ? groups : undefined;
}

// ── Model sweeps ─────────────────────────────────────────────────────────

/** A binding as a sweep item (`{connection_id}` / `{temporary}`), or null. */
export function modelItemFromBinding(b: SlotBinding | null | undefined): SweepModelItem | null {
  if (!b) return null;
  if (b.kind === 'connection') return { connection_id: b.id };
  if (b.kind === 'temporary') {
    const temporary: { label?: string; model: string; base_url?: string; api_key?: { $secret: string } } = {
      model: b.model,
    };
    if (b.label) temporary.label = b.label;
    if (b.baseUrl) temporary.base_url = b.baseUrl;
    if (b.secretRef) temporary.api_key = { $secret: b.secretRef };
    return { temporary };
  }
  return null;
}

/** "+ models": a sweep starting from the slot's current binding. */
export function startModelSweep(b: SlotBinding | null | undefined): SlotBinding {
  const first = modelItemFromBinding(b);
  return { kind: 'sweep', items: first ? [first] : [] };
}

/** The binding one swept value stands for ("Single model" keeps the first). */
export function bindingFromSweepItem(item: SweepModelItem | undefined): SlotBinding | null {
  if (!item || typeof item !== 'object') return null;
  if ('inherit' in item) return null;
  if ('temporary' in item) {
    const t = item.temporary;
    const ref = t.api_key && typeof t.api_key.$secret === 'string' ? t.api_key.$secret : null;
    return {
      kind: 'temporary',
      label: t.label,
      model: t.model,
      baseUrl: t.base_url,
      secretRef: ref,
      save: false,
      needsKey: !ref,
    };
  }
  if ('connection_id' in item && typeof item.connection_id === 'string')
    return { kind: 'connection', id: item.connection_id };
  return null;
}

/** Toggle a model in a model sweep (by item key). */
export function toggleModelItem(items: readonly SweepModelItem[], item: SweepModelItem): SweepModelItem[] {
  const key = sweepItemKey(item);
  return items.some((x) => sweepItemKey(x) === key)
    ? items.filter((x) => sweepItemKey(x) !== key)
    : items.concat([item]);
}

/** Add (or replace the same model with) a swept temporary model. */
export function upsertModelItem(items: readonly SweepModelItem[], item: SweepModelItem): SweepModelItem[] {
  const key = sweepItemKey(item);
  return items.some((x) => sweepItemKey(x) === key)
    ? items.map((x) => (sweepItemKey(x) === key ? item : x))
    : items.concat([item]);
}

// ── Preview helpers ──────────────────────────────────────────────────────

/** The first `shown` run names of a dry run and how many more there are. */
export function runNamePreview(
  jobs: ReadonlyArray<{ run_name?: string }> | undefined,
  shown = RUN_NAMES_SHOWN,
): { names: string[]; more: number } {
  const list = jobs ?? [];
  return { names: list.slice(0, shown).map((j) => j.run_name ?? ''), more: Math.max(0, list.length - shown) };
}
