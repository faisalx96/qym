/**
 * The run page in an exported file (C173): today's React run page, read-only, from the snapshot the exporter wrote.
 * Every query reads the hydrated cache; the network is refused (main.tsx), so nothing loads or saves.
 */
import { useState } from 'react';
import { HydrationBoundary, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from 'react-aria-components';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/ui/Toast';
import { formatHeaderDate } from '@/lib/dates';
import { AuthContext } from '@/features/shell/AuthContext';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { RunDetailPage } from '@/features/run-detail/RunDetailPage';
import { freshen, type RunSnapshot } from './snapshot';
import styles from './ExportApp.module.css';

function snapshotClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // 'always': a query the snapshot lacks fails at once with a network error, never waits for a connection.
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

/** A link inside the page leads to a page the file does not hold. */
function NotInSnapshot({ back }: { back: string }) {
  return (
    <div className={styles.away}>
      <p>This page is not part of the exported file. Open it in qym.</p>
      <Link to={back}>Back to the run</Link>
    </div>
  );
}

export function ExportApp({ snapshot }: { snapshot: RunSnapshot }) {
  const [client] = useState(snapshotClient);
  const [state] = useState(() => freshen(snapshot.state));
  const project: ProjectValue = {
    project: snapshot.project,
    slug: snapshot.slug,
    readOnly: true,
    archived: false,
    viewer: false,
    snapshot: true,
    canManage: false,
    isAdmin: false,
  };
  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={state}>
        <I18nProvider locale="en-US">
          <ToastProvider>
            <AuthContext.Provider value={{ me: snapshot.me, isAdmin: false, refetch: () => undefined }}>
              <ProjectContext.Provider value={project}>
                <div className={styles.frame}>
                  <p className={styles.banner} role="note">
                    <strong>Read-only snapshot</strong> exported from qym on{' '}
                    {formatHeaderDate(snapshot.exportedAt)}. Scores, diagnoses and reviews cannot change in
                    this file.
                  </p>
                  <main id="shell-content" className={styles.content} tabIndex={-1} data-shell-content>
                    <MemoryRouter initialEntries={[snapshot.path]}>
                      <Routes>
                        <Route path="/projects/:slug/runs/*" element={<RunDetailPage />} />
                        <Route path="*" element={<NotInSnapshot back={snapshot.path} />} />
                      </Routes>
                    </MemoryRouter>
                  </main>
                </div>
              </ProjectContext.Provider>
            </AuthContext.Provider>
          </ToastProvider>
        </I18nProvider>
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
