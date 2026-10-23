import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/http';
import { buildChart, chartTableRows, metricNames, seriesSlot } from './chart';
import { classifyActionError, outcomeSummary, planCancelExperiment, stoppedRunIds } from './cancel';
import { baseSourceLabel, formatMetric, formatParam, relTime, tallyJobCounts } from './format';
import {
  buildMatrix,
  buildQueueStrip,
  cellKey,
  compareHref,
  jobGroup,
  jobStats,
  presetConfig,
  pruneSelection,
  temporaryModels,
} from './matrix';
import { makeDetail, makeJob, makeRun } from './testData';

describe('buildMatrix with dataset versions', () => {
  const ref = (dataset: string, version: string) => ({ dataset, version, alias: null });
  const combined = [ref('a', 'v1'), ref('a', 'v2'), ref('b', 'v1'), ref('b', 'v2')];
  const jobs = [
    makeJob({ id: 'c', environment_id: 'e1', datasets: combined, combo_label: '' }),
    ...combined.map((d, k) =>
      makeJob({ id: `p${k}`, environment_id: 'e2', dataset_index: k, dataset: d, combo_label: '' }),
    ),
    makeJob({ id: 'p1r', environment_id: 'e2', dataset_index: 1, dataset: combined[1], attempt: 1, retry_of_job_id: 'p1' }),
  ];
  jobs[2] = { ...jobs[2]!, superseded: true };
  const matrix = buildMatrix(makeDetail(jobs));

  it('QD-56 has a combined row first, then one row per pair, "—" where an environment has no job', () => {
    expect(matrix.rows.map((r) => [r.label, r.sub])).toEqual([
      ['All 4 dataset versions', 'combined'],
      ['a · v1', '#0 · pair 1'],
      ['a · v2', '#0 · pair 2'],
      ['b · v1', '#0 · pair 3'],
      ['b · v2', '#0 · pair 4'],
    ]);
    expect(matrix.cells.get(cellKey('0.c', 'e1'))?.current?.id).toBe('c');
    expect(matrix.cells.get(cellKey('0.c', 'e2'))).toBeUndefined();
    expect(matrix.cells.get(cellKey('0.1', 'e1'))).toBeUndefined();
  });

  it('QD-59 a retried pair keeps its row and counts the earlier attempt', () => {
    const cell = matrix.cells.get(cellKey('0.1', 'e2'));
    expect(cell?.current?.id).toBe('p1r');
    expect(cell?.earlier.map((j) => j.id)).toEqual(['p1']);
  });

  it('QD-57 groups: the combined job first, then each dataset version', () => {
    const groups = jobs.map((j) => jobGroup(j));
    expect(groups[0]).toEqual({ key: 'combined', order: -1, label: 'All 4 dataset versions · one combined run' });
    expect(groups[3]).toEqual({ key: 'pair-2', order: 2, label: 'b · v1' });
    expect(jobGroup(makeJob())).toBeNull();
  });

  it('a plain experiment keeps one row per combination', () => {
    const plain = buildMatrix(makeDetail([makeJob({ id: 'x' }), makeJob({ id: 'y', combo_index: 1 })]));
    expect(plain.rows.map((r) => [r.kind, r.sub])).toEqual([
      ['plain', '#0'],
      ['plain', '#1'],
    ]);
  });
});

