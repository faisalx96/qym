/**
 * Types of the launch-form model layer (UI-agnostic, no React, no network).
 *
 * Three families:
 *  - server payloads (descriptor, slots, model options, presets, dry-run);
 *  - the LaunchDocument: everything the user edited, as plain serialisable data;
 *  - derived views (validation items, settings tree).
 * Secrets are NOT part of the document: see secrets.ts.
 */
import type { EvalPriority } from '@/api/evalCommon';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Priority = EvalPriority;

// ── Form descriptor (services/eval_schema_form.py) ───────────────────────

export type EntryKind = 'field' | 'object' | 'collection' | 'role_table';
export type EntryType = 'boolean' | 'integer' | 'number' | 'string' | 'enum' | 'object' | 'array' | 'json';

export interface Bounds {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
}

export interface RoleRow {
  key: string;
  pointer: string;
  label?: string | null;
  description?: string | null;
  required?: boolean;
  nullable?: boolean;
}

export interface DescriptorEntry {
  pointer: string;
  name: string;
  label: string;
  description?: string | null;
  path: string[];
  parent: string | null;
  params: string[];
  kind: EntryKind;
  type: EntryType;
  widget: string;
  group: string | null;
  required: boolean;
  nullable?: boolean;
  has_default: boolean;
  default: JsonValue;
  sweepable?: boolean;
  secret: boolean;
  enum: JsonValue[] | null;
  value_type?: string | null;
  bounds: Bounds;
  pattern: string | null;
  format: string | null;
  quirks?: string[];
  accepts: string[] | null;
  item_type: string | null;
  hints?: { text?: string; values?: string[]; pattern?: string } & Record<string, unknown>;
  children?: string[];
  additional_pointer?: string | null;
  key_param?: string | null;
  item_pointer?: string | null;
  required_keys?: string[];
  min_items?: number | null;
  max_items?: number | null;
  key_pattern?: string | null;
  row_param?: string | null;
  rows?: RoleRow[];
  columns?: string[];
  ref?: string | null;
  ref_collection?: string | null;
  read_only?: boolean;
  /** Client-side: the type this entry had before it became a JSON fallback (B20). */
  fallback?: string;
}

export interface DescriptorGroup {
  id: string;
  label: string;
  pointers: string[];
}

export interface FormDescriptor {
  descriptor_version?: number;
  title?: string;
  root: string[];
  fields: Record<string, DescriptorEntry>;
  groups: DescriptorGroup[];
  rules?: Array<Record<string, unknown>>;
  warnings?: Array<{ pointer?: string; message: string }>;
}

/** GET …/eval-environments/{eid}/form */
export interface FormResponse {
  environment_id: string;
  schema_id: string | null;
  schema_hash: string | null;
  descriptor: FormDescriptor;
  evaluator?: { status?: string; schema_id?: string | null; schema_hash?: string | null } | null;
}

// ── Model slots & options ────────────────────────────────────────────────

export interface ModelSlot {
  id?: string;
  slot_key: string;
  kind: 'endpoint' | 'flat';
  label: string;
  field_map: Record<string, string | null>;
  transport_fields?: Record<string, string>;
  extra_field_maps?: Array<Record<string, string | null>>;
  required?: boolean;
  status?: 'confirmed' | 'proposed' | 'stale';
}

export interface ConnectionSlotAvailability {
  available: boolean;
  reason_code?: string | null;
  reason?: string | null;
}

export interface ModelConnection {
  connection_id: string;
  name: string;
  model: string | null;
  base_url?: string | null;
  api_key_set?: boolean;
  api_key_hint?: string | null;
  is_default?: boolean;
  available: boolean;
  reason_code?: string | null;
  reason?: string | null;
  slots?: Record<string, ConnectionSlotAvailability>;
}

