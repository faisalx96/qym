/** Multi-dataset / task launch e2e: seeding (datasets with versions, a v1.4 and a v1.3 service) and measuring helpers. */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  createEnvironment,
  FAKE_A,
  FAKE_B,
  publishDefaultPreset,
  seedProject,
  setFakeCapabilities,
  type Seeded,
  type SeededEnv,
} from '../support';

export interface MultiFixture extends Seeded {
  /** Takes a dataset list and a task (the fake on FAKE_A, change request v1.4). */
  production: SeededEnv;
  /** A v1.3 service: no `datasets`, no `task` (FAKE_B). */
  staging: SeededEnv;
}

const items = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ item_id: `${prefix}-${i}`, input: `question ${i}`, expected_output: `answer ${i}` }));

/** A dataset with `versions` published versions; `production` is the alias of the last one. */
export async function createVersionedDataset(
  request: APIRequestContext,
  slug: string,
  name: string,
  versions: number,
): Promise<void> {
  const created = await request.post('/v1/datasets', { data: { project_slug: slug, name, description: 'e2e' } });
  expect(created.ok(), await created.text()).toBeTruthy();
  for (let v = 1; v <= versions; v++) {
    const nv = await request.post(`/v1/datasets/${name}/versions?project_slug=${slug}`, {
      data: v > 1 ? { from_version: `v${v - 1}` } : {},
    });
    expect(nv.ok(), await nv.text()).toBeTruthy();
    const bulk = await request.post(`/v1/datasets/${name}/versions/v${v}/items:bulk?project_slug=${slug}`, {
      data: { upserts: items(6 + v, name.slice(0, 3)) },
    });
    expect(bulk.ok(), await bulk.text()).toBeTruthy();
    const pub = await request.post(`/v1/datasets/${name}/versions/v${v}:publish?project_slug=${slug}`, {
      data: v === versions ? { set_alias: 'production' } : {},
    });
    expect(pub.ok(), await pub.text()).toBeTruthy();
  }
}

/**
 * Project, three datasets (support-tickets v1 to v3, billing-faq v1 v2, refund-cases v1), `production` on a v1.4
 * fake and `staging` on a v1.3 fake, each with a default preset that holds no dataset (the launch starts empty).
 */
export async function seedMulti(request: APIRequestContext): Promise<MultiFixture> {
  const s = await seedProject(request, 'multi');
  await createVersionedDataset(request, s.project.slug, 'support-tickets', 3);
  await createVersionedDataset(request, s.project.slug, 'billing-faq', 2);
  await createVersionedDataset(request, s.project.slug, 'refund-cases', 1);
  await setFakeCapabilities(request, FAKE_A, { datasets: true, task: true });
  await setFakeCapabilities(request, FAKE_B, { datasets: false, task: false });
  const production = await createEnvironment(request, s.project.id, 'production', { port: FAKE_A });
  const staging = await createEnvironment(request, s.project.id, 'staging', { port: FAKE_B });
  const spec = {
    evaluator: { config: { samples: 1 } },
    slot_bindings: { 'endpoint:primary': { connection_id: s.connectionId } },
    env_overrides: {},
  };
  for (const env of [production, staging]) await publishDefaultPreset(request, s.project.id, env.id, spec);
  return { ...s, production, staging };
}

export const round = (n: number) => Math.round(n * 10) / 10;

/** Box size in the web fonts (the mono tags are taller in the fallback font). */
export async function sized(l: Locator): Promise<{ width: number; height: number }> {
  await l.page().evaluate(() => document.fonts.ready);
  const b = await l.boundingBox();
  expect(b, 'element has a box').toBeTruthy();
  return { width: round(b!.width), height: round(b!.height) };
}

export const WIDTHS = [1440, 1024, 390] as const;

/** Elements wider than their box under a root (names and tags must never truncate). */
export function overflowing(root: Locator): Promise<string[]> {
  return root.evaluate((el) =>
    [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]
      .filter(
        (n) =>
          !(n instanceof SVGElement) &&
          !!n.textContent?.trim() &&
          n.scrollWidth > n.clientWidth + 0.5 &&
          getComputedStyle(n).overflowX !== 'visible',
      )
      .map((n) => `${n.tagName}.${n.getAttribute('class') ?? ''}:${n.textContent?.slice(0, 30)}`),
  );
}

/** The single Select of the empty card (its name is the placeholder, then the label). */
export const datasetSelect = (page: Page) => page.getByRole('button', { name: /^Choose a dataset/ });
export const datasetsCard = (page: Page) => page.getByTestId('datasets-fieldset');
export const dsBox = (page: Page, name: string) => page.locator(`li[data-dataset-box="${name}"]`);
export const envBox = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name }) });

/** Choose a dataset in the empty card (2 clicks), then tick its references. */
export async function chooseDataset(page: Page, name: string): Promise<void> {
  await datasetSelect(page).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(dsBox(page, name)).toBeVisible();
}

/** Makes `versions` (e.g. `v3`) the dataset's references: ticks them, and unticks Latest unless `latest` is asked for. */
export async function setVersions(page: Page, dataset: string, versions: string[], latest = false): Promise<void> {
  await dsBox(page, dataset).getByRole('button', { name: new RegExp(`^Versions.* of ${dataset}$`) }).click();
  const panel = page.getByRole('dialog', { name: /Versions options/ });
  for (const v of versions) await panel.getByRole('checkbox', { name: new RegExp(`Version ${v}\\b`) }).click({ force: true });
  if (!latest) await panel.getByRole('checkbox', { name: /Latest version/ }).click({ force: true });
  await page.keyboard.press('Escape');
}

export async function addDataset(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add another dataset' }).click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await expect(dsBox(page, name)).toBeVisible();
}

/** The composed state of the spec: support-tickets v2 + v3 and billing-faq v1 + v2 (4 dataset versions). */
export async function composeFour(page: Page): Promise<void> {
  await chooseDataset(page, 'support-tickets');
  await setVersions(page, 'support-tickets', ['v2', 'v3']);
  await addDataset(page, 'billing-faq');
  await setVersions(page, 'billing-faq', ['v1', 'v2']);
}
