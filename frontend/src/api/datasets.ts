/**
 * Datasets API (brief 07 §4). Every call carries `project_slug`; refs are id,
 * slug or name. Session cookie auth (UI); no bearer tokens, no read tokens.
 */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, apiFetch } from '@/lib/http';

export interface DsUser {
  id: string;
  email: string;
  display_name: string;
}

export interface DatasetPermissions {
  can_manage: boolean;
  is_creator: boolean;
  can_rename_slug: boolean;
  can_move_production: boolean;
  can_delete: boolean;
  can_restore: boolean;
  can_set_production: boolean;
}

export type VersionStatus = 'draft' | 'published';

export interface VersionSchema {
  input_cols?: string[];
  expected_cols?: string[];
  id_col?: string | null;
  metadata_cols?: string[];
  label_cols?: string[];
  encoding?: string;
}

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version: string;
  name: string;
  description: string | null;
  status: VersionStatus;
  source_type: string;
  source_uri: string | null;
  parent_version_id: string | null;
  base_version_id: string | null;
  schema: VersionSchema;
  labels: string[];
  item_count: number;
  run_count: number;
  content_hash: string | null;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  created_by: DsUser | null;
  published_by: DsUser | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  is_default: boolean;
  aliases: string[];
  change_counts?: { added: number; deleted: number; modified: number };
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  private_test_set: boolean;
  items_visible: boolean;
  can_set_private_test_set: boolean;
  created_by_user_id: string | null;
  created_by: DsUser | null;
  created_at: string;
  updated_at: string;
  production_version: DatasetVersion | null;
  latest_version: DatasetVersion | null;
  run_count: number;
  permissions: DatasetPermissions;
  deleted_at?: string | null;
  deleted_by?: DsUser | null;
  original_slug?: string;
}

export interface ItemResultSummary {
  run_count: number;
  avg_latency_ms: number | null;
  metrics: Record<string, { avg: number | null; count?: number }>;
}

export interface DatasetItem {
  id: number;
  item_id: string;
  index: number;
  input: unknown;
  expected_output: unknown;
  metadata: Record<string, unknown>;
  labels: string[];
  fingerprint?: string;
  created_at: string;
  updated_at: string;
  run_count?: number;
  result_summary?: ItemResultSummary | null;
  edit_count?: number;
}

export type MetricDirectionMap = Record<string, string | null | undefined>;

export interface CatalogResponse {
  project: { id: string; slug: string; name: string };
  datasets: Dataset[];
  total: number;
  permissions: { can_manage: boolean };
}

export interface ItemsResponse {
  items: DatasetItem[];
  metric_names: string[];
  metric_directions: MetricDirectionMap;
  total: number;
  next_offset: number | null;
}

export interface DatasetRunRow {
  id: string;
  run_name: string;
  external_run_id: string | null;
  status: string;
  task: string;
  model: string | null;
  started_at: string | null;
  completed_at: string | null;
  avg_latency_ms: number | null;
  eval_score: number | null;
  metric_averages: Record<string, number | null>;
  metric_directions: MetricDirectionMap;
  version_label: string | null;
  items_count: number;
}

export interface DatasetRunsResponse {
  runs: DatasetRunRow[];
  total: number;
  metric_names: string[];
}

export interface LineageChange {
  id: string;
  dataset_version_id: string;
  parent_version_id: string | null;
  change_summary: {
    type: 'created' | 'published' | 'uploaded' | 'alias_set' | string;
    item_count?: number;
    source_type?: string;
    alias?: string;
    from_version_id?: string;
    actor_user_id?: string;
  };
  actor: DsUser | null;
  created_at: string;
}

export interface LineageResponse {
  dataset: Dataset;
  versions: DatasetVersion[];
  changes: LineageChange[];
}

export interface ItemScore {
  metric_name: string;
  score_numeric: number | null;
  score_raw: unknown;
  label: string | null;
  explanation: string | null;
}

export interface ItemRunRow {
  run_id: string;
  run_name: string;
  external_run_id: string | null;
  task: string;
  dataset: string;
  model: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  owner: DsUser | null;
  item_id: string;
  output: unknown;
  trace_id: string | null;
  trace_url: string | null;
  error: string | null;
  latency_ms: number | null;
  retry_count: number;
  metric_directions: MetricDirectionMap;
  scores: ItemScore[];
}

