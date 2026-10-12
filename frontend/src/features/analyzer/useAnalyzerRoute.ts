import { useCallback, useMemo } from 'react';
import { useSearchParamsState } from '@/lib/url-state';

export type AnalyzerScope = 'run' | 'categories' | 'rules' | 'documents';
export const SCOPES: AnalyzerScope[] = ['run', 'categories', 'rules', 'documents'];

/** `diagnosis` -> categories, `project` -> rules, `dashboard` (kill-switched) / unknown -> run. */
export function parseScope(raw: string | null | undefined): AnalyzerScope {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'diagnosis') return 'categories';
  if (value === 'project') return 'rules';
  return (SCOPES as string[]).includes(value) ? (value as AnalyzerScope) : 'run';
}

export function parsePass(raw: string | null | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** URL state of the workspace: `run`, `pass`, `metric`, `scope` (names are a backend contract). */
export function useAnalyzerRoute() {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const runId = params.get('run') ?? '';
  const pass = parsePass(params.get('pass'));
  const metric = params.get('metric') ?? '';
  const scope = parseScope(params.get('scope'));
  const setScope = useCallback(
    (next: AnalyzerScope) => replaceUrlQuery({ scope: next === 'run' ? null : next }),
    [replaceUrlQuery],
  );
  const setPass = useCallback((next: number | null) => replaceUrlQuery({ pass: next }), [replaceUrlQuery]);
  return useMemo(
    () => ({ runId, pass, metric, scope, setScope, setPass }),
    [runId, pass, metric, scope, setScope, setPass],
  );
}
