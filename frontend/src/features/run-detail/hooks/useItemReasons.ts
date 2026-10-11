/**
 * Failure reasons for the displayed metric (brief 04 §3i): the compact row
 * usually carries enough; rows whose index form lacks the reason fields ask
 * the server in one batched POST /items/reasons per tick. One loader per
 * (run, metric, pass) lives outside React as an external store.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { fetchItemReasons } from '@/api/runs';
import { needsServerReason, pickReason, type PickedReason } from '../lib/itemReasons';
import type { Row } from '../types';

export type ServerReason = {
  reason?: string;
  error?: string;
  status?: string;
  explanation?: string;
  label?: string;
};

class ReasonsLoader {
  private reasons = new Map<string, ServerReason>();
  private asked = new Set<string>();
  private queue: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly runId: string,
    private readonly metric: string,
    private readonly pass: number | null,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): Map<string, ServerReason> => this.reasons;

  request(ids: string[]): void {
    let added = false;
    ids.forEach((id) => {
      if (this.asked.has(id)) return;
      this.asked.add(id);
      this.queue.push(id);
      added = true;
    });
    if (added && !this.timer) this.timer = setTimeout(() => this.flush(), 0);
  }

  private flush(): void {
    this.timer = null;
    const ids = this.queue.splice(0, 100);
    if (!ids.length) return;
    fetchItemReasons(this.runId, this.metric, ids, this.pass)
      .then((res) => {
        const next = new Map(this.reasons);
        Object.entries(res.reasons ?? {}).forEach(([id, value]) => next.set(id, value));
        ids.forEach((id) => {
          if (!next.has(id)) next.set(id, {});
        });
        this.reasons = next;
        this.listeners.forEach((l) => l());
      })
      .catch(() => {
        ids.forEach((id) => this.asked.delete(id));
      })
      .finally(() => {
        if (this.queue.length && !this.timer) this.timer = setTimeout(() => this.flush(), 0);
      });
  }
}

const loaders = new Map<string, ReasonsLoader>();
const EMPTY = new Map<string, ServerReason>();
const noop = () => () => {};
const empty = () => EMPTY;

export interface ReasonsApi {
  /** Server reasons fetched so far, by item id. */
  serverReasons: Map<string, ServerReason>;
  /** Ask for ids whose row-level pick needs the server. Safe to call per render. */
  request: (ids: string[]) => void;
}

export function useItemReasons(runId: string, metric: string | null, pass: number | null): ReasonsApi {
  const loader = useMemo(() => {
    if (!metric) return null;
    const key = `${runId}|${metric}|${pass ?? ''}`;
    let l = loaders.get(key);
    if (!l) {
      l = new ReasonsLoader(runId, metric, pass);
      loaders.set(key, l);
    }
    return l;
  }, [metric, pass, runId]);
  const serverReasons = useSyncExternalStore(
    loader ? loader.subscribe : noop,
    loader ? loader.snapshot : empty,
    loader ? loader.snapshot : empty,
  );
  const request = useCallback((ids: string[]) => loader?.request(ids), [loader]);
  return useMemo(() => ({ serverReasons, request }), [serverReasons, request]);
}

export interface ReasonInputs {
  row: Row;
  metric: string;
  scoreText: string | null;
  needText: string | null;
  metaKeys: string[];
  serverReason?: ServerReason;
}

/** The reason to show for one row, and whether the server should be asked. */
export function rowReason(input: ReasonInputs): { picked: PickedReason; askServer: boolean } {
  const { row, metric, serverReason } = input;
  const meta = row.metric_meta?.[metric] ?? null;
  const taskError = row.status === 'error' ? row.error || true : null;
  if (serverReason && Object.keys(serverReason).length) {
    return {
      picked: pickReason({
        taskError,
        meta: { ...(meta ?? {}), ...serverReason },
        score: input.scoreText,
        need: input.needText,
      }),
      askServer: false,
    };
  }
  const picked = pickReason({ taskError, meta, score: input.scoreText, need: input.needText });
  return { picked, askServer: !serverReason && needsServerReason(picked, input.metaKeys) };
}
