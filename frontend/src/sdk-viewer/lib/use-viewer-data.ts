import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Row, RunInfo, Snapshot } from '../types';
import {
  detectSource,
  fetchFile,
  fetchRun,
  fetchSnapshot,
  postScore,
  type ApiFailure,
  type Source,
} from './source';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface ViewerData {
  source: Source;
  /** true until the first successful load */
  loading: boolean;
  error: ApiFailure | null;
  run: RunInfo;
  snapshot: Snapshot | null;
  /** live only: the stream state; files are always 'closed' */
  connection: Connection;
  /** the run reached a terminal state (live: done event or status != RUNNING; file: always) */
  finished: boolean;
  reload: () => void;
  /** file mode: save a corrected metric score, replacing the row in memory */
  saveScore: (rowIndex: number, metric: string, score: string) => Promise<void>;
}

const EMPTY_RUN: RunInfo = {};

function normalise(snap: Partial<Snapshot> | null | undefined): Snapshot | null {
  if (!snap || !Array.isArray(snap.rows)) return null;
  return {
    rows: snap.rows,
    stats: snap.stats ?? {
      total: snap.rows.length,
      completed: 0,
      in_progress: 0,
      failed: 0,
      pending: 0,
      success_rate: 0,
    },
    metric_names: snap.metric_names ?? [],
    last_updated: snap.last_updated,
  };
}

/** Owns every request of the viewer: first load, the SSE stream (live) or the file read (file). */
export function useViewerData(pathname: string = window.location.pathname): ViewerData {
  const source = useMemo<Source>(() => detectSource(pathname), [pathname]);
  const [state, setState] = useState<{
    loading: boolean;
    error: ApiFailure | null;
    run: RunInfo;
    snapshot: Snapshot | null;
    connection: Connection;
    finished: boolean;
  }>({
    loading: true,
    error: null,
    run: EMPTY_RUN,
    snapshot: null,
    connection: 'connecting',
    finished: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let stream: EventSource | null = null;
    let cancelled = false;
    let runLoaded = false;
    const patch = (next: Partial<typeof state>) => !cancelled && setState((s) => ({ ...s, ...next }));
    if (source.mode === 'file') {
      fetchFile(source.filePath, abort.signal)
        .then((data) =>
          patch({
            loading: false,
            run: data.run,
            snapshot: normalise(data.snapshot),
            connection: 'closed',
            finished: true,
          }),
        )
        .catch((err) => err.name !== 'AbortError' && patch({ loading: false, error: err as ApiFailure }));
      return () => {
        cancelled = true;
        abort.abort();
      };
    }

    const finish = async () => {
      stream?.close();
      try {
        const [run, snap] = await Promise.all([fetchRun(abort.signal), fetchSnapshot(abort.signal)]);
        patch({ run, snapshot: normalise(snap) ?? undefined, connection: 'closed', finished: true });
      } catch {
        patch({ connection: 'closed', finished: true });
      }
    };

    (async () => {
      try {
        const [run, snap] = await Promise.all([fetchRun(abort.signal), fetchSnapshot(abort.signal)]);
        if (cancelled) return;
        const snapshot = normalise(snap);
        runLoaded = !!run.dataset_name;
        patch({ loading: false, run, snapshot, finished: !!run.status && run.status !== 'RUNNING' });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') patch({ loading: false, error: err as ApiFailure });
        return;
      }
      if (cancelled) return;
      stream = new EventSource('api/rows/stream');
      stream.addEventListener('open', () => patch({ connection: 'live' }));
      stream.addEventListener('snapshot', (ev) => {
        try {
          const snapshot = normalise(JSON.parse((ev as MessageEvent).data));
          if (!snapshot) return;
          // The run block is registered before the first snapshot; refetch once if we raced it.
          setState((s) => ({ ...s, snapshot, connection: 'live', error: null }));
          if (!runLoaded) {
            fetchRun(abort.signal)
              .then((run) => {
                runLoaded = !!run.dataset_name;
                patch({ run });
              })
              .catch(() => undefined);
          }
        } catch {
          /* malformed event: keep the last good snapshot */
        }
      });
      stream.addEventListener('done', () => void finish());
      stream.addEventListener('error', () => {
        // EventSource retries by itself; surface it unless the server closed for good.
        if (stream?.readyState === EventSource.CLOSED) patch({ connection: 'closed' });
        else patch({ connection: 'reconnecting' });
      });
    })();

    return () => {
      cancelled = true;
      abort.abort();
      stream?.close();
    };
  }, [source, attempt]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: s.snapshot === null, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const saveScore = useCallback(
    async (rowIndex: number, metric: string, score: string) => {
      if (source.mode !== 'file') throw new Error('Scores can only be edited in a saved results file');
      const row: Row = await postScore({
        file_path: source.filePath,
        metric_name: metric,
        row_index: rowIndex,
        new_score: score,
      });
      setState((s) =>
        s.snapshot
          ? {
              ...s,
              snapshot: { ...s.snapshot, rows: s.snapshot.rows.map((r) => (r.index === rowIndex ? row : r)) },
            }
          : s,
      );
    },
    [source],
  );

  return { source, ...state, reload, saveScore };
}
