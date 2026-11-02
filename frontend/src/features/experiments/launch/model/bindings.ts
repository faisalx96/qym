/**
 * Model-slot bindings: project model / temporary model / model sweep per slot, the
 * global model (B22), extra endpoints (this experiment only) and the key refs that
 * point into the SecretStore. All functions are pure and return a new document.
 */
import { slotConnections, temporaryKeysAllowed } from './descriptor';
import { deepCopy, escapeSegment, isPlainObject, isSweepValue, sameValue, splitPointer } from './pointers';
import { sweepItemKey, bindingFromSweepItem } from './sweeps';
import type { SecretStore } from './secrets';
import type {
  Bindings,
  FormContext,
  JsonValue,
  LaunchDocument,
  SlotBinding,
  SweepModelItem,
  TemporaryModelSpec,
  UnionSlot,
  Values,
} from './types';

export function slotPointer(slotKey: string): string {
  return '/slot_bindings/' + escapeSegment(slotKey);
}

export function endpointSlots(ctx: Pick<FormContext, 'slots'>): UnionSlot[] {
  return ctx.slots.filter((s) => s.kind === 'endpoint');
}

/** Name of an `endpoint:<name>` slot key, else null. */
export function endpointName(slotKey: string): string | null {
  const m = /^endpoint:(.+)$/.exec(slotKey);
  return m ? (m[1] as string) : null;
}

// ── Spec <-> binding ─────────────────────────────────────────────────────

export function temporarySpec(b: Extract<SlotBinding, { kind: 'temporary' }>): TemporaryModelSpec {
  const t: TemporaryModelSpec = { model: b.model };
  if (b.label) t.label = b.label;
  if (b.baseUrl) t.base_url = b.baseUrl;
  if (b.secretRef) t.api_key = { $secret: b.secretRef };
  return t;
}

/** A binding as the spec's `slot_bindings` value. */
export function bindingToSpec(b: SlotBinding): JsonValue {
  if (b.kind === 'connection') return { connection_id: b.id };
  if (b.kind === 'sweep') return { sweep: deepCopy(b.items) as unknown as JsonValue[] };
  return { temporary: temporarySpec(b) as unknown as JsonValue };
}

/** A comparable key for a binding (a temporary model's key is not part of it). */
export function bindingKey(b: SlotBinding | null | undefined): string {
  if (!b) return '';
  if (b.kind === 'connection') return 'c:' + b.id;
  if (b.kind === 'temporary') {
    const t = temporarySpec(b);
    delete t.api_key;
    return 't:' + JSON.stringify(t);
  }
  return 's:' + JSON.stringify(b.items.map(sweepItemKey));
}

// ── Secrets ──────────────────────────────────────────────────────────────

/** `{"$secret": ref}` refs under a spec value. */
export function secretRefsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => secretRefsIn(v, out));
  else if (isPlainObject(value)) {
    if (typeof value['$secret'] === 'string') out.push(value['$secret']);
    else for (const k of Object.keys(value)) secretRefsIn(value[k], out);
  }
  return out;
}

/** Key refs a binding holds (their keys live in the SecretStore). */
export function bindingSecretRefs(b: SlotBinding | null | undefined): string[] {
  if (!b) return [];
  if (b.kind === 'temporary') return b.secretRef ? [b.secretRef] : [];
  if (b.kind === 'sweep') return secretRefsIn(b.items);
  return [];
}

/** Every key ref the document uses (bindings and the global model). */
export function docSecretRefs(
  doc: Pick<LaunchDocument, 'bindings' | 'globalModel'>,
  exceptKey?: string | null,
): Set<string> {
  const refs = new Set<string>();
  for (const k of Object.keys(doc.bindings))
    if (k !== exceptKey) bindingSecretRefs(doc.bindings[k]).forEach((r) => refs.add(r));
  bindingSecretRefs(doc.globalModel).forEach((r) => refs.add(r));
  return refs;
}

/** Keys of temporary models no binding uses any more are forgotten. */
export function pruneSecrets(
  doc: Pick<LaunchDocument, 'bindings' | 'globalModel'>,
  secrets: SecretStore,
): void {
  secrets.retainOnly(docSecretRefs(doc));
}

/** A temporary model binding from the "+ Temporary model" form result. */
export function temporaryBinding(input: {
  label?: string;
  model: string;
  baseUrl?: string;
  secretRef: string | null;
  save?: boolean;
}): SlotBinding {
  return {
    kind: 'temporary',
    label: input.label || undefined,
    model: input.model,
    baseUrl: input.baseUrl || undefined,
    secretRef: input.secretRef,
    save: Boolean(input.save),
    needsKey: false,
  };
}