export interface ItemRunsResponse {
  item: DatasetItem;
  aggregates: {
    run_count: number;
    success_count: number;
    error_count: number;
    avg_latency_ms: number | null;
    avg_score: number | null;
    metrics: Record<string, { count: number; avg: number | null; min: number | null; max: number | null }>;
    metric_directions: MetricDirectionMap;
  };
  runs: ItemRunRow[];
}

export interface ItemNeighbors {
  item_id: string;
  index: number;
  total: number;
  previous: DatasetItem | null;
  next: DatasetItem | null;
}

export interface ItemRevision {
  id: string;
  revision_number: number;
  change_type: 'created' | 'updated' | 'deleted';
  before: Partial<DatasetItem> | null;
  after: Partial<DatasetItem> | null;
  actor_user_id: string | null;
  actor: DsUser | null;
  actor_email?: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface ItemLineageResponse {
  item_id: string;
  lineage: { version: DatasetVersion; item: DatasetItem | null; revisions: ItemRevision[] }[];
}

export type CompareKind = 'changed' | 'added' | 'removed' | 'unchanged';

export interface CompareFieldSnapshot {
  input: unknown;
  expected_output: unknown;
  metadata: unknown;
  labels: string[];
}

export interface CompareChangedEntry {
  item_id: string;
  base_index: number | null;
  target_index: number | null;
  edited_by: DsUser | null;
  changed_at: string | null;
  changed_at_source: 'revision' | 'version';
  fields?: string[];
  before?: CompareFieldSnapshot;
  after?: CompareFieldSnapshot;
}

export interface CompareItemEntry extends DatasetItem {
  changed_at?: string | null;
  changed_at_source?: 'revision' | 'version';
  edited_by?: DsUser | null;
}

export interface CompareResponse {
  base: DatasetVersion;
  target: DatasetVersion;
  summary: { added: number; removed: number; changed: number; unchanged: number };
  added?: string[];
  removed?: string[];
  unchanged?: string[];
  changed?: CompareChangedEntry[];
  added_items?: CompareItemEntry[];
  removed_items?: CompareItemEntry[];
  unchanged_items?: CompareItemEntry[];
  field_diffs?: CompareChangedEntry[];
  diffs_truncated?: boolean;
  page?: { kind: CompareKind; offset: number; limit: number; total: number; next_offset: number | null };
}

// ---------------------------------------------------------------- helpers

const enc = encodeURIComponent;

function withSlug(
  path: string,
  slug: string,
  extra: Record<string, string | number | undefined | null> = {},
) {
  const q = new URLSearchParams({ project_slug: slug });
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return `${path}?${q.toString()}`;
}

export const dsKeys = {
  catalog: (slug: string, deleted: boolean) => ['datasets', slug, { deleted }] as const,
  dataset: (slug: string, ref: string) => ['dataset', slug, ref] as const,
  versions: (slug: string, ref: string) => ['dataset-versions', slug, ref] as const,
  items: (slug: string, ref: string, version: string, params: ItemsParams) =>
    ['dataset-items', slug, ref, version, params] as const,
  item: (slug: string, ref: string, version: string, itemId: string) =>
    ['dataset-item', slug, ref, version, itemId] as const,
  itemRuns: (slug: string, ref: string, version: string, itemId: string) =>
    ['dataset-item-runs', slug, ref, version, itemId] as const,
  itemLineage: (slug: string, ref: string, version: string, itemId: string) =>
    ['dataset-item-lineage', slug, ref, version, itemId] as const,
  neighbors: (slug: string, ref: string, version: string, itemId: string, params: NeighborParams) =>
    ['dataset-item-neighbors', slug, ref, version, itemId, params] as const,
  runs: (slug: string, ref: string, version: string | null, offset: number) =>
    ['dataset-runs', slug, ref, { version, offset }] as const,
  lineage: (slug: string, ref: string) => ['dataset-lineage', slug, ref] as const,
  compare: (slug: string, ref: string, head: string, base: string, kind: CompareKind) =>
    ['dataset-compare', slug, ref, head, base, kind] as const,
};

export interface ItemsParams {
  limit: number;
  offset: number;
  search?: string;
  sort?: string;
  label?: string;
}

export interface NeighborParams {
  search?: string;
  sort?: string;
  label?: string;
}

// ---------------------------------------------------------------- queries

export function useDatasetCatalog(slug: string, deleted = false) {
  return useQuery({
    queryKey: dsKeys.catalog(slug, deleted),
    queryFn: () =>
      api.get<CatalogResponse>(
        withSlug('/v1/datasets', slug, { deleted: deleted ? 'true' : undefined, limit: 1000 }),
      ),
    staleTime: 10_000,
  });
}

export function useDataset(slug: string, ref: string) {
  return useQuery({
    queryKey: dsKeys.dataset(slug, ref),
    queryFn: () => api.get<{ dataset: Dataset }>(withSlug(`/v1/datasets/${enc(ref)}`, slug)),
    select: (r) => r.dataset,
    enabled: Boolean(ref),
    retry: false,
  });
}

export function useDatasetVersions(slug: string, ref: string, enabled = true) {
  return useQuery({
    queryKey: dsKeys.versions(slug, ref),
    queryFn: () =>
      api.get<{ dataset: Dataset; versions: DatasetVersion[] }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions`, slug),
      ),
    select: (r) => r.versions,
    enabled: enabled && Boolean(ref),
    retry: false,
  });
}

export function useDatasetItems(
  slug: string,
  ref: string,
  version: string,
  params: ItemsParams,
  enabled = true,
) {
  return useQuery({
    queryKey: dsKeys.items(slug, ref, version, params),
    queryFn: () =>
      api.get<ItemsResponse>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items`, slug, {
          limit: params.limit,
          offset: params.offset,
          search: params.search,
          sort: params.sort,
          label: params.label,
          include_context: 'false',
        }),
      ),
    enabled: enabled && Boolean(ref && version),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useDatasetItem(slug: string, ref: string, version: string, itemId: string, enabled = true) {
  return useQuery({
    queryKey: dsKeys.item(slug, ref, version, itemId),
    queryFn: () =>
      api.get<{ item: DatasetItem }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}`, slug),
      ),
    select: (r) => r.item,
    enabled: enabled && Boolean(ref && version && itemId),
    retry: false,
  });
}

export function useItemNeighbors(
  slug: string,
  ref: string,
  version: string,
  itemId: string,
  params: NeighborParams,
  enabled = true,
) {
  return useQuery({
    queryKey: dsKeys.neighbors(slug, ref, version, itemId, params),
    queryFn: () =>
      api.get<ItemNeighbors>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}/neighbors`, slug, {
          search: params.search,
          sort: params.sort,
          label: params.label,
        }),
      ),
    enabled: enabled && Boolean(ref && version && itemId),
    retry: false,
  });
}

