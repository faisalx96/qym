import { describe, expect, it } from 'vitest';
import { entry, makeCtx } from './__fixtures__/fixtures';
import {
  addSweepValues,
  axesOf,
  bindingFromSweepItem,
  checkLinks,
  checkValues,
  choiceOptions,
  cleanLinks,
  comboCount,
  expandRange,
  findSweeps,
  isSweepable,
  jobEstimate,
  linkAxes,
  modelItemFromBinding,
  parseTypedList,
  pruneLinks,
  runEstimate,
  runNamePreview,
  startModelSweep,
  startSweep,
  stopSweep,
  sweepItemKey,
  sweepLocalErrors,
  toggleChoice,
  toggleModelItem,
  unlinkGroup,
  upsertModelItem,
} from './sweeps';

const f = makeCtx().union.fields;
const threshold = f['/MILVUS_SEARCH_THRESHOLD']!;
const limit = f['/SQL_RESULT_LIMIT']!;
const mode = f['/TABLE_SELECTION_MODE']!;
const flag = f['/BRIEF_ENABLED']!;

describe('sweepable fields and value checks', () => {
  it('allows scalar settings, never secrets, objects or containers', () => {
    expect(isSweepable(threshold)).toBe(true);
    expect(isSweepable(flag)).toBe(true);
    expect(isSweepable(mode)).toBe(true);
    expect(isSweepable(f['/LLM_OVERRIDES/{role}/endpoint'])).toBe(true);
    expect(isSweepable(f['/LLM_OVERRIDES/endpoints/{endpoint}/api_key'])).toBe(false);
    expect(isSweepable(f['/LLM_OVERRIDES'])).toBe(false);
    expect(isSweepable(entry({ pointer: '/j', type: 'json' }))).toBe(false);
  });

  it('reports empty lists, bad values and duplicates by index', () => {
    expect(checkValues(threshold, { sweep: [0.1, 0.2] })).toEqual([]);
    expect(checkValues(threshold, { sweep: [] })).toEqual([
      { index: null, message: 'A sweep needs a non-empty list of values' },
    ]);
    expect(checkValues(threshold, { sweep: [0.1, 'x', 0.1] })).toEqual([
      { index: 1, message: 'Must be a number' },
      { index: 2, message: 'Duplicate value' },
    ]);
    expect(checkValues(limit, { sweep: [1, 1.5] })).toEqual([
      { index: 1, message: 'Must be a whole number' },
    ]);
    expect(checkValues(mode, { sweep: ['rag', 'zzz'] })).toEqual([
      { index: 1, message: 'Must be one of the listed values' },
    ]);
    expect(checkValues(f['/LLM_OVERRIDES/endpoints/{endpoint}/api_key']!, { sweep: ['k'] })).toEqual([
      { index: null, message: 'This setting cannot be swept' },
    ]);
    expect(checkValues(threshold, { sweep: [null] })).toEqual([]); // null = inherit
  });
});

describe('numeric ranges (at most 100 values)', () => {
  it('expands start/stop/step avoiding float noise', () => {
    expect(expandRange(threshold, '0.1', '0.5', '0.1')).toEqual({ values: [0.1, 0.2, 0.3, 0.4, 0.5] });
    expect(expandRange(limit, '1', '10', '3')).toEqual({ values: [1, 4, 7, 10] });
  });

  it('refuses bad input and more than 100 values', () => {
    expect(expandRange(threshold, '', '1', '1')).toEqual({ error: 'Enter a start, stop and step' });
    expect(expandRange(threshold, '1', '0', '1')).toEqual({ error: 'Stop must not be below start' });
    expect(expandRange(threshold, '0', '1', '0')).toEqual({ error: 'The step must be above 0' });
    expect(expandRange(limit, '1', '5', '0.5')).toEqual({ error: 'Use whole numbers' });
    expect(expandRange(limit, '1', '100', '1')).toMatchObject({ values: expect.any(Array) });
    expect(expandRange(limit, '1', '101', '1')).toEqual({
      error: 'That range has 101 values; the most is 100',
    });
  });
});

