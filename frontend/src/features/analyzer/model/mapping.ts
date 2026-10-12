/**
 * Variable mapping: source field + JSON-path selection for INPUT / EXPECTED /
 * OUTPUT and custom `{variables}`, plus the metric-metadata picker.
 * Re-implements playground.js 1405-1870 as pure functions: the tree is
 * derived from sample values, selection state is a set of leaf paths, and the
 * payload is the shortest covering set of node paths.
 */
import type { AnalyzerRow } from './targets';

export type SourceField = 'input' | 'output' | 'expected' | 'error' | 'metric_metadata';
export const SOURCE_FIELDS: SourceField[] = ['input', 'output', 'expected', 'error', 'metric_metadata'];

export type StdVariable = 'input' | 'expected' | 'output';
export const STD_VARIABLES: Array<{ key: StdVariable; label: string; defaultField: SourceField }> = [
  { key: 'input', label: 'Input', defaultField: 'input' },
  { key: 'expected', label: 'Expected output', defaultField: 'expected' },
  { key: 'output', label: 'Actual output', defaultField: 'output' },
];

/** Parse a JSON object/array from a value or a JSON string; null otherwise. */
export function tryParseJson(value: unknown): object | null {
  if (value && typeof value === 'object') return value as object;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return parsePythonLiteral(text);
  }
}

function readPythonString(text: string, start: number): { value: string; next: number } | null {
  const quote = text[start];
  let value = "";
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === "\\") {
      i += 1;
      if (i >= text.length) return null;
      const esc = text[i] as string;
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      if (esc in simple) value += simple[esc];
      else if (esc === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
        value += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
        i += 4;
      } else value += esc;
      continue;
    }
    if (ch === quote) return { value, next: i + 1 };
    value += ch;
  }
  return null;
}

/** A stringified Python dict/list (`str(dict)`): quotes, True/False/None are converted, then parsed as JSON. */
function parsePythonLiteral(text: string): object | null {
  if (text[0] !== "{" && text[0] !== "[") return null;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "'" || ch === '"') {
      const str = readPythonString(text, i);
      if (!str) return null;
      out += JSON.stringify(str.value);
      i = str.next;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < text.length && /[A-Za-z_]/.test(text[i] as string)) i += 1;
      const word = text.slice(start, i);
      if (word === "True") out += "true";
      else if (word === "False") out += "false";
      else if (word === "None") out += "null";
      else return null;
      continue;
    }
    out += ch;
    i += 1;
  }
  try {
    const parsed = JSON.parse(out);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function collectJsonPaths(val: unknown, prefix: string, paths: Set<string>, depth: number): void {
  if (depth > 5 || val == null || typeof val !== 'object') return;
  if (Array.isArray(val)) {
    const arrPrefix = prefix ? `${prefix}[]` : '[]';
    let nested = false;
    for (let i = 0; i < Math.min(val.length, 5); i += 1) {
      if (val[i] && typeof val[i] === 'object') {
        nested = true;
        collectJsonPaths(val[i], arrPrefix, paths, depth + 1);
      }
    }
    if (!nested) paths.add(prefix || '[]');
    return;
  }
  for (const key of Object.keys(val as object).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = (val as Record<string, unknown>)[key];
    if (child && typeof child === 'object') collectJsonPaths(child, path, paths, depth + 1);
    else paths.add(path);
  }
}

const SAMPLE_ROWS = 20;

export function scanFieldPaths(rows: AnalyzerRow[], field: 'input' | 'expected' | 'output' | 'error'): string[] {
  const paths = new Set<string>();
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const direct = row[field];
    const full = (row as unknown as Record<string, unknown>)[`${field}_full`];
    const obj = tryParseJson(full) ?? tryParseJson(direct);
    if (obj) collectJsonPaths(obj, '', paths, 0);
  }
  return [...paths].sort();
}

export interface MetadataGroup {
  metric: string;
  paths: string[];
}

export function scanMetadataGroups(rows: AnalyzerRow[], preferred?: string): MetadataGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    for (const [metric, value] of Object.entries(row.metric_metadata_by_metric)) {
      const obj = tryParseJson(value);
      if (!obj) continue;
      if (!groups.has(metric)) groups.set(metric, new Set());
      collectJsonPaths(obj, '', groups.get(metric) as Set<string>, 0);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (preferred && a === preferred ? -1 : preferred && b === preferred ? 1 : a.localeCompare(b)))
    .map(([metric, set]) => ({ metric, paths: [...set].sort() }))
    .filter((g) => g.paths.length > 0);
}

