import type { RunFile, RunInfo, Snapshot } from '../types';

/** Where the data comes from: the live evaluation (`/`) or a saved file (`/run/<encoded path>`). */
export type Source = { mode: 'live' } | { mode: 'file'; filePath: string };

export function detectSource(pathname: string): Source {
  const m = /\/run\/(.+)$/.exec(pathname);
  if (!m) return { mode: 'live' };
  let filePath = m[1] ?? '';
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    /* keep the raw segment */
  }
  return { mode: 'file', filePath };
}

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
  }
}

/** Relative URLs on purpose: the page's <base href="/"> and the dev proxy both resolve them. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiFailure('Could not reach the qym server. Is the evaluation still running?', 0, url);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = (body as { error?: string } | null)?.error;
    throw new ApiFailure(detail || `${res.status} ${res.statusText}`, res.status, url);
  }
  return body as T;
}

export const fetchRun = (signal?: AbortSignal) => getJson<RunInfo>('api/run', signal);
export const fetchSnapshot = (signal?: AbortSignal) => getJson<Partial<Snapshot>>('api/snapshot', signal);
export const fetchFile = (filePath: string, signal?: AbortSignal) =>
  getJson<RunFile>(`api/runs/${encodeURIComponent(filePath)}`, signal);

export async function postScore(body: {
  file_path: string;
  metric_name: string;
  row_index: number;
  new_score: string;
}): Promise<RunFile['snapshot']['rows'][number]> {
  const res = await fetch('api/runs/update_metric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    row?: RunFile['snapshot']['rows'][number];
  };
  if (!res.ok || !data.row)
    throw new ApiFailure(
      data.error || `${res.status} ${res.statusText}`,
      res.status,
      'api/runs/update_metric',
    );
  return data.row;
}
