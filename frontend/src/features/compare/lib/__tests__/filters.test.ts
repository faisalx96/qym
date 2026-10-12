import { describe, expect, it } from 'vitest';
import { buildCompareModel } from '../model';
import {
  activeFilterCount, applyFilters, decodeFiltersParam, emptyFilters, emptyView, encodeFiltersParam,
  fieldDefsFor, readView, writeView, type CompareView, type FilterGroup,
} from '../filters';
import { resolveCohorts } from '../cohort';
import { makePayload } from './fixtures';

const decodeCtx = { metrics: ['correct', 'quality'], metadataKeys: ['domain', 'complexity', 'topic'], runCount: 3, rows: [] };

describe('filters JSON round trip (byte-compatible with the legacy page)', () => {
  it('encodes only what is set and decodes it back', () => {
    const f = emptyFilters();
    expect(encodeFiltersParam(f)).toBeNull();
    f.rules = { op: 'or', children: [{ field: 'pass_count', oper: 'gte', value: '2' }, { op: 'and', children: [{ field: 'cat:domain', oper: 'in', value: ['x'] }] }] };
    f.approval = 'approved';
    f.domain = ['a', 'b'];
    f.domainMode = 'exclude';
    f.rootCause = ['Retrieval'];
    f.rootCauseMetric = 'quality';
    f.passRate = ['gte', 2];
    f.baseline = { metric: 'quality', columnKey: 'r2', baselineKey: 'r1', kind: 'improved' };
    f.categories = { topic: ['t1'] };
    f.errors = { metric: { kind: 'Metric error', label: 'quality: JudgeError' } };
    const raw = encodeFiltersParam(f)!;
    expect(JSON.parse(raw)).toMatchObject({ approval: 'approved', domainMode: 'exclude', rootCauseMetric: 'quality', passRate: ['gte', 2] });
    expect(decodeFiltersParam(raw, decodeCtx)).toEqual({ ...f, domainOnly: [] });
  });

  it('drops invalid / stale parts silently', () => {
    const raw = JSON.stringify({
      rules: { op: 'xor', children: [] },
      approval: 'maybe',
      passRate: ['gte', 99],
      baseline: { metric: 'gone', columnKey: 'a', baselineKey: 'b', kind: 'improved' },
      categories: { unknownkey: ['a'], domain: ['x'], topic: ['ok'] },
      errors: { task: { kind: 'Task error', prefix: 'long', hash: 'zz.1' } },
    });
    const f = decodeFiltersParam(raw, decodeCtx);
    expect(f.rules.children).toEqual([]);
    expect(f.approval).toBeNull();
    expect(f.passRate).toBeNull();
    expect(f.baseline).toBeNull();
    expect(f.categories).toEqual({ topic: ['ok'] });
    expect(f.errors).toEqual({});
    expect(decodeFiltersParam('not json', decodeCtx)).toEqual(emptyFilters());
  });

  it('reads and writes the view params (defaults drop out)', () => {
    const params = new URLSearchParams(
      'metric=correct&filter=errors&winner=win_1&q=foo&sort=score_desc&page=3&tab=sweep&item=i9&baseline=r2&columns=passes&thr=quality:0.6&thr=bad',
    );
    const v = readView(params, decodeCtx);
    expect(v).toMatchObject({ metric: 'correct', show: 'errors', winner: 'win_1', q: 'foo', sort: 'score_desc', page: 3, tab: 'sweep', item: 'i9', baseline: 'r2', columns: 'each', thresholds: { quality: 0.6 } });
    const out = writeView(v, 'quality');
    expect(out).toMatchObject({ metric: 'correct', filter: 'errors', winner: 'win_1', page: '3', tab: 'sweep', baseline: 'r2', columns: 'passes', thr: ['quality:0.6'] });
    const def = writeView(emptyView(), 'quality');
    expect(Object.values(def).every((x) => x === null || (Array.isArray(x) && !x.length))).toBe(true);
  });
});

