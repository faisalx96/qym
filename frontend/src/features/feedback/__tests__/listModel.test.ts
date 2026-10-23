import { describe, expect, it } from 'vitest';
import { activeFilterCount, apiParams, isFiltered, metaLine, sortToState, viewFromParams } from '../listModel';

describe('list model', () => {
  it('round-trips the URL filters, with complexity and not size', () => {
    const view = viewFromParams(
      new URLSearchParams('status=new,accepted&about=product&project=support-agent&priority=high&complexity=M&mine=1&q=pdf&sort=priority:desc&page=2'),
    );
    expect(view).toMatchObject({
      status: ['new', 'accepted'],
      about: ['product'],
      project: ['support-agent'],
      priority: ['high'],
      complexity: ['M'],
      mine: true,
      q: 'pdf',
      sort: 'priority:desc',
      page: 2,
    });
    expect(apiParams(view)).toMatchObject({ complexity: 'M', project_id: 'support-agent', page_size: 50, mine: true });
    expect(Object.keys(apiParams(view))).not.toContain('size');
    expect(activeFilterCount(view)).toBe(6);
    expect(isFiltered(viewFromParams(new URLSearchParams('')))).toBe(false);
    expect(isFiltered(viewFromParams(new URLSearchParams('q=x')))).toBe(true);
  });

  it('defaults to newest first on page 1', () => {
    const v = viewFromParams(new URLSearchParams(''));
    expect(v).toMatchObject({ sort: 'created_at:desc', page: 1, mine: false });
    expect(sortToState('priority:asc')).toEqual({ key: 'priority', direction: 'asc' });
  });

  it('writes the meta line from the counts', () => {
    expect(metaLine({ all: 8, new: 2, duplicate_pairs: 1 })).toEqual(['8 requests', '2 new', '1 duplicate pair']);
    expect(metaLine({ all: 1, new: 0, duplicate_pairs: 0 })).toEqual(['1 request', '0 new']);
  });
});
