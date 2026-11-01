/** K7 (C058): runs of different tasks are not paired item by item. */
import { describe, expect, it } from 'vitest';
import { applyFilters, emptyView } from '../filters';
import { buildCompareModel } from '../model';
import { makePayload } from './fixtures';

const scores = { i1: { correct: 1, quality: 0.9 }, i2: { correct: 0, quality: 0.3 } };

function model(taskB: string, datasetB = 'golden') {
  const payload = makePayload([
    { id: 'a', name: 'run-a', scores },
    { id: 'b', name: 'run-b', scores },
  ]);
  payload.runs[0]!.run.task_name = 'text2sql';
  payload.runs[0]!.run.dataset_name = 'golden';
  payload.runs[1]!.run.task_name = taskB;
  payload.runs[1]!.run.dataset_name = datasetB;
  return buildCompareModel(payload, ['a', 'b']);
}

describe('unpaired runs (C058)', () => {
  it('names each run with its task and dataset when the tasks differ', () => {
    expect(model('support-agent').unpaired).toEqual([
      { name: 'run-a', task: 'text2sql', dataset: 'golden' },
      { name: 'run-b', task: 'support-agent', dataset: 'golden' },
    ]);
  });

  it('is unpaired when the dataset names differ, and paired when task and dataset match', () => {
    expect(model('text2sql', 'other')).toMatchObject({ unpaired: expect.any(Array) });
    expect(model('text2sql').unpaired).toBeNull();
  });

  it('pairs no items', () => {
    const m = model('support-agent');
    expect(
      applyFilters({ model: m, view: emptyView(), metric: 'quality', thresholds: {}, groups: null }).items,
    ).toEqual([]);
  });
});