describe('buildMatrix', () => {
  const jobs = [
    makeJob({
      id: 'a0',
      combo_index: 0,
      environment_id: 'e1',
      superseded: true,
      status: 'FAILED',
      attempt: 0,
    }),
    makeJob({
      id: 'a1',
      combo_index: 0,
      environment_id: 'e1',
      attempt: 1,
      status: 'SUCCEEDED',
      run_id: 'r1',
      run: makeRun(),
    }),
    makeJob({
      id: 'b0',
      combo_index: 1,
      environment_id: 'e2',
      combo_label: 'timeout=30',
      run_id: 'r2',
      run: makeRun({ id: 'r2', deleted: true }),
      status: 'SUCCEEDED',
    }),
    makeJob({ id: 'c0', combo_index: 1, environment_id: 'e3', environment_name: 'extra', status: 'QUEUED' }),
  ];
  const detail = makeDetail(jobs);
  const matrix = buildMatrix(detail);

  it('orders combinations and lists environments (including ones only seen on jobs)', () => {
    expect(matrix.combos.map((c) => c.index)).toEqual([0, 1]);
    expect(matrix.combos[1]?.label).toBe('timeout=30');
    expect(matrix.envs.map((e) => [e.id, e.active])).toEqual([
      ['e1', true],
      ['e2', false],
      ['e3', true],
    ]);
  });
  it('keeps the latest attempt per cell and the superseded ones aside', () => {
    const cell = matrix.cells.get('0|e1');
    expect(cell?.current?.id).toBe('a1');
    expect(cell?.earlier.map((j) => j.id)).toEqual(['a0']);
    expect(matrix.cells.get('0|e2')).toBeUndefined();
  });
  it('only counts non-deleted runs as comparable and prunes stale selections', () => {
    expect(matrix.liveRunIds).toEqual(['r1']);
    expect(pruneSelection(new Set(['r1', 'r2', 'gone']), matrix.liveRunIds)).toEqual(['r1']);
  });
  it('counts current attempts only', () => {
    expect(jobStats(detail)).toEqual({ jobs: 3, succeeded: 2, failed: 0, inProgress: 1, cancelled: 0 });
  });
  it('builds the compare link with each run id encoded', () => {
    expect(compareHref(['a/b', 'c'])).toBe('/compare?runs=a%2Fb&runs=c');
  });
});

describe('preset config', () => {
  it('keeps only the secret-free, sweep-free keys', () => {
    const job = makeJob({
      qym_config: {
        schema_hash: 'h',
        evaluator: { dataset: 'd' },
        slot_bindings: {
          'endpoint:a': { temporary: { model: 'm1', label: 'L' } },
          'endpoint:b': { connection_id: 'c' },
        },
        env_overrides: { x: 1 },
        sweep: { '/t': 1 },
        base_source: { kind: 'blank' },
      },
    });
    const config = presetConfig(job);
    expect(Object.keys(config).sort()).toEqual([
      'env_overrides',
      'evaluator',
      'schema_hash',
      'slot_bindings',
    ]);
    expect(temporaryModels(config)).toEqual(['m1 (endpoint:a)']);
    expect(presetConfig(makeJob())).toEqual({});
  });
});

describe('planCancelExperiment', () => {
  const queued = makeJob({ id: 'q', status: 'QUEUED' });
  const blocked = makeJob({ id: 'b', status: 'BLOCKED' });
  const running = makeJob({ id: 'r', status: 'RUNNING', run_id: 'run-r' });
  const done = makeJob({ id: 'd', status: 'SUCCEEDED' });
  const old = makeJob({ id: 'o', status: 'RUNNING', superseded: true });

  it('cancels queued and blocked jobs by default and leaves running ones', () => {
    const plan = planCancelExperiment([queued, blocked, running, done, old], 'sweep');
    expect(plan.kind).toBe('pending');
    expect(plan.includeRunning).toBe(false);
    expect(plan.targets.map((j) => j.id)).toEqual(['q', 'b']);
    expect(plan.title).toBe('Cancel queued jobs of “sweep”?');
    expect(plan.description.join(' ')).toContain('1 running job will keep running');
  });
  it('stops running jobs only when nothing else is pending', () => {
    const plan = planCancelExperiment([running, makeJob({ id: 'r2', status: 'RUNNING' }), done], 'sweep');
    expect(plan.kind).toBe('running');
    expect(plan.includeRunning).toBe(true);
    expect(plan.title).toBe('Stop 2 running jobs of “sweep”?');
    expect(plan.confirmLabel).toBe('Stop 2 running jobs');
    expect(plan.cancelLabel).toBe('Keep running');
  });
  it('has nothing to do when every job finished', () => {
    expect(planCancelExperiment([done], 'sweep').kind).toBe('none');
  });
});