// ── Bound fields ─────────────────────────────────────────────────────────

/** Pointers filled by a bound slot -> the slot label (those inputs are locked). */
export function boundPointers(
  doc: Pick<LaunchDocument, 'bindings'>,
  ctx: Pick<FormContext, 'slots'>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of ctx.slots) {
    if (!doc.bindings[slot.slot_key]) continue;
    for (const p of slot.pointers) out[p] = slot.label;
  }
  return out;
}

/** Raw values under a bound slot's fields would be a binding_conflict: drop them. */
export function stripBoundFields(values: Values, bindings: Bindings, slots: readonly UnionSlot[]): Values {
  const next = { ...values };
  for (const slot of slots) {
    if (!bindings[slot.slot_key]) continue;
    for (const p of slot.pointers) delete next[p];
  }
  return next;
}

// ── Setting a binding ────────────────────────────────────────────────────

function dropSlotValues(doc: LaunchDocument, slot: UnionSlot | undefined): LaunchDocument {
  if (!slot) return doc;
  const values = { ...doc.values };
  const invalid = { ...doc.invalid };
  for (const p of slot.pointers) {
    delete values[p];
    delete invalid[p];
  }
  return { ...doc, values, invalid };
}

/**
 * Bind (or unbind with null) a slot. A bound slot fills its fields, so raw values
 * there are dropped (binding_conflict otherwise). Pass `secrets` to forget keys no
 * binding uses any more.
 */
export function setBinding(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  slotKey: string,
  binding: SlotBinding | null,
  secrets?: SecretStore,
): LaunchDocument {
  const bindings = { ...doc.bindings };
  if (binding) bindings[slotKey] = binding;
  else delete bindings[slotKey];
  let next: LaunchDocument = { ...doc, bindings };
  if (binding)
    next = dropSlotValues(
      next,
      ctx.slots.find((s) => s.slot_key === slotKey),
    );
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

/** A key typed again for a temporary model that came without one. */
export function reenterKey(doc: LaunchDocument, slotKey: string, ref: string): LaunchDocument {
  const b = doc.bindings[slotKey];
  if (!b || b.kind !== 'temporary') return doc;
  return { ...doc, bindings: { ...doc.bindings, [slotKey]: { ...b, secretRef: ref, needsKey: false } } };
}

export interface KeyPrompt {
  /** Slot key, or null for the global model. */
  slotKey: string | null;
  label: string;
}

/** Temporary models that came without a key (clone/preset/best run): ask again. */
export function bindingsNeedingKey(doc: LaunchDocument, ctx: Pick<FormContext, 'slots'>): KeyPrompt[] {
  const out: KeyPrompt[] = [];
  const g = doc.globalModel;
  if (g && g.kind === 'temporary' && g.needsKey && !g.secretRef)
    out.push({ slotKey: null, label: 'Global model' });
  for (const key of Object.keys(doc.bindings)) {
    const b = doc.bindings[key];
    if (!b || b.kind !== 'temporary' || !b.needsKey || b.secretRef) continue;
    if (g && followsGlobal(doc, key)) continue; // asked once at the global control
    out.push({ slotKey: key, label: ctx.slots.find((s) => s.slot_key === key)?.label ?? key });
  }
  return out;
}

/** Whether temporary-model keys may be entered for the current environments. */
export function canEnterKeys(ctx: Pick<FormContext, 'envs'>): { allowed: boolean; reason: string | null } {
  return temporaryKeysAllowed(ctx);
}

export function bindingSummary(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'envs' | 'slots'>,
  slotKey: string,
): string {
  const b = doc.bindings[slotKey];
  if (!b) return 'Inherit';
  if (b.kind === 'connection') {
    for (const env of ctx.envs) {
      const conn = env.options?.connections.find((c) => c.connection_id === b.id);
      if (conn) return conn.name;
    }
    return b.id;
  }
  if (b.kind === 'sweep') return `Sweep of ${b.items.length} model${b.items.length === 1 ? '' : 's'}`;
  return 'Temporary: ' + (b.label || b.model);
}

// ── Global model (B22) ───────────────────────────────────────────────────

export function followsGlobal(
  doc: Pick<LaunchDocument, 'bindings' | 'globalModel'>,
  slotKey: string,
): boolean {
  return Boolean(doc.globalModel) && bindingKey(doc.bindings[slotKey]) === bindingKey(doc.globalModel);
}

/** The binding every endpoint shares (a sweep only when linked), else null. */
export function commonEndpointBinding(
  doc: Pick<LaunchDocument, 'bindings' | 'links'>,
  ctx: Pick<FormContext, 'slots'>,
): SlotBinding | null {
  const slots = endpointSlots(ctx);
  const first = slots.length ? doc.bindings[(slots[0] as UnionSlot).slot_key] : undefined;
  if (!first) return null;
  const key = bindingKey(first);
  if (slots.some((s) => bindingKey(doc.bindings[s.slot_key]) !== key)) return null;
  if (first.kind === 'sweep') {
    // Independent model sweeps on several endpoints are a grid, not one global sweep.
    const pointers = slots.map((s) => slotPointer(s.slot_key));
    const linked = slots.length === 1 || (doc.links ?? []).some((g) => pointers.every((p) => g.includes(p)));
    if (!linked) return null;
  }
  return deepCopy(first);
}

/** Derive the global model again after the bindings were replaced as a whole. */
export function deriveGlobalModel(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots' | 'envs'>,
): LaunchDocument {
  if (ctx.envs.length === 0 || ctx.envs.some((e) => e.loading)) return doc;
  return { ...doc, globalModel: commonEndpointBinding(doc, ctx) };
}

/** Endpoints that only have raw values under Environment configurations (no slot yet). */
export function rawEndpointNames(doc: LaunchDocument, ctx: Pick<FormContext, 'union' | 'slots'>): string[] {
  const collection = Object.values(ctx.union.fields).find(
    (e) => e.kind === 'collection' && e.key_param === 'endpoint',
  );
  if (!collection) return [];
  const depth = splitPointer(collection.pointer).length;
  const slotted = ctx.slots.map((s) => s.slot_key);
  const names: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !names.includes(name) && !slotted.includes('endpoint:' + name)) names.push(name);
  };
  for (const p of Object.keys(doc.values))
    if (p.startsWith(collection.pointer + '/')) add(splitPointer(p)[depth]);
  (doc.addedKeys[collection.pointer] ?? []).forEach(add);
  return names;
}

