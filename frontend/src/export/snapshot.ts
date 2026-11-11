/**
 * C173: the read-only run page file. "Export HTML" on the run page writes the React Query cache of that run (the
 * same queries the page reads) into the built export page (`export.html`, every script and style inlined), and the
 * file renders the run page from it with the network refused. These helpers are shared by both sides.
 */
import type { DehydratedState, QueryKey } from '@tanstack/react-query';
import type { Me, Project } from '@/api/types';

/** The comment the export build keeps in export.html; the exporter puts the snapshot in its place. */
export const SNAPSHOT_MARKER = '<!--__QYM_RUN_SNAPSHOT__-->';
export const SNAPSHOT_ID = 'qym-run-snapshot';

export interface RunSnapshot {
  version: 1;
  /** ISO time of the export. */
  exportedAt: string;
  runId: string;
  slug: string;
  project: Project;
  me: Me;
  /** The page's URL inside the app (path, search and hash), so the view opens as it was exported. */
  path: string;
  state: DehydratedState;
}

/** The project overview with no filters: the run page reads only its model colour index from it (useModelIndex). */
function isModelIndexQuery(key: QueryKey, slug: string): boolean {
  return (
    key[0] === 'dashboard' &&
    key[1] === slug &&
    key[2] === 'overview' &&
    JSON.stringify(key[3]) === '{}' &&
    key[4] == null &&
    key[5] == null
  );
}

/**
 * The queries of one run page: the run's own queries, its project's category catalog, the model colour index and the
 * signed-in user. Other pages' data (the runs list, dashboards) stays out of the file.
 */
export function keepForSnapshot(key: QueryKey, runId: string, slug: string): boolean {
  const [head, id] = key;
  if (head === 'run') return id === runId;
  if (head === 'project') return id === slug && key[2] === 'category-catalog';
  if (isModelIndexQuery(key, slug)) return true;
  return head === 'me' && key.length === 1;
}

/** Keep only the model colour index of the project overview: the file holds no other project data. */
export function trimSnapshot(state: DehydratedState, slug: string): DehydratedState {
  return {
    ...state,
    queries: state.queries.map((query) => {
      if (!isModelIndexQuery(query.queryKey, slug)) return query;
      const data = query.state.data as { chart_data?: { modelIndex?: Record<string, number> } } | undefined;
      return {
        ...query,
        state: { ...query.state, data: { chart_data: { modelIndex: data?.chart_data?.modelIndex ?? {} } } },
      };
    }),
  };
}

/** Put the snapshot into the export page. `<` is escaped, so no text in the data can end the script element. */
export function injectSnapshot(template: string, snapshot: RunSnapshot): string {
  if (!template.includes(SNAPSHOT_MARKER)) throw new Error('The export page has no snapshot marker.');
  const json = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  const tag = `<script id="${SNAPSHOT_ID}" type="application/json">${json}</script>`;
  return template.replace(SNAPSHOT_MARKER, () => tag);
}

export function readSnapshot(doc: Document): RunSnapshot | null {
  const text = doc.getElementById(SNAPSHOT_ID)?.textContent;
  if (!text) return null;
  const data = JSON.parse(text) as RunSnapshot;
  return data && data.version === 1 ? data : null;
}

/**
 * Mark every query as just written, far in the future: a hook with a finite staleTime then never refetches (the file
 * has no server). The dates the page shows come from the data, not from these times.
 */
export function freshen(state: DehydratedState, now = Date.now()): DehydratedState {
  const future = now + 100 * 365 * 24 * 3600 * 1000;
  return {
    ...state,
    queries: state.queries.map((query) => ({
      ...query,
      state: { ...query.state, dataUpdatedAt: future, isInvalidated: false },
    })),
  };
}

/** The file name: the run name, with only the characters that are safe in a file name. */
export function snapshotFileName(runName: string): string {
  const base = runName.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'run';
  return `${base}.html`;
}