export function useItemRuns(slug: string, ref: string, version: string, itemId: string, enabled = true) {
  return useQuery({
    queryKey: dsKeys.itemRuns(slug, ref, version, itemId),
    queryFn: () =>
      api.get<ItemRunsResponse>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}/runs`, slug),
      ),
    enabled: enabled && Boolean(ref && version && itemId),
    retry: false,
  });
}

export function useItemLineage(slug: string, ref: string, version: string, itemId: string, enabled = true) {
  return useQuery({
    queryKey: dsKeys.itemLineage(slug, ref, version, itemId),
    queryFn: () =>
      api.get<ItemLineageResponse>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}/lineage`, slug),
      ),
    enabled: enabled && Boolean(ref && version && itemId),
    retry: false,
  });
}

export const DATASET_RUNS_PAGE = 100;

export function useDatasetRuns(slug: string, ref: string, version: string | null, offset = 0) {
  return useQuery({
    queryKey: dsKeys.runs(slug, ref, version, offset),
    queryFn: () =>
      api.get<DatasetRunsResponse>(
        withSlug(`/v1/datasets/${enc(ref)}/runs`, slug, {
          version: version ?? undefined,
          limit: DATASET_RUNS_PAGE,
          offset,
        }),
      ),
    enabled: Boolean(ref),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useDatasetLineage(slug: string, ref: string) {
  return useQuery({
    queryKey: dsKeys.lineage(slug, ref),
    queryFn: () => api.get<LineageResponse>(withSlug(`/v1/datasets/${enc(ref)}/lineage`, slug)),
    enabled: Boolean(ref),
    retry: false,
  });
}

export const COMPARE_PAGE = 50;

export function useCompare(
  slug: string,
  ref: string,
  head: string,
  base: string,
  kind: CompareKind,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: dsKeys.compare(slug, ref, head, base, kind),
    queryFn: ({ pageParam }) =>
      api.get<CompareResponse>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(head)}:compare`, slug, {
          base,
          include_diffs: 1,
          kind,
          limit: COMPARE_PAGE,
          offset: pageParam,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.page?.next_offset ?? null,
    enabled: enabled && Boolean(ref && head && base),
    retry: false,
  });
}

export function fetchFullCompare(slug: string, ref: string, head: string, base: string) {
  return api.get<CompareResponse>(
    withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(head)}:compare`, slug, { base, include_diffs: 1 }),
  );
}

