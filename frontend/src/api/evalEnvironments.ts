/**
 * Eval environments API (brief 06 §4): CRUD, test, schema refresh, the generated form
 * descriptor, LLM model slots, model options and the presets of one environment. The list
 * query and the `EvalEnvironment` record live in `evalCommon.ts`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import type { EvalEnvironment, EvalPriority } from './evalCommon';

const base = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/eval-environments`;
const envBase = (projectId: string, envId: string) => `${base(projectId)}/${encodeURIComponent(envId)}`;

export const envKey = (projectId: string, envId: string) => ['eval-environment', projectId, envId] as const;

// ---------------------------------------------------------------- environment CRUD

export interface EnvironmentUpdate {
  name?: string;
  base_url?: string;
  api_key?: string;
  ranking_metric?: string | null;
  ranking_k?: number | null;
  max_priority?: EvalPriority;
  default_priority?: EvalPriority;
  allow_connection_keys?: boolean;
  is_active?: boolean;
}

export interface EnvironmentCreate {
  name: string;
  base_url: string;
  api_key: string;
}

export function useEvalEnvironment(projectId: string | undefined, envId: string | undefined) {
  return useQuery({
    queryKey: envKey(projectId ?? '', envId ?? ''),
    enabled: Boolean(projectId && envId),
    queryFn: () => api.get<EvalEnvironment>(envBase(projectId!, envId!)),
  });
}

function useInvalidateEnvironments(projectId: string) {
  const qc = useQueryClient();
  return (envId?: string) => {
    void qc.invalidateQueries({ queryKey: ['eval-environments', projectId] });
    if (envId) void qc.invalidateQueries({ queryKey: ['eval-environment', projectId, envId] });
  };
}

export function useCreateEnvironment(projectId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  return useMutation({
    mutationFn: (body: EnvironmentCreate) =>
      api.post<{ environment: EvalEnvironment; slots: EvalSlot[] }>(base(projectId), body),
    onSuccess: (r) => invalidate(r.environment.id),
  });
}

export function useUpdateEnvironment(projectId: string, envId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EnvironmentUpdate) => api.put<EvalEnvironment>(envBase(projectId, envId), body),
    onSuccess: (env) => {
      qc.setQueryData(envKey(projectId, envId), env);
      invalidate();
    },
  });
}

export function useDeleteEnvironment(projectId: string, envId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  return useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(envBase(projectId, envId)),
    onSuccess: () => invalidate(envId),
  });
}

export interface TestResult {
  ok: boolean;
  error?: string | null;
  schema_changed?: boolean;
}

/** Test a connection. Takes the environment id at call time (the list tests many rows). */
export function useTestEnvironment(projectId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  return useMutation({
    mutationFn: (envId: string) => api.post<TestResult>(`${envBase(projectId, envId)}/test`),
    onSettled: (_r, _e, envId) => invalidate(envId),
  });
}

export interface SchemaDiff {
  changed: boolean;
  env_overrides_changed?: boolean;
  added: string[];
  removed: string[];
  changed_types: { pointer: string; from: string; to: string }[];
  schema_id: string;
  schema_hash: string;
  previous_schema_id: string | null;
  slots: EvalSlot[];
  needs_confirmation: boolean;
}

export function useRefreshSchema(projectId: string, envId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SchemaDiff>(`${envBase(projectId, envId)}/schema/refresh`),
    onSettled: () => {
      invalidate(envId);
      void qc.invalidateQueries({ queryKey: ['eval-environment-form', projectId, envId] });
      void qc.invalidateQueries({ queryKey: ['eval-model-slots', projectId, envId] });
      void qc.invalidateQueries({ queryKey: ['eval-presets', projectId, envId] });
    },
  });
}

// ---------------------------------------------------------------- generated form descriptor

/** One entry of the schema-generated form (`services/eval_schema_form.py`). Loosely typed on purpose. */
export interface DescriptorEntry {
  pointer: string;
  name: string;
  label?: string;
  description?: string | null;
  kind: 'field' | 'object' | 'collection' | 'role_table' | string;
  type?: string;
  widget?: string;
  group?: string;
  required?: boolean;
  has_default?: boolean;
  default?: unknown;
  sweepable?: boolean;
  secret?: boolean;
  enum?: unknown[] | null;
  bounds?: Record<string, unknown>;
  children?: string[];
  key_param?: string;
  item_pointer?: string;
  params?: string[];
  required_keys?: string[];
  row_param?: string;
  rows?: { key: string; pointer: string; label?: string }[];
  hints?: { text?: string } | null;
}

