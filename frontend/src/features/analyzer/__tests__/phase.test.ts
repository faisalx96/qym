import { describe, expect, it } from 'vitest';
import type { AnalysisJob } from '@/api/analysis';
import { analyzedKeysOf, touchesTargetFilter } from '../model/targets';
import { mappingSummary, defaultSettings } from '../model/settings';
import { derivePhase } from '../useAnalysisPhase';

const job = (status: string, extra: Partial<AnalysisJob['progress']> = {}): AnalysisJob =>
  ({
    job_id: 'j',
    status,
    progress: { phase: 'analyzing', completed: 3, total: 10, errors: 0, retries: 0, ...extra },
    result: null,
  }) as unknown as AnalysisJob;

const base = { starting: false, cancelling: false, reconnecting: false, testing: false };

describe('derivePhase', () => {
  it('idle, testing and starting without a job', () => {
    expect(derivePhase({ ...base, job: null }).phase).toBe('idle');
    expect(derivePhase({ ...base, job: null, testing: true }).phase).toBe('testing');
    const s = derivePhase({ ...base, job: null, starting: true });
    expect(s.phase).toBe('starting');
    expect(s.live).toBe(true);
  });
  it('running with progress, retry note and reconnecting', () => {
    const v = derivePhase({
      ...base,
      reconnecting: true,
      job: job('running', { phase: 'retrying', item_id: 'item-2', metric_name: 'm', retry_reason: 'slow' }),
    });
    expect(v).toMatchObject({ phase: 'running', live: true, completed: 3, total: 10, pct: 30, reconnecting: true });
    expect(v.retryNote).toBe('Retrying m on item-2: slow');
  });
  it('cancelling, then terminal states', () => {
    expect(derivePhase({ ...base, cancelling: true, job: job('running') }).phase).toBe('cancelling');
    expect(derivePhase({ ...base, job: job('cancelling') }).phase).toBe('cancelling');
    for (const [status, phase] of [
      ['completed', 'done'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
    ] as const) {
      const v = derivePhase({ ...base, reconnecting: true, job: job(status) });
      expect(v.phase).toBe(phase);
      expect(v.live).toBe(false);
      expect(v.finished).toBe(true);
      expect(v.reconnecting).toBe(false);
    }
  });
});

describe('target freeze helpers', () => {
  it('collects analysed keys without errors', () => {
    const keys = analyzedKeysOf([
      { item_id: 'a', metric_name: 'm' },
      { item_id: 'b', metric_name: 'm', error: 'boom' },
      { item_id: '', metric_name: 'm' },
    ]);
    expect([...keys]).toEqual(['a\u0000m']);
    expect(analyzedKeysOf(undefined).size).toBe(0);
  });
  it('only filter settings release the frozen list', () => {
    expect(touchesTargetFilter({ maxScorePct: 50 })).toBe(true);
    expect(touchesTargetFilter({ skipAnalyzed: false })).toBe(true);
    expect(touchesTargetFilter({ instructions: 'x', limit: 3 })).toBe(false);
  });
});

describe('mappingSummary', () => {
  const s = defaultSettings({ metrics: ['m'], maxIssues: 3, timeoutSeconds: 120 });
  it('default, custom fields and variables', () => {
    expect(mappingSummary(s, 0)).toBe('Default fields');
    expect(mappingSummary(s, 2)).toBe('2 variables');
    expect(mappingSummary({ ...s, includeScores: false }, 1)).toBe('Custom fields · 1 variable');
  });
});