export function downloadUrl(slug: string, ref: string, version: string) {
  return withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}:download`, slug);
}

// ---------------------------------------------------------------- mutations

export function invalidateDataset(qc: QueryClient, slug: string, ref: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['dataset', slug, ref] }),
    qc.invalidateQueries({ queryKey: ['dataset-versions', slug, ref] }),
    qc.invalidateQueries({ queryKey: ['dataset-lineage', slug, ref] }),
    qc.invalidateQueries({ queryKey: ['datasets', slug] }),
  ]);
}

export function invalidateItems(qc: QueryClient, slug: string, ref: string) {
  void qc.invalidateQueries({ queryKey: ['dataset-items', slug, ref] });
  void qc.invalidateQueries({ queryKey: ['dataset-item', slug, ref] });
  void qc.invalidateQueries({ queryKey: ['dataset-item-neighbors', slug, ref] });
  void qc.invalidateQueries({ queryKey: ['dataset-item-lineage', slug, ref] });
  invalidateDataset(qc, slug, ref);
}

export interface CreateDatasetBody {
  name: string;
  slug?: string;
  description?: string;
  tags?: string[];
  private_test_set?: boolean;
}

export function useCreateDataset(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDatasetBody) =>
      api.post<{ dataset: Dataset }>('/v1/datasets', { ...body, project_slug: slug }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['datasets', slug] }),
  });
}

export function usePatchDataset(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateDatasetBody>) =>
      api.patch<{ dataset: Dataset }>(withSlug(`/v1/datasets/${enc(ref)}`, slug), body),
    onSuccess: (r) => {
      qc.setQueryData(dsKeys.dataset(slug, ref), r);
      if (r.dataset.slug !== ref) qc.setQueryData(dsKeys.dataset(slug, r.dataset.slug), r);
      void qc.invalidateQueries({ queryKey: ['datasets', slug] });
    },
  });
}

export function useDeleteDataset(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete<{ ok: boolean; restorable: boolean }>(withSlug(`/v1/datasets/${enc(ref)}`, slug)),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['dataset', slug, ref] });
      void qc.invalidateQueries({ queryKey: ['datasets', slug] });
    },
  });
}

export function useRestoreDataset(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ dataset: Dataset }>(withSlug(`/v1/datasets/${enc(id)}:restore`, slug)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['datasets', slug] }),
  });
}

export function useCreateVersion(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; from_version?: string; from_alias?: string }) =>
      api.post<{ version: DatasetVersion }>(withSlug(`/v1/datasets/${enc(ref)}/versions`, slug), body),
    onSuccess: async () => {
      await invalidateDataset(qc, slug, ref);
    },
  });
}

export function usePatchVersion(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, ...body }: { version: string; name?: string; description?: string }) =>
      api.patch<{ version: DatasetVersion }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}`, slug),
        body,
      ),
    onSuccess: () => invalidateDataset(qc, slug, ref),
  });
}

export function usePublishVersion(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ version, setAlias }: { version: string; setAlias: boolean }) =>
      api.post<{ version: DatasetVersion }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}:publish`, slug),
        setAlias ? { set_alias: 'production' } : {},
      ),
    onSuccess: () => {
      invalidateDataset(qc, slug, ref);
      void qc.invalidateQueries({ queryKey: ['dataset-items', slug, ref] });
    },
  });
}

export function useSetProduction(slug: string, ref: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) =>
      api.post<{ alias: { dataset_id: string; alias: string; dataset_version_id: string } }>(
        withSlug(`/v1/datasets/${enc(ref)}/aliases/production`, slug),
        { version },
      ),
    onSuccess: () => invalidateDataset(qc, slug, ref),
  });
}

export interface ItemBody {
  item_id?: string;
  input?: unknown;
  expected_output?: unknown;
  metadata?: Record<string, unknown>;
  labels?: string[];
}

export function useCreateItem(slug: string, ref: string, version: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemBody) =>
      api.post<{ item: DatasetItem }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items`, slug),
        body,
      ),
    onSuccess: () => invalidateItems(qc, slug, ref),
  });
}

