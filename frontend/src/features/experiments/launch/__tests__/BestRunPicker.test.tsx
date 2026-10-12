import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BestRunRow, BestRunsPayload } from '@/api/launch';
import { BestRunPicker } from '../sections/BestRunPicker';
import { createDocument, emptyBaseInfo } from '../model';
import { live, makeEnv, PRODUCTION, renderSection } from './sectionTestKit';

const scopeData = {
  total_runs: 12,
  datasets: [
    {
      id: 'd1',
      name: 'golden',
      run_count: 12,
      versions: [
        { id: 'v2', version: 'v2', run_count: 8 },
        { id: 'v1', version: 'v1', run_count: 4 },
      ],
    },
  ],
  versioning: { agent_version: [{ value: '1.4', run_count: 9 }] },
};

const row = (n: number, score: number): BestRunRow => ({
  rank: n,
  run_id: `run-${n}-abcdefgh`,
  metric: 'accuracy',
  score,
  pass_at_k_value: score - 0.05,
  item_count: 40,
  error_item_count: n === 2 ? 3 : 0,
  age_seconds: 3600 * n,
  dataset: { id: 'd1', name: 'golden' },
  dataset_version: { id: 'v2', version: 'v2' },
  remote_versioning: { agent_version: '1.4', kb_version: 'kb-7' },
  params: { sweep: { '/LLM_OVERRIDES/endpoints/primary/timeout': 25 } },
});

const listData = (over: Partial<BestRunsPayload> = {}): BestRunsPayload => ({
  environment_id: 'e1',
  dataset: { id: 'd1', name: 'golden' },
  dataset_version: null,
  scope: {
    dataset: { name: 'golden' },
    dataset_version: null,
    versioning: { agent_version: ['1.4'] },
    global: false,
  },
  metric: 'accuracy',
  k: 3,
  exclude_errored: true,
  excluded_errored_count: 2,
  metrics: [
    { name: 'accuracy', run_count: 9 },
    { name: 'f1', run_count: 4 },
  ],
  runs: [row(1, 0.91), row(2, 0.88), row(3, 0.7)],
  reason: null,
  ...over,
});

const state = vi.hoisted(() => ({
  scopeError: null as unknown,
  list: null as unknown,
  scopesSeen: [] as unknown[],
}));

vi.mock('@/api/launch', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    useBestRunScope: () => ({
      data: state.scopeError ? undefined : scopeData,
      isError: Boolean(state.scopeError),
      error: state.scopeError,
      refetch: vi.fn(),
    }),
    useBestRuns: (_p: unknown, _e: unknown, scope: unknown) => {
      state.scopesSeen.push(scope);
      return {
        data: scope ? state.list : undefined,
        isError: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
      };
    },
  };
});

function setup(options: Parameters<typeof renderSection>[1] = {}) {
  const chooseBase = vi.fn(async () => true);
  const env = makeEnv(PRODUCTION, 'production');
  const view = renderSection(<BestRunPicker />, {
    envs: [env],
    ...options,
    overrides: {
      chooseBase,
      baseState: {
        envId: 'e1',
        presets: [],
        savedPresets: [],
        loading: false,
        note: '',
        label: 'Best run',
        available: () => ({ ok: true }),
      },
      ...options.overrides,
    },
  });
  return { chooseBase, ...view };
}

beforeEach(() => {
  state.scopeError = null;
  state.list = listData();
  state.scopesSeen = [];
});

