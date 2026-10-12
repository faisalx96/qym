/**
 * View state lives in the query string (shell.js replaceUrlQuery convention):
 * `replaceUrlQuery({page: '2', q: null})` rewrites the current URL without a
 * history entry; `useSearchParamsState` is the hook form.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams, type NavigateOptions } from 'react-router-dom';

export type QueryUpdates = Record<string, string | number | boolean | string[] | null | undefined>;

export function applyQueryUpdates(params: URLSearchParams, updates: QueryUpdates): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '' || value === false) next.delete(key);
    else if (Array.isArray(value)) {
      next.delete(key);
      value.forEach((item) => next.append(key, item));
    } else next.set(key, String(value === true ? '1' : value));
  }
  return next;
}

export function useSearchParamsState() {
  const [params, setParams] = useSearchParams();
  const replaceUrlQuery = useCallback(
    (updates: QueryUpdates, opts: NavigateOptions = {}) => {
      setParams((prev) => applyQueryUpdates(prev, updates), { replace: true, ...opts });
    },
    [setParams],
  );
  const pushUrlQuery = useCallback(
    (updates: QueryUpdates) => setParams((prev) => applyQueryUpdates(prev, updates), { replace: false }),
    [setParams],
  );
  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  return useMemo(
    () => ({ params, get, replaceUrlQuery, pushUrlQuery }),
    [params, get, replaceUrlQuery, pushUrlQuery],
  );
}

/** One typed query param with a default; writes use replaceState. */
export function useQueryParam(key: string, fallback = ''): [string, (value: string | null) => void] {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (v: string | null) => replaceUrlQuery({ [key]: v === fallback ? null : v }),
    [key, fallback, replaceUrlQuery],
  );
  return [value, set];
}
