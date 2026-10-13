/**
 * The Analyze-run view model: configuration, targets, prompt preview, Test and
 * the background job in one place so any layout can render it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  usePromptPreview,
  useTestItems,
  type AnalysisConfig,
  type AnalysisResultPayload,
  type PlaygroundConfigPayload,
} from '@/api/analysis';
import { ApiError } from '@/lib/http';
import { useDebounced } from '../useDebounced';
import type { RunnerState } from '../useAnalysisRunner';
import {
  STD_VARIABLES,
  pathsToTree,
  scanFieldPaths,
  scanMetadataGroups,
  type PathNode,
  type StdVariable,
} from '../model/mapping';
import {
  analyzeRequest,
  buildConfigPayload,
  customVarsOf,
  defaultSettings,
  fieldsSent,
  previewRequest,
  testRequest,
  type AnalyzerSettings,
  type FieldTrees,
  type RunGuard,
} from '../model/settings';
import {
  analyzedKeysOf,
  touchesTargetFilter,
  effectiveCount,
  humanOverwriteTargets,
  matchTargets,
  type AnalyzerRow,
  type MatchedTarget,
} from '../model/targets';
import type { RunData } from './useRunData';

export interface TargetKey {
  itemId: string;
  metric: string;
}
export const targetKeyOf = (itemId: string, metric: string) => `${itemId}\u0000${metric}`;

export interface TestOutcome {
  results: AnalysisResultPayload[];
  fields: string[];
  at: number;
}

export interface WorkspaceInit {
  runId: string;
  data: RunData;
  config: AnalysisConfig;
  preselectMetric: string | null;
}

export function useRunWorkspace(
  { runId, data, config, preselectMetric }: WorkspaceInit,
  runner: RunnerState,
) {
  const [settings, setSettings] = useState<AnalyzerSettings>(() =>
    defaultSettings({
      metrics: data.metricNames,
      preselect: preselectMetric,
      maxIssues: config.max_root_cause_categories || 3,
      timeoutSeconds: config.analysis_defaults.request_timeout_seconds || 120,
    }),
  );
  const [connectionId, setConnectionId] = useState<string | null>(config.default_connection_id);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [testKeys, setTestKeys] = useState<string[]>([]);
  const [testState, setTestState] = useState<{ outcome: TestOutcome | null; error: string | null }>({
    outcome: null,
    error: null,
  });
  const [testing, setTesting] = useState(false);
  const testAbort = useRef<AbortController | null>(null);
  const testMutation = useTestItems(runId);
  const [humanConfirm, setHumanConfirm] = useState<{ count: number; metrics: string[] } | null>(null);

  /* Target list freeze: rows as they were when a job started, so finishing it does not collapse the list. */
  const [frozen, setFrozen] = useState<AnalyzerRow[] | null>(null);
  const busyRef = useRef(false);
  const rowsRef = useRef(data.rows);
  useEffect(() => {
    rowsRef.current = data.rows;
  }, [data.rows]);

  const update = useCallback((patch: Partial<AnalyzerSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    // A deliberate filter change re-filters against the live data (never while a job runs).
    if (touchesTargetFilter(patch) && !busyRef.current) setFrozen(null);
  }, []);
  const refreshTargets = useCallback(() => {
    if (!busyRef.current) setFrozen(null);
  }, []);

  /* configuration -> payload */
  const customVars = useMemo(() => customVarsOf(settings), [settings]);
  const trees: FieldTrees = useMemo(() => {
    const treeFor = (field: string): PathNode[] =>
      field === 'input' || field === 'expected' || field === 'output' || field === 'error'
        ? pathsToTree(scanFieldPaths(data.rows, field))
        : [];
    const std = Object.fromEntries(
      STD_VARIABLES.map((v) => [v.key, treeFor(settings.std[v.key].field)]),
    ) as Record<StdVariable, PathNode[]>;
    const custom = Object.fromEntries(
      customVars.map((name) => [name, treeFor(settings.custom[name]?.field ?? '')]),
    );
    return { std, custom, metadata: scanMetadataGroups(data.rows, settings.selectedMetrics[0]) };
  }, [data.rows, settings.std, settings.custom, settings.selectedMetrics, customVars]);
  const cfg: PlaygroundConfigPayload = useMemo(() => buildConfigPayload(settings, trees), [settings, trees]);

  /* targets */
  const matchOptions = {
    selectedMetrics: settings.selectedMetrics,
    maxScore: settings.maxScorePct / 100,
    skipAnalyzed: settings.skipAnalyzed,
    allowHumanOverwrite: settings.allowHuman,
  };
  /** Live matches: what "Analyze N" would send if started now. */
  const liveMatched: MatchedTarget[] = useMemo(
    () => matchTargets(data.rows, matchOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.rows, settings.selectedMetrics, settings.maxScorePct, settings.skipAnalyzed, settings.allowHuman],
  );
  /** What the list shows: the frozen snapshot while a job ran, otherwise the live matches. */
  const matched: MatchedTarget[] = useMemo(
    () => (frozen ? matchTargets(frozen, matchOptions) : liveMatched),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      frozen,
      liveMatched,
      settings.selectedMetrics,
      settings.maxScorePct,
      settings.skipAnalyzed,
      settings.allowHuman,
    ],
  );
  const targetCount = effectiveCount(liveMatched, settings.limit);
  const rowById = useMemo(
    () => new Map<string, AnalyzerRow>(data.rows.map((r) => [r.item_id, r])),
    [data.rows],
  );

  const allKeys = useMemo(
    () => matched.flatMap((m) => m.metrics.map((metric) => targetKeyOf(m.row.item_id, metric))),
    [matched],
  );
  const effectiveFocus = focusKey && allKeys.includes(focusKey) ? focusKey : (allKeys[0] ?? null);
  const focus: TargetKey | null = effectiveFocus
    ? { itemId: effectiveFocus.split('\u0000')[0] ?? '', metric: effectiveFocus.split('\u0000')[1] ?? '' }
    : null;
  const liveTestKeys = testKeys.filter((k) => allKeys.includes(k));

  const guard: RunGuard = {
    connectionId,
    ...(data.pass != null ? { pass_number: data.pass } : {}),
    ...(data.passRevision != null && data.pass != null ? { expected_pass_version: data.passRevision } : {}),
  };

  /* preview (no LLM call) */
  const previewBody =
    focus && connectionId !== undefined ? previewRequest(cfg, focus.itemId, focus.metric, guard) : null;
  const previewKey = previewBody ? JSON.stringify(previewBody) : null;
  const debouncedKey = useDebounced(previewKey, 500);
  const debouncedBody = useMemo(() => (debouncedKey ? JSON.parse(debouncedKey) : null), [debouncedKey]);
  const preview = usePromptPreview(runId, debouncedBody);
  const previewPending = previewKey !== debouncedKey || preview.isFetching;

  /* job */
  const busy = runner.busy || testing;
  useEffect(() => {
    busyRef.current = runner.busy;
  }, [runner.busy]);
  // Freeze the list as soon as a job is running (also a job resumed after a reload).
  useEffect(() => {
    if (runner.busy) setFrozen((cur) => cur ?? rowsRef.current);
  }, [runner.busy]);
  const sessionAnalyzed = useMemo(
    () =>
      runner.job?.status === 'completed' || runner.job?.status === 'cancelled'
        ? analyzedKeysOf(runner.job.result?.results)
        : new Set<string>(),
    [runner.job],
  );
  const connection = config.llm_connections.find((c) => c.id === connectionId);
  const llmReady =
    config.llm_configured &&
    Boolean(connectionId) &&
    connection?.llm_api_key_set !== false &&
    config.can_operate_analyzer;

  const doAnalyze = useCallback(async () => {
    setHumanConfirm(null);
    await runner.start(analyzeRequest(cfg, settings, guard));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, cfg, settings, connectionId, data.pass, data.passRevision]);

  const analyze = useCallback(async () => {
    if (settings.allowHuman) {
      const humans = humanOverwriteTargets(matched);
      if (humans.length) {
        setHumanConfirm({ count: humans.length, metrics: [...new Set(humans.map((h) => h.metric_name))] });
        return;
      }
    }
    await doAnalyze();
  }, [settings.allowHuman, matched, doAnalyze]);

  /* test (synchronous LLM call, nothing saved) */
  const runTest = useCallback(async () => {
    const keys = liveTestKeys.length ? liveTestKeys : effectiveFocus ? [effectiveFocus] : [];
    if (!keys.length) return;
    const byMetric = new Map<string, string[]>();
    for (const k of keys.slice(0, 3)) {
      const [itemId = '', metric = ''] = k.split('\u0000');
      byMetric.set(metric, [...(byMetric.get(metric) ?? []), itemId]);
    }
    const controller = new AbortController();
    testAbort.current = controller;
    setTesting(true);
    setTestState({ outcome: null, error: null });
    try {
      const results: AnalysisResultPayload[] = [];
      for (const [metric, itemIds] of byMetric) {
        const res = await testMutation.mutateAsync({
          body: testRequest(cfg, itemIds, metric, settings, guard),
          signal: controller.signal,
        });
        results.push(...res.results.map((r) => ({ ...r, metric_name: r.metric_name ?? metric })));
      }
      setTestState({ outcome: { results, fields: fieldsSent(cfg), at: Date.now() }, error: null });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError')
        setTestState({ outcome: null, error: 'Test cancelled.' });
      else
        setTestState({
          outcome: null,
          error: e instanceof ApiError ? e.detail || e.message : 'The test could not be run.',
        });
    } finally {
      setTesting(false);
      testAbort.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTestKeys, effectiveFocus, cfg, settings, connectionId, data.pass, data.passRevision, testMutation]);

  const cancelTest = useCallback(() => testAbort.current?.abort(), []);

  const toggleTest = useCallback((key: string) => {
    setTestKeys((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 3 ? cur : [...cur, key],
    );
  }, []);

  return {
    settings,
    update,
    setSettings,
    cfg,
    trees,
    customVars,
    matched,
    targetCount,
    /** The list is a snapshot from when the last job started (analysed targets stay visible). */
    frozen: frozen !== null,
    sessionAnalyzed,
    refreshTargets,
    rowById,
    allKeys,
    focus,
    focusKey: effectiveFocus,
    setFocusKey,
    testKeys: liveTestKeys,
    toggleTest,
    connectionId,
    setConnectionId,
    preview: {
      messages: preview.data?.messages ?? [],
      characters: preview.data?.prompt_characters ?? null,
      pending: previewPending,
      error: preview.isError ? preview.error : null,
      retry: () => void preview.refetch(),
      hasTarget: focus != null,
    },
    test: { ...testState, testing, run: runTest, cancel: cancelTest },
    runner,
    busy,
    llmReady,
    analyze,
    humanConfirm,
    confirmHuman: doAnalyze,
    cancelHumanConfirm: () => setHumanConfirm(null),
    guard,
  };
}

export type RunWorkspace = ReturnType<typeof useRunWorkspace>;
