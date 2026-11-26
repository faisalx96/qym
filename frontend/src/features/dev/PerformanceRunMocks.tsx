/**
 * Performance mocks: the run page. Each mock is the real page (`features/performance/RunPage`, with the app's
 * own frame) inside the gallery shell, reading from a query client of its own that is filled from the fixtures
 * and never asks the network.
 */
import { useState } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { performanceKeys, type PerformanceRunRead } from '@/api/performance';
import { RunPage, type RunDialog, type RunTab } from '@/features/performance/RunPage';
import { logTailKey, type LogTail } from '@/features/performance/components/run/logTail';
import { QUESTIONS_PAGE_SIZE } from '@/features/performance/components/run/QuestionsTab';
import { RealPageShell, fixtureClient } from './PerformanceHomeMocks';
import {
  performanceLogPage,
  performanceProject,
  performanceQuestionsPage,
  performanceRunEvents,
  performanceRunEventsFinal,
} from './performanceFixtures';

export type { RunDialog, RunTab };

/** Every read the run page makes, held from the fixtures. */
function runClient(read: PerformanceRunRead, receivedAt: number): QueryClient {
  return fixtureClient((client) => {
    // The page polls a run that is active, and its hooks switch themselves on. Here every read, also one
    // asked for later, answers with what it already holds.
    client.getQueryCache().subscribe((event) => {
      if (event.type !== 'added') return;
      const query = event.query;
      query.fetch = () => Promise.resolve(query.state.data);
    });
    const slug = performanceProject.slug;
    const id = read.run.id;
    const tail: LogTail = {
      lines: performanceLogPage.lines,
      cursor: performanceLogPage.last_seq,
      total: performanceLogPage.total,
      dropped: performanceLogPage.dropped,
    };
    client.setQueryData(performanceKeys.run(slug, id), { ...read, received_at: receivedAt });
    client.setQueryData(
      performanceKeys.runQuestions(slug, id, { page: 1, page_size: QUESTIONS_PAGE_SIZE }),
      performanceQuestionsPage,
    );
    client.setQueryData(
      performanceKeys.runEvents(slug, id),
      read.summary ? performanceRunEventsFinal : performanceRunEvents,
    );
    client.setQueryData(logTailKey(slug, id, { level: [], q: '' }), tail);
  });
}

export function PerformanceRunPage({
  variant,
  read,
  tab = 'progress',
  dialog,
  logMode = 'all',
}: {
  variant: string;
  read: PerformanceRunRead;
  tab?: RunTab;
  dialog?: RunDialog;
  logMode?: 'all' | 'events';
}) {
  const [fixture] = useState(() => {
    // The clock stands at the moment of the read, so "Last report" stays what the fixture says.
    const receivedAt = Date.parse(read.server_time);
    return { client: runClient(read, receivedAt), now: () => receivedAt };
  });
  return (
    <RealPageShell variant={variant} crumbs={[`Run ${read.run.number}`]}>
      <QueryClientProvider client={fixture.client}>
        <RunPage
          slug={performanceProject.slug}
          runId={read.run.id}
          now={fixture.now}
          initial={{
            tab,
            dialog,
            logMode,
            // The Questions mock shows one row open, as the design does.
            question: tab === 'questions' ? performanceQuestionsPage.rows[0]?.seq : undefined,
          }}
        />
      </QueryClientProvider>
    </RealPageShell>
  );
}