describe('chip editing', () => {
  it('parses typed numbers split on commas and spaces', () => {
    expect(parseTypedList(threshold, '0.5, 0.7;0.9  1')).toEqual({ values: [0.5, 0.7, 0.9, 1] });
    expect(parseTypedList(limit, '1 2.5')).toEqual({ error: 'Enter whole numbers' });
    expect(parseTypedList(threshold, 'a')).toEqual({ error: 'Enter numbers' });
    expect(parseTypedList(f['/RAG_ITERATION']!, 'latest')).toEqual({ values: ['latest'] });
    expect(parseTypedList(threshold, '  ')).toEqual({ values: [] });
  });

  it('skips duplicates when adding', () => {
    expect(addSweepValues([1, 2], [2, 3, 3])).toEqual({ values: [1, 2, 3], skipped: 2 });
  });

  it('starts a sweep from the value, [true,false] for booleans', () => {
    expect(startSweep(flag, undefined)).toEqual({ sweep: [true, false] });
    expect(startSweep(threshold, 0.3)).toEqual({ sweep: [0.3] });
    expect(startSweep(threshold, undefined)).toEqual({ sweep: [] });
    expect(startSweep(threshold, { sweep: [1] })).toEqual({ sweep: [] });
  });

  it('stops a sweep keeping the first value', () => {
    expect(stopSweep({ sweep: [0.2, 0.4] })).toBe(0.2);
    expect(stopSweep({ sweep: [] })).toBeUndefined();
    expect(stopSweep({ sweep: [null] })).toBeUndefined();
  });

  it('offers booleans, enums and endpoints as multi-choice and keeps their order', () => {
    expect(choiceOptions(flag)?.map((o) => o.value)).toEqual([true, false]);
    const modes = choiceOptions(mode)!;
    expect(modes.map((o) => o.value)).toEqual(['rag', 'llm_direct', 'pure_llm']);
    expect(toggleChoice(modes, ['pure_llm'], 'rag')).toEqual(['rag', 'pure_llm']);
    expect(toggleChoice(modes, ['rag', 'pure_llm'], 'rag')).toEqual(['pure_llm']);
    expect(
      choiceOptions(f['/LLM_OVERRIDES/{role}/endpoint']!, ['primary', 'fast'])?.map((o) => o.value),
    ).toEqual(['primary', 'fast']);
    expect(choiceOptions(threshold)).toBeNull();
  });
});