/** Endpoint names bound in a config's slot_bindings that no selected env has confirmed. */
export function unconfirmedEndpoints(
  config: { slot_bindings?: unknown } | null | undefined,
  ctx: Pick<FormContext, 'envs'>,
): string[] {
  const raw = config && isPlainObject(config.slot_bindings) ? config.slot_bindings : {};
  return Object.keys(raw)
    .map(endpointName)
    .filter((n): n is string => Boolean(n))
    .filter((name) => !ctx.envs.some((e) => e.slots.some((s) => s.slot_key === 'endpoint:' + name)));
}

function bindGlobalTo(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  slots: readonly UnionSlot[],
): LaunchDocument {
  const g = doc.globalModel;
  if (!g) return doc;
  let next = doc;
  for (const slot of slots) {
    next = { ...next, bindings: { ...next.bindings, [slot.slot_key]: deepCopy(g) } };
    next = dropSlotValues(next, slot);
  }
  if (g.kind === 'sweep') {
    const pointers = endpointSlots(ctx)
      .filter((s) => followsGlobal(next, s.slot_key))
      .map((s) => slotPointer(s.slot_key));
    if (pointers.length > 1) {
      // One axis: the endpoints' sweeps run zipped, with whatever was linked to them.
      const others: string[] = [];
      const groups = (next.links ?? []).filter((grp) => {
        if (!grp.some((p) => pointers.includes(p))) return true;
        grp.forEach((p) => {
          if (!pointers.includes(p) && !others.includes(p)) others.push(p);
        });
        return false;
      });
      next = { ...next, links: groups.concat([pointers.concat(others)]) };
    }
  }
  return next;
}

/**
 * Set (every endpoint gets it) or clear (endpoints keep their models) the global
 * model. Endpoints that only have raw values must be added first: call
 * `rawEndpointNames` and load their proposals (`addExtraEndpoints`) before this.
 */