describe('applyFilters', () => {
  const payload = makePayload([
    { id: 'A', model: 'm', scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.3 }, i3: { correct: 1, quality: 0.8 }, i4: { correct: 0, quality: 0.1 } }, metaByItem: { i1: { domain: 'x', complexity: 'easy' }, i2: { domain: 'y', complexity: 'hard' }, i3: { domain: "['x', 'y']", complexity: 'easy' }, i4: { domain: 'y', complexity: 'hard' } }, taskErrors: ['i4'] },
    { id: 'B', model: 'n', scores: { i1: { correct: 1, quality: 0.9 }, i2: { correct: 1, quality: 0.9 }, i3: { correct: 0, quality: 0.2 }, i4: { correct: 0, quality: 0.1 } } },
    { id: 'C', model: 'n', scores: { i1: { correct: 0, quality: 0.2 }, i2: { correct: 1, quality: 0.7 }, i3: { correct: 0, quality: 0.1 }, i4: { correct: 0, quality: 0.0 } } },
  ]);
  const model = buildCompareModel(payload, ['A', 'B', 'C']);
  const run = (patch: Partial<CompareView> = {}, filters = emptyFilters()) =>
    applyFilters({ model, view: { ...emptyView(), ...patch, filters }, metric: 'quality', thresholds: {}, groups: null }).items.map((i) => i.itemId);

  it('is stable without filters and respects the sort', () => {
    expect(run()).toEqual(['i1', 'i2', 'i3', 'i4']);
    expect(run({ sort: 'score_desc' })).toEqual(['i1', 'i2', 'i3', 'i4']);
    expect(run({ sort: 'score_asc' })).toEqual(['i4', 'i3', 'i1', 'i2']);
  });

  it('show: errors, all_correct, partially_correct, unique_solve', () => {
    expect(run({ show: 'errors' })).toEqual(['i4']);
    expect(run({ show: 'all_wrong' })).toEqual(['i4']);
    expect(run({ show: 'partially_correct' })).toEqual(['i1', 'i2', 'i3']);
    expect(run({ show: 'unique_solve' })).toEqual(['i3']);
  });

  it('winner and pass-rate filters', () => {
    expect(run({ winner: 'win_0' })).toEqual(['i3']);
    expect(run({ winner: 'only_0' })).toEqual(['i3']);
    const f = emptyFilters();
    f.passRate = ['eq', 2];
    expect(run({}, f)).toEqual(['i1', 'i2']);
  });

  it('metadata filters: domain is any-of with an "only" switch; categories; rules', () => {
    const f = emptyFilters();
    f.domain = ['x'];
    expect(run({}, f)).toEqual(['i1', 'i3']);
    f.domainOnly = ['x'];
    expect(run({}, f)).toEqual(['i1']);
    const ex = emptyFilters();
    ex.domain = ['x'];
    ex.domainMode = 'exclude';
    expect(run({}, ex)).toEqual(['i2', 'i4']);
    const c = emptyFilters();
    c.complexity = ['HARD'];
    expect(run({}, c)).toEqual(['i2', 'i4']);
    const r = emptyFilters();
    r.rules = { op: 'and', children: [{ field: 'cat:complexity', oper: 'in', value: ['hard'] }, { field: 'error', oper: 'is', value: 'false' }] } as FilterGroup;
    expect(run({}, r)).toEqual(['i2']);
    const pc = emptyFilters();
    pc.rules = { op: 'or', children: [{ field: 'pass_count', oper: 'gte', value: '3' }, { field: 'score:0', oper: 'lt', value: '0.2' }] };
    expect(run({}, pc)).toEqual(['i4']);
  });

  it('baseline delta filter keeps items that improved vs the baseline column', () => {
    const f = emptyFilters();
    f.baseline = { metric: 'quality', columnKey: 'B', baselineKey: 'A', kind: 'improved' };
    // i4: A's task error scores 0 (higher is better), B's 0.1 is an improvement
    expect(run({}, f)).toEqual(['i2', 'i4']);
    f.baseline = { metric: 'quality', columnKey: 'B', baselineKey: 'A', kind: 'regressed' };
    expect(run({}, f)).toEqual(['i3']);
  });

  it('text search uses the supplied matcher; field defs cover metadata, scores and state', () => {
    const out = applyFilters({ model, view: { ...emptyView(), q: 'i3' }, metric: 'quality', thresholds: {}, groups: null });
    expect(out.items.map((i) => i.itemId)).toEqual(['i3']);
    const defs = fieldDefsFor(model, 'quality').map((d) => d.id);
    expect(defs).toEqual(expect.arrayContaining(['outcome', 'winner', 'pass_count', 'score:0', 'score:2', 'cat:domain', 'cat:complexity', 'approval', 'error', 'edited', 'output', 'latency']));
    const view = { ...emptyView(), show: 'errors', winner: 'win_0' };
    expect(activeFilterCount(view, fieldDefsFor(model, 'quality'))).toBe(2);
  });

  it('cohort bucket filter ("A sweeps B") needs groups, a direction and a non-numeric metric', () => {
    const groups = resolveCohorts(model, { left: ['A'], right: ['B'], leftLabel: 'A', rightLabel: 'B' });
    const ids = applyFilters({ model, view: { ...emptyView(), show: 'grouped:b_sweeps_a' }, metric: 'quality', thresholds: {}, groups }).items.map((i) => i.itemId);
    expect(ids).toEqual(['i2']);
    expect(applyFilters({ model, view: { ...emptyView(), show: 'grouped:b_sweeps_a' }, metric: 'quality', thresholds: {}, groups: null }).items).toEqual([]);
  });
});
