import { describe, expect, it } from 'vitest';
import {
  addMetaFilter,
  API_DEFAULT_MODE,
  canAddMetaFilter,
  DEFAULT_MODE,
  isValidMetaPath,
  MAX_META_FILTERS,
  MAX_META_VALUES,
  metaChipLabel,
  metaFiltersToObject,
  metaFiltersToParams,
  metaModesToParams,
  orderByFacet,
  parseMetaFilters,
  parseMetaModePair,
  parseMetaPair,
  removeMetaFilter,
  type MetaFilter,
} from '../metaFilter';
import { parseDatasetRoute } from '../route';

const one = (path: string, value: string): MetaFilter => ({ path, values: [value], mode: DEFAULT_MODE });

describe('metadata path rules (A3-45)', () => {
  it.each(['domain', 'source.channel', 'source.region.code', 'a-b_c.d9'])('accepts %s', (p) =>
    expect(isValidMetaPath(p)).toBe(true),
  );
  it.each(['', 'a.b.c.d', '.a', 'a..b', 'a b', 'a$', 'a/b'])('rejects "%s"', (p) =>
    expect(isValidMetaPath(p)).toBe(false),
  );
});

describe('URL round trip (A3-9, QA1-22)', () => {
  it('splits on the first colon only', () => {
    expect(parseMetaPair('note:a:b')).toEqual({ path: 'note', value: 'a:b' });
    expect(parseMetaPair('novalue')).toBeNull();
    expect(parseMetaPair('bad path:x')).toBeNull();
    expect(parseMetaPair('flag:')).toEqual({ path: 'flag', value: '' });
  });
  it('parses the mode pair and refuses other modes', () => {
    expect(parseMetaModePair('tags:any')).toEqual({ path: 'tags', mode: 'any' });
    expect(parseMetaModePair('tags:all')).toEqual({ path: 'tags', mode: 'all' });
    expect(parseMetaModePair('tags:some')).toBeNull();
    expect(parseMetaModePair('tags')).toBeNull();
    expect(parseMetaModePair('a..b:any')).toBeNull();
  });
  it('reads repeated meta and meta_mode params from the route', () => {
    const route = parseDatasetRoute(
      'qa',
      new URLSearchParams('meta=domain:finance&meta=tags:a&meta=tags:b&meta_mode=tags:any&state=disabled'),
    );
    expect(route.meta).toEqual(['domain:finance', 'tags:a', 'tags:b']);
    expect(route.metaMode).toEqual(['tags:any']);
    expect(route.state).toBe('disabled');
    expect(parseDatasetRoute('qa', new URLSearchParams('state=bogus')).state).toBe('active');
  });
  it('merges the values of one path and applies its mode', () => {
    expect(parseMetaFilters(['tags:billing', 'tags:refund', 'domain:finance'], ['tags:any'])).toEqual([
      { path: 'tags', values: ['billing', 'refund'], mode: 'any' },
      { path: 'domain', values: ['finance'], mode: API_DEFAULT_MODE },
    ]);
  });
  it('drops invalid pairs, duplicates, a mode without meta and values past twenty', () => {
    expect(parseMetaFilters(['bad', 'a:1', 'a:1', 'b:2'], ['zzz:any', 'b:nope'])).toEqual([
      { path: 'a', values: ['1'], mode: 'all' },
      { path: 'b', values: ['2'], mode: 'all' },
    ]);
    const many = Array.from({ length: 25 }, (_, n) => `t:v${n}`);
    expect(parseMetaFilters(many)[0]!.values).toHaveLength(MAX_META_VALUES);
  });
  it('a bad mode on several values means all (the API default)', () => {
    expect(parseMetaFilters(['t:a', 't:b'], ['t:sometimes'])[0]!.mode).toBe('all');
  });
  it('writes meta per value and one meta_mode only for two or more values', () => {
    const list: MetaFilter[] = [
      { path: 'tags', values: ['billing', 'refund'], mode: 'any' },
      one('domain', 'finance'),
    ];
    expect(metaFiltersToParams(list)).toEqual(['tags:billing', 'tags:refund', 'domain:finance']);
    expect(metaModesToParams(list)).toEqual(['tags:any']);
    expect(parseMetaFilters(metaFiltersToParams(list), metaModesToParams(list))).toEqual(
      list.map((f) => (f.values.length < 2 ? { ...f, mode: 'all' } : f)),
    );
  });
});

describe('chip text (QA1-19)', () => {
  it('scalar and single value have no suffix', () => {
    expect(metaChipLabel(one('domain', 'finance'))).toBe('domain: finance');
  });
  it('several values list in order with the mode', () => {
    expect(metaChipLabel({ path: 'tags', values: ['billing', 'refund'], mode: 'all' })).toBe(
      'tags: billing, refund (all)',
    );
    expect(metaChipLabel({ path: 'channels', values: ['chat', 'phone'], mode: 'any' })).toBe(
      'channels: chat, phone (any)',
    );
  });
});

describe('filter list rules (A3-10, QA1-24)', () => {
  it('replaces a filter on the same path', () => {
    expect(addMetaFilter([one('a', '1')], one('a', '2'))).toEqual([one('a', '2')]);
  });
  it('caps the list at five paths, not values', () => {
    let list: MetaFilter[] = [];
    for (let n = 0; n < 7; n += 1) list = addMetaFilter(list, one(`k${n}`, 'v'));
    expect(list).toHaveLength(MAX_META_FILTERS);
    expect(canAddMetaFilter(list)).toBe(false);
    expect(addMetaFilter(list, one('k0', 'x'))).toHaveLength(MAX_META_FILTERS);
    const wide = addMetaFilter([], {
      path: 'tags',
      values: Array.from({ length: 20 }, (_, n) => `v${n}`),
      mode: 'any',
    });
    expect(canAddMetaFilter(wide)).toBe(true);
  });
  it('removes a path and builds the batch object (QA1-54)', () => {
    const list: MetaFilter[] = [one('domain', 'finance'), { path: 'tags', values: ['a', 'b'], mode: 'all' }];
    expect(removeMetaFilter(list, { path: 'domain' })).toEqual([list[1]]);
    expect(metaFiltersToObject(list)).toEqual({
      domain: 'finance',
      tags: { values: ['a', 'b'], mode: 'all' },
    });
  });
  it('orders chosen values the way the facet list shows them', () => {
    const facet = [{ value: 'billing' }, { value: 'refund' }, { value: 'account' }];
    expect(orderByFacet(['account', 'refund', 'billing'], facet)).toEqual(['billing', 'refund', 'account']);
    expect(orderByFacet(['typed', 'billing'], facet)).toEqual(['billing', 'typed']);
  });
});
