import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSource } from '../source';
import { useViewerData } from '../use-viewer-data';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  readyState = 1;
  handlers: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: unknown) => void) {
    (this.handlers[name] ??= []).push(fn);
  }
  emit(name: string, data?: unknown) {
    this.handlers[name]?.forEach((fn) => fn({ data: data === undefined ? undefined : JSON.stringify(data) }));
  }
  close() {
    this.readyState = 2;
  }
}

const snap = (completed: number) => ({
  rows: [],
  stats: { total: 2, completed, in_progress: 0, failed: 0, pending: 2 - completed, success_rate: 0 },
  metric_names: ['m'],
});

function mockFetch(routes: Record<string, () => { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { status = 200, body } = (routes[url] ?? (() => ({ status: 404, body: {} })))();
      return { ok: status < 400, status, statusText: 'x', json: async () => body } as Response;
    }),
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('detectSource', () => {
  it('reads the saved file path from /run/<encoded>', () => {
    expect(detectSource('/')).toEqual({ mode: 'live' });
    expect(detectSource(`/run/${encodeURIComponent('/tmp/a b/run.csv')}`)).toEqual({
      mode: 'file',
      filePath: '/tmp/a b/run.csv',
    });
  });
});

describe('useViewerData (live)', () => {
  it('loads, follows snapshot events and freezes on done', async () => {
    let status = 'RUNNING';
    mockFetch({
      'api/run': () => ({ body: { dataset_name: 'ds', status } }),
      'api/snapshot': () => ({ body: snap(0) }),
    });
    const { result } = renderHook(() => useViewerData('/'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.finished).toBe(false);
    const es = FakeEventSource.instances[0] as FakeEventSource;
    act(() => es.emit('open'));
    act(() => es.emit('snapshot', snap(1)));
    expect(result.current.snapshot?.stats.completed).toBe(1);
    expect(result.current.connection).toBe('live');
    act(() => es.emit('error'));
    expect(result.current.connection).toBe('reconnecting');
    status = 'COMPLETED';
    act(() => es.emit('done'));
    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(result.current.run.status).toBe('COMPLETED');
    expect(result.current.connection).toBe('closed');
  });

  it('shows an unreachable server as an error, not an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { result } = renderHook(() => useViewerData('/'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/Could not reach/);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe('useViewerData (file)', () => {
  const url = `api/runs/${encodeURIComponent('/tmp/r.csv')}`;
  it('loads a saved file and replaces a row after a score edit', async () => {
    const row = { index: 0, metric_values: ['1'] };
    mockFetch({
      [url]: () => ({
        body: {
          run: { file_path: '/tmp/r.csv' },
          snapshot: { ...snap(1), rows: [{ index: 0, metric_values: ['0'] }] },
        },
      }),
      'api/runs/update_metric': () => ({ body: { ok: true, row } }),
    });
    const { result } = renderHook(() => useViewerData(`/run/${encodeURIComponent('/tmp/r.csv')}`));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.finished).toBe(true);
    await act(() => result.current.saveScore(0, 'm', '1'));
    expect(result.current.snapshot?.rows[0]?.metric_values).toEqual(['1']);
  });

  it('surfaces the server message for a missing file', async () => {
    mockFetch({ [url]: () => ({ status: 404, body: { error: 'File not found: /tmp/r.csv' } }) });
    const { result } = renderHook(() => useViewerData(`/run/${encodeURIComponent('/tmp/r.csv')}`));
    await waitFor(() => expect(result.current.error?.status).toBe(404));
    expect(result.current.error?.message).toBe('File not found: /tmp/r.csv');
  });
});
