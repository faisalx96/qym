import { describe, expect, it } from 'vitest';
import {
  clearJobPriorities,
  createDocument,
  defaultRunPriority,
  highEnvironments,
  highRunCount,
  jobKey,
  liveJobPriorities,
  pruneJobPriorities,
  runPriorityOptions,
  setAllJobPriorities,
  setJobPriority,
  buildLaunchRequest,
  SecretStore,
  type DryRunJob,
} from '.';
import { makeEnv } from './__fixtures__/fixtures';

const job = (env: string, combo: number, dataset = 0): DryRunJob => ({
  environment_id: env,
  environment_name: env === 'e1' ? 'production' : 'staging',
  combo_index: combo,
  dataset_index: dataset,
});
const jobs = [job('e1', 0), job('e1', 1), job('e2', 0)];

describe('priority per run (round 9, I2)', () => {
  it('keys a run by environment, combination and dataset', () => {
    expect(jobKey(job('e1', 2, 3))).toBe('e1:2:3');
    expect(jobKey({ environment_id: 'e1', combo_index: 0 })).toBe('e1:0:0');
  });

  it('C-6-2 the default of every run is the experiment priority, else the lowest environment default', () => {
    const ctx = { envs: [makeEnv('e1', 'production', { defaultPriority: 'HIGH' }), makeEnv('e2', 'staging', { defaultPriority: 'LOW' })] };
    expect(defaultRunPriority({ priority: '' }, ctx)).toBe('LOW');
    expect(defaultRunPriority({ priority: 'HIGH' }, ctx)).toBe('HIGH');
    expect(defaultRunPriority({ priority: '' }, { envs: [] }, { priority: 'NORMAL' })).toBe('NORMAL');
  });

  it('C-6-3 choosing one run changes only that run; choosing the default removes the change', () => {
    let doc = createDocument();
    doc = setJobPriority(doc, 'e1:0:0', 'HIGH', 'NORMAL');
    expect(doc.jobPriorities).toEqual({ 'e1:0:0': 'HIGH' });
    doc = setJobPriority(doc, 'e1:0:0', 'NORMAL', 'NORMAL');
    expect(doc.jobPriorities).toEqual({});
  });

  it('C-6-8 a row the user did not change follows the experiment default', () => {
    const doc = setJobPriority(createDocument(), 'e1:0:0', 'LOW', 'NORMAL');
    const ctx = { envs: [] };
    // experiment-level High: the untouched rows are High, the changed row stays Low
    const withHigh = { ...doc, priority: 'HIGH' as const };
    const fallback = defaultRunPriority(withHigh, ctx);
    expect(highRunCount(withHigh, jobs, fallback)).toBe(2);
  });

  it('C-6-7 "Set every run to" sets all rows and clears the markers when it equals the default', () => {
    const keys = jobs.map(jobKey);
    const all = setAllJobPriorities(createDocument(), keys, 'LOW', 'NORMAL');
    expect(Object.keys(all.jobPriorities)).toHaveLength(3);
    expect(setAllJobPriorities(all, keys, 'NORMAL', 'NORMAL').jobPriorities).toEqual({});
    expect(clearJobPriorities(all).jobPriorities).toEqual({});
  });

  it('only runs of the preview are sent, and stale changes are pruned', () => {
    let doc = setJobPriority(createDocument(), 'e1:1:0', 'HIGH', 'NORMAL');
    doc = setJobPriority(doc, 'e9:0:0', 'LOW', 'NORMAL');
    expect(liveJobPriorities(doc, jobs)).toEqual([
      { environment_id: 'e1', combo_index: 1, dataset_index: 0, priority: 'HIGH' },
    ]);
    expect(liveJobPriorities(doc, undefined)).toEqual([]);
    expect(pruneJobPriorities(doc, jobs).jobPriorities).toEqual({ 'e1:1:0': 'HIGH' });
    // nothing to prune: the same document comes back
    const clean = setJobPriority(createDocument(), 'e1:0:0', 'LOW', 'NORMAL');
    expect(pruneJobPriorities(clean, jobs)).toBe(clean);
  });

  it('C-6-6 names the environments of the High runs only, once each', () => {
    const doc = { ...createDocument(), jobPriorities: { 'e1:0:0': 'HIGH', 'e1:1:0': 'HIGH', 'e2:0:0': 'LOW' } as const };
    expect(highEnvironments(doc, jobs, 'NORMAL')).toEqual(['production']);
    expect(highRunCount(doc, jobs, 'NORMAL')).toBe(2);
  });

  it('C-6-4 / C-6-5 High needs a manager and the run’s own environment cap', () => {
    const member = runPriorityOptions('HIGH', 'production', false);
    expect(member.map((o) => o.label)).toEqual(['Low', 'Normal', 'High']);
    expect(member[2]).toMatchObject({ disabled: true, description: 'Only project managers' });
    const capped = runPriorityOptions('NORMAL', 'staging', true);
    expect(capped[2]).toMatchObject({ disabled: true, description: 'Capped at Normal on staging' });
    expect(runPriorityOptions('HIGH', 'production', true).every((o) => !o.disabled)).toBe(true);
    // an environment that does not say its cap is read as Normal
    expect(runPriorityOptions(undefined, 'x', true)[2]?.disabled).toBe(true);
  });

  it('C-6-3 / C-6-10 the request carries job_priorities for the changed runs only, and none without a change', () => {
    const doc = setJobPriority(createDocument({ environmentIds: ['e1'], name: 'x' }), 'e1:1:0', 'HIGH', 'NORMAL');
    const body = buildLaunchRequest(doc, new SecretStore(), { dryRun: true, jobs }, null);
    expect(body.job_priorities).toEqual([{ environment_id: 'e1', combo_index: 1, dataset_index: 0, priority: 'HIGH' }]);
    expect(buildLaunchRequest(createDocument({ environmentIds: ['e1'], name: 'x' }), new SecretStore(), { dryRun: true, jobs }, null)).not.toHaveProperty('job_priorities');
  });
});
