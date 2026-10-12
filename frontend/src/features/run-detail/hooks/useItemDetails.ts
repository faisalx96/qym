/**
 * Lazy row bodies (run_details.js ensureRows): requests coalesce per tick,
 * go out in batches of ≤100 ids with ≤3 in flight, and land in the compact
 * query cache by item_id (loaded rows keep `__details_loaded`). Per-id
 * loading/error state is exposed for the card to render.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchItemDetails, runKeys } from '@/api/runs';
import type { Row, RunPayload } from '../types';

export const MAX_DETAIL_ITEMS = 100;
export const MAX_IN_FLIGHT = 3;

type ItemState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'loaded' };

class DetailsLoader {
  private states = new Map<string, ItemState>();
  private listeners = new Set<() => void>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private inFlight = 0;
  private scheduled = false;
  private waiters = new Map<string, Array<() => void>>();

  constructor(
    private readonly qc: QueryClient,
    private readonly runId: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  getState = (id: string): ItemState | undefined => this.states.get(id);

  snapshot = (): Map<string, ItemState> => this.states;

  private loaded(id: string): boolean {
    const payload = this.qc.getQueryData<RunPayload>(runKeys.compact(this.runId));
    const row = payload?.snapshot.rows.find((r) => r.item_id === id);
    return !!row && (row.__details_loaded === true || payload?.snapshot.detail_mode !== 'lazy');
  }

  /** Resolve once every id is loaded (or failed). */
  ensure(ids: string[]): Promise<void> {
    const wanted = ids.filter((id) => !this.loaded(id));
    if (!wanted.length) return Promise.resolve();
    const promises = wanted.map(
      (id) =>
        new Promise<void>((resolve) => {
          const list = this.waiters.get(id) ?? [];
          list.push(resolve);
          this.waiters.set(id, list);
          const current = this.states.get(id);
          if (!this.queued.has(id) && current?.status !== 'loading') {
            this.queued.add(id);
            this.queue.push(id);
            this.states.set(id, { status: 'loading' });
          }
        }),
    );
    this.states = new Map(this.states);
    this.emit();
    this.schedule();
    return Promise.all(promises).then(() => undefined);
  }

  retry(id: string): Promise<void> {
    this.states.delete(id);
    return this.ensure([id]);
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump() {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const batch = this.queue.splice(0, MAX_DETAIL_ITEMS);
      batch.forEach((id) => this.queued.delete(id));
      this.inFlight++;
      fetchItemDetails(this.runId, batch)
        .then((res) => {
          const byId = new Map(res.rows.map((r) => [r.item_id, r]));
          this.qc.setQueryData<RunPayload>(runKeys.compact(this.runId), (prev) => {
            if (!prev) return prev;
            const rows = prev.snapshot.rows.map((row) => {
              const full = byId.get(row.item_id);
              return full ? ({ ...row, ...full, __details_loaded: true } as Row) : row;
            });
            return { ...prev, snapshot: { ...prev.snapshot, rows } };
          });
          const next = new Map(this.states);
          batch.forEach((id) => {
            if (byId.has(id)) next.set(id, { status: 'loaded' });
            else next.set(id, { status: 'error', error: new Error('Item not found') });
          });
          this.states = next;
        })
        .catch((error: unknown) => {
          const next = new Map(this.states);
          batch.forEach((id) => next.set(id, { status: 'error', error }));
          this.states = next;
        })
        .finally(() => {
          this.inFlight--;
          batch.forEach((id) => {
            (this.waiters.get(id) ?? []).forEach((resolve) => resolve());
            this.waiters.delete(id);
          });
          this.emit();
          this.pump();
        });
    }
  }
}

const loaders = new Map<string, DetailsLoader>();

function loaderFor(qc: QueryClient, runId: string): DetailsLoader {
  const key = runId;
  let loader = loaders.get(key);
  if (!loader) {
    loader = new DetailsLoader(qc, runId);
    loaders.set(key, loader);
  }
  return loader;
}

export interface ItemDetailsApi {
  ensure: (ids: string[]) => Promise<void>;
  retry: (id: string) => Promise<void>;
  stateOf: (id: string) => ItemState | undefined;
}

export function useItemDetails(runId: string): ItemDetailsApi {
  const qc = useQueryClient();
  const loader = useMemo(() => loaderFor(qc, runId), [qc, runId]);
  const states = useSyncExternalStore(loader.subscribe, loader.snapshot, loader.snapshot);
  const ensure = useCallback((ids: string[]) => loader.ensure(ids), [loader]);
  const retry = useCallback((id: string) => loader.retry(id), [loader]);
  const stateOf = useCallback((id: string) => states.get(id), [states]);
  return useMemo(() => ({ ensure, retry, stateOf }), [ensure, retry, stateOf]);
}

/** Rows whose bodies are present (compact snapshots ship previews only). */
export function rowHasBodies(row: Row, detailMode: string | undefined): boolean {
  return row.__details_loaded === true || detailMode !== 'lazy';
}
