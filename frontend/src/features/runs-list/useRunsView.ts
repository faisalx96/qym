/** The runs view in the URL (replace, never push): parse, patch, debounce the search. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { normalizeSearch } from '@/lib/runs-order';
import { parseView, viewKeys, viewToParams, type RunsView } from './urlState';

export type ViewPatch = Partial<RunsView> | ((v: RunsView) => RunsView);

export function useRunsView() {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  const setView = useCallback(
    (patch: ViewPatch, keepPage = false) => {
      setParams(
        (prev) => {
          const cur = parseView(prev);
          const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
          if (!keepPage && !(typeof patch !== 'function' && 'page' in patch)) next.page = 1;
          const out = new URLSearchParams(prev);
          for (const key of viewKeys(prev)) out.delete(key);
          for (const [k, v] of viewToParams(next)) out.append(k, v);
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setPage = useCallback((page: number) => setView({ page }, true), [setView]);
  return { view, setView, setPage };
}

/** Local text with a 200 ms debounce into the URL; follows external URL changes (Clear, Esc, back). */
export function useDebouncedSearch(urlValue: string, commit: (q: string) => void, delay = 200) {
  const [text, setText] = useState(urlValue);
  const [seen, setSeen] = useState(urlValue);
  if (seen !== urlValue) {
    setSeen(urlValue);
    if (normalizeSearch(text) !== urlValue) setText(urlValue);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = useCallback(
    (value: string) => {
      setText(value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(normalizeSearch(value)), delay);
    },
    [commit, delay],
  );
  const flush = useCallback(
    (value: string) => {
      clearTimeout(timer.current);
      setText(value);
      commit(normalizeSearch(value));
    },
    [commit],
  );
  return { text, change, flush };
}
