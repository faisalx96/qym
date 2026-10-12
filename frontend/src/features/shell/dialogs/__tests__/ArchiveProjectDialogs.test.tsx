import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { ToastProvider } from '@/ui';
import type { Project } from '@/api/types';

vi.mock('@/api/projects', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchArchivePreview: vi.fn(() => Promise.reject(new ApiError(500, 'boom'))),
  fetchUnarchivePreview: vi.fn(() => Promise.reject(new ApiError(500, 'boom'))),
}));

import { ArchiveProjectDialog, UnarchiveProjectDialog } from '../ArchiveProjectDialogs';

const project = { id: 'p1', name: 'Demo', slug: 'demo', is_active: true } as Project;

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('archive previews', () => {
  it('a failed archive preview shows a warning and keeps Archive available', async () => {
    wrap(<ArchiveProjectDialog project={project} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Could not check for running runs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive anyway' })).toBeEnabled();
  });

  it('a failed unarchive preview shows a warning and keeps both actions', async () => {
    wrap(<UnarchiveProjectDialog project={project} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/Could not check for active API keys/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive anyway' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Revoke keys first' })).toBeInTheDocument();
  });
});
