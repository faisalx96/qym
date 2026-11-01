/** K1 (C036, C162, C245, C248): the default baseline, the page title, run names, letters and the dataset version. */
import { describe, expect, it } from 'vitest';
import { datasetVersionLabel } from '@/lib/format';
import { runLetters } from '../../CompareContext';
import { defaultBaselineKey, metricColumns, resolveBaseline } from '../baseline';
import { buildCompareModel } from '../model';
import { compareTitle } from '../title';
import { makePayload } from './fixtures';

const scores = { i1: { correct: 1, quality: 0.8 }, i2: { correct: 0, quality: 0.4 } };

function twoRuns(patch: (runs: ReturnType<typeof makePayload>['runs']) => void = () => {}) {
  const payload = makePayload([
    { id: 'new', name: 'gpt-run-c', model: 'gpt', scores },
    { id: 'old', name: 'claude-run-b', model: 'claude', scores },
  ]);
  payload.runs[0]!.run.started_at = '2026-10-02T12:00:00Z';
  payload.runs[1]!.run.started_at = '2026-10-01T12:00:00Z';
  patch(payload.runs);
  // ticked newest first, as the runs list does top-down
  return buildCompareModel(payload, ['new', 'old']);
}

describe('the default baseline (C036)', () => {
  it('is the run that started first, not the first one ticked', () => {
    const model = twoRuns();
    const columns = metricColumns(model, 'run');
    expect(defaultBaselineKey(model, columns)).toBe('old');
    expect(resolveBaseline(columns, null, model)!.key).toBe('old');
    expect(resolveBaseline(columns, 'new', model)!.key).toBe('new');
  });

  it('is the approved run of the set when there is one', () => {
    const model = twoRuns((runs) => (runs[0]!.run.status = 'APPROVED'));
    expect(defaultBaselineKey(model, metricColumns(model, 'run'))).toBe('new');
  });

  it('is the official run when no run is approved', () => {
    const model = twoRuns((runs) => (runs[0]!.run.origin = 'official'));
    expect(defaultBaselineKey(model, metricColumns(model, 'run'))).toBe('new');
  });
});

describe('the page title (C245, C215)', () => {
  it('names the run, then its baseline', () => {
    const model = twoRuns();
    expect(compareTitle(model, { base: 'old' })).toBe('gpt-run-c vs claude-run-b');
  });

  it('names one repeat run once', () => {
    const payload = makePayload([{ id: 'rep', name: 'support-agent-02645', samples: 3, scores }]);
    const model = buildCompareModel(payload, ['rep']);
    expect(compareTitle(model, { base: 'rep' })).toBe('3 passes of support-agent-02645');
  });

  it('counts three or more runs on their dataset', () => {
    const payload = makePayload([
      { id: 'a', scores },
      { id: 'b', scores },
      { id: 'c', scores },
    ]);
    payload.runs.forEach((r) => (r.run.dataset_name = 'support-faq'));
    const model = buildCompareModel(payload, ['a', 'b', 'c']);
    expect(compareTitle(model, { base: 'a' })).toBe('3 runs on support-faq');
  });
});

describe('run names (C162)', () => {
  it('labels a run by its run_name, not by model and date', () => {
    const model = twoRuns();
    expect(model.runs.map((r) => r.label)).toEqual(['gpt-run-c', 'claude-run-b']);
  });

  it('adds "· pass N" only to the passes of a run with more than one pass', () => {
    const payload = makePayload([
      { id: 'one', name: 'single', samples: 1, scores },
      { id: 'rep', name: 'repeat', samples: 2, scores },
    ]);
    payload.runs[0]!.run.metadata = { has_repeat_pass_context: true };
    const model = buildCompareModel(payload, ['one', 'rep']);
    expect(model.runs.map((r) => r.label)).toEqual(['single', 'repeat · pass 1', 'repeat · pass 2']);
  });

  it('letters cohort sides A and B and numbers their runs', () => {
    expect(runLetters(['a1', 'a2', 'b1', 'b2'], { left: ['a1', 'a2'], right: ['b1', 'b2'] })).toEqual([
      'A1',
      'A2',
      'B1',
      'B2',
    ]);
    expect(runLetters(['x', 'y'], { left: ['x'], right: ['y'] })).toEqual(['A', 'B']);
    expect(runLetters(['x', 'y', 'z'], null)).toEqual(['A', 'B', 'C']);
  });
});

describe('the dataset version (C248)', () => {
  it('prints v1 for "v1" and for 1, and nothing when there is none', () => {
    expect(datasetVersionLabel('v1')).toBe('v1');
    expect(datasetVersionLabel('3')).toBe('v3');
    expect(datasetVersionLabel(3)).toBe('v3');
    expect(datasetVersionLabel(null)).toBe('');
  });
});