export function setGlobalModel(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  binding: SlotBinding | null,
  secrets?: SecretStore,
): LaunchDocument {
  let next: LaunchDocument = { ...doc, globalModel: binding ? deepCopy(binding) : null };
  if (binding) next = bindGlobalTo(next, ctx, endpointSlots(ctx));
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

/** "Single model" on a global sweep that starts with Inherit: the endpoints inherit. */
export function inheritEverywhere(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  secrets?: SecretStore,
): LaunchDocument {
  const bindings = { ...doc.bindings };
  for (const s of endpointSlots(ctx)) if (followsGlobal(doc, s.slot_key)) delete bindings[s.slot_key];
  const next = { ...doc, bindings, globalModel: null };
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

export interface GlobalSummary {
  following: UnionSlot[];
  /** Endpoints that differ from the global model ("custom"). Empty when none is set. */
  custom: UnionSlot[];
  total: number;
}

export function globalSummary(doc: LaunchDocument, ctx: Pick<FormContext, 'slots'>): GlobalSummary {
  const slots = endpointSlots(ctx);
  const following = slots.filter((s) => followsGlobal(doc, s.slot_key));
  const custom = doc.globalModel ? slots.filter((s) => !followsGlobal(doc, s.slot_key)) : [];
  return { following, custom, total: slots.length };
}

/** A new endpoint starts on the global model, like every other endpoint. */
export function addExtraEndpoints(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'slots'>,
  names: readonly string[],
): LaunchDocument {
  const fresh = names.filter((n, i) => names.indexOf(n) === i && !doc.extraEndpoints.includes(n));
  if (!fresh.length) return doc;
  let next: LaunchDocument = { ...doc, extraEndpoints: [...doc.extraEndpoints, ...fresh] };
  if (next.globalModel) {
    next = bindGlobalTo(
      next,
      ctx,
      endpointSlots(ctx).filter((s) => fresh.includes(endpointName(s.slot_key) ?? '')),
    );
  }
  return next;
}

export function removeExtraEndpoint(
  doc: LaunchDocument,
  name: string,
  secrets?: SecretStore,
): LaunchDocument {
  const bindings = { ...doc.bindings };
  delete bindings['endpoint:' + name];
  const next = { ...doc, extraEndpoints: doc.extraEndpoints.filter((n) => n !== name), bindings };
  if (secrets) pruneSecrets(next, secrets);
  return next;
}

/** Name checks for "+ Add LLM endpoint". */
export const ENDPOINT_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_.-]*$';
export function validateEndpointName(
  name: string,
  collection: { key_pattern?: string | null } | null,
  existing: readonly UnionSlot[],
): string | null {
  const n = name.trim();
  if (!n) return 'Enter a name.';
  if (!new RegExp(collection?.key_pattern || ENDPOINT_NAME_PATTERN).test(n)) {
    return collection?.key_pattern ? 'Invalid name.' : 'Use letters, digits, ".", "_" or "-".';
  }
  if (existing.some((s) => s.slot_key === 'endpoint:' + n)) return 'Already present.';
  return null;
}

// ── Spec -> binding (presets, clones, Raw JSON) ──────────────────────────

/** Spec value -> form binding for a slot, or a note why it is left to Inherit. */
export function bindingFromSpec(
  raw: unknown,
  slot: UnionSlot,
  ctx: Pick<FormContext, 'envs'>,
): { binding: SlotBinding | null; note?: string } {
  if (raw == null || !isPlainObject(raw) || raw['inherit'] === true) return { binding: null };
  if (isSweepValue(raw)) {
    return { binding: { kind: 'sweep', items: deepCopy(raw.sweep) as unknown as SweepModelItem[] } };
  }
  if (typeof raw['connection_id'] === 'string' && !('temporary' in raw)) {
    const id = raw['connection_id'];
    const conn = slotConnections(ctx, slot).find((c) => c.id === id);
    if (conn && conn.available) return { binding: { kind: 'connection', id } };
    const name = (typeof raw['name'] === 'string' && raw['name']) || conn?.name || id;
    return {
      binding: null,
      note: `Model ${name} ${conn ? 'cannot be used' : 'no longer exists'} for ${slot.label}; pick another model.`,
    };
  }
  if (isPlainObject(raw['temporary'])) {
    // Never a key: presets and clones drop it (§7.5); it is asked for again.
    const t = raw['temporary'];
    return {
      binding: {
        kind: 'temporary',
        label: typeof t['label'] === 'string' ? t['label'] : undefined,
        model: typeof t['model'] === 'string' ? t['model'] : '',
        baseUrl: typeof t['base_url'] === 'string' ? t['base_url'] : undefined,
        secretRef: null,
        save: false,
        needsKey: true,
      },
    };
  }
  return { binding: null };
}

/** Sweep-item helper for the models multi-select: the binding one item stands for. */
export function singleBindingFromItem(item: SweepModelItem | undefined): SlotBinding | null {
  return bindingFromSweepItem(item);
}

/** True when two bindings are the same model (keys ignored). */
export function sameBinding(a: SlotBinding | null | undefined, b: SlotBinding | null | undefined): boolean {
  return sameValue(bindingKey(a), bindingKey(b));
}