export function usePatchItem(slug: string, ref: string, version: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: ItemBody }) =>
      api.patch<{ item: DatasetItem }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}`, slug),
        body,
      ),
    onSuccess: (r, { itemId }) => {
      qc.setQueryData(dsKeys.item(slug, ref, version, itemId), r);
      if (r.item.item_id !== itemId) qc.setQueryData(dsKeys.item(slug, ref, version, r.item.item_id), r);
      void qc.invalidateQueries({ queryKey: ['dataset-items', slug, ref] });
      void qc.invalidateQueries({ queryKey: ['dataset-item-lineage', slug, ref] });
      void qc.invalidateQueries({ queryKey: ['dataset-item-neighbors', slug, ref] });
      void qc.invalidateQueries({ queryKey: ['dataset-versions', slug, ref] });
    },
  });
}

export function useDeleteItem(slug: string, ref: string, version: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api.delete<{ ok: boolean }>(
        withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items/${enc(itemId)}`, slug),
      ),
    onSuccess: () => invalidateItems(qc, slug, ref),
  });
}

export interface BulkItemsBody {
  upserts?: (ItemBody & { op?: 'create' })[];
  deletes?: string[];
}

export interface BulkItemsResponse {
  summary: { created: number; updated: number; deleted: number };
  created: DatasetItem[];
  updated: DatasetItem[];
  deleted: string[];
}

export const BULK_CHUNK = 1000;

export function bulkItems(slug: string, ref: string, version: string, body: BulkItemsBody) {
  return api.post<BulkItemsResponse>(
    withSlug(`/v1/datasets/${enc(ref)}/versions/${enc(version)}/items:bulk`, slug),
    body,
  );
}

export function useBulkItems(slug: string, ref: string, version: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkItemsBody) => bulkItems(slug, ref, version, body),
    onSuccess: () => invalidateItems(qc, slug, ref),
  });
}

export interface UploadFields {
  name: string;
  description?: string;
  version_name?: string;
  publish: boolean;
  set_alias: boolean;
  format: 'csv' | 'jsonl' | 'json';
  encoding?: string;
  input_cols?: string[];
  expected_cols?: string[];
  id_col?: string;
  metadata_cols?: string[];
  create_only?: boolean;
  dataset_ref?: string;
}

/** Multipart POST /v1/datasets:upload with XHR so the caller sees byte progress. */
export function uploadDataset(
  slug: string,
  file: File,
  fields: UploadFields,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ dataset: Dataset; version: DatasetVersion }> {
  const fd = new FormData();
  fd.append('project_slug', slug);
  fd.append('name', fields.name);
  if (fields.create_only) fd.append('create_only', 'true');
  if (fields.dataset_ref) fd.append('dataset_ref', fields.dataset_ref);
  if (fields.description) fd.append('description', fields.description);
  if (fields.version_name) fd.append('version_name', fields.version_name);
  if (fields.publish) fd.append('publish', 'true');
  if (fields.publish && fields.set_alias) fd.append('set_alias', 'production');
  fd.append('format', fields.format);
  if (fields.format === 'csv') {
    if (fields.encoding) fd.append('encoding', fields.encoding);
    if (fields.input_cols?.length) fd.append('input_cols', fields.input_cols.join(','));
    if (fields.expected_cols?.length) fd.append('expected_cols', fields.expected_cols.join(','));
    if (fields.id_col) fd.append('id_col', fields.id_col);
    if (fields.metadata_cols?.length) fd.append('metadata_cols', fields.metadata_cols.join(','));
  }
  fd.append('file', file);
  if (!onProgress || typeof XMLHttpRequest === 'undefined') {
    return apiFetch('/v1/datasets:upload', { method: 'POST', body: fd, signal });
  }
  return uploadWithProgress('/v1/datasets:upload', fd, onProgress, signal);
}

async function uploadWithProgress<T>(
  path: string,
  body: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const { platformUrl } = await import('@/lib/runtime');
  const { ApiError } = await import('@/lib/http');
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', platformUrl(path));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new TypeError('Network error while uploading'));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { name: 'AbortError' }));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        let detail = obj ? (obj.detail ?? obj.error ?? '') : '';
        if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
        reject(new ApiError(xhr.status, String(detail || `HTTP ${xhr.status}`), { body: data }));
      }
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}
