/** Trash seeding: ingest runs through the SDK path, then soft-delete them. */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createProject, uniqueSlug, type SeededProject } from '../helpers';
import { createApiKey } from '../shell/support';
import {
  bulkItems,
  createDataset,
  createVersion,
  ingestRun,
  publishVersion,
  sampleItems,
  softDeleteRun,
  type IngestedRun,
} from '../datasets/support';

export interface TrashSeed {
  project: SeededProject;
  runs: IngestedRun[];
  prefix: string;
}

/** `n` deleted runs named `<prefix>-<i>` in a fresh project (or the given one). */
export async function seedTrash(
  request: APIRequestContext,
  prefix: string,
  n: number,
  project?: SeededProject,
): Promise<TrashSeed> {
  const p = project ?? (await createProject(request, `Trash ${prefix}`, uniqueSlug(prefix)));
  const ds = await createDataset(request, p.slug, `trash ds ${prefix}`);
  const v = await createVersion(request, p.slug, ds.slug);
  const items = sampleItems(1);
  await bulkItems(request, p.slug, ds.slug, v.version, items);
  await publishVersion(request, p.slug, ds.slug, v.version, true);
  const apiKey = await createApiKey(request, p.id, `e2e-${prefix}`).then((k) => k.token);
  const runs: IngestedRun[] = [];
  for (let i = 0; i < n; i++) {
    runs.push(
      await ingestRun(request, {
        apiKey,
        task: 'qa',
        runName: `${prefix}-${i}`,
        dataset: ds,
        version: { ...v, status: 'published' },
        items,
      }),
    );
  }
  for (const r of runs) await softDeleteRun(request, r.id);
  return { project: p, runs, prefix };
}

/** Opens a deleted run's row menu (its one '>' handle, as on the runs list, C151) and returns the menu. */
export async function openTrashRowMenu(page: Page, row: Locator): Promise<Locator> {
  await row.hover();
  await row.locator('td[data-col="actions"] button[data-row-menu]').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Picks one item of a deleted run's row menu: Restore or Delete permanently. */
export async function pickTrashAction(page: Page, row: Locator, item: string): Promise<void> {
  const menu = await openTrashRowMenu(page, row);
  await menu.getByRole('menuitem', { name: item }).click();
}
