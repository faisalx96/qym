import { describe, expect, it } from 'vitest';
import {
  addMetaFilter,
  canAddMetaFilter,
  isValidMetaPath,
  MAX_META_FILTERS,
  metaChipLabel,
  metaFiltersToObject,
  parseMetaFilter,
  parseMetaFilters,
  removeMetaFilter,
  serializeMetaFilter,
} from '../metaFilter';
import { parseDatasetRoute } from '../route';

describe('metadata path rules (A3-45)', () => {
  it.each(['domain', 'source.channel', 'source.region.code', 'a-b_c.d9'])('accepts %s', (p) =>
    expect(isValidMetaPath(p)).toBe(true),
  );
  it.each(['', 'a.b.c.d', '.a', 'a..b', 'a b', 'a$', 'a/b'])('rejects "%s"', (p) =>
    expect(isValidMetaPath(p)).toBe(false),
  );
});

describe('URL round trip (A3-9)', () => {
  it('splits on the first colon only', () => {
    expect(parseMetaFilter('note:a:b')).toEqual({ path: 'note', value: 'a:b' });
    expect(parseMetaFilter('novalue')).toBeNull();
    expect(parseMetaFilter('bad path:x')).toBeNull();
    expect(parseMetaFilter('flag:')).toEqual({ path: 'flag', value: '' });
  });
  it('serialises what it parses', () => {
    const f = { path: 'source.region.code', value: 'sa' };
    expect(parseMetaFilter(serializeMetaFilter(f))).toEqual(f);
  });
  it('reads repeated meta params from the route', () => {
    const route = parseDatasetRoute(
      'qa',
      new URLSearchParams('meta=domain:finance&meta=difficulty:2&state=disabled'),
    );
    expect(route.meta).toEqual(['domain:finance', 'difficulty:2']);
    expect(route.state).toBe('disabled');
    expect(parseDatasetRoute('qa', new URLSearchParams('state=bogus')).state).toBe('active');
  });
  it('keeps one filter per path and drops invalid ones', () => {
    expect(parseMetaFilters(['a:1', 'a:2', 'bad', 'b:3'])).toEqual([
      { path: 'a', value: '2' },
      { path: 'b', value: '3' },
    ]);
  });
});

describe('filter list rules (A3-10)', () => {
  it('replaces a filter on the same path', () => {
    const next = addMetaFilter([{ path: 'a', value: '1' }], { path: 'a', value: '2' });
    expect(next).toEqual([{ path: 'a', value: '2' }]);
  });
  it('caps the list at five', () => {
    let list = [] as ReturnType<typeof parseMetaFilters>;
    for (let n = 0; n < 7; n += 1) list = addMetaFilter(list, { path: `k${n}`, value: 'v' });
    expect(list).toHaveLength(MAX_META_FILTERS);
    expect(canAddMetaFilter(list)).toBe(false);
    // Replacing on a full list still works.
    expect(addMetaFilter(list, { path: 'k0', value: 'x' })).toHaveLength(MAX_META_FILTERS);
  });
  it('removes only the named filter and builds chip text and the batch object', () => {
    const list = parseMetaFilters(['domain:finance', 'source.region.code:sa']);
    expect(removeMetaFilter(list, list[0]!)).toEqual([list[1]]);
    expect(metaChipLabel(list[1]!)).toBe('source.region.code: sa');
    expect(metaFiltersToObject(list)).toEqual({ domain: 'finance', 'source.region.code': 'sa' });
  });
});
