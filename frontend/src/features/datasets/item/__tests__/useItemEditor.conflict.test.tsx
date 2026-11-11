import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasetItem } from '@/api/datasets';
import { useItemEditor } from '../useItemEditor';

afterEach(() => vi.unstubAllGlobals());

const item = {
  item_id: 'ar-007',
  input: 'q',
  expected_output: 'old',
  metadata: {},
  updated_at: '2026-11-01T10:00:00.000001Z',
} as unknown as DatasetItem;
const theirs = { ...item, expected_output: 'theirs', updated_at: '2026-11-01T10:05:00.000002Z' };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('useItemEditor save conflict (C015)', () => {
  it('sends the loaded updated_at, keeps the edits on a 409, and Keep mine saves over theirs', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return bodies.length === 1
          ? respond(409, {
              detail: {
                code: 'item_changed',
                message: 'Someone else saved this item after you opened it.',
                item: theirs,
                changed_by: { id: 'u2', email: 'b@x.com', display_name: 'Bea' },
                changed_at: theirs.updated_at,
              },
            })
          : respond(200, { item: { ...theirs, expected_output: 'mine', updated_at: 'later' } });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useItemEditor('p', 'faq', 'v3', item), { wrapper });
    act(() => result.current.set('expected', { mode: 'text', text: 'mine' }));
    let saved: unknown;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toBeNull();
    expect(bodies[0]).toEqual({ expected_output: 'mine', expected_updated_at: item.updated_at });
    expect(result.current.conflict).toMatchObject({
      by: { display_name: 'Bea' },
      mine: { expected_output: 'mine' },
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      saved = await result.current.keepMine();
    });
    expect(bodies[1]).toEqual({ expected_output: 'mine', expected_updated_at: theirs.updated_at });
    expect(result.current.conflict).toBeNull();
  });
});
