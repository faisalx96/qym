/**
 * The real launch provider (contract: LaunchContext.tsx). It owns the document, loads the
 * environments' data through TanStack Query (shared in-flight requests), keeps the starting
 * point (base) in sync with the selection, runs the debounced dry run and the launch.
 *
 * Async flows never read React state: they use `docRef` (updated synchronously by `setDoc`) and
 * `buildCtxNow` (a FormContext built from the query cache, fetching what is missing), so a base
 * is never laid onto a half-loaded union (B19) and a stale response is dropped by generation.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  evalEnvironmentsKey,
  errorMessage,
  useEvalEnvironments,
  type EvalEnvironment,
} from '@/api/evalCommon';
import {
  cloneExperiment,
  fetchActiveEnvironments,
  fetchBestRunBase,
  fetchLaunchDatasets,
  fetchEvaluatorConfig,
  fetchPresets,
  fetchPresetVersion,
  fetchPromotePrefill,
  invalidateEnvData,
  launchKeys,
  postExperiment,
  refreshSchema,
  useEnvPresets,
  useEvaluatorConfig,
  useLaunchDatasets,
} from '@/api/launch';
import type { Preset } from '@/api/evalEnvironments';
import { ApiError } from '@/lib/http';
import { usePromiseConfirm } from '@/features/environments/usePromiseConfirm';
import { useToast } from '@/ui';
import { LaunchCtx, type BaseChoice, type LaunchContextValue, type SetDoc } from './LaunchContext';
import {
  addExtraEndpoints,
  applyBase,
  baseAvailability,
  baseLabel,
  buildContext,
  buildLaunchRequest,
  buildPresetConfig,
  contextLoading,
  createDocument,
  deriveGlobalModel,
  describeBaseChange,
  diffCount,
  droppedChangesMessage,
  emptyBaseInfo,
  evaluatorChangedCount,
  failedBase,
  layerConfigAsEdits,
  presetConfigKey,
  promoteWarningLines,
  highWarnings,
  loadedBaseFromBestRun,
  loadedBaseFromClone,
  loadedBaseFromPreset,
  mapServerErrors,
  normalizePriority,
  parseLaunchFailure,
  pendingBestRunBase,
  pickBaseEnv,
  prefillFromClone,
  pruneBindings,
  pruneOrphanValues,
  resetAll as resetAllModel,
  scratchBase,
  SecretStore,
  toggleEnvironment,
  unconfirmedEndpoints,
  type BaseEnvRecord,
  type BaseInfo,
  type BestRunBaseResponse,
  type CloneInfo,
  type EditorApi,
  type RebindItem,
  type FormContext,
  type LaunchConfig,
  type LaunchDocument,
  type LoadedBase,
  type PresetVersionResponse,
  type ServerError,
} from './model';
import { loadEnvDataNow, useEnvData } from './state/useEnvData';
import { useDryRun } from './state/useDryRun';
import { useLaunchView } from './state/useLaunchView';
import type { BaseRef, LaunchMode, SchemaStatus } from './types';
import type { RevealStep } from './wizard/steps';

export interface LaunchProviderProps {
  mode?: LaunchMode;
  slug: string;
  projectId: string;
  canManage: boolean;
  readOnly: boolean;
  /** `?env= &clone= &job= &base= &preset=` — read once on mount. */
  initialParams?: URLSearchParams;
  /** Called with the new experiment id after a successful launch (the page navigates). */
  onLaunched?: (experimentId: string) => void;
  /** `mode="editor"`: which environment's default preset is edited, and what is laid on the current version. */
  editor?: EditorSetup;
  /** Wizard: bring the step holding a field on screen (a clicked problem, an Edit link). */
  revealStep?: RevealStep;
  children: ReactNode;
}

/** The default-preset editor's entry point (`?from=vN`, `?promote=saved|run|job&id=`). */
export interface EditorSetup {
  environmentId: string;
  /** An older version of the default preset to draft from. */
  from?: number;
  promote?: { kind: 'saved' | 'run' | 'job'; id: string };
}

interface EditorLoad {
  state: 'loading' | 'ready' | 'error';
  error: string;
  canPublish: boolean;
  presetId: string | null;
  currentVersion: number | null;
  draftLabel: string | null;
  promoted: boolean;
  rebind: RebindItem[];
  warnings: string[];
  schemaHash: string | null;
  baseKey: string;
}

const EDITOR_LOADING: EditorLoad = {
  state: 'loading',
  error: '',
  canPublish: false,
  presetId: null,
  currentVersion: null,
  draftLabel: null,
  promoted: false,
  rebind: [],
  warnings: [],
  schemaHash: null,
  baseKey: '',
};
const NO_REBIND: RebindItem[] = [];

const NO_RECORDS: EvalEnvironment[] = [];
const BASE_KINDS = ['default', 'saved', 'best_run', 'scratch'] as const;

