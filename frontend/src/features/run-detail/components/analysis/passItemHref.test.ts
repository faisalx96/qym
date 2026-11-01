/** C127: the 'Pass N' links of a repeat item keep the page's filters and set only the pass and the item. */
import { describe, expect, it } from 'vitest';
import { passItemHref } from './MetricAnalysisCards';

describe('passItemHref', () => {
  it('keeps show, metric, threshold and q, and sets pass and item', () => {
    const search = new URLSearchParams(
      'show=failed&metric=relevance&threshold=0.7&q=refund&item=item-3&page=4',
    );
    const href = passItemHref('/projects/p/runs/r1', search, 2, 'item-3');
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/projects/p/runs/r1');
    expect(url.searchParams.get('show')).toBe('failed');
    expect(url.searchParams.get('metric')).toBe('relevance');
    expect(url.searchParams.get('threshold')).toBe('0.7');
    expect(url.searchParams.get('q')).toBe('refund');
    expect(url.searchParams.get('pass')).toBe('2');
    expect(url.searchParams.get('item')).toBe('item-3');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('drops an open trace so the new pass does not open a stale one', () => {
    const href = passItemHref('/r', new URLSearchParams('trace=item-3&trace_pass=5'), 1, 'item-3');
    expect(href).toBe('/r?pass=1&item=item-3');
  });
});
