/* eslint-disable @typescript-eslint/no-explicit-any -- request/response bodies are untyped JSON here */
/** Brief 06 §2.6 (journey 6): the default preset editor (the launch form in editor mode). */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { resetFakes, test } from '../support';
import {
  dialog,
  listPresets,
  maxAttempts,
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

const editorUrl = (envId: string, q = '') => `/projects/${f.project.slug}/environments/${envId}/default-preset/edit${q}`;

async function versionsOf(request: APIRequestContext, envId: string, kind: 'official' | 'saved'): Promise<any[]> {
  const preset = (await listPresets(request, f.project.id, envId)).find((p) => p.kind === kind)!;
  const res = await request.get(`/v1/projects/${f.project.id}/eval-environments/${envId}/presets/${preset.id}/versions`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { versions: any[] }).versions;
}

const pane = (page: Page) => page.getByRole('complementary', { name: 'Review and publish' });
const notesBox = (page: Page) => pane(page).getByRole('textbox', { name: /Release notes/ });
const publishBtn = (page: Page, v: number) => pane(page).getByRole('button', { name: `Publish v${v}` });

async function openEditor(page: Page, envId: string, q = '') {
  await page.goto(editorUrl(envId, q));
  await expect(pane(page)).toBeVisible();
}

test('edit from v1: Publish v2 needs a change and notes, confirms, and creates version 2', async ({ page, request }) => {
  await openEditor(page, f.env.id);
  await expect(publishBtn(page, 2)).toBeDisabled();
  const field = await maxAttempts(page);
  await field.fill('3');
  await expect(pane(page)).toContainText('Environment configurations: 1 change');
  // Changed, but notes are still required.
  await expect(publishBtn(page, 2)).toBeDisabled();
  await notesBox(page).fill('Retry three times');
  await expect(publishBtn(page, 2)).toBeEnabled();
  await publishBtn(page, 2).click();
  const d = dialog(page);
  await expect(d).toContainText('Publish default preset v2?');
  await d.getByRole('button', { name: 'Keep editing' }).click();
  expect((await versionsOf(request, f.env.id, 'official')).length).toBe(1);
  await publishBtn(page, 2).click();
  await dialog(page).getByRole('button', { name: 'Publish v2' }).click();
  await expect(page.getByText(/Published default preset v2/)).toBeVisible();
  await expect(page).not.toHaveURL(/default-preset\/edit/);
  const versions = await versionsOf(request, f.env.id, 'official');
  expect(versions).toHaveLength(2);
  const v2 = versions.find((v) => v.version === 2)!;
  expect(v2.notes).toBe('Retry three times');
  expect(JSON.stringify(v2.config)).toContain('"max_attempts":3');
});

test('an environment without a default preset publishes v1', async ({ page, request }) => {
  await openEditor(page, f.bare.id);
  await expect(publishBtn(page, 1)).toBeDisabled();
  await page.getByRole('button', { name: /Dataset$/ }).first().click();
  await page.getByRole('option', { name: 'golden' }).click();
  await notesBox(page).fill('First default');
  await publishBtn(page, 1).click();
  await dialog(page).getByRole('button', { name: 'Publish v1' }).click();
  await expect(page.getByText(/Published default preset v1/)).toBeVisible();
  expect((await versionsOf(request, f.bare.id, 'official')).length).toBe(1);
});

test('promote a saved preset to the default preset', async ({ page, request }) => {
  const saved = (await listPresets(request, f.project.id, f.env.id)).find((p) => p.kind === 'saved')!;
  // From the environment page, as a manager would.
  await page.goto(`/projects/${f.project.slug}/environments/${f.env.id}`);
  await page.getByRole('button', { name: /^Promote Slow timeout to default preset/ }).click();
  await expect(page).toHaveURL(new RegExp(`default-preset/edit\\?.*promote=saved.*id=${saved.id}|default-preset/edit\\?.*id=${saved.id}.*promote=saved`));
  await expect(pane(page)).toContainText('Compared with');
  await expect(publishBtn(page, 2)).toBeDisabled(); // notes missing
  await notesBox(page).fill('Promote the slow timeout');
  await expect(publishBtn(page, 2)).toBeEnabled();
  await publishBtn(page, 2).click();
  await dialog(page).getByRole('button', { name: 'Publish v2' }).click();
  await expect(page.getByText(/Published default preset v2/)).toBeVisible();
  const v2 = (await versionsOf(request, f.env.id, 'official')).find((v) => v.version === 2)!;
  expect(JSON.stringify(v2.config)).toContain('"timeout":120');
});

test('409: publishing from a stale tab shows the conflict and reopening drafts v3', async ({ page, context, request }) => {
  await openEditor(page, f.env.id);
  const field = await maxAttempts(page);
  await field.fill('2');
  await notesBox(page).fill('from the stale tab');

  const other = await context.newPage();
  await openEditor(other, f.env.id);
  await (await maxAttempts(other)).fill('5');
  await notesBox(other).fill('published first');
  await publishBtn(other, 2).click();
  await dialog(other).getByRole('button', { name: 'Publish v2' }).click();
  await expect(other.getByText(/Published default preset v2/)).toBeVisible();
  await other.close();

  await publishBtn(page, 2).click();
  await dialog(page).getByRole('button', { name: 'Publish v2' }).click();
  await expect(pane(page).getByText('The default preset changed')).toBeVisible();
  expect((await versionsOf(request, f.env.id, 'official')).length).toBe(2);
  await pane(page).getByRole('button', { name: 'Reload the editor' }).click();
  await expect(publishBtn(page, 3)).toBeVisible();
  await expect(publishBtn(page, 3)).toBeDisabled();
});

test('leaving the editor with unpublished changes asks first', async ({ page }) => {
  await openEditor(page, f.env.id);
  await (await maxAttempts(page)).fill('4');
  await expect(pane(page)).toContainText('1 change');
  await pane(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toContainText('Leave without publishing?');
  await dialog(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/default-preset\/edit/);
});
