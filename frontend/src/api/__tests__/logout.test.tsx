import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLogout } from '../me';

vi.mock('@/lib/http', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { post: vi.fn(() => Promise.resolve({})), get: vi.fn() },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

afterEach(() => vi.unstubAllGlobals());

describe('sign-out', () => {
  it("clears this tab's kept selection, saved filters and caches before leaving for /login", async () => {
    sessionStorage.setItem(
      'qym:runs-selection:pa',
      JSON.stringify({ selected: ['run-001'], cohortA: [], passRevisions: {} }),
    );
    sessionStorage.setItem('qym:dashboard-state:pa', '{"models":["m-b"]}');
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(String(assign.mock.calls[0]![0])).toContain('/login?next=');
  });
});