/** GET …/eval-environments/{eid}/model-options */
export interface ModelOptions {
  schema_id?: string | null;
  environment_id?: string;
  allow_connection_keys?: boolean;
  temporary_keys_allowed: boolean;
  temporary_keys_reason: string | null;
  connections: ModelConnection[];
}

/** Everything the form loaded for one selected environment. */
export interface EnvData {
  id: string;
  name: string;
  /** The environment's `max_priority` / `default_priority` (priority select). */
  maxPriority?: Priority;
  defaultPriority?: Priority;
  /** Who may launch latency-sensitive runs here (`manager`: project managers and admins only). */
  latencyMinRole?: 'member' | 'manager';
  /** schema_hash of the environment record (editor mode / preset publish). */
  schemaHash?: string | null;
  loading?: boolean;
  form: FormDescriptor | null;
  formError?: string;
  evaluator?: { status?: string; schema_id?: string | null; schema_hash?: string | null } | null;
  /** Confirmed slots only. */
  slots: ModelSlot[];
  needsConfirmation?: boolean;
  options: ModelOptions | null;
  optionsError?: string;
  /** Extra endpoint name → the slot the server proposed (null: this env cannot add it). */
  extra?: Record<string, ModelSlot | null>;
  /** What the service accepts beyond guide v1.3 (from its stored evaluator schema). */
  capabilities?: { datasets: boolean; task: boolean };
  /** The service's tasks as last read (`ids` only; the names live in the launch page's query). */
  taskList?: { status: 'ok' | 'unsupported' | 'error'; ids: string[] };
}

// ── Presets, best runs, clone ────────────────────────────────────────────

export interface RemapDropped {
  pointer: string;
  label?: string;
  message?: string;
  /** Older responses name the cause `reason`. */
  reason?: string;
}

export interface PresetRemap {
  from_schema_hash?: string | null;
  to_schema_hash?: string | null;
  config: LaunchConfig;
  dropped?: RemapDropped[];
  errors?: Array<RemapDropped | string>;
  summary?: string | null;
  ok?: boolean;
}

export interface PresetVersion {
  id: string;
  preset_id?: string;
  version: number;
  schema_id?: string | null;
  schema_hash?: string | null;
  schema_current?: boolean;
  config: LaunchConfig;
  notes?: string | null;
  warnings?: Array<{ rule: string; message: string }>;
  published_at?: string;
}

export interface Preset {
  id: string;
  environment_id?: string;
  name: string;
  kind: 'official' | 'saved';
  current_version_id?: string | null;
  current_version: PresetVersion | null;
}

/** GET …/presets/{id}/versions/{n}?remap=current */
export interface PresetVersionResponse {
  version: PresetVersion;
  remap?: PresetRemap;
}

/** GET …/best-runs/{run_id}/base */
export interface BestRunBaseResponse {
  run: { id: string; run_name?: string; [key: string]: unknown };
  base_source: Record<string, unknown>;
  config: LaunchConfig;
  score?: number | null;
  remap?: PresetRemap;
  warnings?: Array<{ rule?: string; message: string }>;
  prompts?: Array<{ slot_key: string; label?: string; model?: string; base_url?: string; reason?: string }>;
  versioning?: Record<string, unknown>;
  latest_versioning?: Record<string, unknown>;
  drift?: {
    status: 'same' | 'changed' | 'unknown';
    changes?: Array<{ key: string; run: unknown; latest: unknown }>;
  };
  metric?: string;
}

/** POST …/experiments/{xid}/clone */
export interface CloneResponse {
  name: string;
  description?: string;
  environment_ids: string[];
  unavailable_environment_ids?: string[];
  /** Names of the original's environments (notes about the ones that are gone). */
  environment_names?: Record<string, string>;
  base_source: Record<string, unknown>;
  cloned_base_source?: Record<string, unknown> | null;
  priority?: Priority | null;
  latency_sensitive?: boolean;
  spec: LaunchConfig;
  combo?: {
    job_id: string;
    combo_index: number;
    environment_id: string;
    schema_hash?: string;
    sweep?: unknown;
    from_snapshot?: boolean;
  } | null;
}

