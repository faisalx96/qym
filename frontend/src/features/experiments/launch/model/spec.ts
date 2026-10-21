/**
 * The launch document -> POST /experiments body. Keys never enter the spec: a
 * temporary model's key is `{"$secret": ref}` in `slot_bindings` and `{ref: key}` in
 * the request's `secrets`, read from the SecretStore at send time.
 */
import { applyEvaluatorEdits } from './evaluator';
import { bindingToSpec, docSecretRefs } from './bindings';
import { datasetValue } from './document';
import { buildOverrides, deepCopy, isPlainObject, stableStringify } from './pointers';
import type { SecretStore } from './secrets';
import type {
  BaseSourcePayload,
  EvaluatorPanel,
  JsonObject,
  JsonValue,
  LaunchConfig,
  LaunchDocument,
  LaunchRequest,
  LaunchSpec,
  Priority,
} from './types';

// ── Spec ─────────────────────────────────────────────────────────────────

/** The §8.1 document the form sends. */
export function buildSpec(doc: LaunchDocument, panel?: EvaluatorPanel | null): LaunchSpec {
  // Base evaluator inputs (samples, report_k, …) ride along unchanged.
  let evaluator: JsonObject = {
    ...(deepCopy(doc.evaluatorExtra) as JsonObject),
    dataset: datasetValue(doc) || null,
  };
  if (doc.dataset.mode === 'project' && doc.dataset.ref) {
    if (doc.dataset.ref.startsWith('v:')) evaluator['dataset_version'] = doc.dataset.ref.slice(2);
    else if (doc.dataset.ref.startsWith('a:')) {
      const current = isPlainObject(evaluator['config']) ? evaluator['config'] : {};
      evaluator['config'] = { ...current, dataset_alias: doc.dataset.ref.slice(2) };
    }
  }
  const slotBindings: Record<string, JsonValue> = {};
  for (const key of Object.keys(doc.bindings)) slotBindings[key] = bindingToSpec(doc.bindings[key] as never);
  const values: Record<string, JsonValue> = {};
  for (const p of Object.keys(doc.values)) values[p] = deepCopy(doc.values[p] as JsonValue);
  evaluator = applyEvaluatorEdits(doc, evaluator, panel);
  const spec: LaunchSpec = { evaluator, slot_bindings: slotBindings, env_overrides: buildOverrides(values) };
  if (doc.links) spec.links = deepCopy(doc.links);
  return spec;
}

/**
 * The configuration to save as a preset version (default-preset editor): no dataset
 * key when none, temporary models without a key, and the environment's schema hash.
 */
export function buildPresetConfig(
  doc: LaunchDocument,
  schemaHash?: string | null,
  panel?: EvaluatorPanel | null,
): LaunchConfig {
  const spec = buildSpec(doc, panel);
  const evaluator = { ...spec.evaluator };
  if (!evaluator['dataset']) delete evaluator['dataset'];
  const slotBindings: Record<string, JsonValue> = {};
  for (const key of Object.keys(spec.slot_bindings)) {
    const b = spec.slot_bindings[key];
    if (isPlainObject(b) && isPlainObject(b['temporary'])) {
      const t = { ...b['temporary'] };
      delete t['api_key']; // presets never hold a key
      slotBindings[key] = { temporary: t };
    } else {
      slotBindings[key] = b as JsonValue;
    }
  }
  const out: LaunchConfig = { ...spec, evaluator, slot_bindings: slotBindings };
  if (schemaHash) out.schema_hash = schemaHash;
  return out;
}

export function baseSource(doc: LaunchDocument): BaseSourcePayload {
  const { base, clone } = doc;
  if ((base.kind === 'default' || base.kind === 'saved') && base.loaded && base.versionId) {
    return { kind: base.kind === 'default' ? 'official' : 'saved', preset_version_id: base.versionId };
  }
  if (base.kind === 'clone' && clone) {
    return clone.jobId
      ? { kind: 'clone', experiment_id: clone.experimentId, job_id: clone.jobId }
      : { kind: 'clone', experiment_id: clone.experimentId };
  }
  if (base.kind === 'best_run' && base.loaded && base.runId) return { kind: 'best_run', run_id: base.runId };
  return { kind: 'blank' };
}

export interface RequestOptions {
  dryRun: boolean;
  /** Sent after the user confirmed the HIGH-priority preemption warning. */
  acknowledgePreemption?: boolean;
  /**
   * Keys in the dry run's `secrets` field too (the vanilla form does: the service
   * validates that every `$secret` ref resolves). Default true.
   */
  secretsInDryRun?: boolean;
}

export function buildLaunchRequest(
  doc: LaunchDocument,
  secrets: SecretStore,
  options: RequestOptions,
  panel?: EvaluatorPanel | null,
): LaunchRequest {
  const dryRun = options.dryRun;
  const spec = buildSpec(doc, panel);
  const sendSecrets = !dryRun || options.secretsInDryRun !== false;
  const save: string[] = [];
  for (const key of Object.keys(doc.bindings)) {
    const b = doc.bindings[key];
    if (b && b.kind === 'temporary' && b.save) save.push(key);
  }
  const body: LaunchRequest = {
    name: doc.name.trim() || (dryRun ? 'Untitled experiment' : ''),
    environment_ids: doc.environmentIds.slice(),
    spec,
    base_source: baseSource(doc),
    dry_run: dryRun,
    secrets: sendSecrets ? secrets.pick(docSecretRefs(doc)) : {},
    save_to_project_models: save,
  };
  if (doc.description.trim()) body.description = doc.description.trim();
  if (doc.priority) body.priority = doc.priority as Priority;
  if (options.acknowledgePreemption) body.acknowledge_preemption = true;
  // Platform-owned: a request field, never part of the editable document.
  if (doc.latencySensitive) body.latency_sensitive = true;
  return body;
}

// ── Change detection / debouncing ────────────────────────────────────────

/** Stable text of the §8.1 document, the environments and the starting point. */
export function specKey(doc: LaunchDocument, panel?: EvaluatorPanel | null): string {
  return stableStringify({
    spec: buildSpec(doc, panel),
    env: doc.environmentIds,
    base: baseSource(doc),
    save: Object.keys(doc.bindings).filter((k) => {
      const b = doc.bindings[k];
      return b && b.kind === 'temporary' && b.save;
    }),
  });
}

/**
 * Stable serialisation of everything a dry run sends (no key values: only refs), for
 * debouncing. Name, priority, latency and description are part of it (run names and
 * the preemption warning depend on them) but are not `specChanged`.
 */
export function dryRunKey(doc: LaunchDocument, panel?: EvaluatorPanel | null): string {
  return stableStringify({
    spec: specKey(doc, panel),
    name: doc.name.trim(),
    priority: doc.priority,
    latency: doc.latencySensitive,
    description: doc.description.trim(),
  });
}

/**
 * Did the §8.1 document change? Name, priority, latency and description are
 * request fields, not the document: those edits skip the sweeps/evaluator panel
 * updates (`specChanged: false`) but still debounce a new dry run (`dryRunKey`).
 */
export function specChanged(
  prev: LaunchDocument,
  next: LaunchDocument,
  panel?: EvaluatorPanel | null,
): boolean {
  return specKey(prev, panel) !== specKey(next, panel);
}
