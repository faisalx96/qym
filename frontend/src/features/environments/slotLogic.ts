/**
 * Pure logic of the LLM slot editor (eval_environments.js `createSlotEditor`): which
 * descriptor fields can fill a role, and the reducer behind the cards. Mirrors the rules of
 * `services/eval_model_slots.py`: a field fills one role of one key set of one slot.
 */
import type {
  DescriptorEntry,
  EvalSlot,
  FormDescriptor,
  KeySet,
  SlotPayload,
  SlotRole,
  SlotStatus,
} from '@/api/evalEnvironments';

export const ROLES: SlotRole[] = ['model', 'base_url', 'api_key'];
export const ROLE_LABELS: Record<SlotRole, string> = {
  model: 'Model',
  base_url: 'Base URL',
  api_key: 'API key',
};

// Mirrors DEFAULT_SLOT_RULES in services/eval_model_slots.py.
const ROLE_RULES: Record<SlotRole, { names: string[]; suffixes: string[]; types: string[] }> = {
  model: { names: ['model', 'model_name'], suffixes: ['_MODEL_NAME', '_MODEL'], types: ['string', 'enum'] },
  base_url: { names: ['base_url', 'url'], suffixes: ['_BASE_URL', '_URL', '_ENDPOINT'], types: ['string'] },
  api_key: { names: ['api_key'], suffixes: ['_API_KEY', '_KEY'], types: ['string'] },
};
const TRANSPORT = ['timeout', 'max_attempts', 'max_connections', 'max_keepalive', 'connect_timeout'];
const SCALAR_TYPES = ['boolean', 'integer', 'number', 'string', 'enum'];

export interface EditSlot {
  slot_key: string;
  kind: 'endpoint' | 'flat';
  label: string;
  field_map: KeySet;
  transport_fields: Record<string, string>;
  extra_field_maps: KeySet[];
  required: boolean;
  status: SlotStatus;
}

export interface SlotEditorState {
  slots: EditSlot[];
  removed: EditSlot[];
  errors: Record<string, string[]>;
  general: string;
  generalReload: boolean;
  notice: string;
}

// ------------------------------------------------------------- JSON pointers & descriptor

export const escapePointerSegment = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Fill `{param}` segments of a pointer template. */
export function expandPointer(template: string, params: Record<string, string>): string {
  return template
    .split('/')
    .map((segment) => {
      const m = /^\{(.+)\}$/.exec(segment);
      const value = m ? params[m[1]!] : undefined;
      return value != null ? escapePointerSegment(value) : segment;
    })
    .join('/');
}

