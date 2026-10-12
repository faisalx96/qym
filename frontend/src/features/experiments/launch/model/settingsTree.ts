/**
 * The "Environment overrides" card as data: one tree per descriptor group built from the
 * union of the selected environments and the document, with "not in <env>" tags, bound
 * (slot-filled) fields, changed flags, search / changed-only visibility and which groups
 * to open. Components only render this tree.
 */
import { boundPointers, endpointName } from './bindings';
import {
  editEntry,
  hintText,
  leafKind,
  missingFrom,
  placeholderFor,
  unmatchedEntry,
  unmatchedPointers,
  envsMissing,
  notInEnvMessage,
} from './descriptor';
import type { LeafKind } from './descriptor';
import { changedPointers, isChanged } from './layering';
import {
  appendSegment,
  childPointer,
  has,
  isSweepValue,
  pointerToFieldName,
  sameValue,
  splitPointer,
} from './pointers';
import type { DescriptorEntry, FormContext, InvalidText, JsonValue, LaunchDocument } from './types';

export interface SettingsFilter {
  search: string;
  changedOnly: boolean;
  /** Groups the user opened (closed by default; "unmatched" is open by default). */
  groupOpen: Record<string, boolean>;
}

export interface NodeBase {
  pointer: string;
  /** `/env_overrides` + pointer: the pointer errors and focus use. */
  docPointer: string;
  /** RHF-safe field name of docPointer. */
  fieldName: string;
  visible: boolean;
}

export interface LeafNode extends NodeBase {
  type: 'leaf';
  template: string;
  entry: DescriptorEntry;
  /** The entry the control is edited with (JSON fallback when the value does not fit). */
  edit: DescriptorEntry;
  kind: LeafKind;
  title: string;
  /** "context · title": the accessible label. */
  label: string;
  value: JsonValue | undefined;
  swept: boolean;
  invalid: InvalidText | null;
  changed: boolean;
  /** Label of the slot filling this field: the control is locked. */
  boundBy: string | null;
  missingEnvs: string[];
  /** Local error: the setting is not in these (names of) environments. */
  notInEnvErrors: string[];
  hint: string;
  placeholder: string;
  /** An extra key / unmatched value: offers Remove. */
  removable: boolean;
  searchText: string;
}

export interface AllItemsField {
  template: string;
  entry: DescriptorEntry;
  label: string;
  /** Unbound target pointers the value is written to. */
  pointers: string[];
  /** All targets share one value (else "Mixed"). */
  same: boolean;
  value: JsonValue | undefined;
}

export interface ObjectNode extends NodeBase {
  type: 'object';
  template: string;
  entry: DescriptorEntry;
  title: string;
  missingEnvs: string[];
  children: SettingsNode[];
  extra: ExtraKeysView | null;
}

export interface ExtraKeysView {
  /** `<object pointer>#extra`: key into `doc.addedKeys`. */
  listKey: string;
  template: string;
  fixedKeys: string[];
  items: Array<{ key: string; pointer: string; node: LeafNode | ObjectNode }>;
}

export interface CollectionItemView extends NodeBase {
  key: string;
  required: boolean;
  /** Added in the form (not required, not from a base value): offers Remove. */
  removable: boolean;
  children: SettingsNode[];
}

export interface CollectionNode extends NodeBase {
  type: 'collection';
  template: string;
  entry: DescriptorEntry;
  title: string;
  keyParam: string;
  keyPattern: string | null;
  /** `doc.addedKeys` key for "+ Add <keyParam>". */
  listKey: string;
  items: CollectionItemView[];
  allItems: AllItemsField[];
}

export interface RoleRowView extends NodeBase {
  key: string;
  label: string;
  description: string | null;
  absentEnvs: string[];
  cells: LeafNode[];
  changed: boolean;
  overridden: boolean;
}

export interface RoleTableNode extends NodeBase {
  type: 'role_table';
  template: string;
  entry: DescriptorEntry;
  rowParam: string;
  columns: Array<{ template: string; label: string }>;
  rows: RoleRowView[];
  allRow: Array<AllItemsField | null>;
}

export type SettingsNode = LeafNode | ObjectNode | CollectionNode | RoleTableNode;