describe('cancel outcomes', () => {
  it('summarises per-job outcomes', () => {
    expect(
      outcomeSummary({
        a: 'cancelled',
        b: 'cancelled',
        c: 'cancelling',
        d: 'already_terminal',
        e: 'forbidden',
      }),
    ).toBe('2 cancelled, 1 stopping on the service, 1 already finished, 1 not allowed');
    expect(outcomeSummary({})).toBe('Nothing to cancel');
  });
  it('announces only runs whose cancel took effect', () => {
    const jobs = [
      makeJob({ id: 'a', run_id: 'ra' }),
      makeJob({ id: 'b', run_id: 'rb' }),
      makeJob({ id: 'c', run_id: null }),
      makeJob({ id: 'd', run_id: 'rd' }),
    ];
    expect(
      stoppedRunIds(jobs, { a: 'cancelling', b: 'already_terminal', c: 'cancelled', d: 'cancelled' }),
    ).toEqual(['ra', 'rd']);
  });
});

describe('classifyActionError', () => {
  const err = (status: number, detail: unknown) =>
    new ApiError(status, JSON.stringify(detail), { body: { detail } });
  it('recognises the preemption acknowledgement', () => {
    const c = classifyActionError(
      err(422, { code: 'preemption_acknowledgement_required', message: 'HIGH preempts' }),
    );
    expect(c).toMatchObject({ kind: 'preemption', message: 'HIGH preempts' });
  });
  it('reads the slots of a temporary_key_required error', () => {
    const c = classifyActionError(
      err(422, {
        code: 'temporary_key_required',
        message: 'Keys needed',
        slots: [{ slot_key: 'endpoint:primary', label: 'Answer model' }, { nope: 1 }],
      }),
    );
    expect(c.kind).toBe('temporary_keys');
    expect(c.slots).toEqual([{ slot_key: 'endpoint:primary', label: 'Answer model' }]);
  });
  it('maps 403 and 409 and everything else', () => {
    expect(classifyActionError(err(403, 'no')).kind).toBe('denied');
    expect(classifyActionError(err(409, { message: 'already retried' })).kind).toBe('conflict');
    expect(classifyActionError(err(500, 'boom')).kind).toBe('other');
    expect(classifyActionError(new Error('x'))).toMatchObject({ kind: 'other', message: 'x' });
  });
});

describe('buildChart', () => {
  const run = (id: string, mean: number, name = 'acc') =>
    makeRun({
      id,
      metric_means: { [name]: mean, other: 1 },
      headline_metric: { name, mean, direction: 'maximize' },
    });
  const jobs = [
    makeJob({
      id: 'j1',
      environment_id: 'e1',
      combo_index: 0,
      params: { sweep: { '/t': 10 } },
      run_id: 'r1',
      run: run('r1', 0.5),
      status: 'SUCCEEDED',
    }),
    makeJob({
      id: 'j2',
      environment_id: 'e1',
      combo_index: 1,
      params: { sweep: { '/t': 30 } },
      run_id: 'r2',
      run: run('r2', 0.7),
      status: 'SUCCEEDED',
    }),
    makeJob({
      id: 'j3',
      environment_id: 'e2',
      combo_index: 0,
      params: { sweep: { '/t': 10 } },
      run_id: 'r3',
      run: run('r3', 0.4),
      status: 'SUCCEEDED',
    }),
    makeJob({
      id: 'j4',
      environment_id: 'e2',
      combo_index: 1,
      params: { sweep: { '/t': 30 } },
      status: 'RUNNING',
    }),
  ];
  const detail = makeDetail(jobs);
  const envs = buildMatrix(detail).envs;

  it('orders metric names by how many runs have them as headline', () => {
    expect(metricNames(jobs)).toEqual(['acc', 'other']);
  });
  it('builds one series per environment with points inside the plot', () => {
    const model = buildChart(detail, envs, '/t', 'acc');
    expect(model.empty).toBe(false);
    expect(model.numeric).toBe(true);
    expect(model.series.map((s) => [s.name, s.slot, s.points.length])).toEqual([
      ['staging', '1', 2],
      ['production', '2', 1],
    ]);
    for (const s of model.series)
      for (const p of s.points) {
        expect(p.px).toBeGreaterThanOrEqual(model.plot.left);
        expect(p.px).toBeLessThanOrEqual(model.plot.right);
        expect(p.py).toBeGreaterThanOrEqual(model.plot.top);
        expect(p.py).toBeLessThanOrEqual(model.plot.bottom);
      }
    const [low, high] = model.series[0]!.points;
    expect(high!.py).toBeLessThan(low!.py); // higher value plots higher
    expect(model.xTicks.map((t) => t.label)).toEqual(['10', '30']);
    expect(model.yTicks).toHaveLength(5);
    expect(chartTableRows(model)).toHaveLength(3);
  });
  it('is empty without a metric, a matching pointer or finished runs', () => {
    expect(buildChart(detail, envs, '/t', null).empty).toBe(true);
    expect(buildChart(detail, envs, '/missing', 'acc').empty).toBe(true);
    expect(buildChart(makeDetail([jobs[3]!]), envs, '/t', 'acc').empty).toBe(true);
  });
  it('treats non-numeric settings as categories and folds the 6th+ environment into one neutral slot', () => {
    const cat = makeDetail([
      makeJob({
        id: 'c1',
        params: { sweep: { '/m': 'gpt' } },
        run_id: 'r1',
        run: run('r1', 1),
        status: 'SUCCEEDED',
      }),
      makeJob({
        id: 'c2',
        combo_index: 1,
        params: { sweep: { '/m': { connection_id: 'c', model: 'claude' } } },
        run_id: 'r2',
        run: run('r2', 2),
        status: 'SUCCEEDED',
      }),
    ]);
    const model = buildChart(cat, buildMatrix(cat).envs, '/m', 'acc');
    expect(model.numeric).toBe(false);
    expect(model.xTicks.map((t) => t.label)).toEqual(['gpt', 'claude']);
    expect(seriesSlot(4)).toBe('5');
    expect(seriesSlot(5)).toBe('other');
  });
});

