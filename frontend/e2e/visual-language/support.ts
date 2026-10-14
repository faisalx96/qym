import type { Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { createApiKey, ensureProject, seedCompareRun } from '../compare/seed';
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
