/**
 * Failure reasons for the displayed metric (brief 04 §3i): the compact row
 * usually carries enough; rows whose index form lacks the reason fields ask
 * the server in one batched POST /items/reasons per tick.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface ReasonsApi {
  /** Server reasons fetched so far, by item id. */
  serverReasons: Map<string, ServerReason>;
  /** Ask for ids whose row-level pick needs the server. Safe to call per render. */
  request: (ids: string[]) => void;
}

export function useItemReasons(runId: string, metric: string | null, pass: number | null): ReasonsApi {
  const [serverReasons, setServerReasons] = useState<Map<string, ServerReason>>(() => new Map());
  const asked = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${metric ?? ''}|${pass ?? ''}`;
  const keyRef = useRef(key);
  const [trackedKey, setTrackedKey] = useState(key);
  if (trackedKey !== key) {
    // Metric or pass changed: forget what was asked for the previous one.
    setTrackedKey(key);
    setServerReasons(new Map());
  }

  const flush = useCallback(() => {
    timer.current = null;
    if (keyRef.current !== key) {
      keyRef.current = key;
      asked.current = new Set();
      queue.current = [];
      return;
    }
    const ids = queue.current.splice(0, 100);
    if (!ids.length || !metric) return;
    const askedKey = key;
    fetchItemReasons(runId, metric, ids, pass)
      .then((res) => {
        if (keyRef.current !== askedKey) return;
        setServerReasons((prev) => {
          const next = new Map(prev);
          Object.entries(res.reasons ?? {}).forEach(([id, value]) => next.set(id, value));
          ids.forEach((id) => {
            if (!next.has(id)) next.set(id, {});
          });
          return next;
        });
      })
      .catch(() => {
        ids.forEach((id) => asked.current.delete(id));
      })
      .finally(() => {
        if (queue.current.length && !timer.current) timer.current = setTimeout(() => flushRef.current(), 0);
      });
  }, [key, metric, pass, runId]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const request = useCallback(
    (ids: string[]) => {
      if (keyRef.current !== key) {
        keyRef.current = key;
        asked.current = new Set();
        queue.current = [];
      }
      let added = false;
      ids.forEach((id) => {
        if (asked.current.has(id)) return;
        asked.current.add(id);
        queue.current.push(id);
        added = true;
      });
      if (added && !timer.current) timer.current = setTimeout(() => flushRef.current(), 0);
    },
    [key],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
  if (serverReason && Object.keys(serverReason).length) {
    return {
      picked: pickReason({
        taskError: row.status === 'error' ? row.error || true : null,
        meta: { ...(meta ?? {}), ...serverReason },
        score: input.scoreText,
        need: input.needText,
      }),
      askServer: false,
    };
  }
  const picked = pickReason({
    taskError: row.status === 'error' ? row.error || true : null,
    meta,
    score: input.scoreText,
    need: input.needText,
  });
  return { picked, askServer: !serverReason && needsServerReason(picked, input.metaKeys) };
}