// ── The §8.1 config document (what the server stores/receives as `spec`) ─

export interface LaunchConfig {
  evaluator?: JsonObject;
  slot_bindings?: Record<string, JsonValue>;
  env_overrides?: JsonObject;
  links?: string[][];
  schema_hash?: string;
  base_source?: JsonObject;
}

export interface TemporaryModelSpec {
  label?: string;
  model: string;
  base_url?: string;
  api_key?: { $secret: string };
}

/** `{connection_id}` | `{temporary}` | `{inherit: true}` as stored inside a sweep. */
export type SweepModelItem =
  { connection_id: string } | { temporary: TemporaryModelSpec } | { inherit: true };

// ── The launch document ──────────────────────────────────────────────────

export type SlotBinding =
  | { kind: 'connection'; id: string }
  | {
      kind: 'temporary';
      label?: string;
      model: string;
      baseUrl?: string;
      /** Ref into the SecretStore; null when the key was not copied (clone/preset). */
      secretRef: string | null;
      /** Save the temporary model to project models on launch. */
      save: boolean;
      /** Came without a key: ask the user to enter it again. */
      needsKey: boolean;
    }
  | { kind: 'sweep'; items: SweepModelItem[] };

export type Bindings = Record<string, SlotBinding>;
export type Values = Record<string, JsonValue>;

export interface InvalidText {
  message: string;
  raw: string;
  /** The text is being edited as JSON because the widget could not show the value. */
  json?: boolean;
}

export type DatasetMode = 'project' | 'custom';
export interface DatasetChoice {
  mode: DatasetMode;
  /** Project dataset name (mode 'project'). */
  name: string;
  /** '' (latest) | 'v:<version>' | 'a:<alias>' */
  ref: string;
  /** A custom dataset string (mode 'custom'). */
  custom: string;
}

/** One dataset of the Datasets card and the references chosen on it ('' latest, `v:<version>`, `a:<alias>`). */
export interface DatasetEntry {
  name: string;
  refs: string[];
}

export type RunShape = 'combined' | 'one_each';

/**
 * What the user chose beyond one dataset (change request v1.4). The primary dataset stays
 * `LaunchDocument.dataset` (its first reference is `dataset.ref`); `extraRefs` are its further
 * references and `more` the datasets after it, so a one-dataset document is exactly what it was.
 */
export interface LaunchSelection {
  extraRefs: string[];
  more: DatasetEntry[];
  runShape: RunShape;
  /** Task id per environment id; `null` or absent = the worker's default task. */
  tasks: Record<string, string | null>;
}

export type BaseKind = 'default' | 'best_run' | 'saved' | 'scratch' | 'clone' | 'official-edit';

export interface BaseInfo {
  kind: BaseKind;
  loading: boolean;
  loaded: boolean;
  envId?: string | null;
  /** Preset version id (default/saved). */
  versionId?: string;
  version?: number;
  presetId?: string;
  presetName?: string | null;
  releaseNotes?: string;
  /** Best run. */
  runId?: string;
  runName?: string;
  metric?: string;
  score?: number | null;
  label?: string;
  pending?: boolean;
  error?: string;
  summary?: string | null;
  dropped: RemapDropped[];
  errors: string[];
  warnings: string[];
  notes: string[];
  /** Best-run model prompts: temporary models that came without a key. */
  prompts?: Array<{ slot_key: string; label?: string; model?: string; base_url?: string; reason?: string }>;
  drift?: BestRunBaseResponse['drift'];
  /** Best run: the run's agent/kb versions. */
  versioning?: Record<string, unknown>;
}

export interface Baseline {
  values: Values;
  bindings: Bindings;
  dataset: DatasetChoice | null;
  /** Further dataset references, run shape and tasks of the starting point. */
  selection?: LaunchSelection;
}

