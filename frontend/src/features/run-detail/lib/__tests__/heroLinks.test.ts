import { describe, expect, it } from 'vitest';
import { runEntityLinks } from '../heroModel';
import type { Run } from '../../types';

const run = (over: Partial<Run>) =>
  ({
    run_id: 'run-000',
    model_name: 'm-a',
    task_name: 'support-qa',
    dataset_name: 'golden',
    owner: { id: 'dev' },
    ...over,
  }) as Run;

describe('run header links', () => {
  it('link the dataset (with its version), model, task and owner', () => {
    const links = runEntityLinks(run({ dataset_slug: 'golden-set', dataset_version: 'v1' }), 'pa');
    expect(links.dataset).toBe('/projects/pa/datasets/golden-set?tab=runs&v=v1');
    expect(links.model).toBe('/projects/pa?model=m-a');
    expect(links.task).toBe('/projects/pa?task=support-qa');
    expect(links.owner).toBe('/projects/pa?owner=dev');
    expect(links.project).toBe('/projects/pa');
  });

  it('a dataset known only by label opens the Runs list filtered to it', () => {
    const links = runEntityLinks(run({ dataset_slug: null, dataset_version: undefined }), 'pa');
    expect(links.dataset).toBe('/projects/pa?dataset=golden');
    expect(links.datasetTitle).toBe('Runs on dataset golden');
  });

  it('has no links outside a project', () => {
    expect(runEntityLinks(run({}), undefined).model).toBeNull();
  });
});
