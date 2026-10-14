import { describe, expect, it } from 'vitest';
import { inlineFacets } from '../filterBarModel';

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
    expect(inlineFacets(900, ALL)).toEqual(['tasks', 'datasets', 'models', 'statuses', 'owners']);
    expect(inlineFacets(700, ALL)).toEqual(['tasks', 'models', 'statuses']);
  });
  it('never goes below Status, Model, Task and treats an unmeasured bar as wide', () => {
    expect(inlineFacets(200, ALL)).toEqual(['tasks', 'models', 'statuses']);
    expect(inlineFacets(0, ALL)).toHaveLength(6);
  });
});