export interface MetaRow {
  id: number;
  key: string;
  raw: string;
}

/** Edits of the evaluator inputs on top of the base's `evaluator.config` (B19). */
export interface EvaluatorEdits {
  /** name -> value, or null for a base input the user cleared. */
  config: Record<string, JsonValue | null>;
  invalid: Record<string, InvalidText>;
  /** The whole run_metadata (starts as the base's keys). */
  meta: MetaRow[];
  metaTouched: boolean;
  metaSeed: string | null;
  nextMetaId: number;
  /** Keys only reachable from Raw JSON. */
  extra: { report_k?: number; dataset_version?: string };
}

export interface CloneInfo {
  /** Names of the original's environments by id. */
  envNames?: Record<string, string>;
  experimentId: string;
  jobId: string | null;
  spec: LaunchConfig;
  linkedGroups: string[][] | undefined;
  sourceName: string;
  notes: string[];
}

export interface LaunchDocument {
  environmentIds: string[];
  dataset: DatasetChoice;
  /** Further dataset references, the run shape and the task per environment. */
  selection: LaunchSelection;
  name: string;
  description: string;
  /** '' = environment default. */
  priority: Priority | '';
  /** Latency-sensitive run: starts on a quiet gateway and makes other jobs wait (guide v1.3 §2.2). */
  latencySensitive: boolean;
  base: BaseInfo;
  baseline: Baseline;
  /** Base evaluator keys besides the dataset (samples, report_k, config, …). */
  evaluatorExtra: JsonObject;
  /** env_overrides as flat `{pointer: value}` (pointers relative to env_overrides). */
  values: Values;
  invalid: Record<string, InvalidText>;
  /** collection pointer (or `<object>#extra`) -> keys added in the form. */
  addedKeys: Record<string, string[]>;
  bindings: Bindings;
  globalModel: SlotBinding | null;
  extraEndpoints: string[];
  /** Linked (zipped) sweep axes, as document pointers (`/env_overrides/…`). */
  links: string[][] | undefined;
  evaluator: EvaluatorEdits;
  clone: CloneInfo | null;
}

// ── Union of the selected environments ───────────────────────────────────

export interface UnionModel {
  fields: Record<string, DescriptorEntry>;
  /** template -> ids of the environments whose descriptor has it. */
  presence: Record<string, string[]>;
  groups: DescriptorGroup[];
  /** Ids of the environments whose form is loaded. */
  envs: string[];
}

export interface UnionSlot {
  slot_key: string;
  label: string;
  kind: 'endpoint' | 'flat';
  required: boolean;
  field_map: Record<string, string>;
  extra_field_maps: Array<Record<string, string>>;
  /** Every pointer the slot fills over all key sets. */
  pointers: string[];
  envs: string[];
  /** Added for this experiment only. */
  extra: boolean;
}

export interface FormContext {
  envs: EnvData[];
  union: UnionModel;
  slots: UnionSlot[];
  /** Project dataset names (maps a base's dataset string onto the picker). */
  datasetNames: string[];
  /** Payload of GET …/experiments/evaluator-config (null while loading). */
  evaluatorPanel: EvaluatorPanel | null;
  /** The run cap from the last dry run. */
  maxJobs: number | null;
  isManager: boolean;
  /** Names of every active environment of the project (notes about environments that are not ticked). */
  envNames?: Record<string, string>;
}

export interface EvaluatorPanel {
  descriptor: FormDescriptor;
  fields: string[];
  missing: Record<string, string[]>;
  platform_owned: { config: string[]; evaluator: string[]; body?: string[] };
  platform_owned_present?: string[];
  reserved_metadata_prefix: string;
  platform_metadata_keys?: string[];
  source?: 'static' | 'environment' | 'mixed';
  environments?: Array<{
    environment_id: string;
    name: string;
    source?: string;
    schema_hash?: string | null;
  }>;
}

// ── Launch request / dry run ─────────────────────────────────────────────

