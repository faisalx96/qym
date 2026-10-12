import { describe, expect, it } from 'vitest';
import { breakdownDeltaGood, sweepMetadataKeys, type SweepItem } from '../cohort';

describe('sweep breakdown delta direction (C097)', () => {
  it('flips the sign of Avg@k for a minimize metric only', () => {
    expect(breakdownDeltaGood('avgAtK', -0.1, 'minimize')).toBeGreaterThan(0);
    expect(breakdownDeltaGood('avgAtK', -0.1, 'maximize')).toBeLessThan(0);
    expect(breakdownDeltaGood('passAtK', -0.1, 'minimize')).toBeLessThan(0);
  });
});

describe('sweep metadata keys (C096)', () => {
  it('never offers internal analysis keys', () => {
    const items = [{ metadata: { domain: 'a', metric_analyses: { q: {} }, analysis_error: 'x', retry_count: 1 } }, { metadata: { domain: 'b' } }] as unknown as SweepItem[];
    expect(sweepMetadataKeys(items)).toEqual(['domain']);
  });
});

describe('root-cause summary carries solutions (C055)', () => {
  it('counts the solutions recorded on each category', async () => {
    const { rootCauseSummary } = await import('../breakdown');
    const issue = (solution: string) => ({ issue_id: solution, category: 'Retrieval', subcategory: 'miss', finding: 'f', category_reason: 'r', solution });
    const row = (...issues: ReturnType<typeof issue>[]) => ({ item_id: 'i1', status: 'completed', metric_values: [0], item_metadata: { metric_analyses: { q: { root_cause_issues: issues } } } });
    const model = { runs: [{ byItem: new Map([['i1', row(issue('add reranker'), issue('add reranker'), issue('')) ]]) }] } as never;
    const [cat] = rootCauseSummary(model, [{ key: 'r', base: 'r', runIdxs: [0], pass: null, label: 'r', title: 'r' }], new Set(['i1']), 'all');
    expect(cat!.solutions).toEqual([['add reranker', 2]]);
  });
});

describe('csv item metadata (C096)', () => {
  it('skips metric_analyses', async () => {
    const { SKIPPED_METADATA } = await import('../skipMetadata');
    expect(SKIPPED_METADATA.has('metric_analyses')).toBe(true);
  });
});