describe('axes, links and the run estimate', () => {
  const spec = {
    env_overrides: {
      MILVUS_SEARCH_THRESHOLD: { sweep: [0.1, 0.2, 0.3] },
      SQL_RESULT_LIMIT: { sweep: [10, 20] },
    },
    evaluator: { config: { samples: { sweep: [1, 2, 3] } } },
    slot_bindings: { 'endpoint:primary': { sweep: [{ connection_id: 'a' }, { connection_id: 'b' }] } },
  };

  it('matches the service for a two-parameter sweep (parse_sweeps output pinned)', () => {
    // Same spec fed to qym_platform.services.eval_sweeps.parse_sweeps: axes
    // [samples], [A], [B] (order evaluator, env_overrides) and, linked, [samples, A] + [B].
    const two = {
      env_overrides: { A: { sweep: [1, 2] }, B: { sweep: [0.1, 0.2, 0.3] } },
      evaluator: { config: { samples: { sweep: [5, 10] } } },
    };
    const grid = axesOf(two);
    expect(grid.axes.map((a) => a.pointers)).toEqual([
      ['/evaluator/config/samples'],
      ['/env_overrides/A'],
      ['/env_overrides/B'],
    ]);
    expect(comboCount(grid.axes)).toBe(12);
    expect(jobEstimate(two, 2)).toBe(24);
    const linked = axesOf({ ...two, links: [['/env_overrides/A', '/evaluator/config/samples']] });
    expect(linked.axes.map((a) => a.pointers)).toEqual([
      ['/evaluator/config/samples', '/env_overrides/A'],
      ['/env_overrides/B'],
    ]);
    expect(comboCount(linked.axes)).toBe(6);
  });

  it('finds sweeps in all three sections in axis order', () => {
    expect(findSweeps(spec).map((s) => s.pointer)).toEqual([
      '/slot_bindings/endpoint:primary',
      '/evaluator/config/samples',
      '/env_overrides/MILVUS_SEARCH_THRESHOLD',
      '/env_overrides/SQL_RESULT_LIMIT',
    ]);
  });

  it('multiplies unlinked axes and zips linked ones', () => {
    const grid = axesOf(spec);
    expect(grid.axes.map((a) => a.length)).toEqual([2, 3, 3, 2]);
    expect(comboCount(grid.axes)).toBe(36);
    const linkedSpec = {
      ...spec,
      links: [['/evaluator/config/samples', '/env_overrides/MILVUS_SEARCH_THRESHOLD']],
    };
    const linked = axesOf(linkedSpec);
    expect(linked.axes.map((a) => a.length)).toEqual([2, 3, 2]);
    expect(linked.axes[1]).toMatchObject({ linked: true, group: 0 });
    expect(comboCount(linked.axes)).toBe(12);
    expect(jobEstimate(linkedSpec, 2)).toBe(24);
  });

  it('flags the over-cap state and writes the maths', () => {
    const est = runEstimate(spec, 2, 50);
    expect(est).toMatchObject({ combos: 36, runs: 72, over: true, cap: 50 });
    expect(est.math).toBe('2 × 3 × 3 × 2 = 36 combinations × 2 environments = 72 runs');
    expect(runEstimate(spec, 1, 100).over).toBe(false);
    expect(runEstimate(spec, 1, null).over).toBe(false);
    expect(runEstimate({}, 3, 100)).toMatchObject({ combos: 1, runs: 3 });
  });

  it('links axes of equal length and refuses unequal ones', () => {
    const found = findSweeps(spec);
    const ok = linkAxes(
      undefined,
      ['/evaluator/config/samples', '/env_overrides/MILVUS_SEARCH_THRESHOLD'],
      found,
    );
    expect(ok).toEqual({ links: [['/evaluator/config/samples', '/env_overrides/MILVUS_SEARCH_THRESHOLD']] });
    const bad = linkAxes(
      undefined,
      ['/evaluator/config/samples', '/env_overrides/SQL_RESULT_LIMIT'],
      found,
      (p) => p.split('/').pop()!,
    );
    expect(bad).toEqual({
      error: 'Linked values need the same number of values (samples has 3, SQL_RESULT_LIMIT has 2).',
    });
    expect('error' in linkAxes(undefined, ['/evaluator/config/samples'], found)).toBe(true);
  });

  it('unlinks a group and drops links to values no longer swept', () => {
    const links = [
      ['/a', '/b'],
      ['/c', '/d'],
    ];
    const swept = new Set(['/a', '/b', '/c', '/d']);
    expect(unlinkGroup(links, swept, 0)).toEqual([['/c', '/d']]);
    expect(unlinkGroup([['/a', '/b']], swept, 0)).toBeUndefined();
    expect(
      cleanLinks(
        [
          ['/a', '/b', '/gone'],
          ['/a', '/c'],
        ],
        new Set(['/a', '/b', '/c']),
      ),
    ).toEqual([['/a', '/b']]);
    expect(
      pruneLinks([['/env_overrides/X', '/env_overrides/Y']], { env_overrides: { X: { sweep: [1] }, Y: 3 } }),
    ).toBeUndefined();
  });

  it('checks links written in a document like the service', () => {
    const doc = {
      ...spec,
      links: [
        ['/evaluator/config/samples', '/env_overrides/SQL_RESULT_LIMIT'],
        ['/nope', '/env_overrides/MILVUS_SEARCH_THRESHOLD'],
        ['/env_overrides/MILVUS_SEARCH_THRESHOLD'],
      ],
    };
    const messages = checkLinks(doc).map((e) => e.message);
    expect(messages).toContain('Linked values need the same number of values (got 3, 2)');
    expect(messages).toContain('/nope is not a swept value');
    expect(messages).toContain('A linked group needs two or more values');
    expect(checkLinks({ links: 'x' as never })).toEqual([
      { pointer: '/links', message: 'links must be a list of lists of pointers' },
    ]);
    expect(checkLinks({})).toEqual([]);
  });

  it('reports empty sweeps and uneven linked groups as local errors', () => {
    const errs = sweepLocalErrors(
      {
        env_overrides: { A: { sweep: [] }, B: { sweep: [1, 2] }, C: { sweep: [1] } },
        links: [['/env_overrides/B', '/env_overrides/C']],
      },
      (p) => p.split('/').pop()!,
    );
    expect(errs).toEqual([
      { pointer: '/env_overrides/A', message: 'A: Add at least one value, or switch back to a single value' },
      { pointer: '/links/0', message: 'Linked values need the same number of values: B has 2, C has 1' },
    ]);
  });
});

