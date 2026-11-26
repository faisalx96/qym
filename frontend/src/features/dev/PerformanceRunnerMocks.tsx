/**
 * Performance mocks: the Runner page. The mock is the real page (`features/performance/RunnerPage`) inside the
 * gallery shell, reading from a query client of its own that is filled from the fixtures: nothing is fetched.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { performanceKeys, type PerformanceRunnerEvents, type PerformanceRunnerRead } from '@/api/performance';
import { RunnerPage } from '@/features/performance/RunnerPage';
import { EVENTS_PAGE_SIZE } from '@/features/performance/components/runner/EventsTable';
import { RealPageShell, fixtureClient } from './PerformanceHomeMocks';

const SLUG = 'demo';

export function PerformanceRunnerPage({
  variant,
  read,
  events,
}: {
  variant: string;
  read: PerformanceRunnerRead;
  events: PerformanceRunnerEvents;
}) {
  const [client] = useState(() =>
    fixtureClient((cache) => {
      cache.setQueryData(performanceKeys.runner(SLUG), { ...read, received_at: Date.now() });
      cache.setQueryData(performanceKeys.runnerEvents(SLUG, { page: 1, limit: EVENTS_PAGE_SIZE }), events);
    }),
  );
  return (
    <RealPageShell variant={variant} crumbs={['Runner']}>
      <QueryClientProvider client={client}>
        <RunnerPage slug={SLUG} />
      </QueryClientProvider>
    </RealPageShell>
  );
}
