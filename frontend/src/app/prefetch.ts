/**
 * Warm-up of the run page (perf round 6). The page's data does not wait for its code: a pointer or keyboard
 * intent on a run link, a deep link and an idle list all start the work that the click would start later.
 */
import { useMemo, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { prefetchRun } from '@/api/runs';
import { once } from '@/lib/once';

/** The run page's route chunk; the router's lazy page and every prefetch share this one import. */
export const loadRunDetailPage = once(() => import('@/features/run-detail/RunDetailPage'));

const INTENT_DELAY_MS = 80;

/** Pointer or focus intent (debounced) and pointer down (at once) start the run's summary, its rows and the page chunk. */
export function useRunIntent(runId: string) {
  const qc = useQueryClient();
  const timer = useRef<number>(0);
  return useMemo(() => {
    const go = () => {
      window.clearTimeout(timer.current);
      prefetchRun(qc, runId);
      void loadRunDetailPage();
    };
    const arm = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(go, INTENT_DELAY_MS);
    };
    const cancel = () => window.clearTimeout(timer.current);
    return { onPointerEnter: arm, onFocus: arm, onPointerLeave: cancel, onBlur: cancel, onPointerDown: go };
  }, [qc, runId]);
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** Idle prefetch costs bytes: skipped when the reader asked to save data or the connection is 2g or 3g. */
function connectionAllowsPrefetch(): boolean {
  const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return !(c?.saveData || (c?.effectiveType && /^(slow-)?[23]g$/.test(c.effectiveType)));
}

let idleRequested = false;
/** After the runs list is idle, fetch the run page's chunk (only the chunk, no data). */
export function prefetchRunChunkWhenIdle(): void {
  if (idleRequested || typeof window === 'undefined' || !connectionAllowsPrefetch()) return;
  idleRequested = true;
  const run = () => void loadRunDetailPage();
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 });
  else globalThis.setTimeout(run, 1200);
}

let boundClient: QueryClient | null = null;
/** The app's query client, for the route loader below (routes are module-level, the client is created by App). */
export function bindPrefetchClient(qc: QueryClient): void {
  boundClient = qc;
}

/** Route loader of the run page: starts the rows and the summary the moment the navigation starts (link, key, deep link). */
export function runRouteLoader({ params }: { params: { '*'?: string } }): null {
  const runId = (params['*'] ?? '').replace(/\/analyzer$/, '');
  if (boundClient && runId) prefetchRun(boundClient, runId);
  void loadRunDetailPage();
  return null;
}