describe('model sweeps', () => {
  it('starts from the slot binding and keys temporary models without their key', () => {
    expect(startModelSweep(null)).toEqual({ kind: 'sweep', items: [] });
    expect(startModelSweep({ kind: 'connection', id: 'c1' })).toEqual({
      kind: 'sweep',
      items: [{ connection_id: 'c1' }],
    });
    const temp = {
      kind: 'temporary' as const,
      model: 'm',
      label: 'L',
      secretRef: 'tmp-1',
      save: false,
      needsKey: false,
    };
    const item = modelItemFromBinding(temp)!;
    expect(item).toEqual({ temporary: { model: 'm', label: 'L', api_key: { $secret: 'tmp-1' } } });
    expect(sweepItemKey(item)).toBe(
      sweepItemKey({ temporary: { model: 'm', label: 'L', api_key: { $secret: 'other' } } }),
    );
    expect(sweepItemKey({ inherit: true })).toBe('inherit');
  });

  it('toggles and replaces swept models by identity', () => {
    const a = { connection_id: 'a' };
    const b = { connection_id: 'b' };
    expect(toggleModelItem([a], b)).toEqual([a, b]);
    expect(toggleModelItem([a, b], a)).toEqual([b]);
    const t1 = { temporary: { model: 'm', api_key: { $secret: 'one' } } };
    const t2 = { temporary: { model: 'm', api_key: { $secret: 'two' } } };
    expect(upsertModelItem([a, t1], t2)).toEqual([a, t2]);
  });

  it('collapses a sweep item to a single binding', () => {
    expect(bindingFromSweepItem({ connection_id: 'a' })).toEqual({ kind: 'connection', id: 'a' });
    expect(bindingFromSweepItem({ inherit: true })).toBeNull();
    expect(bindingFromSweepItem(undefined)).toBeNull();
    expect(bindingFromSweepItem({ temporary: { model: 'm' } })).toMatchObject({
      kind: 'temporary',
      model: 'm',
      secretRef: null,
      needsKey: true,
    });
    expect(bindingFromSweepItem({ temporary: { model: 'm', api_key: { $secret: 'r' } } })).toMatchObject({
      secretRef: 'r',
      needsKey: false,
    });
  });
});

describe('run-name preview', () => {
  it('shows the first 12 names and the remainder', () => {
    const jobs = Array.from({ length: 15 }, (_, i) => ({ run_name: `run ${i}` }));
    const p = runNamePreview(jobs);
    expect(p.names).toHaveLength(12);
    expect(p.names[11]).toBe('run 11');
    expect(p.more).toBe(3);
    expect(runNamePreview(undefined)).toEqual({ names: [], more: 0 });
  });
});