export interface GroupView {
  id: string;
  label: string;
  count: number;
  nodes: SettingsNode[];
  /** Has a visible leaf under the current filter (always true without a filter). */
  visible: boolean;
  /** The group is rendered open: the user's choice, or a filter match. */
  open: boolean;
  /** Opened by the filter only; not the user's choice. */
  autoOpened: boolean;
  matches: number;
}

export interface SettingsView {
  groups: GroupView[];
  /** "Other values": pointers no selected schema describes. Null when none. */
  unmatched: GroupView | null;
  filtering: boolean;
  /** Filtering and nothing matches ("No settings match."). */
  empty: boolean;
  changedCount: number;
}

export const UNMATCHED_GROUP = 'unmatched';

interface BuildState {
  doc: LaunchDocument;
  ctx: FormContext;
  bound: Record<string, string>;
  query: string;
  changedOnly: boolean;
}

function envLabel(ctx: FormContext, id: string): string {
  return ctx.envs.find((e) => e.id === id)?.name ?? id;
}

function collectionKeys(s: BuildState, entry: DescriptorEntry, concrete: string): string[] {
  const keys = (entry.required_keys ?? []).slice();
  if (entry.key_param === 'endpoint' || /\/endpoints$/.test(concrete)) {
    for (const slot of s.ctx.slots) {
      const name = endpointName(slot.slot_key);
      if (name && !keys.includes(name)) keys.push(name);
    }
  }
  for (const key of s.doc.addedKeys[concrete] ?? []) if (!keys.includes(key)) keys.push(key);
  for (const p of Object.keys(s.doc.values)) {
    if (!p.startsWith(concrete + '/')) continue;
    const key = splitPointer(p.slice(concrete.length))[0];
    if (key != null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Endpoint names an endpoint-ref field may point at. */
export function endpointRefOptions(doc: LaunchDocument, ctx: FormContext, entry: DescriptorEntry): string[] {
  const collection = entry.ref_collection ? ctx.union.fields[entry.ref_collection] : undefined;
  if (!collection) return [];
  return collectionKeys(
    { doc, ctx, bound: {}, query: '', changedOnly: false },
    collection,
    entry.ref_collection as string,
  );
}

function leaf(
  s: BuildState,
  template: string,
  pointer: string,
  context: string,
  override?: DescriptorEntry,
  removable = false,
): LeafNode {
  const entry = override ?? (s.ctx.union.fields[template] as DescriptorEntry);
  const value = s.doc.values[pointer];
  const invalid = s.doc.invalid[pointer] ?? null;
  const edit = editEntry(entry, value, invalid);
  const title = entry.label || entry.name;
  const label = (context ? context + ' · ' : '') + title;
  const changed = isChanged(s.doc, pointer);
  const missingEnvs = override ? [] : missingFrom(s.ctx.union, template);
  const notInEnv = has(s.doc.values, pointer)
    ? envsMissing(s.ctx.envs, pointer).map((id) => notInEnvMessage(pointer, envLabel(s.ctx, id)))
    : [];
  const boundBy = s.bound[pointer] ?? null;
  const searchText = [label, entry.name, pointer, entry.description ?? ''].join(' ').toLowerCase();
  const matches = (!s.query || searchText.includes(s.query)) && (!s.changedOnly || changed);
  const docPointer = '/env_overrides' + pointer;
  return {
    type: 'leaf',
    pointer,
    docPointer,
    fieldName: pointerToFieldName(docPointer),
    template,
    entry,
    edit,
    kind: leafKind(edit),
    title,
    label,
    value,
    swept: isSweepValue(value),
    invalid,
    changed,
    boundBy,
    missingEnvs,
    notInEnvErrors: notInEnv,
    hint: hintText(edit),
    placeholder: placeholderFor(entry, boundBy),
    removable,
    searchText,
    visible: matches,
  };
}

function allItemsField(
  s: BuildState,
  template: string,
  label: string,
  pointers: string[],
): AllItemsField | null {
  const entry = s.ctx.union.fields[template];
  if (!entry || entry.kind !== 'field' || entry.secret || entry.widget === 'secret') return null;
  const free = pointers.filter((p) => !s.bound[p]);
  if (!free.length) return null;
  const same =
    free.every((p) => sameValue(s.doc.values[p], s.doc.values[free[0] as string])) &&
    !free.some((p) => has(s.doc.invalid, p) || isSweepValue(s.doc.values[p]));
  return {
    template,
    entry,
    label,
    pointers: free,
    same,
    value: same ? s.doc.values[free[0] as string] : undefined,
  };
}

function roleColumns(s: BuildState, table: DescriptorEntry): Array<{ template: string; label: string }> {
  const cols: Array<{ template: string; label: string }> = [];
  for (const template of table.columns ?? []) {
    const entry = s.ctx.union.fields[template];
    if (!entry) continue;
    if (entry.kind === 'field') cols.push({ template, label: entry.name });
    else {
      for (const child of entry.children ?? []) {
        const c = s.ctx.union.fields[child];
        if (c && c.kind === 'field') cols.push({ template: child, label: `${entry.name}.${c.name}` });
      }
    }
  }
  return cols;
}

function roleTable(s: BuildState, template: string): RoleTableNode {
  const table = s.ctx.union.fields[template] as DescriptorEntry;
  const cols = roleColumns(s, table);
  const query = s.query;
  const rows: RoleRowView[] = (table.rows ?? []).map((row) => {
    const cells = cols.map((col) =>
      leaf(
        // cells of a table are filtered by row, never per cell
        { ...s, query: '', changedOnly: false },
        col.template,
        childPointer(table.pointer, row.pointer, col.template),
        row.key,
        undefined,
        false,
      ),
    );
    const changed = cells.some((c) => c.changed);
    const text = [row.key, row.label ?? '', row.description ?? '', ...cols.map((c) => c.label)]
      .join(' ')
      .toLowerCase();
    const prefix = row.pointer + '/';
    const overridden =
      Object.keys(s.doc.values).some((p) => p.startsWith(prefix)) ||
      Object.keys(s.doc.invalid).some((p) => p.startsWith(prefix));
    const docPointer = '/env_overrides' + row.pointer;
    const rowVisible = (!query || text.includes(query)) && (!s.changedOnly || changed);
    return {
      pointer: row.pointer,
      docPointer,
      fieldName: pointerToFieldName(docPointer),
      key: row.key,
      label: row.label || row.key,
      description: row.description ?? null,
      absentEnvs: s.ctx.envs.length > 1 ? envsMissing(s.ctx.envs, row.pointer) : [],
      cells: cells.map((c) => ({ ...c, visible: rowVisible })),
      changed,
      overridden,
      visible: rowVisible,
    };
  });
  const allRow = cols.map((col) =>
    allItemsField(
      s,
      col.template,
      `All ${table.row_param || 'role'}s · ${col.label}`,
      rows.filter((r) => r.visible).map((r) => childPointer(table.pointer, r.pointer, col.template)),
    ),
  );
  const docPointer = '/env_overrides' + table.pointer;
  return {
    type: 'role_table',
    pointer: table.pointer,
    docPointer,
    fieldName: pointerToFieldName(docPointer),
    template,
    entry: table,
    rowParam: table.row_param || 'role',
    columns: cols,
    rows,
    allRow,
    visible: rows.some((r) => r.visible),
  };
}

function children(s: BuildState, entry: DescriptorEntry, pointer: string, context: string): SettingsNode[] {
  const out: SettingsNode[] = [];
  for (const childTemplate of entry.children ?? []) {
    const child = s.ctx.union.fields[childTemplate];
    if (!child) continue;
    if (child.kind === 'role_table') out.push(roleTable(s, childTemplate));
    else out.push(node(s, childTemplate, childPointer(entry.pointer, pointer, childTemplate), context));
  }
  return out;
}

function anyVisible(nodes: readonly SettingsNode[]): boolean {
  return nodes.some((n) => n.visible);
}

function extraKeys(s: BuildState, entry: DescriptorEntry, pointer: string): ExtraKeysView | null {
  const template = entry.additional_pointer;
  const item = template ? s.ctx.union.fields[template] : undefined;
  if (!template || !item) return null;
  const fixed = new Set<string>();
  for (const childTemplate of entry.children ?? []) {
    const c = s.ctx.union.fields[childTemplate];
    if (!c) continue;
    if (c.kind === 'role_table') (c.rows ?? []).forEach((r) => fixed.add(r.key));
    else fixed.add(c.path[c.path.length - 1] ?? '');
  }
  const listKey = pointer + '#extra';
  const keys: string[] = [];
  for (const p of [...Object.keys(s.doc.values), ...Object.keys(s.doc.invalid)]) {
    if (!p.startsWith(pointer + '/')) continue;
    const key = splitPointer(p.slice(pointer.length))[0];
    if (key != null && !fixed.has(key) && !keys.includes(key)) keys.push(key);
  }
  for (const key of s.doc.addedKeys[listKey] ?? []) if (!keys.includes(key)) keys.push(key);
  const items = keys.map((key) => {
    const concrete = appendSegment(pointer, key);
    if (item.kind === 'field') {
      const n = leaf(
        s,
        template,
        concrete,
        entry.label || entry.name,
        { ...item, name: key, label: key },
        true,
      );
      return { key, pointer: concrete, node: n };
    }
    const docPointer = '/env_overrides' + concrete;
    const kids = children(s, item, concrete, key);
    const n: ObjectNode = {
      type: 'object',
      pointer: concrete,
      docPointer,
      fieldName: pointerToFieldName(docPointer),
      template,
      entry: item,
      title: key,
      missingEnvs: [],
      children: kids,
      extra: null,
      visible: anyVisible(kids),
    };
    return { key, pointer: concrete, node: n };
  });
  return { listKey, template, fixedKeys: Array.from(fixed), items };
}

function collection(s: BuildState, template: string, pointer: string): CollectionNode {
  const entry = s.ctx.union.fields[template] as DescriptorEntry;
  const keys = collectionKeys(s, entry, pointer);
  const required = entry.required_keys ?? [];
  const item = entry.item_pointer ? s.ctx.union.fields[entry.item_pointer] : undefined;
  const items: CollectionItemView[] = keys.map((key) => {
    const itemPointer = appendSegment(pointer, key);
    const kids = item ? children(s, item, itemPointer, key) : [];
    const docPointer = '/env_overrides' + itemPointer;
    return {
      pointer: itemPointer,
      docPointer,
      fieldName: pointerToFieldName(docPointer),
      key,
      required: required.includes(key),
      removable: !required.includes(key) && (s.doc.addedKeys[pointer] ?? []).includes(key),
      children: kids,
      visible: anyVisible(kids),
    };
  });
  const allItems: AllItemsField[] = [];
  if (item && keys.length > 1) {
    const noun = (entry.key_param || 'entry') + (entry.key_param ? 's' : '');
    for (const childTemplate of item.children ?? []) {
      const child = s.ctx.union.fields[childTemplate];
      if (!child) continue;
      const pointers = keys.map((key) =>
        childPointer(entry.item_pointer as string, appendSegment(pointer, key), childTemplate),
      );
      const f = allItemsField(s, childTemplate, `All ${noun} · ${child.label || child.name}`, pointers);
      if (f) allItems.push(f);
    }
  }
  const docPointer = '/env_overrides' + pointer;
  return {
    type: 'collection',
    pointer,
    docPointer,
    fieldName: pointerToFieldName(docPointer),
    template,
    entry,
    title: entry.label || entry.name,
    keyParam: entry.key_param || 'entry',
    keyPattern: entry.key_pattern ?? null,
    listKey: pointer,
    items,
    allItems,
    visible: items.some((i) => i.visible),
  };
}

function node(s: BuildState, template: string, pointer: string, context: string): SettingsNode {
  const entry = s.ctx.union.fields[template] as DescriptorEntry;
  if (entry.kind === 'field') return leaf(s, template, pointer, context);
  if (entry.kind === 'collection') return collection(s, template, pointer);
  if (entry.kind === 'role_table') return roleTable(s, template);
  const kids = children(s, entry, pointer, context);
  const extra = extraKeys(s, entry, pointer);
  const docPointer = '/env_overrides' + pointer;
  const extraVisible = extra ? extra.items.some((i) => i.node.visible) : false;
  return {
    type: 'object',
    pointer,
    docPointer,
    fieldName: pointerToFieldName(docPointer),
    template,
    entry,
    title: entry.label || entry.name,
    missingEnvs: missingFrom(s.ctx.union, template),
    children: kids,
    extra,
    visible: anyVisible(kids) || extraVisible,
  };
}

function countLeaves(nodes: readonly SettingsNode[], onlyVisible: boolean): number {
  let n = 0;
  for (const nd of nodes) {
    if (nd.type === 'leaf') n += !onlyVisible || nd.visible ? 1 : 0;
    else if (nd.type === 'object') {
      n += countLeaves(nd.children, onlyVisible);
      n += (nd.extra?.items ?? []).reduce((acc, i) => acc + countLeaves([i.node], onlyVisible), 0);
    } else if (nd.type === 'collection') nd.items.forEach((i) => (n += countLeaves(i.children, onlyVisible)));
    else n += nd.rows.filter((r) => !onlyVisible || r.visible).length;
  }
  return n;
}

/** The whole "Environment overrides" card for the current document and filter. */
export function buildSettingsView(
  doc: LaunchDocument,
  ctx: FormContext,
  filter: Partial<SettingsFilter> = {},
): SettingsView {
  const query = (filter.search ?? '').trim().toLowerCase();
  const changedOnly = Boolean(filter.changedOnly);
  const filtering = Boolean(query) || changedOnly;
  const groupOpen = filter.groupOpen ?? {};
  const s: BuildState = { doc, ctx, bound: boundPointers(doc, ctx), query, changedOnly };
  const toGroup = (id: string, label: string, nodes: SettingsNode[], count: number): GroupView => {
    const matches = countLeaves(nodes, true);
    const visible = !filtering || matches > 0;
    const chosen = groupOpen[id] ?? id === UNMATCHED_GROUP;
    const open = filtering ? visible || chosen : chosen;
    return { id, label, count, nodes, visible, open, autoOpened: open && !chosen, matches };
  };
  const groups: GroupView[] = [];
  if (ctx.union.envs.length) {
    for (const group of ctx.union.groups) {
      const nodes: SettingsNode[] = [];
      for (const template of group.pointers) {
        if (!ctx.union.fields[template]) continue;
        nodes.push(node(s, template, template, ''));
      }
      groups.push(toGroup(group.id, group.label, nodes, group.pointers.length));
    }
  }
  let unmatched: GroupView | null = null;
  if (ctx.union.envs.length) {
    const pointers = unmatchedPointers(ctx.union, [...Object.keys(doc.values), ...Object.keys(doc.invalid)]);
    if (pointers.length) {
      const nodes = pointers.map((p) => {
        const segs = splitPointer(p);
        const entry = unmatchedEntry(p);
        entry.name = segs[segs.length - 1] ?? p;
        return leaf(s, p, p, '', entry, true);
      });
      unmatched = toGroup(UNMATCHED_GROUP, 'Other values', nodes, pointers.length);
    }
  }
  const anyVisibleGroup = groups.some((g) => g.visible) || Boolean(unmatched?.visible);
  return {
    groups,
    unmatched,
    filtering,
    empty: filtering && !anyVisibleGroup,
    changedCount: changedPointers(doc).length,
  };
}

/** Flat list of every leaf (including role cells) in a view: handy for focus lookups. */
export function allLeaves(view: SettingsView): LeafNode[] {
  const out: LeafNode[] = [];
  const walk = (nodes: readonly SettingsNode[]) => {
    for (const nd of nodes) {
      if (nd.type === 'leaf') out.push(nd);
      else if (nd.type === 'object') {
        walk(nd.children);
        (nd.extra?.items ?? []).forEach((i) => walk([i.node]));
      } else if (nd.type === 'collection') nd.items.forEach((i) => walk(i.children));
      else nd.rows.forEach((r) => out.push(...r.cells));
    }
  };
  [...view.groups, ...(view.unmatched ? [view.unmatched] : [])].forEach((g) => walk(g.nodes));
  return out;
}

/** The group id (descriptor group, or "unmatched") a document pointer lives in. */
export function groupOfPointer(ctx: Pick<FormContext, 'union'>, pointer: string): string | null {
  const segments = splitPointer(pointer);
  for (let n = segments.length; n > 0; n -= 1) {
    const prefix =
      '/' +
      segments
        .slice(0, n)
        .map((x) => x.replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('/');
    const template = Object.keys(ctx.union.fields).find((t) => sameShape(t, prefix));
    const entry = template ? ctx.union.fields[template] : undefined;
    if (entry?.group) return entry.group;
  }
  return segments.length ? UNMATCHED_GROUP : null;
}

function sameShape(template: string, concrete: string): boolean {
  const a = splitPointer(template);
  const b = splitPointer(concrete);
  return (
    a.length === b.length &&
    a.every((seg, i) => seg === b[i] || (seg.length > 2 && seg.startsWith('{') && seg.endsWith('}')))
  );
}