export interface LaunchSpec {
  evaluator: JsonObject;
  slot_bindings: Record<string, JsonValue>;
  env_overrides: JsonObject;
  links?: string[][];
}

export type BaseSourcePayload =
  | { kind: 'blank' }
  | { kind: 'official' | 'saved'; preset_version_id: string }
  | { kind: 'clone'; experiment_id: string; job_id?: string }
  | { kind: 'best_run'; run_id: string };

export interface LaunchRequest {
  name: string;
  description?: string;
  environment_ids: string[];
  spec: LaunchSpec;
  base_source: BaseSourcePayload;
  dry_run: boolean;
  secrets: Record<string, string>;
  save_to_project_models: string[];
  priority?: Priority;
  acknowledge_preemption?: boolean;
  /** Sent only when true. */
  latency_sensitive?: boolean;
}

export interface ServerError {
  pointer: string;
  rule?: string;
  /** e.g. `temporary_key_required`. */
  code?: string;
  message: string;
  environment_id?: string | null;
  environment_name?: string | null;
  combo_index?: number | null;
  section?: string;
  form_pointer?: string;
  field?: string | null;
  params?: Record<string, string>;
  slot_key?: string;
}

export interface DryRunAxis {
  pointers: string[];
  linked: boolean;
  length: number;
  values: JsonValue[][];
}

export interface DryRunJob {
  environment_id: string;
  environment_name?: string;
  combo_index: number;
  dataset_index?: number;
  label?: string;
  run_name?: string;
  params?: Record<string, unknown>;
  dataset?: { dataset: string; version?: string | null; alias?: string | null } | null;
  datasets?: Array<{ dataset: string; version?: string | null; alias?: string | null }> | null;
  task?: { id: string; name: string } | null;
  errors?: ServerError[];
  warnings?: Array<{ message: string; [key: string]: unknown }>;
}

export interface DryRunResponse {
  dry_run: true;
  ok: boolean;
  axes?: DryRunAxis[];
  combo_count?: number;
  job_count?: number;
  max_jobs?: number | null;
  priority?: Priority;
  preemption_warning?: string | null;
  errors: ServerError[];
  /** Launch-level warnings (never block): `vllm_ceiling_unset`, `dataset_token_not_declared`. */
  warnings?: LaunchWarning[];
  jobs?: DryRunJob[];
  /** What each environment receives (change request v1.4). */
  datasets_plan?: DatasetsPlanItem[];
}

export interface DatasetsPlanItem {
  environment_id: string;
  environment_name: string;
  mode: 'single' | 'combined' | 'fan_out';
  units: number;
  reason: null | 'service_without_datasets' | 'run_shape';
}

export interface LaunchWarning {
  code: 'vllm_ceiling_unset' | 'dataset_token_not_declared' | string;
  message: string;
  pointer?: string;
  environment_ids?: string[];
}

// ── Validation ───────────────────────────────────────────────────────────

export const WIZARD_STEPS = [
  { id: 'where', label: 'Where it runs' },
  { id: 'start', label: 'Starting point' },
  { id: 'models', label: 'Models' },
  { id: 'env', label: 'Environment configurations' },
  { id: 'eval', label: 'Evaluation configurations' },
  { id: 'review', label: 'Review and launch' },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]['id'];

export interface ValidationItem {
  /** Document pointer (`/env_overrides/…`) or a pseudo pointer (`#name`). */
  pointer: string;
  /** Human label, e.g. "Primary model › Model". */
  label: string;
  message: string;
  stepId: StepId;
  /** RHF-safe name of the field to focus (see pointers.pointerToFieldName). */
  fieldName: string;
  /** Descriptor group to open (env step), or 'unmatched'. */
  groupId?: string;
  rule?: string;
  environmentId?: string | null;
  comboIndex?: number | null;
  /** Secondary context: environment name, swept combination label. */
  where: string[];
  source: 'local' | 'server';
}
