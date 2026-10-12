/* eslint-disable @typescript-eslint/no-explicit-any -- request/response bodies are untyped JSON here */
/**
 * Evaluation inputs, run_metadata validation, Raw JSON (brief 06 §8 scenario 8) and the validation
 * list that focuses the field of a problem.
 */
import { expect, type Page } from '@playwright/test';
import { resetFakes, test } from '../support';
import {
  expectReady,
  launchButton,
  nameBox,
  openLaunch,
  openSection,
  review,
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

async function setRaw(page: Page, text: string): Promise<void> {
  const content = page.getByRole('region', { name: /^Raw JSON/ }).locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

async function rawJson(page: Page): Promise<any> {
  const text = await page.getByRole('region', { name: /^Raw JSON/ }).locator('.cm-content').innerText();
  return JSON.parse(text);
}

test.describe('evaluation inputs and run metadata', () => {
  test('an evaluation input is a change on top, shows in the badge and in the request', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('eval run');
    const ev = await openSection(page, 'Evaluation configurations');
    await ev.getByRole('textbox', { name: 'Samples' }).fill('5');
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Evaluation configurations/ })).toContainText('1');
    await expect(review(page)).toContainText('Evaluation configurations: 1 change');
    await expectReady(page);
    const raw = await openSection(page, 'Raw JSON');
    await expect(raw.locator('.cm-content')).toContainText('"samples": 5');
  });

  test('run metadata: a normal key is accepted; a reserved qym_ key blocks Launch and the problem focuses the field', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('meta run');
    const ev = await openSection(page, 'Evaluation configurations');
    await ev.getByRole('button', { name: 'Add key' }).click();
    await ev.getByRole('textbox', { name: 'Metadata key 1' }).fill('ticket');
    await ev.getByRole('textbox', { name: 'Metadata value 1' }).fill('ABC-1');
    await expectReady(page);
    await ev.getByRole('textbox', { name: 'Metadata key 1' }).fill('qym_secret');
    await expect(ev.getByText('Keys starting with qym_ are reserved for the platform').last()).toBeVisible();
    const problem = review(page).getByRole('button', { name: /Run metadata › qym_secret/ });
    await expect(problem).toBeVisible();
    await expect(launchButton(page)).toBeDisabled();

    // Collapse the section, click the problem: it opens again and focuses the key field.
    await page.getByRole('heading', { level: 3, name: /^Evaluation configurations/ }).getByRole('button').click();
    await expect(page.getByRole('textbox', { name: 'Metadata key 1' })).toBeHidden();
    await problem.click();
    await expect(page.getByRole('textbox', { name: 'Metadata key 1' })).toBeFocused();

    await page.getByRole('textbox', { name: 'Metadata key 1' }).fill('ticket');
    await expectReady(page);
    await expect(launchButton(page)).toBeEnabled();
  });
});

test.describe('Raw JSON', () => {
  test('an unknown key lists errors and blocks Launch; fixing it and Apply updates the fields', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('raw run');
    const raw = await openSection(page, 'Raw JSON');
    await expect(raw.getByRole('status')).toContainText('In sync with the form');
    const doc = await rawJson(page);

    await setRaw(page, JSON.stringify({ ...doc, bogus_key: 1 }, null, 2));
    await expect(raw.getByRole('status')).toContainText(/Unapplied edits/);
    await raw.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(raw.getByRole('list', { name: 'Raw JSON errors' })).toBeVisible();
    await expect(raw.getByRole('list', { name: 'Raw JSON errors' })).toContainText('bogus_key');
    await expect(launchButton(page)).toBeDisabled();
    await expect(review(page)).toContainText(/problem/);

    // Fix: drop the unknown key, change samples, Apply.
    doc.evaluator.config.samples = 7;
    await setRaw(page, JSON.stringify(doc, null, 2));
    await raw.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(raw.getByRole('list', { name: 'Raw JSON errors' })).toHaveCount(0);
    await expect(raw.getByRole('status')).toContainText('In sync with the form');
    await openSection(page, 'Evaluation configurations');
    await expect(page.getByRole('textbox', { name: 'Samples' })).toHaveValue('7');
    await expectReady(page);
    await expect(launchButton(page)).toBeEnabled();
  });

  test('Revert to form drops unapplied edits', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const raw = await openSection(page, 'Raw JSON');
    const doc = await rawJson(page);
    doc.evaluator.config.samples = 9;
    await setRaw(page, JSON.stringify(doc, null, 2));
    await expect(raw.getByRole('status')).toContainText(/Unapplied edits/);
    // The form did not change while typing.
    await openSection(page, 'Evaluation configurations');
    await expect(page.getByRole('textbox', { name: 'Samples' })).toHaveValue('2');
    await raw.getByRole('button', { name: 'Revert to form' }).click();
    await expect(raw.getByRole('status')).toContainText('In sync with the form');
    await expect(raw.locator('.cm-content')).toContainText('"samples": 2');
  });

  test('invalid JSON is reported, not applied', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const raw = await openSection(page, 'Raw JSON');
    await setRaw(page, '{ "evaluator": ');
    await raw.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(raw.getByRole('list', { name: 'Raw JSON errors' })).toBeVisible();
  });
});
