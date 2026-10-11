/**
 * Search and the "Output text" rule go to POST /items/search per base run (one
 * request answers up to 32 conditions); compact rows carry only previews, so
 * bodies are never downloaded to search (brief 05 J6). Item ids and previews
 * are matched client-side while a request is in flight.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { encodeRunId } from '@/api/runs';
import type { ItemSearchPayload } from '@/features/run-detail/types';
import type { CompareModel } from '../lib/model';
import { isFilterGroup, localMatcher, rowText, type FilterNode, type ItemContext, type TextMatcher } from '../lib/filters';

export const MAX_SEARCH_CONDITIONS = 32;
const MAX_QUERY = 10_000;

export function collectOutputValues(node: FilterNode, out: string[] = []): string[] {
  if (isFilterGroup(node)) node.children.forEach((c) => collectOutputValues(c, out));
  else if (node.field === 'output' && typeof node.value === 'string' && node.value.trim()) out.push(node.value);
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

export interface CompareSearch {
  matcher: TextMatcher;
  pending: boolean;
}

export function useCompareSearch(model: CompareModel | null, q: string, rules: FilterNode): CompareSearch {
  const query = q.trim();
  const outputs = useDebounced(
    useMemo(() => Array.from(new Set(collectOutputValues(rules))).slice(0, MAX_SEARCH_CONDITIONS - 1), [rules]),
    150,
  );
  const lazy = !!model && model.runs.some((r) => r.snapshot.detail_mode === 'lazy');
  const enabled = !!model && lazy && query.length <= MAX_QUERY && (!!query || outputs.length > 0);
  const conditions = useMemo(() => {
    const list: Array<{ id: string; field: 'all' | 'output'; operator: 'contains'; value: string }> = [];
    if (query) list.push({ id: 'q', field: 'all', operator: 'contains', value: query });
    outputs.forEach((value) => list.push({ id: `o:${value}`, field: 'output', operator: 'contains', value }));
    return list;
  }, [query, outputs]);
  const bases = useMemo(
    () =>
      model
        ? Array.from(new Set(model.runs.map((r) => r.base))).map((base) => ({
            base,
            passes: model.runs.filter((r) => r.base === base && r.pass).map((r) => r.pass as number),
          }))
        : [],
    [model],
  );
  const sig = JSON.stringify(conditions);
  const results = useQueries({
    queries: bases.map(({ base, passes }) => ({
      queryKey: ['compare', 'search', base, sig, passes.join(',')] as const,
      queryFn: () =>
        api.post<ItemSearchPayload>(`/api/runs/${encodeRunId(base)}/items/search`, {
          conditions,
          ...(passes.length === 1 ? { pass_number: passes[0] } : passes.length > 1 ? { pass_numbers: passes } : {}),
        }),
      enabled,
      staleTime: 60_000,
      placeholderData: (prev: ItemSearchPayload | undefined) => prev,
    })),
  });
  const dataSig = results.map((r) => r.dataUpdatedAt).join(',');
  const pending = enabled && results.some((r) => r.isFetching);
  const matcher = useMemo<TextMatcher>(() => {
    if (!enabled || !model) return localMatcher;
    // base -> condition id -> matching item_ids (every pass pooled)
    const sets = new Map<string, Map<string, Set<string>>>();
    bases.forEach(({ base }, i) => {
      const data = results[i]?.data;
      if (!data) return;
      const byId = new Map<string, Set<string>>();
      const add = (id: string, ids: string[]) => {
        const s = byId.get(id) ?? new Set<string>();
        ids.forEach((x) => s.add(x));
        byId.set(id, s);
      };
      Object.entries(data.matches ?? {}).forEach(([id, ids]) => add(id, ids));
      Object.values(data.matches_by_pass ?? {}).forEach((m) => Object.entries(m).forEach(([id, ids]) => add(id, ids)));
      sets.set(base, byId);
    });
    const serverHit = (condId: string, c: ItemContext) =>
      model.runs.some((run) => {
        const row = run.byItem.get(c.itemId);
        return !!row && !!sets.get(run.base)?.get(condId)?.has(row.item_id);
      });
    const haveAll = (condId: string) => bases.every(({ base }) => sets.get(base)?.has(condId));
    return (field, needle, c) => {
      if (field === 'content') {
        if (c.itemId.toLowerCase().includes(needle.toLowerCase())) return true;
        if (haveAll('q')) return serverHit('q', c);
        return c.rows.some((r) => rowText(r).toLowerCase().includes(needle.toLowerCase()));
      }
      const id = `o:${needle}`;
      if (haveAll(id)) return serverHit(id, c);
      return localMatcher(field, needle, c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, model, bases, dataSig]);
  return { matcher, pending };
}
