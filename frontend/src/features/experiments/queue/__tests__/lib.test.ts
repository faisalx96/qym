import { describe, expect, it } from 'vitest';
import type { QueueJob } from '@/api/evalQueue';
import {
  elapsedSeconds,
  formatElapsed,
  jobSections,
  outcomeSummary,
  remoteSections,
  runProgress,
  splitJobs,
} from '../lib';

function job(over: Partial<QueueJob>): QueueJob {
  return {
    id: 'j',
    experiment_id: 'x',
    experiment_name: 'exp',
    environment_id: 'e',
    environment_name: 'staging',
    combo_index: 0,
    attempt: 0,
    run_name: null,
    params: {},
    priority: 'NORMAL',
    latency_sensitive: false,
    status: 'QUEUED',
    wait_reason: null,
    admitted_at: null,
    deferrals: 0,
    deferral_reason: null,
    contaminated_attempts: 0,
    error: null,
    queue_position: 1,
    created_by_user_id: null,
    created_by_email: null,
    created_at: '2026-01-01T00:00:00Z',
    next_attempt_at: null,
    submitted_at: null,
    cancel_requested_at: null,
    remote_job_id: null,
    remote_status: null,
    can_cancel: true,
    run: null,
    ...over,
  };
}

describe('splitJobs', () => {
  it('puts queued/blocked here, submitted/running remote, and uncancellable ones aside', () => {
    const split = splitJobs([
      job({ id: 'a', status: 'QUEUED' }),
      job({ id: 'b', status: 'BLOCKED' }),
      job({ id: 'c', status: 'RUNNING' }),
      job({ id: 'd', status: 'SUBMITTED' }),
      job({ id: 'e', status: 'QUEUED', can_cancel: false }),
      job({ id: 'f', status: 'CANCELLING' }),
    ]);
    expect(split.here.map((j) => j.id)).toEqual(['a', 'b']);
    expect(split.remote.map((j) => j.id)).toEqual(['c', 'd']);
    expect(split.skipped.map((j) => j.id)).toEqual(['e', 'f']);
  });
  it('omits empty sections and labels jobs', () => {
    const sections = jobSections(splitJobs([job({ combo_index: 3 })]));
    expect(sections.map((s) => s.key)).toEqual(['here']);
    expect(sections[0]?.items).toEqual(['exp #3 on staging']);
  });
});

describe('remoteSections', () => {
  it('separates orphans from stale jobs', () => {
    const items = [
      {
        remote_job_id: 'r1',
        status: 'RUNNING',
        priority: null,
        user_id: null,
        created_at: null,
        run_name: null,
        orphan: true,
        stale: false,
        match: null,
      },
      {
        remote_job_id: 'r2',
        status: 'RUNNING',
        priority: null,
        user_id: null,
        created_at: null,
        run_name: null,
        orphan: false,
        stale: true,
        match: { job_id: 'j', experiment_id: 'x', experiment_name: 'E', status: 'FAILED' },
      },
    ];
    const s = remoteSections(items, ['r1', 'r2']);
    expect(s.map((x) => x.key)).toEqual(['orphans', 'stale']);
    expect(s[1]?.items[0]).toBe('r2 (E, Failed)');
  });
});

describe('summaries', () => {
  it('summarises outcomes', () => {
    expect(outcomeSummary({ cancelled: 2, cancelling: 1 })).toBe('2 cancelled, 1 stopping on the service');
    expect(outcomeSummary({})).toBe('Nothing to cancel');
  });
  it('elapsed is blank while waiting and formatted after', () => {
    const now = new Date('2026-01-01T00:02:05Z').getTime();
    expect(elapsedSeconds(job({ status: 'QUEUED' }), now)).toBeNull();
    expect(elapsedSeconds(job({ status: 'RUNNING', submitted_at: '2026-01-01T00:00:00Z' }), now)).toBe(125);
    expect(formatElapsed(125)).toBe('2m 05s');
    expect(formatElapsed(null)).toBe('—');
  });
  it('progress is null without a total', () => {
    expect(runProgress(job({}))).toBeNull();
    const run = {
      id: 'r',
      status: 'RUNNING',
      status_reason: null,
      started_at: null,
      last_event_at: null,
      items_done: 5,
      items_total: 10,
      deleted: false,
    };
    expect(runProgress(job({ run }))).toBe(0.5);
  });
});
