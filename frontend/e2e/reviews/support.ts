/** Seeding for the reviews specs: one project, datasets, runs and N pending human-only corrections. */
import { expect, type APIRequestContext } from '@playwright/test';
import { createProject, uniqueSlug, type SeededProject } from '../helpers';
import { createApiKey } from '../shell/support';
import {
  addCorrection,
  bulkItems,
  createDataset,
  createVersion,
  ingestRun,
  listCorrections,
  publishVersion,
  sampleItems,
  type CorrectionSummary,
  type IngestedRun,
} from '../datasets/support';

export interface ReviewSeed {
  project: SeededProject;
  run: IngestedRun;
  runName: string;
  dataset: string;
  corrections: CorrectionSummary[];
}

/**
 * `n` pending corrections on one run (task `qa`, model `openai/gpt-4o`, dataset `<prefix>-ds`).
 * Corrections are listed oldest first, so `corrections[0]` is the first row in the default sort.
 */
export async function seedReviews(
  request: APIRequestContext,
  prefix: string,
  n: number,
  opts: { task?: string; model?: string; project?: SeededProject; categoryPrefix?: string } = {},
): Promise<ReviewSeed> {
  const project = opts.project ?? (await createProject(request, `Reviews ${prefix}`, uniqueSlug(prefix)));
  const ds = await createDataset(
    request,
    project.slug,
    `${prefix} ds ${Math.random().toString(36).slice(2, 5)}`,
  );
  const v = await createVersion(request, project.slug, ds.slug);
  const items = sampleItems(Math.max(n, 3));
  await bulkItems(request, project.slug, ds.slug, v.version, items);
  await publishVersion(request, project.slug, ds.slug, v.version, true);
  const apiKey = await createApiKey(request, project.id, `e2e-${prefix}`).then((k) => k.token);
  const runName = `run-${prefix}-${Math.random().toString(36).slice(2, 6)}`;
  const run = await ingestRun(request, {
    apiKey,
    task: opts.task ?? 'qa',
    model: opts.model ?? 'openai/gpt-4o',
    runName,
    dataset: ds,
    version: { ...v, status: 'published' },
    items,
  });
  for (let i = 0; i < n; i++) {
    await addCorrection(request, run, items[i]?.item_id ?? `q-${i}`, {
      category: `${opts.categoryPrefix ?? 'Cat'}-${i}`,
      subcategory: 'sub',
      finding: `finding number ${i}`,
    });
  }
  const corrections = (await listCorrections(request, project.slug, 'pending'))
    .filter((c) => c.run_id === run.id)
    .sort((a, b) => a.id - b.id);
  expect(corrections).toHaveLength(n);
  return { project, run, runName, dataset: ds.name, corrections };
}

export async function decideViaApi(
  request: APIRequestContext,
  id: number,
  action: 'approve' | 'reject' | 'reset',
): Promise<void> {
  const res = await request.post(`/api/corrections/${id}/${action}`, {
    data: action === 'reset' ? {} : { comment: 'via api' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}