export interface FormDescriptor {
  root: string[];
  fields: Record<string, DescriptorEntry>;
  groups: { id: string; label: string; pointers: string[] }[];
  warnings: { pointer?: string; message: string }[];
}

export interface EnvironmentForm {
  environment_id: string;
  schema_id: string;
  schema_hash: string;
  descriptor: FormDescriptor;
}

export function useEnvironmentForm(projectId: string | undefined, envId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['eval-environment-form', projectId ?? '', envId ?? ''],
    enabled: Boolean(projectId && envId && enabled),
    queryFn: () => api.get<EnvironmentForm>(`${envBase(projectId!, envId!)}/form`),
  });
}

// ---------------------------------------------------------------- model slots

export type SlotStatus = 'confirmed' | 'proposed' | 'stale' | 'new';
export type SlotRole = 'model' | 'base_url' | 'api_key';
export type KeySet = Record<SlotRole, string | null>;

export interface EvalSlot {
  id?: string;
  slot_key: string;
  kind: 'endpoint' | 'flat';
  label: string;
  field_map: Partial<KeySet>;
  transport_fields: Record<string, string>;
  extra_field_maps: Partial<KeySet>[];
  required: boolean;
  status: SlotStatus;
}

export interface ModelSlotsResponse {
  environment_id: string;
  schema_id: string;
  slots: EvalSlot[];
  needs_confirmation: boolean;
  proposal?: EvalSlot | null;
}

export interface SlotPayload {
  slot_key: string;
  kind: 'endpoint' | 'flat';
  label: string;
  field_map: Partial<KeySet>;
  transport_fields: Record<string, string>;
  extra_field_maps: Partial<KeySet>[];
}

export function useModelSlots(projectId: string | undefined, envId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['eval-model-slots', projectId ?? '', envId ?? ''],
    enabled: Boolean(projectId && envId && enabled),
    queryFn: () => api.get<ModelSlotsResponse>(`${envBase(projectId!, envId!)}/model-slots`),
  });
}

export function fetchEndpointProposal(projectId: string, envId: string, endpoint: string) {
  return api.get<ModelSlotsResponse>(
    `${envBase(projectId, envId)}/model-slots?propose_endpoint=${encodeURIComponent(endpoint)}`,
  );
}

export function useSaveModelSlots(projectId: string, envId: string) {
  const invalidate = useInvalidateEnvironments(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { slots: SlotPayload[]; schema_id: string }) =>
      api.put<ModelSlotsResponse>(`${envBase(projectId, envId)}/model-slots`, body),
    onSuccess: (r) => {
      qc.setQueryData(['eval-model-slots', projectId, envId], r);
      invalidate(envId);
    },
  });
}

export interface ModelOption {
  connection_id: string;
  name: string;
  model: string;
  base_url: string;
  api_key_set: boolean;
  api_key_hint: string | null;
  is_default: boolean;
  available: boolean;
  reason_code: string | null;
  reason: string | null;
  slots: Record<string, { available: boolean; reason_code: string | null; reason: string | null }>;
}

export interface ModelOptions {
  schema_id: string;
  environment_id: string;
  allow_connection_keys: boolean;
  temporary_keys_allowed: boolean;
  temporary_keys_reason: string | null;
  connections: ModelOption[];
}

export function useModelOptions(projectId: string | undefined, envId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['eval-model-options', projectId ?? '', envId ?? ''],
    enabled: Boolean(projectId && envId && enabled),
    queryFn: () => api.get<ModelOptions>(`${envBase(projectId!, envId!)}/model-options`),
  });
}

export interface VersioningDetails {
  environment_id: string;
  status: 'ok' | 'unsupported' | 'error';
  versioning_details: Record<string, unknown>;
  error: string | null;
  fetched_at: string | null;
}

export function useVersioningDetails(projectId: string | undefined, envId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['eval-versioning-details', projectId ?? '', envId ?? ''],
    enabled: Boolean(projectId && envId && enabled),
    queryFn: () => api.get<VersioningDetails>(`${envBase(projectId!, envId!)}/versioning-details`),
  });
}

// ---------------------------------------------------------------- presets

export interface PresetWarning {
  rule: string;
  message: string;
}

