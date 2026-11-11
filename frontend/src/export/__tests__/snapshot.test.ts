import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Me, Project } from '@/api/types';
import { buildRunExport } from '@/features/run-detail/lib/exportRun';
import {
  freshen,
  injectSnapshot,
  keepForSnapshot,
  readSnapshot,
  snapshotFileName,
  SNAPSHOT_MARKER,
  type RunSnapshot,
} from '../snapshot';

const TEMPLATE = `<!doctype html><html><body>${SNAPSHOT_MARKER}<div id="root"></div></body></html>`;

function snapshot(state: RunSnapshot['state']): RunSnapshot {
  return {
    version: 1,
    exportedAt: '2026-11-02T10:00:00.000Z',
    runId: 'r1',
    slug: 'p',
    project: { id: 'p1', slug: 'p', name: 'P' } as Project,
    me: { id: 'u1' } as Me,
    path: '/projects/p/runs/r1',
    state,
  };
}

describe('the run snapshot (C173)', () => {
  it('keeps only this run, its catalog, the model colours and the user', () => {
    expect(keepForSnapshot(['run', 'r1', 'compact'], 'r1', 'p')).toBe(true);
    expect(keepForSnapshot(['run', 'r2', 'compact'], 'r1', 'p')).toBe(false);
    expect(keepForSnapshot(['project', 'p', 'category-catalog'], 'r1', 'p')).toBe(true);
    expect(keepForSnapshot(['dashboard', 'p', 'overview', {}, null, null], 'r1', 'p')).toBe(true);
    expect(keepForSnapshot(['dashboard', 'p', 'overview', { tasks: ['t'] }, null, null], 'r1', 'p')).toBe(
      false,
    );
    expect(keepForSnapshot(['dashboard', 'p', 'runs', {}], 'r1', 'p')).toBe(false);
    expect(keepForSnapshot(['me'], 'r1', 'p')).toBe(true);
  });

  it('cannot end its script element, and reads back the same', () => {
    const state = { mutations: [], queries: [] };
    const data = snapshot(state);
    data.project.name = '</script><script>alert(1)</script>';
    const html = injectSnapshot(TEMPLATE, data);
    expect(html).not.toContain('</script><script>alert');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(readSnapshot(doc)?.project.name).toBe('</script><script>alert(1)</script>');
  });

  it('marks every query fresh, so no hook refetches in the file', () => {
    const query = {
      queryKey: ['me'],
      queryHash: '["me"]',
      state: { dataUpdatedAt: 1 },
    } as unknown as RunSnapshot['state']['queries'][number];
    const state = freshen({ mutations: [], queries: [query] }, 1000);
    expect(state.queries[0]?.state.dataUpdatedAt).toBeGreaterThan(1000 + 50 * 365 * 24 * 3600 * 1000);
  });

  it('names the file after the run', () => {
    expect(snapshotFileName('text2sql / run 7')).toBe('text2sql_run_7.html');
    expect(snapshotFileName('///')).toBe('run.html');
  });

  it('builds the file from the page cache and the export page', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['run', 'r1', 'compact'], {
      run: { run_id: 'r1' },
      snapshot: { rows: [], row_fields: ['text'] },
    });
    qc.setQueryData(['run', 'r2', 'compact'], { other: true });
    qc.setQueryData(['me'], { id: 'u1' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(TEMPLATE, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const html = await buildRunExport(qc, {
        runId: 'r1',
        slug: 'p',
        project: { id: 'p1', slug: 'p', name: 'P' } as Project,
        me: { id: 'u1' } as Me,
        runName: 'r1',
        path: '/projects/p/runs/r1',
      });
      const data = readSnapshot(new DOMParser().parseFromString(html, 'text/html'))!;
      expect(data.state.queries.map((q) => q.queryKey)).toEqual([['run', 'r1', 'compact'], ['me']]);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/export/run-template');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