interface Selection {
  envId?: string | null;
  presetId?: string;
  runId?: string;
  metric?: string;
}

type RawBase =
  | { type: 'preset'; preset: Pick<Preset, 'id' | 'name'>; res: PresetVersionResponse }
  | { type: 'best'; res: BestRunBaseResponse }
  | { type: 'clone'; clone: CloneInfo }
  | { type: 'scratch' }
  | { type: 'pending' }
  | { type: 'failed'; error: string };

/** What identifies a starting point: re-selecting the same one is a no-op. */
function keyOf(kind: string, sel: Selection): string {
  const withEnv = kind === 'default' || kind === 'saved' || kind === 'best_run';
  return [
    kind,
    withEnv ? (sel.envId ?? '') : '',
    kind === 'saved' ? (sel.presetId ?? '') : '',
    kind === 'best_run' ? (sel.runId ?? '') : '',
  ].join('|');
}

function rawConfig(raw: RawBase): LaunchConfig | undefined {
  if (raw.type === 'preset') return raw.res.remap?.config;
  if (raw.type === 'best') return raw.res.config;
  if (raw.type === 'clone') return raw.clone.spec;
  return undefined;
}

export function LaunchProvider({
  mode = 'launch',
  slug,
  projectId,
  canManage,
  readOnly,
  initialParams,
  onLaunched,
  editor: editorSetup,
  revealStep,
  children,
}: LaunchProviderProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, dialog } = usePromiseConfirm();
  const [params] = useState(() => initialParams ?? new URLSearchParams(window.location.search));

  // ── document ────────────────────────────────────────────────────────────
  const [doc, setDocState] = useState<LaunchDocument>(() => createDocument());
  const docRef = useRef(doc);
  const setDoc = useCallback<SetDoc>((updater) => {
    const next = updater(docRef.current);
    if (next === docRef.current) return;
    docRef.current = next;
    setDocState(next);
  }, []);
  const [secrets] = useState(() => new SecretStore());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      secrets.clear(); // keys never outlive the page
    };
  }, [secrets]);
  const [initState, setInitState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [schemaEpoch, setSchemaEpoch] = useState(0);
  const [baseNote, setBaseNote] = useState('');
  const [editorLoad, setEditorLoad] = useState<EditorLoad>(EDITOR_LOADING);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const launchedRef = useRef(false);
  const touchedRef = useRef(false);
  const baseKeyRef = useRef('');
  const baseGen = useRef(0);
  const syncGen = useRef(0);

  // ── environments, datasets, evaluator panel ─────────────────────────────
  const envQuery = useEvalEnvironments(projectId, { active: true });
  const envRecords = envQuery.data ?? NO_RECORDS;
  const envRecordsRef = useRef(envRecords);
  useEffect(() => {
    envRecordsRef.current = envRecords;
  });
  const selectedEnvs = useMemo(
    () =>
      doc.environmentIds
        .map((id) => envRecords.find((e) => e.id === id))
        .filter((e): e is EvalEnvironment => Boolean(e)),
    [doc.environmentIds, envRecords],
  );
  // Every dataset of the project, restricted and private ones included (owner decision D3: any
  // member may launch on any dataset; the experiment's own token does the reading).
  const datasetsQuery = useLaunchDatasets(projectId);
  const datasets = datasetsQuery.data ?? null;
  const datasetNames = useMemo(
    () => (datasets ? datasets.map((d) => d.name) : null),
    [datasets],
  );
  const envs = useEnvData(projectId, selectedEnvs, doc.extraEndpoints);
  const targets = useMemo(
    () =>
      selectedEnvs.map((e) => ({
        id: e.id,
        schemaHash: e.schema_hash,
        evaluatorSchemaHash: e.evaluator_schema_hash,
      })),
    [selectedEnvs],
  );
  const panelQuery = useEvaluatorConfig(projectId, targets);
  const panel = panelQuery.data ?? null;
  const ctxBase = useMemo(
    () =>
      buildContext({
        envs,
        extraEndpoints: doc.extraEndpoints,
        datasetNames: datasetNames ?? [],
        evaluatorPanel: panel,
        maxJobs: null,
        isManager: canManage,
      }),
    [envs, doc.extraEndpoints, datasetNames, panel, canManage],
  );
  const envsLoading = selectedEnvs.length > 0 && contextLoading(ctxBase);
  const baseLoading = doc.base.loading;

  // ── dry run ─────────────────────────────────────────────────────────────
  const { preview, key: dryKey } = useDryRun({
    projectId,
    doc,
    panel,
    secrets,
    enabled: mode === 'launch' && initState === 'ready' && envs.length > 0 && !envsLoading && !baseLoading,
  });
  const maxJobs = preview.data?.max_jobs ?? null;
  const ctx = useMemo<FormContext>(
    () => (maxJobs == null ? ctxBase : { ...ctxBase, maxJobs }),
    [ctxBase, maxJobs],
  );
  const ctxRef = useRef(ctx);
  const [launchFailure, setLaunchFailure] = useState<{ key: string; errors: ServerError[] } | null>(null);
  const launchErrors = useMemo(
    () => (launchFailure && launchFailure.key === dryKey ? launchFailure.errors : []),
    [launchFailure, dryKey],
  );
  const editorView = useMemo(
    () => (mode === 'editor' ? { rebind: editorLoad.rebind } : null),
    [mode, editorLoad.rebind],
  );
  const view = useLaunchView({
    doc,
    setDoc,
    ctx,
    secrets,
    preview,
    launchErrors: launchErrors.length ? launchErrors : null,
    launching,
    editor: editorView,
    revealStep,
  });
  const latest = useRef({ view, preview, dryKey });
  useEffect(() => {
    ctxRef.current = ctx;
    latest.current = { view, preview, dryKey };
  });

  // ── imperative context (fresh data, no render needed) ───────────────────
  const buildCtxNow = useCallback(
    async (ids: string[], extras: string[]): Promise<FormContext> => {
      const records = await qc.ensureQueryData({
        queryKey: evalEnvironmentsKey(projectId, true),
        queryFn: () => fetchActiveEnvironments(projectId),
      });
      const selected = ids
        .map((id) => records.find((r) => r.id === id))
        .filter((r): r is EvalEnvironment => Boolean(r));
      const evalTargets = selected.map((e) => ({
        id: e.id,
        schemaHash: e.schema_hash,
        evaluatorSchemaHash: e.evaluator_schema_hash,
      }));
      const [loaded, datasets, evaluatorPanel] = await Promise.all([
        loadEnvDataNow(qc, projectId, selected, extras),
        qc
          .ensureQueryData({
            queryKey: launchKeys.datasets(projectId),
            queryFn: () => fetchLaunchDatasets(projectId),
          })
          .catch(() => []),
        evalTargets.length
          ? qc
              .ensureQueryData({
                queryKey: launchKeys.evaluatorConfig(
                  projectId,
                  evalTargets
                    .map((t) => `${t.id}:${t.schemaHash ?? ''}:${t.evaluatorSchemaHash ?? ''}`)
                    .join('|'),
                ),
                queryFn: () => fetchEvaluatorConfig(projectId, evalTargets),
              })
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      return buildContext({
        envs: loaded,
        extraEndpoints: extras,
        datasetNames: datasets.map((d) => d.name),
        evaluatorPanel,
        maxJobs: ctxRef.current.maxJobs,
        isManager: canManage,
      });
    },
    [qc, projectId, canManage],
  );

  // ── starting point ──────────────────────────────────────────────────────
  const fetchRaw = useCallback(
    async (kind: BaseChoice, sel: Selection, d: LaunchDocument): Promise<RawBase> => {
      if (kind === 'scratch') return { type: 'scratch' };
      if (kind === 'clone')
        return d.clone
          ? { type: 'clone', clone: d.clone }
          : { type: 'failed', error: 'There is no experiment to copy.' };
      if (!sel.envId) return { type: 'failed', error: 'Pick an environment first.' };
      if (kind === 'best_run') {
        if (!sel.runId) return { type: 'pending' };
        try {
          return { type: 'best', res: await fetchBestRunBase(projectId, sel.envId, sel.runId, sel.metric) };
        } catch (error) {
          return { type: 'failed', error: errorMessage(error) || 'Failed to load that run' };
        }
      }
      let list: Preset[];
      try {
        const presets = await qc.ensureQueryData({
          queryKey: launchKeys.presets(projectId, sel.envId),
          queryFn: () => fetchPresets(projectId, sel.envId as string),
        });
        list = presets.presets;
      } catch (error) {
        return { type: 'failed', error: errorMessage(error) || 'Failed to load the presets' };
      }
      const name = envRecordsRef.current.find((e) => e.id === sel.envId)?.name ?? 'this environment';
      const preset =
        kind === 'default'
          ? list.find((p) => p.kind === 'official')
          : (list.find((p) => p.kind === 'saved' && p.id === sel.presetId && p.current_version) ??
            list.find((p) => p.kind === 'saved' && p.current_version));
      if (!preset || !preset.current_version) {
        return {
          type: 'failed',
          error:
            kind === 'default'
              ? `No default preset is published for ${name}.`
              : 'There is no saved preset to start from.',
        };
      }
      try {
        const res = await fetchPresetVersion(projectId, sel.envId, preset.id, preset.current_version.version);
        if (!res.remap) return { type: 'failed', error: 'Failed to load the preset' };
        return { type: 'preset', preset, res };
      } catch (error) {
        return { type: 'failed', error: errorMessage(error) || 'Failed to load the preset' };
      }
    },
    [qc, projectId],
  );

  const toLoaded = (raw: RawBase, kind: BaseChoice, sel: Selection, c: FormContext): LoadedBase => {
    switch (raw.type) {
      case 'preset':
        return loadedBaseFromPreset(kind as 'default' | 'saved', sel.envId as string, raw.preset, raw.res, c);
      case 'best':
        return loadedBaseFromBestRun(sel.envId as string, raw.res, c);
      case 'clone':
        return loadedBaseFromClone(raw.clone, c);
      case 'scratch':
        return scratchBase(c);
      case 'pending':
        return pendingBestRunBase(sel.envId as string, c);
      default:
        return failedBase(kind, sel.envId ?? null, raw.error, c);
    }
  };

  /** Loads a starting point and lays it under the document (edits that still fit are replayed). */
  const applyBaseKind = useCallback(
    async (kind: BaseChoice, sel: Selection, announce: boolean) => {
      const gen = ++baseGen.current;
      baseKeyRef.current = keyOf(kind, sel);
      const start = docRef.current;
      const pendingInfo: BaseInfo = {
        ...emptyBaseInfo(kind),
        loaded: false,
        loading: true,
        envId: sel.envId ?? null,
        presetId: sel.presetId,
        runId: sel.runId,
        metric: sel.metric,
      };
      setDoc((d) => ({ ...d, base: pendingInfo }));
      try {
        let ctxNow = await buildCtxNow(start.environmentIds, start.extraEndpoints);
        const raw = await fetchRaw(kind, sel, docRef.current);
        if (gen !== baseGen.current || !alive.current) return;
        const config = rawConfig(raw);
        const extras = config ? unconfirmedEndpoints(config, ctxNow) : [];
        if (extras.length) {
          ctxNow = await buildCtxNow(start.environmentIds, [...start.extraEndpoints, ...extras]);
          if (gen !== baseGen.current || !alive.current) return;
        }
        const addable = extras.filter((n) => ctxNow.slots.some((s) => s.slot_key === 'endpoint:' + n));
        const loaded = toLoaded(raw, kind, sel, ctxNow);
        baseKeyRef.current = keyOf(kind, {
          envId: loaded.info.envId ?? sel.envId,
          presetId: loaded.info.presetId ?? sel.presetId,
          runId: loaded.info.runId ?? sel.runId,
        });
        const withExtras = addExtraEndpoints(docRef.current, ctxNow, addable);
        const result = applyBase(withExtras, ctxNow, loaded, secrets);
        setDoc(() => result.doc);
        if (announce && result.dropped > 0)
          toast.show(droppedChangesMessage(result.dropped), { tone: 'info' });
      } catch (error) {
        if (gen !== baseGen.current || !alive.current) return;
        setDoc((d) => ({
          ...d,
          base: {
            ...emptyBaseInfo(kind),
            loaded: false,
            envId: sel.envId ?? null,
            error: errorMessage(error) || 'Failed to load the starting point',
          },
        }));
      }
    },
    [buildCtxNow, fetchRaw, secrets, setDoc, toast],
  );

  /** After the selection / schema changed: default to the default preset, else scratch (§9.2). */
  const syncBase = useCallback(
    async (gen: number) => {
      const d = docRef.current;
      const selected = d.environmentIds
        .map((id) => envRecordsRef.current.find((e) => e.id === id))
        .filter((e): e is EvalEnvironment => Boolean(e));
      if (!selected.length) return;
      const envId =
        d.base.envId && selected.some((e) => e.id === d.base.envId) ? d.base.envId : pickBaseEnv(selected);
      if (!envId) return;
      let savedCount: number | null = null;
      try {
        const presets = await qc.ensureQueryData({
          queryKey: launchKeys.presets(projectId, envId),
          queryFn: () => fetchPresets(projectId, envId),
        });
        savedCount = presets.presets.filter((p) => p.kind === 'saved' && p.current_version).length;
      } catch {
        savedCount = null;
      }
      if (gen !== syncGen.current || !alive.current) return;
      const fresh = docRef.current;
      let kind = fresh.base.kind as BaseChoice;
      if ((kind as string) === 'official-edit') kind = 'scratch';
      if (kind !== 'clone') {
        if (!touchedRef.current) kind = 'default';
        const availability = baseAvailability(
          kind,
          selected.find((e) => e.id === envId),
          { savedPresets: savedCount, hasClone: Boolean(fresh.clone) },
        );
        if (!availability.ok && kind !== 'best_run' && kind !== 'scratch') {
          setBaseNote(
            `${availability.reason ?? 'That starting point is not available'}${touchedRef.current ? '' : ' yet'}, so the form starts from scratch.`,
          );
          kind = 'scratch';
        } else if (kind !== 'scratch') {
          setBaseNote('');
        }
      }
      const sel: Selection = {
        envId,
        presetId: kind === 'saved' ? fresh.base.presetId : undefined,
        runId: kind === 'best_run' ? fresh.base.runId : undefined,
        metric: kind === 'best_run' ? fresh.base.metric : undefined,
      };
      if (keyOf(kind, sel) !== baseKeyRef.current) await applyBaseKind(kind, sel, touchedRef.current);
    },
    [qc, projectId, applyBaseKind],
  );

  const syncEnvironments = useCallback(async () => {
    const gen = ++syncGen.current;
    const d = docRef.current;
    if (!d.environmentIds.length) return;
    try {
      const ctxNow = await buildCtxNow(d.environmentIds, d.extraEndpoints);
      if (gen !== syncGen.current || !alive.current) return;
      setDoc((x) =>
        normalizePriority(
          deriveGlobalModel(pruneBindings(pruneOrphanValues(x, ctxNow), ctxNow, secrets), ctxNow),
          ctxNow,
        ),
      );
      await syncBase(gen);
    } catch (error) {
      if (alive.current)
        toast.show(errorMessage(error) || 'Could not load the environments', { tone: 'error' });
    }
  }, [buildCtxNow, setDoc, secrets, syncBase, toast]);

  // ── default-preset editor: the current version is the base, drafts are edits ──
  const loadEditorBase = useCallback(
    async (setup: EditorSetup, records: EvalEnvironment[]) => {
      const envId = setup.environmentId;
      const fail = (error: string) => {
        if (alive.current) setEditorLoad({ ...EDITOR_LOADING, state: 'error', error });
      };
      try {
        const list = await fetchPresets(projectId, envId);
        qc.setQueryData(launchKeys.presets(projectId, envId), list);
        const official = list.presets.find((p) => p.kind === 'official') ?? null;
        const current = official?.current_version ?? null;
        const canPublish = list.can_publish_official && official?.can_publish !== false;
        if (!canPublish) {
          if (alive.current) setEditorLoad({ ...EDITOR_LOADING, state: 'ready', canPublish: false });
          return;
        }
        let ctxNow = await buildCtxNow([envId], []);
        const [curRes, fromRes, promoted] = await Promise.all([
          official && current ? fetchPresetVersion(projectId, envId, official.id, current.version) : null,
          official && setup.from && setup.from !== current?.version
            ? fetchPresetVersion(projectId, envId, official.id, setup.from)
            : null,
          setup.promote ? fetchPromotePrefill(projectId, envId, setup.promote.kind, setup.promote.id) : null,
        ]);
        if (!alive.current) return;
        if (curRes && !curRes.remap) throw new Error('Failed to load the current version');
        if (fromRes && !fromRes.remap) throw new Error(`Failed to load v${setup.from}`);
        const draft = promoted?.config ?? fromRes?.remap?.config ?? null;
        const extras = Array.from(
          new Set([
            ...unconfirmedEndpoints(curRes?.remap?.config ?? {}, ctxNow),
            ...(draft ? unconfirmedEndpoints(draft, ctxNow) : []),
          ]),
        );
        if (extras.length) ctxNow = await buildCtxNow([envId], extras);
        if (!alive.current) return;
        const addable = extras.filter((n) => ctxNow.slots.some((s) => s.slot_key === 'endpoint:' + n));
        const label = current ? `Default preset v${current.version}` : 'Blank (no default preset yet)';
        const loaded =
          official && current && curRes
            ? loadedBaseFromPreset('default', envId, official, curRes, ctxNow)
            : scratchBase(ctxNow);
        loaded.info = { ...loaded.info, kind: 'official-edit', label };
        const withExtras = addExtraEndpoints({ ...docRef.current, environmentIds: [envId] }, ctxNow, addable);
        let next = applyBase(withExtras, ctxNow, loaded, secrets).doc;
        const schemaHash = records.find((e) => e.id === envId)?.schema_hash ?? null;
        const baseKey = presetConfigKey(next, schemaHash, ctxNow.evaluatorPanel);
        const warnings = [...loaded.info.warnings];
        let draftLabel: string | null = null;
        if (draft) {
          next = layerConfigAsEdits(next, ctxNow, draft);
          if (promoted) {
            draftLabel = promoted.source?.label || 'a configuration';
            warnings.push(...promoteWarningLines(promoted));
            if (promoted.remap?.summary) warnings.push(promoted.remap.summary);
          } else {
            draftLabel = `v${setup.from}`;
            if (fromRes?.remap?.summary) warnings.push(`v${setup.from}: ${fromRes.remap.summary}`);
          }
        }
        docRef.current = next;
        setDocState(next);
        setEditorLoad({
          state: 'ready',
          error: '',
          canPublish: true,
          presetId: official?.id ?? null,
          currentVersion: current?.version ?? null,
          draftLabel,
          promoted: Boolean(promoted),
          rebind: promoted?.unbound ?? NO_REBIND,
          warnings,
          schemaHash,
          baseKey,
        });
      } catch (error) {
        fail(errorMessage(error) || 'Failed to load the default preset');
      }
    },
    [qc, projectId, buildCtxNow, secrets],
  );

  // ── mount: URL params ───────────────────────────────────────────────────
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const records = await qc.ensureQueryData({
          queryKey: evalEnvironmentsKey(projectId, true),
          queryFn: () => fetchActiveEnvironments(projectId),
        });
        if (mode === 'editor' && editorSetup) {
          if (!records.some((r) => r.id === editorSetup.environmentId)) {
            setEditorLoad({ ...EDITOR_LOADING, state: 'error', error: 'This environment is not available.' });
          } else {
            setDoc((d) => ({ ...d, environmentIds: [editorSetup.environmentId] }));
            await loadEditorBase(editorSetup, records);
          }
          if (alive.current) setInitState('ready');
          return;
        }
        let patch: Partial<LaunchDocument> = {};
        const cloneId = params.get('clone');
        if (cloneId && mode === 'launch') {
          const jobId = params.get('job');
          try {
            const res = await cloneExperiment(projectId, cloneId, jobId);
            const prefill = prefillFromClone(res, { experimentId: cloneId, jobId });
            patch = {
              ...prefill.patch,
              environmentIds: prefill.patch.environmentIds.filter((id) => records.some((r) => r.id === id)),
            };
            touchedRef.current = true;
          } catch (error) {
            toast.show(errorMessage(error) || 'Could not load the experiment to clone', { tone: 'error' });
          }
        }
        if (!patch.environmentIds) {
          const wanted = params
            .getAll('env')
            .flatMap((v) => v.split(','))
            .filter((id) => records.some((r) => r.id === id));
          const only = records.length === 1 ? [records[0]!.id] : [];
          patch.environmentIds = wanted.length ? Array.from(new Set(wanted)) : only;
          const baseParam = params.get('base');
          const kind = BASE_KINDS.find((k) => k === baseParam);
          if (kind) {
            touchedRef.current = true;
            patch.base = {
              ...emptyBaseInfo(kind),
              loaded: kind === 'scratch',
              presetId: kind === 'saved' ? (params.get('preset') ?? undefined) : undefined,
            };
          }
        }
        if (!alive.current) return;
        setDoc((d) => ({ ...d, ...patch }));
        setInitState('ready');
      } catch {
        if (alive.current) setInitState('error');
      }
    })();
  }, [qc, projectId, params, mode, editorSetup, loadEditorBase, toast, setDoc]);

  // ── react to the selection ──────────────────────────────────────────────
  const envSig = doc.environmentIds.join(',');
  useEffect(() => {
    if (initState !== 'ready' || !envSig || mode !== 'launch') return;
    void syncEnvironments();
  }, [envSig, schemaEpoch, initState, mode, syncEnvironments]);

  // ── schema auto-refresh: once per visit and environment (B18) ───────────
  const [visit] = useState(() => Math.random().toString(36).slice(2));
  const refreshes = useQueries({
    queries: selectedEnvs.map((e) => ({
      queryKey: ['schema-refresh', projectId, e.id, visit],
      queryFn: () => refreshSchema(projectId, e.id),
      enabled: mode === 'launch' && initState === 'ready',
      staleTime: Infinity,
      gcTime: 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  const refreshSig = refreshes.map((r) => `${r.status}:${r.fetchStatus}`).join('|');
  const schemaStatus = useMemo<Record<string, SchemaStatus>>(() => {
    const out: Record<string, SchemaStatus> = {};
    selectedEnvs.forEach((e, i) => {
      const r = refreshes[i];
      const failure = r?.error;
      const silent = failure instanceof ApiError && (failure.status === 401 || failure.status === 403);
      out[e.id] = {
        checking: Boolean(r?.isFetching),
        error: failure && !silent ? errorMessage(failure) || 'Schema refresh failed' : '',
      };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refreshes` is a new array each render; refreshSig keys it
  }, [selectedEnvs, refreshSig]);
  const handled = useRef(new Set<string>());
  const changedSig = refreshes.map((r, i) => (r.data?.changed ? selectedEnvs[i]?.id : '')).join(',');
  useEffect(() => {
    refreshes.forEach((r, i) => {
      const env = selectedEnvs[i];
      if (!env || !r.data?.changed || handled.current.has(env.id)) return;
      handled.current.add(env.id);
      const evaluator = r.data.evaluator ?? {};
      const added = (r.data.added ?? []).length + (evaluator.added ?? []).length;
      const removed = (r.data.removed ?? []).length + (evaluator.removed ?? []).length;
      toast.show(`Schema updated for ${env.name} (${added} added, ${removed} removed)`, { tone: 'info' });
      void invalidateEnvData(qc, projectId, env.id).then(() => {
        if (!alive.current) return;
        baseKeyRef.current = ''; // the starting point was re-mapped onto the old schema: load it again
        setSchemaEpoch((n) => n + 1);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by changedSig
  }, [changedSig]);

  // ── actions ─────────────────────────────────────────────────────────────
  const toggleEnv = useCallback(
    (id: string, on: boolean) => setDoc((d) => toggleEnvironment(d, id, on)),
    [setDoc],
  );

  const reloadSlots = useCallback(
    async (envId?: string) => {
      const ids = envId ? [envId] : docRef.current.environmentIds;
      await Promise.all(ids.map((id) => invalidateEnvData(qc, projectId, id)));
      if (alive.current) setSchemaEpoch((n) => n + 1);
    },
    [qc, projectId],
  );

  const loadProposal = useCallback(
    async (names: string | string[]) => {
      const d = docRef.current;
      const fresh = Array.from(new Set(Array.isArray(names) ? names : [names])).filter(
        (n) => n && !d.extraEndpoints.includes(n),
      );
      if (!fresh.length) return [];
      const ctxNow = await buildCtxNow(d.environmentIds, [...d.extraEndpoints, ...fresh]);
      if (!alive.current) return [];
      const added = fresh.filter((n) => ctxNow.slots.some((s) => s.slot_key === 'endpoint:' + n));
      setDoc((x) => addExtraEndpoints(x, ctxNow, added));
      return added;
    },
    [buildCtxNow, setDoc],
  );

  const envNameOf = useCallback(
    (id: string) => envRecordsRef.current.find((e) => e.id === id)?.name ?? id,
    [],
  );

  const chooseBase = useCallback(
    async (kind: BaseChoice, ref: BaseRef = {}): Promise<boolean> => {
      const d = docRef.current;
      const selected = d.environmentIds
        .map((id) => envRecordsRef.current.find((e) => e.id === id))
        .filter((e): e is EvalEnvironment => Boolean(e));
      if (!selected.length && kind !== 'scratch' && kind !== 'clone') return false;
      const envId =
        ref.envId ??
        (d.base.envId && selected.some((e) => e.id === d.base.envId) ? d.base.envId : pickBaseEnv(selected));
      const sel: Selection = { envId, presetId: ref.presetId, runId: ref.runId, metric: ref.metric };
      if (keyOf(kind, sel) === baseKeyRef.current && !ref.force) return true;
      const change = describeBaseChange(d, baseLabel(d, envNameOf));
      if (change.needed) {
        const ok = await ask({
          title: change.title,
          description: change.description,
          confirmLabel: change.confirmLabel,
          cancelLabel: change.cancelLabel,
        });
        if (!ok || !alive.current) return false;
      }
      touchedRef.current = true;
      setBaseNote('');
      await applyBaseKind(kind, sel, true);
      return true;
    },
    [ask, applyBaseKind, envNameOf],
  );

  const resetAll = useCallback(
    () => setDoc((d) => resetAllModel(d, ctxRef.current, secrets)),
    [setDoc, secrets],
  );

  const launch = useCallback(async () => {
    if (launchingRef.current || readOnly) return;
    const { view: v, preview: pv, dryKey: key } = latest.current;
    if (v.review.items.length || !v.review.canLaunch) {
      const first = v.review.items[0];
      if (first) v.focusIssue(first);
      return;
    }
    const d = docRef.current;
    const c = ctxRef.current;
    const high =
      d.priority === 'HIGH' || (d.priority === '' && c.envs.some((e) => e.defaultPriority === 'HIGH'));
    let acknowledge = false;
    if (high) {
      const ok = await ask({
        title: 'Launch at HIGH priority?',
        description: highWarnings(c, pv.data),
        confirmLabel: 'Launch at HIGH',
        cancelLabel: 'Do not launch',
        tone: 'danger',
      });
      if (!ok) return;
      acknowledge = true;
    }
    launchingRef.current = true;
    setLaunching(true);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const body = buildLaunchRequest(
            docRef.current,
            secrets,
            { dryRun: false, acknowledgePreemption: acknowledge },
            c.evaluatorPanel,
          );
          const res = await postExperiment<{ id: string }>(projectId, body);
          secrets.clear();
          launchedRef.current = true;
          void qc.invalidateQueries({ queryKey: ['experiments', projectId] });
          void qc.invalidateQueries({ queryKey: ['eval-queue', projectId] });
          toast.show(`Launched “${body.name}”`, { tone: 'success' });
          onLaunched?.(res.id);
          return;
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          const failure = parseLaunchFailure(error.status, error.body);
          if (failure.kind === 'preemption' && !acknowledge) {
            const ok = await ask({
              title: 'Launch at HIGH priority?',
              description: [failure.message],
              confirmLabel: 'Launch at HIGH',
              cancelLabel: 'Do not launch',
              tone: 'danger',
            });
            if (!ok) return;
            acknowledge = true;
            continue;
          }
          if (failure.kind === 'validation') {
            setLaunchFailure({ key, errors: failure.errors });
            const items = mapServerErrors(failure.errors, docRef.current, c, pv.data);
            toast.show(`${items.length} problem${items.length === 1 ? '' : 's'} to fix before launching`, {
              tone: 'error',
            });
            if (items[0]) latest.current.view.focusIssue(items[0]);
            return;
          }
          toast.show(failure.message, { tone: 'error' });
          return;
        }
      }
    } catch (error) {
      toast.show(errorMessage(error) || 'Failed to launch the experiment', { tone: 'error' });
    } finally {
      launchingRef.current = false;
      if (alive.current) setLaunching(false);
    }
  }, [readOnly, ask, secrets, projectId, qc, toast, onLaunched]);

  // ── derived ─────────────────────────────────────────────────────────────
  const baseEnvId =
    doc.base.envId && doc.environmentIds.includes(doc.base.envId)
      ? doc.base.envId
      : pickBaseEnv(selectedEnvs as BaseEnvRecord[]);
  const presetsQuery = useEnvPresets(projectId, baseEnvId ?? undefined);
  const presets = presetsQuery.data?.presets;
  const savedPresets = useMemo(
    () => (presets ?? []).filter((p) => p.kind === 'saved' && p.current_version),
    [presets],
  );
  const baseRecord = selectedEnvs.find((e) => e.id === baseEnvId);
  const available = useCallback(
    (kind: BaseChoice) =>
      baseAvailability(kind, baseRecord, {
        savedPresets: presetsQuery.isSuccess ? savedPresets.length : presetsQuery.isError ? 0 : null,
        hasClone: Boolean(doc.clone),
      }),
    [baseRecord, presetsQuery.isSuccess, presetsQuery.isError, savedPresets.length, doc.clone],
  );
  const changeCount = diffCount(doc).total + evaluatorChangedCount(doc, ctx.evaluatorPanel);
  const hasChanges =
    changeCount > 0 ||
    Boolean(
      doc.name.trim() ||
        doc.description.trim() ||
        doc.versioningText.trim() ||
        doc.priority ||
        doc.latencySensitive,
    );
  const hasChangesRef = useRef(hasChanges);
  useEffect(() => {
    hasChangesRef.current = hasChanges;
  });
  const canLaunchAsIs =
    (doc.base.kind === 'default' || doc.base.kind === 'saved') &&
    doc.base.loaded &&
    view.review.items.length === 0 &&
    view.review.canLaunch &&
    !preview.loading &&
    !preview.error &&
    preview.data != null &&
    preview.data.ok !== false;

  const editorApi = useMemo<EditorApi | null>(() => {
    if (mode !== 'editor' || !editorSetup) return null;
    const { baseKey, schemaHash } = editorLoad;
    return {
      environmentId: editorSetup.environmentId,
      state: editorLoad.state,
      error: editorLoad.error,
      canPublish: editorLoad.canPublish,
      presetId: editorLoad.presetId,
      currentVersion: editorLoad.currentVersion,
      nextVersion: (editorLoad.currentVersion ?? 0) + 1,
      draftLabel: editorLoad.draftLabel,
      promoted: editorLoad.promoted,
      unchanged:
        editorLoad.state === 'ready' &&
        baseKey !== '' &&
        presetConfigKey(doc, schemaHash, ctx.evaluatorPanel) === baseKey,
      rebind: editorLoad.rebind,
      warnings: editorLoad.warnings,
      schemaHash,
      buildConfig: () => buildPresetConfig(docRef.current, schemaHash, ctxRef.current.evaluatorPanel),
    };
  }, [mode, editorSetup, editorLoad, doc, ctx.evaluatorPanel]);

  const value: LaunchContextValue = {
    mode,
    editor: editorApi,
    slug,
    projectId,
    readOnly,
    canManage,
    doc,
    setDoc,
    ctx,
    secrets,
    envRecords,
    selectedEnvs,
    schemaStatus,
    toggleEnv,
    reloadSlots,
    loadProposal,
    datasetNames,
    datasets,
    review: view.review,
    preview,
    launchErrors,
    raw: view.raw,
    sectionState: view.sectionState,
    openSection: view.openSection,
    sectionSummary: view.sectionSummary,
    settingsUi: view.settingsUi,
    setSettingsUi: view.setSettingsUi,
    registerField: view.registerField,
    focusField: view.focusField,
    focusIssue: view.focusIssue,
    revealStep: view.revealStep,
    baseState: {
      envId: baseEnvId,
      presets: presets ?? [],
      savedPresets,
      loading: doc.base.loading || presetsQuery.isPending,
      note: baseNote,
      label: baseLabel(doc, envNameOf),
      available,
    },
    chooseBase,
    resetAll,
    confirm: ask,
    isLaunching: launching,
    launch,
    flags: {
      initState,
      envsLoading,
      baseLoading,
      hasChanges,
      canLaunchAsIs,
      multiEnv: doc.environmentIds.length > 1,
      isClone: Boolean(doc.clone),
      unsavedGuard: () => !launchedRef.current && hasChangesRef.current,
    },
  };
  return (
    <LaunchCtx.Provider value={value}>
      {children}
      {dialog}
    </LaunchCtx.Provider>
  );
}
