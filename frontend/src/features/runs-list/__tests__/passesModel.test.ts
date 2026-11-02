import { beforeEach, describe, expect, it } from 'vitest';
import type { RunPass } from '@/api/dashboardTypes';
import {
  issuesSummaryText,
  passIssues,
  passRowsView,
  readStoredMetric,
  writeStoredMetric,
} from '../passes/model';

const pass = (n: number, status: string) => ({ pass_number: n, status }) as unknown as RunPass;

describe('passRowsView', () => {
  it('lists started passes and folds the waiting ones into one line', () => {
    const { rows } = passRowsView([pass(1, 'completed'), pass(2, 'running')], 5, 'RUNNING');
    expect(rows.filter((r) => r.kind === 'pass')).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({ kind: 'queued', first: 3, last: 5, count: 3, notRun: false });
  });
  it('says "not run" once the run ended without them', () => {
    const { rows } = passRowsView([pass(1, 'completed')], 3, 'FAILED');
    expect(rows.at(-1)).toMatchObject({ kind: 'queued', notRun: true });
  });
});

describe('passIssues', () => {
  it('is empty for a clean pass', () => {
    expect(passIssues({} as never)).toEqual([]);
    expect(issuesSummaryText([])).toBe('');
  });
  it('orders task errors, metric errors and retries and keeps the tooltip wording', () => {
    const issues = passIssues({ task_error_count: 1, metric_error_count: 2, retry_count: 3 } as never);
    expect(issues.map((i) => i.kind)).toEqual(['task', 'metric', 'retry']);
    expect(issues.map((i) => i.tone)).toEqual(['danger', 'warning', 'info']);
    expect(issuesSummaryText(issues)).toBe('1 task error, 2 metric errors, 3 retries');
  });
});

describe('remembered metric', () => {
  beforeEach(() => sessionStorage.clear());
  it('round-trips per project', () => {
    expect(readStoredMetric('a')).toBeNull();
    writeStoredMetric('a', 'accuracy');
    expect(readStoredMetric('a')).toBe('accuracy');
    expect(readStoredMetric('b')).toBeNull();
  });
});
