/** C130: a published version's empty Runs tab offers a run when the project can launch, else the SDK line. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type * as DatasetsApi from '@/api/datasets';
import type { DatasetVersion } from '@/api/datasets';
import { ToastProvider } from '@/ui';
import { RunsTab } from '../RunsTab';

vi.mock('@/api/datasets', async (importOriginal) => {
  const actual = await importOriginal<typeof DatasetsApi>();
  return {
    ...actual,
    useDatasetRuns: () => ({
      data: { runs: [], total: 0, metric_names: [] },
      isPending: false,
      isError: false,
      refetch: () => undefined,
    }),
  };
});

const version = { id: 'v-2', version: 'v2', status: 'published' } as DatasetVersion;

function mount(canLaunch: boolean, v: DatasetVersion = version) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <RunsTab slug="proj" datasetRef="faq" datasetName="FAQ set" version={v} canLaunch={canLaunch} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('RunsTab empty state (C130)', () => {
  it('offers Run experiment on v2 with the dataset and version in the launch link', () => {
    mount(true);
    const link = screen.getByRole('link', { name: 'Run experiment on v2' });
    expect(link.getAttribute('href')).toBe('/projects/proj/experiments/new?dataset=FAQ+set&version=v2');
  });

  it('keeps a copyable SDK line with the project slug without an environment, or on a draft', () => {
    mount(false);
    expect(screen.queryByRole('link', { name: /Run experiment/ })).not.toBeInTheDocument();
    expect(screen.getByText(/with an API key of project proj/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the SDK line' })).toBeInTheDocument();
  });

  it('does not offer a run on a draft version', () => {
    mount(true, { ...version, status: 'draft' } as DatasetVersion);
    expect(screen.queryByRole('link', { name: /Run experiment/ })).not.toBeInTheDocument();
  });
});
