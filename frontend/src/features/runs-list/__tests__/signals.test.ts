import { describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { signalItems } from '../cells';

const row = (over: Partial<RunRow>) =>
  ({ run_id: 'r', status: 'COMPLETED', samples: 1, metrics: ['accuracy'], ...over }) as RunRow;

describe('runs-list signals keep task errors, metric errors and retries apart', () => {
  it('metric errors only', () => {
    const items = signalItems(row({ task_error_count: 0, metric_error_count: 2, execution_error_count: 1 }));
    expect(items.map((i) => [i.key, i.count, i.tone])).toEqual([['metric', 2, 'metric']]);
    expect(items[0]!.text).toBe('2 metric errors across all items');
  });
  it('task errors and retries, each with its own tone', () => {
    const items = signalItems(
      row({ task_error_count: 3, metric_error_count: 0, execution_error_count: 3, total_retries: 4 }),
    );
    expect(items.map((i) => [i.key, i.count, i.tone])).toEqual([
      ['task', 3, 'error'],
      ['retry', 4, 'info'],
    ]);
    expect(items[1]!.text).toBe('4 total retries across all items');
  });
  it('an old publication never presents the combined count as task failures: it says the breakdown is updating', () => {
    const [item] = signalItems(row({ execution_error_count: 5 }));
    expect(item!.key).toBe('task');
    expect(item!.text).toContain('(breakdown is updating)');
  });
  it('a repeat run says the counts span all passes', () => {
    const [item] = signalItems(row({ samples: 2, task_error_count: 1, metric_error_count: 0 }));
    expect(item!.text).toBe('1 task error across all passes');
  });
  it('a live run shows no retries yet', () => {
    expect(
      signalItems(row({ status: 'RUNNING', task_error_count: 0, metric_error_count: 0, total_retries: 2 })),
    ).toEqual([]);
  });
  it('an ingest flag adds a warning whose reason is plain text', () => {
    const reason = 'item_completed for item <img src=x onerror=alert(1)>';
    const items = signalItems(
      row({
        ingest_incomplete: { missing_items: 0, rejected_events: 1, reason },
      } as unknown as Partial<RunRow>),
    );
    const ingest = items.find((i) => i.key === 'ingest')!;
    expect(ingest.text).toBe(`Incomplete data. ${reason}`);
    expect(ingest.tone).toBe('warning');
  });
});
