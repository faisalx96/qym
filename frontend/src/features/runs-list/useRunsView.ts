/** The runs view in the URL (replace, never push): parse, patch, debounce the search. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { normalizeSearch } from '@/lib/runs-order';
import { DEFAULT_VIEW, parseView, viewKeys, viewToParams, type RunsView } from './urlState';

export type ViewPatch = Partial<RunsView> | ((v: RunsView) => RunsView);

/** The project's current filters (sort and page left out), shared by the Runs and Models pages for this tab. */
const sharedKey = (slug: string) => `qym:runs-filters:${slug}`;

function readShared(slug: string): string {
  try {
    return sessionStorage.getItem(sharedKey(slug)) ?? '';
  } catch {
    return '';
  }
}

function writeShared(slug: string, value: string) {
  try {
    if (value) sessionStorage.setItem(sharedKey(slug), value);
    else sessionStorage.removeItem(sharedKey(slug));
  } catch {
    // storage unavailable: filters just are not shared
  }
}

/**
 * `adopt`: a page opened without any filter in its URL (the Models page) starts from the filters last
 * set on any runs view of this project and tab, so "filter the runs, then look at the models" works.
 */
export function useRunsView({ adopt = false }: { adopt?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const { slug = '' } = useParams();
  const view = useMemo(() => parseView(params), [params]);
  const adopted = useRef(false);
  const shared = useMemo(() => {
    const clean = { ...view, sort: DEFAULT_VIEW.sort, page: 1 };
    return viewToParams(clean).toString();
  }, [view]);
  useEffect(() => {
    if (!slug) return;
    if (adopt && !adopted.current) {
      adopted.current = true;
      const stored = readShared(slug);
      if (!shared && stored) {
        setParams(
          (prev) => {
            const out = new URLSearchParams(prev);
            for (const [k, v] of new URLSearchParams(stored)) out.append(k, v);
            return out;
          },
          { replace: true },
        );
        return;
      }
    }
    writeShared(slug, shared);
  }, [slug, shared, adopt, setParams]);
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