export function humanize(name: string): string {
  const acronyms = ['ai', 'api', 'id', 'llm', 'rag', 'sql', 'url', 'viz'];
  const words = String(name)
    .split(/[_\-\s.]+/)
    .filter(Boolean)
    .map((w) => (acronyms.includes(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  if (words.length && words[0] === words[0]!.toLowerCase()) {
    words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
  }
  return words.join(' ') || String(name);
}

const fieldsOf = (d: FormDescriptor | undefined | null) => d?.fields ?? {};

export function countFields(d: FormDescriptor | undefined | null): number {
  return Object.values(fieldsOf(d)).filter((e) => e?.kind === 'field').length;
}

function endpointCollection(d: FormDescriptor): DescriptorEntry | null {
  return (
    Object.values(fieldsOf(d)).find(
      (e) => e && e.kind === 'collection' && e.name === 'endpoints' && !(e.params && e.params.length),
    ) ?? null
  );
}

export function hasEndpointCollection(d: FormDescriptor): boolean {
  return endpointCollection(d) !== null;
}

const roleFits = (entry: DescriptorEntry | undefined, role: SlotRole) =>
  Boolean(entry && entry.kind === 'field' && ROLE_RULES[role].types.includes(String(entry.type)));

/** Concrete pointers that can fill `role` for an endpoint slot. */
export function endpointCandidates(d: FormDescriptor, endpointKey: string, role: SlotRole): string[] {
  const fields = fieldsOf(d);
  const collection = endpointCollection(d);
  const item = collection?.item_pointer ? fields[collection.item_pointer] : undefined;
  if (!collection || !item) return [];
  const rank = (e: DescriptorEntry) =>
    ROLE_RULES[role].names.includes(String(e.name).toLowerCase()) ? 0 : 1;
  return (item.children ?? [])
    .map((p) => fields[p])
    .filter((e): e is DescriptorEntry => roleFits(e, role))
    .sort((a, b) => rank(a) - rank(b))
    .map((e) => expandPointer(e.pointer, { [collection.key_param ?? 'endpoint']: endpointKey }));
}

/** Top-level (flat env var) pointers that can fill `role`. */
export function flatCandidates(d: FormDescriptor, role: SlotRole): string[] {
  const fields = fieldsOf(d);
  const suffixes = ROLE_RULES[role].suffixes;
  const rank = (e: DescriptorEntry) =>
    suffixes.some((s) => String(e.name).toUpperCase().endsWith(s)) ? 0 : 1;
  return (d.root ?? [])
    .map((p) => fields[p])
    .filter((e): e is DescriptorEntry => roleFits(e, role))
    .sort((a, b) => rank(a) - rank(b))
    .map((e) => e.pointer);
}

function rootByUpperName(d: FormDescriptor): Record<string, DescriptorEntry> {
  const out: Record<string, DescriptorEntry> = {};
  for (const p of d.root ?? []) {
    const e = fieldsOf(d)[p];
    if (e?.kind === 'field') out[String(e.name).toUpperCase()] = e;
  }
  return out;
}

// ------------------------------------------------------------- slot helpers

export const emptyKeySet = (): KeySet => ({ model: null, base_url: null, api_key: null });

function normalizeKeySet(set: Partial<KeySet> | null | undefined): KeySet {
  return { model: set?.model ?? null, base_url: set?.base_url ?? null, api_key: set?.api_key ?? null };
}

export function normalizeSlot(slot: Partial<EvalSlot> & { slot_key: string }): EditSlot {
  return {
    slot_key: slot.slot_key,
    kind: slot.kind ?? (slot.slot_key.startsWith('flat:') ? 'flat' : 'endpoint'),
    label: slot.label ?? '',
    field_map: normalizeKeySet(slot.field_map),
    transport_fields: { ...(slot.transport_fields ?? {}) },
    extra_field_maps: (slot.extra_field_maps ?? []).map(normalizeKeySet),
    required: Boolean(slot.required),
    status: slot.status ?? 'new',
  };
}

/** Every key set of a slot: `field_map` first, then `extra_field_maps`. */
export const keySets = (slot: EditSlot): KeySet[] => [slot.field_map, ...slot.extra_field_maps];

export function slotPointers(slot: EditSlot): string[] {
  const out: string[] = [];
  for (const set of keySets(slot)) for (const p of Object.values(set)) if (p) out.push(p);
  for (const p of Object.values(slot.transport_fields)) if (p) out.push(p);
  return out;
}

function usedPointers(slots: EditSlot[], exceptKey?: string): Set<string> {
  const used = new Set<string>();
  for (const slot of slots) if (slot.slot_key !== exceptKey) slotPointers(slot).forEach((p) => used.add(p));
  return used;
}

/** Fields that can fill `role` of key set `setIdx` of `slot` (not used anywhere else). */
export function candidatesFor(
  slots: EditSlot[],
  descriptor: FormDescriptor,
  slot: EditSlot,
  role: SlotRole,
  setIdx: number,
): string[] {
  const name = slot.slot_key.slice(slot.slot_key.indexOf(':') + 1);
  const used = usedPointers(slots, slot.slot_key);
  keySets(slot).forEach((set, j) => {
    for (const [r, p] of Object.entries(set)) if (p && (j !== setIdx || r !== role)) used.add(p);
  });
  Object.values(slot.transport_fields).forEach((p) => used.add(p));
  // The first set of an endpoint slot lives in its endpoint entry; other sets can be any
  // top-level LLM field (e.g. CHART_LLM_MODEL next to VIZ_LLM_MODEL).
  const candidates =
    slot.kind === 'endpoint' && setIdx === 0
      ? endpointCandidates(descriptor, name, role)
      : flatCandidates(descriptor, role);
  return candidates.filter((p) => !used.has(p));
}

/** Unassigned top-level model fields offered by "Add a group". */
export function freeFlatModels(slots: EditSlot[], descriptor: FormDescriptor): string[] {
  const used = usedPointers(slots);
  return flatCandidates(descriptor, 'model').filter((p) => !used.has(p));
}

/** Build a flat group around a model field, pulling in the matching base URL/key/transport fields. */
export function flatSlotFromField(
  slots: EditSlot[],
  descriptor: FormDescriptor,
  pointer: string,
): EditSlot | { error: string } {
  const entry = fieldsOf(descriptor)[pointer];
  if (!entry) return { error: 'That field is not in the schema.' };
  const name = String(entry.name);
  const upper = name.toUpperCase();
  const suffix = ROLE_RULES.model.suffixes.find((s) => upper.endsWith(s) && upper.length > s.length);
  const prefix = suffix ? name.slice(0, name.length - suffix.length) : name;
  const key = `flat:${prefix}`;
  if (slots.some((s) => s.slot_key === key)) return { error: `A slot ${key} already exists.` };
  const byName = rootByUpperName(descriptor);
  const used = usedPointers(slots);
  const slot = normalizeSlot({
    slot_key: key,
    kind: 'flat',
    label: `${humanize(prefix)} model`,
    field_map: { model: pointer },
  });
  for (const role of ['base_url', 'api_key'] as const) {
    for (const s of ROLE_RULES[role].suffixes) {
      const candidate = byName[`${prefix}${s}`.toUpperCase()];
      if (candidate && roleFits(candidate, role) && !used.has(candidate.pointer)) {
        slot.field_map[role] = candidate.pointer;
        used.add(candidate.pointer);
        break;
      }
    }
  }
  for (const t of TRANSPORT) {
    const candidate = byName[`${prefix}_${t}`.toUpperCase()];
    if (candidate && SCALAR_TYPES.includes(String(candidate.type)) && !used.has(candidate.pointer)) {
      slot.transport_fields[t] = candidate.pointer;
      used.add(candidate.pointer);
    }
  }
  return slot;
}

/** Slots whose key sets lack a model field cannot be saved. */
export function slotsMissingModel(slots: EditSlot[]): EditSlot[] {
  return slots.filter((s) => keySets(s).some((set) => !set.model));
}

export function toPayload(slots: EditSlot[]): SlotPayload[] {
  return slots.map((s) => ({
    slot_key: s.slot_key,
    kind: s.kind,
    label: s.label.trim(),
    field_map: s.field_map,
    transport_fields: s.transport_fields,
    extra_field_maps: s.extra_field_maps,
  }));
}

// ------------------------------------------------------------- reducer

export type SlotAction =
  | { type: 'reset'; slots: EvalSlot[]; notice?: string }
  | { type: 'rename'; slotKey: string; label: string }
  | { type: 'setRole'; slotKey: string; setIdx: number; role: SlotRole; pointer: string | null }
  | { type: 'addSet'; slotKey: string }
  | { type: 'removeSet'; slotKey: string; setIdx: number }
  | { type: 'detach'; slotKey: string; name: string }
  | { type: 'merge'; srcKey: string; dstKey: string }
  | { type: 'remove'; slotKey: string }
  | { type: 'restore'; slotKey: string }
  | { type: 'addSlot'; slot: EditSlot }
  | { type: 'setErrors'; errors: Record<string, string[]>; general: string; reload?: boolean }
  | { type: 'general'; message: string };

export function initSlotState(slots: EvalSlot[] = []): SlotEditorState {
  return {
    slots: slots.map(normalizeSlot),
    removed: [],
    errors: {},
    general: '',
    generalReload: false,
    notice: '',
  };
}

function clearErrors(state: SlotEditorState, slotKey?: string): SlotEditorState {
  const errors = { ...state.errors };
  if (slotKey) delete errors[slotKey];
  return { ...state, errors, general: '', generalReload: false };
}

export function slotReducer(state: SlotEditorState, action: SlotAction): SlotEditorState {
  const update = (key: string, fn: (s: EditSlot) => EditSlot): SlotEditorState =>
    clearErrors(
      { ...state, slots: state.slots.map((s) => (s.slot_key === key ? fn(s) : s)), notice: '' },
      key,
    );
  switch (action.type) {
    case 'reset':
      return { ...initSlotState(action.slots), notice: action.notice ?? '' };
    case 'rename':
      return {
        ...state,
        slots: state.slots.map((s) => (s.slot_key === action.slotKey ? { ...s, label: action.label } : s)),
      };
    case 'setRole':
      return update(action.slotKey, (s) => {
        const sets = keySets(s).map((set, i) =>
          i === action.setIdx ? { ...set, [action.role]: action.pointer } : set,
        );
        return { ...s, field_map: sets[0]!, extra_field_maps: sets.slice(1) };
      });
    case 'addSet':
      return update(action.slotKey, (s) => ({
        ...s,
        extra_field_maps: [...s.extra_field_maps, emptyKeySet()],
      }));
    case 'removeSet':
      return update(action.slotKey, (s) => ({
        ...s,
        extra_field_maps: s.extra_field_maps.filter((_, i) => i !== action.setIdx - 1),
      }));
    case 'detach':
      return update(action.slotKey, (s) => {
        const transport = { ...s.transport_fields };
        delete transport[action.name];
        return { ...s, transport_fields: transport };
      });
    case 'merge': {
      const src = state.slots.find((s) => s.slot_key === action.srcKey);
      const dst = state.slots.find((s) => s.slot_key === action.dstKey);
      if (!src || !dst || src === dst) return state;
      const dropped: string[] = [];
      const transport = { ...dst.transport_fields };
      for (const [name, pointer] of Object.entries(src.transport_fields)) {
        if (!transport[name]) transport[name] = pointer;
        else dropped.push(pointer);
      }
      // Each of the source's key sets becomes one more key set of the target.
      const merged: EditSlot = {
        ...dst,
        transport_fields: transport,
        extra_field_maps: [
          ...dst.extra_field_maps,
          ...keySets(src)
            .filter((set) => set.model)
            .map(normalizeKeySet),
        ],
      };
      const next = clearErrors(
        { ...state, slots: state.slots.filter((s) => s !== src).map((s) => (s === dst ? merged : s)) },
        dst.slot_key,
      );
      return {
        ...next,
        notice:
          `Moved the keys of “${src.label || src.slot_key}” into “${dst.label || dst.slot_key}”: the model picked for it now fills them too.` +
          (dropped.length ? ` ${dropped.join(', ')} stay plain inputs.` : ''),
      };
    }
    case 'remove': {
      const slot = state.slots.find((s) => s.slot_key === action.slotKey);
      if (!slot || slot.required) return state;
      return clearErrors(
        {
          ...state,
          slots: state.slots.filter((s) => s !== slot),
          removed: [...state.removed, slot],
          notice: '',
        },
        slot.slot_key,
      );
    }
    case 'restore': {
      const slot = state.removed.find((s) => s.slot_key === action.slotKey);
      if (!slot) return state;
      const removed = state.removed.filter((s) => s !== slot);
      if (state.slots.some((s) => s.slot_key === slot.slot_key)) {
        return {
          ...state,
          general: `A slot ${slot.slot_key} already exists; remove it first to restore the old one.`,
        };
      }
      // Fields another slot claimed meanwhile cannot be shared.
      const used = usedPointers(state.slots);
      const strip = (set: KeySet): KeySet => ({
        model: set.model && !used.has(set.model) ? set.model : null,
        base_url: set.base_url && !used.has(set.base_url) ? set.base_url : null,
        api_key: set.api_key && !used.has(set.api_key) ? set.api_key : null,
      });
      const transport = Object.fromEntries(
        Object.entries(slot.transport_fields).filter(([, p]) => !used.has(p)),
      );
      const restored: EditSlot = {
        ...slot,
        field_map: strip(slot.field_map),
        extra_field_maps: slot.extra_field_maps.map(strip),
        transport_fields: transport,
      };
      return clearErrors({ ...state, slots: [...state.slots, restored], removed }, undefined);
    }
    case 'addSlot':
      return clearErrors(
        {
          ...state,
          slots: [...state.slots, action.slot],
          removed: state.removed.filter((s) => s.slot_key !== action.slot.slot_key), // the new slot supersedes it
          notice: '',
        },
        undefined,
      );
    case 'setErrors':
      return {
        ...state,
        errors: action.errors,
        general: action.general,
        generalReload: Boolean(action.reload),
      };
    case 'general':
      return { ...state, general: action.message, generalReload: false };
    default:
      return state;
  }
}

/** Route 422 `detail.errors` onto slot cards; the rest becomes a general message. */
export function distributeSlotErrors(
  slots: EditSlot[],
  errors: { slot_key?: string; message: string }[],
): { errors: Record<string, string[]>; general: string } {
  const byKey: Record<string, string[]> = {};
  const general: string[] = [];
  for (const e of errors) {
    if (e.slot_key && slots.some((s) => s.slot_key === e.slot_key))
      (byKey[e.slot_key] ??= []).push(e.message);
    else if (e.message) general.push(e.message);
  }
  return {
    errors: byKey,
    general:
      general.join(' ') ||
      (Object.keys(byKey).length ? 'Fix the highlighted slots, then confirm again.' : ''),
  };
}
