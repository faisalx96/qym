/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untyped JSON here */
/**
 * Cutover: launch-form behaviours the vanilla Chromium pytest suite protected
 * (tests/platform/test_experiment_launch_*_browser.py) that no other spec asserts:
 * a saved preset fills every field of the configuration sections and what is shown is what is
 * sent, the name field keeps focus while typing, settings groups stay as the user left them, and
 * the LLM groups dialog opened from the Models section.
 */
import { expect, type Page } from '@playwright/test';
import { PRIMARY, resetFakes, saveSavedPreset, test } from '../support';
import {
  listPresets,
  captureExperimentPosts,
  ensureOpen,
  nameBox,
  goStep,
  openLaunch,
  rail,
  openSection,
  expectReady,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const presetDoc = (connectionId: string) => ({
  evaluator: {
    dataset: 'golden',
    report_k: 2,
    config: {
      samples: 3,
      max_retries: 4,
      force_model_override: true,
      run_metadata: { team: 'rag', tier: 2 },
    },
  },
  slot_bindings: { [PRIMARY]: { connection_id: connectionId } },
  env_overrides: {
    TABLE_SELECTION_MODE: 'rag',
    MILVUS_SEARCH_THRESHOLD: 0.7,
    SQL_RESULT_LIMIT: 50,
    BRIEF_ENABLED: false,
    LLM_OVERRIDES: { endpoints: { primary: { timeout: 60 } }, main: { temperature: 0.2 } },
  },
});

async function openSavedPreset(page: Page, request: any, name: string): Promise<void> {
  await saveSavedPreset(request, f.project.id, f.env.id, name, presetDoc(f.connectionId));
  const saved = (await listPresets(request, f.project.id, f.env.id)).find((p) => p.name === name)!;
  await openLaunch(page, f.project.slug, `?env=${f.env.id}&base=saved&preset=${saved.id}`, 'start');
  await expect(page.getByRole('status').filter({ hasText: 'Based on' })).toContainText(
    `Saved preset “${name}”`,
  );
  await goStep(page, 'where');
}

test('a saved preset fills every field of the configuration sections and what is shown is sent', async ({
  page,
  request,
}) => {
  const posts = captureExperimentPosts(page);
  await openSavedPreset(page, request, 'RAG baseline');
  await nameBox(page).fill('from preset');

  const env = await openSection(page, 'Environment configurations');
  // the preset's values are the starting point, not changes
  await expect(rail(page).getByRole('button', { name: /\d\s*Environment configurations/ })).not.toContainText(
    '1',
  );
  const groupButtons = env.getByRole('heading', { level: 4 }).getByRole('button');
  for (let i = 0; i < (await groupButtons.count()); i++) await ensureOpen(groupButtons.nth(i));
  await expect(env.getByRole('textbox', { name: 'Timeout', exact: true })).toHaveValue('60');
  await expect(env.getByRole('textbox', { name: 'Milvus Search Threshold' })).toHaveValue('0.7');
  await expect(env.getByRole('textbox', { name: 'Sql Result Limit' })).toHaveValue('50');
  await expect(
    env.getByRole('combobox', { name: 'Table Selection Mode' }).locator('option:checked'),
  ).toHaveText('rag');
  await expect(env.getByRole('combobox', { name: 'Brief Enabled' }).locator('option:checked')).toHaveText(
    'false',
  );

  const ev = await openSection(page, 'Evaluation configurations');
  await expect(ev.getByRole('textbox', { name: 'Samples' })).toHaveValue('3');
  await expect(ev.getByRole('textbox', { name: 'Max Retries', exact: true })).toHaveValue('4');
  await expect(ev.getByRole('textbox', { name: 'Metadata key 1' })).toHaveValue('team');
  await expect(ev.getByRole('textbox', { name: 'Metadata value 1' })).toHaveValue('rag');
  await expect(ev.getByRole('textbox', { name: 'Metadata key 2' })).toHaveValue('tier');
  await expect(ev.getByRole('textbox', { name: 'Metadata value 2' })).toHaveValue('2');
  await expect(ev).toContainText('report_k');
  await expectReady(page);

  // what the sections show is what is sent
  const doc = presetDoc(f.connectionId);
  const last = posts.dryRuns.at(-1)!.body.spec;
  expect(last.env_overrides).toEqual(doc.env_overrides);
  expect(last.evaluator.config).toEqual(doc.evaluator.config);
  expect(last.evaluator.report_k).toBe(2);
});

test('typing the experiment name keeps the focus and does not rebuild the field', async ({ page }) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  const name = nameBox(page);
  await name.click();
  await page.evaluate(() => {
    (window as any).__name = document.activeElement;
  });
  await name.pressSequentially('rag threshold', { delay: 30 });
  await page.waitForTimeout(800); // the debounced dry run lands too
  await expect(name).toHaveValue('rag threshold');
  await expect(name).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === (window as any).__name)).toBe(true);
});

test("settings groups stay closed unless opened and keep exactly the user's choice across a search", async ({
  page,
}) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  const env = await openSection(page, 'Environment configurations');
  const groups = env.getByRole('heading', { level: 4 }).getByRole('button');
  await expect(groups.first()).toBeVisible();
  const expanded = () =>
    groups.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-expanded') === 'true'));
  expect((await expanded()).some(Boolean)).toBe(false);

  await groups.first().click();
  const open = await expanded();
  expect(open.filter(Boolean)).toHaveLength(1);

  // a search opens the matching groups only while it is active
  const search = env.getByRole('searchbox', { name: /Search settings/ });
  await search.fill('threshold');
  expect((await expanded()).some((v, i) => v && !open[i])).toBe(true);
  await search.fill('');
  expect(await expanded()).toEqual(open);
});

test('Edit LLM groups: moving keys into another group makes a second key set, and a set without a model is refused', async ({
  page,
}) => {
  await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
  await openSection(page, 'Models');
  await page.getByRole('button', { name: 'Edit LLM groups' }).click();
  const dialog = page.getByRole('dialog', { name: /LLM model groups/ });
  const primary = dialog.locator('[data-slot-key="endpoint:primary"]');
  await expect(primary).toBeVisible();
  await expect(primary.getByText(/^Keys \d/)).toHaveCount(1);

  // an empty extra set is refused with its reason, and nothing is saved
  await primary.getByRole('button', { name: '+ Add another set of keys' }).click();
  await expect(primary.getByText(/^Keys \d/)).toHaveCount(2);
  const saves: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith('/model-slots')) saves.push(r.url());
  });
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(dialog.getByText('Every set of keys needs a model field').first()).toBeVisible();
  expect(saves).toEqual([]);
  await primary.getByRole('button', { name: /^Remove key set 2/ }).click();
  await expect(primary.getByText(/^Keys \d/)).toHaveCount(1);

  // moving the VIZ group's keys makes them a second key set of the primary group
  const viz = dialog.locator('[data-slot-key="flat:VIZ_LLM"]');
  await viz.getByRole('button', { name: /Merge .* into another group/ }).click();
  await page.getByRole('option', { name: 'Primary model' }).click();
  await expect(primary.getByText(/^Keys \d/)).toHaveCount(2);
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(dialog).toBeHidden();
  expect(saves).toHaveLength(1);
  // the form reloads the environment: the card says what it fills
  await expect(page.getByRole('article', { name: 'Primary model' })).toContainText('in 2 key sets');
});
