/**
 * "Export HTML" (C173): the run page as one read-only HTML file, built in the browser from today's React page.
 * The page's own queries (rows with every late group, passes, repeat stats, step latency, review log, the category
 * catalog and the signed-in user) go into the built export page (`/api/export/run-template`), which renders the
 * same run page from them with the network refused. The old frozen template and its offline edit mode are not used.
 */
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { LATE_GROUPS, loadedGroups, loadLateGroup, runKeys, RUN_EXPORT_TEMPLATE_URL } from '@/api/runs';
import type { RunPayload } from '../types';
import type { Me, Project } from '@/api/types';
import { platformUrl } from '@/lib/runtime';
import {
  injectSnapshot,
  keepForSnapshot,
  snapshotFileName,
  trimSnapshot,
  type RunSnapshot,
} from '@/export/snapshot';

interface ExportInput {
  runId: string;
  slug: string;
  project: Project;
  me: Me;
  runName: string;
  /** The page's path, search and hash inside the app. */
  path: string;
}

/** Wait until no query of the page is loading (the sections fetch their data as they mount), at most `timeoutMs`. */
async function settle(qc: QueryClient, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let quiet = 0;
  while (Date.now() < until && quiet < 2) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    quiet = qc.isFetching() === 0 ? quiet + 1 : 0;
  }
}

/** The run page file for `input`: the export page with the run's queries in it. */
export async function buildRunExport(qc: QueryClient, input: ExportInput): Promise<string> {
  const { runId, slug } = input;
  // The item texts load in the browser's idle time; the file needs them now.
  const loaded = loadedGroups(qc.getQueryData<RunPayload>(runKeys.compact(runId)));
  for (const group of LATE_GROUPS) {
    if (loaded.includes(group)) continue;
    await qc.fetchQuery({
      queryKey: runKeys.rows(runId, group),
      queryFn: ({ signal }) => loadLateGroup(qc, runId, group, signal),
      staleTime: Infinity,
    });
  }
  await settle(qc);
  const response = await fetch(platformUrl(RUN_EXPORT_TEMPLATE_URL), { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`The export page did not load (HTTP ${response.status}).`);
  const template = await response.text();
  const snapshot: RunSnapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    runId,
    slug,
    project: input.project,
    me: input.me,
    path: input.path,
    state: trimSnapshot(
      dehydrate(qc, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' && keepForSnapshot(query.queryKey, runId, slug),
      }),
      slug,
    ),
  };
  return injectSnapshot(template, snapshot);
}

/** Build the file and hand it to the browser as a download. */
export async function exportRunHtml(qc: QueryClient, input: ExportInput): Promise<void> {
  const html = await buildRunExport(qc, input);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = snapshotFileName(input.runName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
