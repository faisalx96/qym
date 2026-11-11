import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/http';
import { projectKey, useReviewRules } from '../projects';
import type { Project } from '../types';

vi.mock('@/lib/http', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { patch: vi.fn(), get: vi.fn() },
}));

describe('useReviewRules (C010)', () => {
  it('puts the saved rules into the cached project, so the form compares against them', async () => {
    const qc = new QueryClient();
    const project = {
      id: 'p1',
      slug: 'demo',
      correction_approvers: 'members',
      correction_require_different_reviewer: false,
    } as Project;
    qc.setQueryData(projectKey('demo'), project);
    vi.mocked(api.patch).mockResolvedValue({
      project_id: 'p1',
      correction_approvers: 'managers',
      correction_require_different_reviewer: true,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useReviewRules(project), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        correction_approvers: 'managers',
        correction_require_different_reviewer: true,
      });
    });
    await waitFor(() =>
      expect(qc.getQueryData<Project>(projectKey('demo'))).toMatchObject({
        correction_approvers: 'managers',
        correction_require_different_reviewer: true,
      }),
    );
  });
});
