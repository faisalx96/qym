/**
 * Lazy row bodies for the compared runs (run_details.js ensureRows): requests
 * coalesce per tick, go out in batches of <=100 ids with <=3 in flight, per
 * *base* run (the passes of a repeat run share its rows). Full rows live in an
 * external store keyed by (base run, item_id); the compact compare payload is
 * never rebuilt when bodies arrive. Retained rows are capped like the legacy
 * page (200 per run) by releasing the oldest loaded ones.
 */
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Row } from '@/features/run-detail/types';
import { scopeRowToPass } from '@/features/run-detail/lib/passScope';
import { fetchItemDetails } from '@/api/runs';
import type { CompareRun } from '../lib/model';

export const MAX_DETAIL_ITEMS = 100;
export const MAX_IN_FLIGHT = 3;
export const MAX_RETAINED_PER_RUN = 200;

export type ItemState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'loaded' };

export class DetailsStore {
  private rows = new Map<string, Map<string, Row>>();
  private states = new Map<string, ItemState>();
  private version = 0;
  private listeners = new Set<() => void>();
  private queue: Array<{ base: string; id: string }> = [];
  private queued = new Set<string>();
  private inFlight = 0;
  private scheduled = false;
  private waiters = new Map<string, Array<() => void>>();
  private fetcher: typeof fetchItemDetails;

  constructor(fetcher: typeof fetchItemDetails = fetchItemDetails) {
    this.fetcher = fetcher;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  private emit() {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  private key(base: string, id: string) {
    return `${base}\u0000${id}`;
  }
  full(base: string, itemId: string): Row | undefined {
    return this.rows.get(base)?.get(itemId);
  }
  stateOf(base: string, itemId: string): ItemState | undefined {
    return this.states.get(this.key(base, itemId));
  }
  /** Put a full row (a mutation answered with it). */
  put(base: string, row: Row): void {
    const map = this.rows.get(base) ?? new Map<string, Row>();
    map.set(row.item_id, { ...row, __details_loaded: true });
    this.rows.set(base, map);
    this.states.set(this.key(base, row.item_id), { status: 'loaded' });
    this.emit();
  }
  loadedCount(base: string): number {
    return this.rows.get(base)?.size ?? 0;
  }

  ensure(pairs: Array<{ base: string; id: string }>): Promise<void> {
    const wanted = pairs.filter((p) => !this.full(p.base, p.id));
    if (!wanted.length) return Promise.resolve();
    const promises = wanted.map(
      (p) =>
        new Promise<void>((resolve) => {
          const k = this.key(p.base, p.id);
          const list = this.waiters.get(k) ?? [];
          list.push(resolve);
          this.waiters.set(k, list);
          if (!this.queued.has(k) && this.states.get(k)?.status !== 'loading') {
            this.queued.add(k);
            this.queue.push(p);
            this.states.set(k, { status: 'loading' });
          }
        }),
    );
    this.emit();
    this.schedule();
    return Promise.all(promises).then(() => undefined);
  }

  retry(base: string, id: string): Promise<void> {
    this.states.delete(this.key(base, id));
    return this.ensure([{ base, id }]);
  }

  /** Keep only `keep` (and the newest) rows of a run: collapsed items release their bodies. */
  release(base: string, keep: ReadonlySet<string>): void {
    const map = this.rows.get(base);
    if (!map || map.size <= MAX_RETAINED_PER_RUN) return;
    for (const id of Array.from(map.keys())) {
      if (map.size <= MAX_RETAINED_PER_RUN) break;
      if (!keep.has(id)) {
        map.delete(id);
        this.states.delete(this.key(base, id));
      }
    }
    this.emit();
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
      const first = this.queue[0]!;
      const batch: Array<{ base: string; id: string }> = [];
      const rest: Array<{ base: string; id: string }> = [];
      for (const p of this.queue) {
        if (p.base === first.base && batch.length < MAX_DETAIL_ITEMS) batch.push(p);
        else rest.push(p);
      }
      this.queue = rest;
      batch.forEach((p) => this.queued.delete(this.key(p.base, p.id)));
      this.inFlight += 1;
      this.fetcher(
        first.base,
        batch.map((p) => p.id),
      )
        .then((res) => {
          const map = this.rows.get(first.base) ?? new Map<string, Row>();
          const byId = new Map(res.rows.map((r) => [r.item_id, r]));
          batch.forEach((p) => {
            const row = byId.get(p.id);
            if (row) {
              map.set(p.id, { ...row, __details_loaded: true });
              this.states.set(this.key(p.base, p.id), { status: 'loaded' });
            } else this.states.set(this.key(p.base, p.id), { status: 'error', error: new Error('Item not found') });
          });
          this.rows.set(first.base, map);
        })
        .catch((error: unknown) => {
          batch.forEach((p) => this.states.set(this.key(p.base, p.id), { status: 'error', error }));
        })
        .finally(() => {
          this.inFlight -= 1;
          batch.forEach((p) => {
            const k = this.key(p.base, p.id);
            (this.waiters.get(k) ?? []).forEach((r) => r());
            this.waiters.delete(k);
          });
          this.emit();
          this.pump();
        });
    }
  }
}

const Ctx = createContext<DetailsStore | null>(null);

export function DetailsProvider({ store, children }: { store: DetailsStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useDetailsStore(): DetailsStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('DetailsProvider missing');
  return store;
}

export function useNewDetailsStore(): DetailsStore {
  const [store] = useState(() => new DetailsStore());
  return store;
}

/** Re-render when any body arrives. */
export function useDetailsVersion(): number {
  const store = useDetailsStore();
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** The row of one run on one item with bodies (a pass slice for a pass column), or the compact row. */
export function resolveRow(store: DetailsStore, run: CompareRun, itemId: string): { row: Row | null; loaded: boolean } {
  const compact = run.byItem.get(itemId) ?? null;
  if (!compact) return { row: null, loaded: false };
  const full = store.full(run.base, compact.item_id);
  if (!full) return { row: compact, loaded: compact.__details_loaded === true };
  const names = run.snapshot.metric_names ?? run.run.metric_names ?? [];
  const merged = { ...compact, ...full, compare_item_id: compact.compare_item_id, __details_loaded: true } as Row;
  return { row: run.pass ? scopeRowToPass(merged, names, run.pass) : merged, loaded: true };
}

export function useEnsureBodies(runs: CompareRun[]) {
  const store = useDetailsStore();
  return useCallback(
    (itemIds: string[]) => {
      const pairs: Array<{ base: string; id: string }> = [];
      const seen = new Set<string>();
      for (const run of runs) {
        for (const id of itemIds) {
          const row = run.byItem.get(id);
          if (!row) continue;
          const k = `${run.base}\u0000${row.item_id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          pairs.push({ base: run.base, id: row.item_id });
        }
      }
      return store.ensure(pairs);
    },
    [runs, store],
  );
}

export function useResolvedRows(runs: CompareRun[], itemId: string) {
  const store = useDetailsStore();
  const version = useDetailsVersion();
  return useMemo(
    () => runs.map((run) => resolveRow(store, run, itemId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, store, itemId, version],
  );
}
