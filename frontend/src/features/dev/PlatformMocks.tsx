/** Composed platform pages using the production components and frozen fictional read responses. */
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { NewRunPage } from '@/features/performance/NewRunPage';
import { TargetsPage } from '@/features/performance/TargetsPage';
import { PerformanceHomePage } from '@/features/performance/PerformanceHomePage';
import { PlatformRun } from '@/features/performance/components/platform/PlatformRun';
import {
  platformFixtureRead,
  platformRunRead,
  platformLogPage,
  type PlatformFixtureState,
} from '@/features/performance/platform-fixtures';
import { RealPageShell } from './PerformanceHomeMocks';

const project: ProjectValue = {
  project: {
    id: 'platform-demo',
    name: 'QA - Performance',
    slug: 'demo',
    is_active: true,
    member_count: 3,
    run_count: 31,
    role: 'MANAGER',
    created_at: '2026-11-25T15:00:00Z',
    updated_at: '2026-11-25T15:00:00Z',
    correction_approvers: 'members',
    correction_require_different_reviewer: true,
  },
  slug: 'demo',
  readOnly: false,
  archived: false,
  viewer: false,
  canManage: true,
  isAdmin: false,
};
function fixtureClient(state: PlatformFixtureState): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'added') return;
    const query = event.query;
    const rawKey = query.queryKey;
    const key = rawKey[5] === 'platform' ? [...rawKey.slice(0, 5), ...rawKey.slice(6)] : rawKey;
    const scope = String(key[3] ?? '');
    const sub =
      scope === 'mixed-home'
        ? ''
        : scope === 'mixed-setup'
          ? '/setup'
          : scope === 'mixed-targets'
            ? '/targets'
            : scope === 'mixed-runs'
              ? '/runs'
              : scope === 'mixed-run' || scope === 'run'
                ? `/runs/${String(key[4])}${key[5] ? `/${String(key[5])}` : ''}`
                : '';
    const filter = key.length > 6 ? key[6] : scope === 'mixed-runs' ? key[4] : {};
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries((filter ?? {}) as object)) {
      if (Array.isArray(value)) value.forEach((item) => params.append(name, String(item)));
      else if (value != null) params.set(name, String(value));
    }
    const data =
      key[5] === 'log-tail'
        ? { lines: platformLogPage.lines, cursor: 3, total: 3, dropped: 0 }
        : platformFixtureRead(sub, params, state);
    query.setData(data);
    query.fetch = () => Promise.resolve(data);
  });
  return client;
}
export function PlatformMockPage({
  state = 'finished',
  page = 'run',
}: {
  state?: PlatformFixtureState;
  page?: 'run' | 'home' | 'new' | 'targets';
}) {
  const [fixture] = useState(() => ({ client: fixtureClient(state), read: platformRunRead(state) }));
  return (
    <RealPageShell
      variant={`platform-${page}-${state}`}
      crumbs={page === 'run' ? [`Run ${fixture.read.run.number}`] : [page]}
    >
      <ProjectContext.Provider value={project}>
        <QueryClientProvider client={fixture.client}>
          {page === 'run' ? (
            <PlatformRun
              slug="demo"
              runId={fixture.read.run.id}
              read={fixture.read}
              onRetry={() => undefined}
              now={() => fixture.read.received_at}
            />
          ) : page === 'home' ? (
            <PerformanceHomePage slug="demo" />
          ) : page === 'targets' ? (
            <TargetsPage slug="demo" />
          ) : (
            <NewRunPage slug="demo" initial={{ targetId: 'platform' }} />
          )}
        </QueryClientProvider>
      </ProjectContext.Provider>
    </RealPageShell>
  );
}