export interface PresetConfig {
  evaluator?: { dataset?: string; dataset_version?: string; config?: Record<string, unknown> };
  slot_bindings?: Record<string, unknown>;
  env_overrides?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PresetVersion {
  id: string;
  preset_id: string;
  version: number;
  schema_id: string;
  schema_hash: string;
  schema_current: boolean;
  config: PresetConfig;
  notes: string | null;
  warnings: PresetWarning[];
  published_by?: { id?: string; name?: string } | null;
  published_at: string;
}

export interface Preset {
  id: string;
  environment_id: string;
  name: string;
  kind: 'official' | 'saved';
  current_version_id: string | null;
  current_version: PresetVersion | null;
  can_publish: boolean;
  created_by?: { id?: string; name?: string } | null;
  created_at: string;
  updated_at: string;
}

export interface PresetList {
  environment_id: string;
  can_publish_official: boolean;
  presets: Preset[];
}

export const presetsKey = (projectId: string, envId: string) => ['eval-presets', projectId, envId] as const;

export function usePresets(projectId: string | undefined, envId: string | undefined) {
  return useQuery({
    queryKey: presetsKey(projectId ?? '', envId ?? ''),
    enabled: Boolean(projectId && envId),
    queryFn: () => api.get<PresetList>(`${envBase(projectId!, envId!)}/presets`),
  });
}

export function usePresetVersions(projectId: string | undefined, envId: string | undefined, presetId: string | null | undefined) {
  return useQuery({
    queryKey: ['eval-preset-versions', projectId ?? '', envId ?? '', presetId ?? ''],
    enabled: Boolean(projectId && envId && presetId),
    queryFn: () =>
      api.get<{ preset_id: string; current_version_id: string; versions: PresetVersion[] }>(
        `${envBase(projectId!, envId!)}/presets/${encodeURIComponent(presetId!)}/versions`,
      ),
  });
}

export interface RemapResult {
  from_schema_hash?: string;
  to_schema_hash?: string;
  config: PresetConfig;
  dropped: { pointer: string; label?: string; message: string }[];
  errors: { pointer?: string; message: string }[];
  summary?: string;
  ok: boolean;
}

export interface PresetVersionView {
  version: PresetVersion;
  remap?: RemapResult | null;
}

export function fetchPresetVersionView(
  projectId: string,
  envId: string,
  presetId: string,
  version: number,
  remapCurrent = false,
) {
  const qs = remapCurrent ? '?remap=current' : '';
  return api.get<PresetVersionView>(
    `${envBase(projectId, envId)}/presets/${encodeURIComponent(presetId)}/versions/${version}${qs}`,
  );
}

export function usePresetVersionView(
  projectId: string | undefined,
  envId: string | undefined,
  presetId: string | null | undefined,
  version: number | null | undefined,
  remapCurrent = false,
) {
  return useQuery({
    queryKey: ['eval-preset-version', projectId ?? '', envId ?? '', presetId ?? '', version ?? 0, remapCurrent],
    enabled: Boolean(projectId && envId && presetId && version),
    queryFn: () => fetchPresetVersionView(projectId!, envId!, presetId!, version!, remapCurrent),
  });
}

/** Create a preset (`official` publishes v1; `saved` stores a named starting point). */
export function useCreatePreset(projectId: string, envId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: 'official' | 'saved'; name?: string; config: PresetConfig; notes?: string }) =>
      api.post<{ preset: Preset; warnings: PresetWarning[] }>(`${envBase(projectId, envId)}/presets`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: presetsKey(projectId, envId) });
      void qc.invalidateQueries({ queryKey: ['eval-environments', projectId] });
      void qc.invalidateQueries({ queryKey: envKey(projectId, envId) });
    },
  });
}

/** Publish a new version of a preset. */
export function usePublishPresetVersion(projectId: string, envId: string, presetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { config: PresetConfig; notes?: string }) =>
      api.post<{ preset: Preset; version: PresetVersion; warnings: PresetWarning[] }>(
        `${envBase(projectId, envId)}/presets/${encodeURIComponent(presetId)}/versions`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: presetsKey(projectId, envId) });
      void qc.invalidateQueries({ queryKey: ['eval-preset-versions', projectId, envId, presetId] });
      void qc.invalidateQueries({ queryKey: ['eval-environments', projectId] });
      void qc.invalidateQueries({ queryKey: envKey(projectId, envId) });
    },
  });
}