export interface PathNode {
  label: string;
  path: string;
  children: PathNode[];
}

export const formatPathLabel = (path: string) => path.replace(/\[\]/g, '[*]');

export function pathsToTree(paths: string[]): PathNode[] {
  const root: PathNode = { label: '', path: '', children: [] };
  const ensure = (parent: PathNode, label: string, path: string): PathNode => {
    let node = parent.children.find((c) => c.label === label && c.path === path);
    if (!node) {
      node = { label, path, children: [] };
      parent.children.push(node);
    }
    return node;
  };
  for (const raw of paths) {
    let parent = root;
    let built = '';
    for (const part of raw.split('.')) {
      if (!part) continue;
      if (part.endsWith('[]')) {
        const base = part.slice(0, -2);
        if (base) {
          built = built ? `${built}.${base}` : base;
          parent = ensure(parent, base, built);
        }
        const arrayPath = built ? `${built}[]` : '[]';
        parent = ensure(parent, '[*]', arrayPath);
        built = arrayPath;
      } else {
        built = built ? `${built}.${part}` : part;
        parent = ensure(parent, part, built);
      }
    }
  }
  const sort = (nodes: PathNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export function leafPaths(nodes: PathNode[]): string[] {
  const out: string[] = [];
  const walk = (list: PathNode[]) =>
    list.forEach((n) => {
      if (n.children.length) walk(n.children);
      else out.push(n.path);
    });
  walk(nodes);
  return out;
}

export function nodeLeaves(node: PathNode): string[] {
  return node.children.length ? leafPaths(node.children) : [node.path];
}

export type CheckState = 'all' | 'some' | 'none';

export function nodeState(node: PathNode, selected: ReadonlySet<string>): CheckState {
  const leaves = nodeLeaves(node);
  const count = leaves.filter((l) => selected.has(l)).length;
  return count === 0 ? 'none' : count === leaves.length ? 'all' : 'some';
}

/** Toggle a node: every leaf under it becomes checked (unless it already is fully checked). */
export function toggleNode(node: PathNode, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const leaves = nodeLeaves(node);
  const all = leaves.every((l) => next.has(l));
  leaves.forEach((l) => (all ? next.delete(l) : next.add(l)));
  return next;
}

/** Shortest set of node paths that covers exactly the selected leaves. */
export function coverPaths(tree: PathNode[], selected: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (nodes: PathNode[]) => {
    for (const node of nodes) {
      const state = nodeState(node, selected);
      if (state === 'all') out.push(node.path);
      else if (state === 'some') walk(node.children);
    }
  };
  walk(tree);
  return out;
}

export interface FieldSlot {
  field: SourceField | '';
  /** "Use full value": send the whole field. */
  full: boolean;
  /** Selected leaf paths when not full. */
  selected: string[];
}

export const defaultSlot = (field: SourceField | ''): FieldSlot => ({ field, full: true, selected: [] });

/** Mapping source for one slot: `field`, or `field.path` entries for a custom subset. */
export function slotSource(slot: FieldSlot, tree: PathNode[]): { source: string | string[]; custom: boolean } | null {
  if (!slot.field) return null;
  if (slot.full || tree.length === 0 || slot.field === 'metric_metadata') {
    return { source: slot.field, custom: false };
  }
  const cover = coverPaths(tree, new Set(slot.selected));
  return { source: cover.map((p) => `${slot.field}.${p}`), custom: true };
}

export interface MetadataSelection {
  /** Unchecked leaves (selection is "all except these" so new metrics default to included). */
  deselected: string[];
}

const metaPrefix = (metric: string) => `metric_metadata:${encodeURIComponent(metric).replace(/\./g, '%2E')}.`;

/** `metadata_fields` when a custom subset is chosen; null = send all metadata. */
export function metadataFields(groups: MetadataGroup[], selection: MetadataSelection): string[] | null {
  const off = new Set(selection.deselected);
  if (off.size === 0) return null;
  const fields: string[] = [];
  for (const group of groups) {
    const tree = pathsToTree(group.paths);
    const selected = new Set(leafPaths(tree).filter((l) => !off.has(`${group.metric}\u0000${l}`)));
    for (const path of coverPaths(tree, selected)) fields.push(`${metaPrefix(group.metric)}${path}`);
  }
  return fields;
}

export const metadataKey = (metric: string, leaf: string) => `${metric}\u0000${leaf}`;
