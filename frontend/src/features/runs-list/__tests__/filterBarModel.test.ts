import { describe, expect, it } from 'vitest';
import { inlineFacets, triggerWidth } from '../filterBarModel';

const ALL = ['tasks', 'datasets', 'models', 'versions', 'statuses', 'owners', 'v.agent'];

describe('inlineFacets', () => {
  it('keeps every facet inline on a wide bar, versioning keys always overflow', () => {
    expect(inlineFacets(1200, ALL)).toEqual([
      'tasks',
      'datasets',
      'models',
      'versions',
      'statuses',
      'owners',
    ]);
  });
  it('drops the lowest priority first (Version, User, Dataset) in display order', () => {
    // 6 x 104 + More 124 + Clear 96 = 844
    expect(inlineFacets(800, ALL)).toEqual(['tasks', 'datasets', 'models', 'statuses', 'owners']);
    expect(inlineFacets(560, ALL)).toEqual(['tasks', 'models', 'statuses']);
  });
  it('keeps room for More filters and Clear only when they show', () => {
    const facets = ALL.filter((id) => !id.startsWith('v.'));
    expect(inlineFacets(640, facets, undefined, false)).toHaveLength(6); // 624
    expect(inlineFacets(640, facets, undefined, true)).toHaveLength(4); // + Clear: overflow needs More too (636)
    expect(inlineFacets(760, ALL, undefined, false)).toHaveLength(6); // 624 + More 124
  });
  it('sizes a trigger by its text: a long value takes room from the lowest priority facet', () => {
    const facets = ALL.filter((id) => !id.startsWith('v.'));
    const text = (id: string) =>
      id === 'statuses' ? 'Status · Completed' : id === 'tasks' ? 'Task · summarize' : 'X';
    expect(triggerWidth('Model')).toBe(96);
    expect(triggerWidth('Status · Completed')).toBe(137);
    expect(triggerWidth('x'.repeat(60))).toBe(168);
    expect(inlineFacets(761, facets, text, true)).toEqual(['tasks', 'datasets', 'models', 'statuses']);
  });
  it('never goes below Status, Model, Task and treats an unmeasured bar as wide', () => {
    expect(inlineFacets(200, ALL)).toEqual(['tasks', 'models', 'statuses']);
    expect(inlineFacets(0, ALL)).toHaveLength(6);
  });
});