describe('format helpers', () => {
  it('formats metrics, params, base sources and job tallies', () => {
    expect(formatMetric(0.12345)).toBe('0.123');
    expect(formatMetric(1234.5)).toBe('1235');
    expect(formatMetric(undefined)).toBe('—');
    expect(formatParam({ temporary: { model: 'jais' } })).toBe('jais');
    expect(formatParam(null)).toBe('inherit');
    expect(baseSourceLabel({ kind: 'official' })).toBe('Default preset');
    expect(baseSourceLabel({ kind: 'weird_kind' })).toBe('Weird kind');
    expect(
      tallyJobCounts({ SUCCEEDED: 2, FAILED: 1, TIMED_OUT: 1, RUNNING: 3, QUEUED: 1, CANCELLED: 2 }),
    ).toEqual({ ok: 2, failed: 2, live: 4, cancelled: 2 });
  });
  it('writes relative times', () => {
    const now = Date.parse('2026-01-02T00:00:00Z');
    expect(relTime('2026-01-01T23:59:40Z', now)).toBe('just now');
    expect(relTime('2026-01-01T23:30:00Z', now)).toBe('30 min ago');
    expect(relTime('2026-01-01T20:00:00Z', now)).toBe('4 hr ago');
    expect(relTime(null, now)).toBe('—');
  });
});

describe('buildQueueStrip', () => {
  it('counts live jobs per environment and reports the first queue position', () => {
    const row = (environment_id: string, status: string, queue_position: number | null) => ({
      environment_id,
      environment_name: environment_id === 'e1' ? 'staging' : null,
      status,
      queue_position,
    });
    const strip = buildQueueStrip([
      row('e1', 'QUEUED', 7),
      row('e1', 'QUEUED', 4),
      row('e1', 'RUNNING', null),
      row('e1', 'BLOCKED', null),
      row('e2', 'SUBMITTED', null),
      row('e2', 'SUCCEEDED', null),
    ]);
    expect(strip).toEqual([
      { environmentId: 'e1', environmentName: 'staging', queued: 2, running: 1, blocked: 1, position: 4 },
      { environmentId: 'e2', environmentName: 'e2', queued: 0, running: 1, blocked: 0, position: null },
    ]);
    expect(buildQueueStrip([row('e1', 'FAILED', null)])).toEqual([]);
  });
});
