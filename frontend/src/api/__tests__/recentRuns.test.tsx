import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/http';
import { RECENT_PAGE_SIZE, useRecentRuns } from '../admin';

vi.mock('@/lib/http', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: vi.fn(() => Promise.resolve({ runs: [], total_count: 0 })) },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('Admin recent runs (C093)', () => {
  it('shows 25 runs a page', () => {
    expect(RECENT_PAGE_SIZE).toBe(25);
  });

  it('sends the run search and the Project filter', async () => {
    renderHook(() => useRecentRuns(2, RECENT_PAGE_SIZE, true, { q: ' nightly ', projectId: 'p-1' }), {
      wrapper,
    });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const url = String(vi.mocked(api.get).mock.calls.at(-1)![0]);
    expect(url).toContain('global_limit=25&global_offset=25');
    expect(url).toContain('q=nightly');
    expect(url).toContain('project_id=p-1');
  });
});
