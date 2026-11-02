/**
 * Search and the "Output text" rule use POST /items/search for lazy snapshots
 * (one request answers up to 32 conditions); otherwise the loaded strings are
 * searched client-side (brief 04 J7). 250 ms debounce is applied to `q` by the
 * caller (SearchField); rule values are debounced here.
 */
import { useEffect, useMemo, useState } from 'react';
import { useItemSearchQuery } from '@/api/runs';
import type { ItemSearchCondition, Row } from '../types';
import { isFilterGroup, type FilterNode } from '../lib/filterRules';
import type { RunModel } from '../lib/runModel';
import { stringify } from '../lib/rowErrors';

export const MAX_SEARCH_CONDITIONS = 32;
const MAX_SERVER_QUERY = 10_000;

export function collectOutputValues(node: FilterNode, out: string[] = []): string[] {
  if (isFilterGroup(node)) node.children.forEach((c) => collectOutputValues(c, out));
  else if (node.field === 'output' && typeof node.value === 'string' && node.value.trim())
    out.push(node.value);
  return out;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface ItemSearch {
  searchMatcher?: (row: Row) => boolean;
  outputMatcher?: (value: string, row: Row) => boolean;
  pending: boolean;
}

export function useItemSearch(
  runId: string,
  model: RunModel,
  q: string,
  rules: FilterNode,
  lazy: boolean,
): ItemSearch {
  const outputs = useDebounced(
    useMemo(
      () => Array.from(new Set(collectOutputValues(rules))).slice(0, MAX_SEARCH_CONDITIONS - 1),
      [rules],
    ),
    150,
  );
  const query = q.trim();
  const server = lazy && query.length <= MAX_SERVER_QUERY;
  const conditions = useMemo<ItemSearchCondition[]>(() => {
    if (!server) return [];
    const list: ItemSearchCondition[] = [];
    if (query) list.push({ id: 'q', field: 'all', operator: 'contains', value: query });
    outputs.forEach((value) => list.push({ id: 'o:' + value, field: 'output', operator: 'contains', value }));
    return list;
  }, [outputs, query, server]);
  const passNumbers = useMemo(
    () =>
      model.viewPass
        ? [model.viewPass]
        : model.isRepeat
          ? Array.from({ length: model.samples }, (_, i) => i + 1)
          : [],
    [model.isRepeat, model.samples, model.viewPass],
  );
  const result = useItemSearchQuery(runId, conditions, passNumbers, server);
  const sets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const data = result.data;
    if (!data) return map;
    const add = (id: string, ids: string[]) => {
      const set = map.get(id) ?? new Set<string>();
      ids.forEach((x) => set.add(x));
      map.set(id, set);
    };
    Object.entries(data.matches ?? {}).forEach(([id, ids]) => add(id, ids));
    Object.values(data.matches_by_pass ?? {}).forEach((byId) =>
      Object.entries(byId).forEach(([id, ids]) => add(id, ids)),
    );
    return map;
  }, [result.data]);

  return useMemo(() => {
    const preview = (row: Row, needle: string) =>
      [
        row.item_id,
        row.input_full ?? row.input ?? row.input_preview,
        row.expected_full ?? row.expected,
        row.output_full ?? row.output ?? row.output_digest,
      ]
        .map((v) => stringify(v).toLowerCase())
        .some((t) => t.includes(needle.toLowerCase()));
    const searchMatcher = query
      ? server && sets.has('q')
        ? (row: Row) => sets.get('q')!.has(row.item_id)
        : server && result.isPlaceholderData === false && result.data
          ? (row: Row) => sets.get('q')?.has(row.item_id) ?? false
          : (row: Row) => preview(row, query)
      : undefined;
    const outputMatcher = (value: string, row: Row) => {
      const set = sets.get('o:' + value);
      if (server && set) return set.has(row.item_id);
      return stringify(row.output_full ?? row.output ?? row.output_digest ?? '')
        .toLowerCase()
        .includes(value.toLowerCase());
    };
    return { searchMatcher, outputMatcher, pending: server && result.isFetching };
  }, [query, result.data, result.isFetching, result.isPlaceholderData, server, sets]);
}