describe('BestRunPicker', () => {
  it('asks for a scope first and loads the top run after Find', async () => {
    const user = userEvent.setup();
    const { chooseBase } = setup();
    expect(screen.getByText(/Choose a dataset, a version/)).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Best runs' })).not.toBeInTheDocument();
    expect(state.scopesSeen.every((s) => s === null)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Find best runs' }));
    const table = await screen.findByRole('grid', { name: 'Best runs' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('0.91')).toBeInTheDocument();
    expect(within(table).getByText('0.86')).toBeInTheDocument(); // pass@3
    expect(within(table).getByText('40 (3 err)')).toBeInTheDocument();
    expect(within(table).getAllByText('agent 1.4 / kb kb-7')).toHaveLength(3);
    expect(within(table).getAllByText('timeout=25')).toHaveLength(3);
    expect(screen.getByText('PASS@3', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/2 runs are hidden for erroring/)).toBeInTheDocument();
    await waitFor(() =>
      expect(chooseBase).toHaveBeenCalledWith('best_run', { runId: 'run-1-abcdefgh', metric: 'accuracy' }),
    );
  });

  it('picks another run from the table and marks the current base', async () => {
    const user = userEvent.setup();
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      base: { ...emptyBaseInfo('best_run'), loaded: true, runId: 'run-1-abcdefgh' },
    });
    const { chooseBase } = setup({ doc });
    await user.click(screen.getByRole('button', { name: 'Find best runs' }));
    await screen.findByRole('grid', { name: 'Best runs' });
    expect(screen.getByText('Current base')).toBeInTheDocument();
    chooseBase.mockClear();
    await user.click(screen.getByRole('button', { name: 'Start from run run-2-ab' }));
    expect(chooseBase).toHaveBeenCalledWith('best_run', { runId: 'run-2-abcdefgh', metric: 'accuracy' });
  });

  it('shows the reason and the other-version shortcut when nothing is ranked', async () => {
    const user = userEvent.setup();
    state.list = listData({
      runs: [],
      reason: 'no_runs_on_version',
      latest_version_with_runs: { id: 'v2', version: 'v2', run_count: 8 },
    });
    const { chooseBase } = setup();
    await user.click(screen.getByRole('button', { name: 'Find best runs' }));
    expect(await screen.findByText('No official run on this dataset version yet.')).toBeInTheDocument();
    expect(chooseBase).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Use v2 \(8 runs\)/ }));
    const last = state.scopesSeen[state.scopesSeen.length - 1] as { versionId?: string; datasetId?: string };
    expect(last.versionId).toBe('v2');
    expect(last.datasetId).toBe('d1');
  });

  it('offers a temporary model the best run used and binds it without a key', async () => {
    const user = userEvent.setup();
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      base: {
        ...emptyBaseInfo('best_run'),
        loaded: true,
        runId: 'run-1-abcdefgh',
        versioning: { agent_version: '1.4' },
        drift: { status: 'changed', changes: [{ key: 'agent_version', run: '1.4', latest: '1.5' }] },
        prompts: [{ slot_key: 'endpoint:primary', label: 'mini trial', model: 'gpt-4o-mini' }],
      },
    });
    setup({ doc });
    expect(screen.getByText(/Launching reproduces the configuration/)).toBeInTheDocument();
    expect(screen.getByText('Temporary models were left unbound')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use it again' }));
    const binding = live.current?.doc.bindings['endpoint:primary'];
    expect(binding).toMatchObject({
      kind: 'temporary',
      model: 'gpt-4o-mini',
      secretRef: null,
      needsKey: true,
    });
    expect(screen.getByRole('button', { name: 'In use' })).toBeDisabled();
  });

  it('tells when the current versions are unknown', () => {
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      base: {
        ...emptyBaseInfo('best_run'),
        loaded: true,
        runId: 'r',
        versioning: { agent_version: '1.4' },
        drift: { status: 'unknown' },
      },
    });
    setup({ doc });
    expect(screen.getByText(/cannot be checked/)).toBeInTheDocument();
  });

  it('shows a failed scope load as an error with Retry', () => {
    state.scopeError = new Error('boom');
    setup();
    expect(screen.getByText('Could not load what can be ranked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = setup();
    await user.click(screen.getByRole('button', { name: 'Find best runs' }));
    await screen.findByRole('grid', { name: 'Best runs' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
