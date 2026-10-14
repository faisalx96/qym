import type { APIRequestContext, Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { createApiKey, ensureProject, seedCompareRun } from '../compare/seed';
import { seedLaunch } from '../experiments/launch/launchSupport';
import { experimentSpec, launchExperiment, resetFakes, withFakesLock } from '../experiments/support';
import { seedReviews } from '../reviews/support';
import { seedAnalyzer } from '../analyzer/helpers';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from '../datasets/support';
import { client, openRun, seedClassic, seedProject, seedRepeat } from '../run-detail/support';

export interface Tour {
  slug: string;
  runId: string;
  repeatId: string;
  compareIds: string[];
}

/** One project with a classic run, a repeat run and four comparable runs. */
export async function seedTour(): Promise<Tour> {
  const s = await seedProject('vl');
  const runId = await seedClassic(s, { items: 40, taskErrors: 3, scorerErrors: 2, traced: 2 });
  const repeatId = await seedRepeat(s);
  const project = await ensureProject(client, 'VL compare', uniqueSlug('vl-cmp'));
  const token = await createApiKey(client, project.id);
  const compareIds: string[] = [];
  for (let i = 0; i < 4; i++)
    compareIds.push(
      await seedCompareRun(client, token, {
        name: `run-${i + 1}`,
        model: `vendor/m-${i}`,
        skill: (i - 1) / 8,
        items: 12,
        seed: 7 + i,
        taskErrors: i === 2 ? [2] : [],
      }),
    );
  return { slug: s.slug, runId, repeatId, compareIds };
}

export { openRun };

/** Resolves when no CSS animation or transition is running (entrances and fills are 360ms). */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 10_000 });
}

export interface AreasWorld {
  slug: string;
  envId: string;
  experimentId: string;
  datasetSlug: string;
  runId: string;
  analysisSlug: string;
}

/** One project that has an environment, a launched experiment, a dataset, an analysed run and pending reviews. */
export async function createLaunchAreas(request: APIRequestContext): Promise<AreasWorld> {
  return withFakesLock(async () => {
    await resetFakes(request);
    const f = await seedLaunch(request);
    const exp = await launchExperiment(request, f.project.id, {
      name: 'vl experiment',
      environment_ids: [f.env.id],
      spec: experimentSpec(f.connectionId),
    });
    const ds = await createDataset(request, f.project.slug, 'VL dataset', { description: 'vl' });
    const v = await createVersion(request, f.project.slug, ds.slug);
    await bulkItems(request, f.project.slug, ds.slug, v.version, sampleItems(8));
    await publishVersion(request, f.project.slug, ds.slug, v.version, true);
    await seedReviews(request, 'vlrev', 3, { project: f.project });
    const an = await seedAnalyzer(request);
    return {
      slug: f.project.slug,
      envId: f.env.id,
      experimentId: exp.id,
      datasetSlug: ds.slug,
      runId: an.runId,
      analysisSlug: an.slug,
    };
  });
}
