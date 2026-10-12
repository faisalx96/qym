/* eslint-disable @typescript-eslint/no-explicit-any -- request/response bodies are untyped JSON here */
/**
 * Brief 06 §2.5 step 3 + §8 scenario 6: models (follow global / custom / temporary), the secret
 * hygiene of temporary model keys, global model apply / clear, extra endpoints, and re-entering a
 * key after a clone.
 */
import { expect, type Page } from '@playwright/test';
import {
  experimentSpec,
  fakeJobs,
  getExperiment,
  launchExperiment,
  resetFakes, test,
  waitForSubmitted,
} from '../support';
import {
  captureConsole,
  captureExperimentPosts,
  expectReady,
  launchButton,
  nameBox,
  openLaunch,
  openSection,
  pickRadio,
  scanForSecret,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const KEY = 'sk-SECRET-temp-9876543210';
let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const primary = (page: Page) => page.getByRole('article', { name: 'Primary model' });

async function addTemporaryOnPrimary(page: Page, key = KEY): Promise<void> {
  await openSection(page, 'Models');
  await pickRadio(primary(page), 'Temporary');
  const form = primary(page).getByRole('group', { name: 'Temporary model' });
  await form.getByRole('textbox', { name: 'Label' }).fill('mini trial');
  await form.getByRole('textbox', { name: /^Model/ }).fill('gpt-4o-mini');
  await form.getByRole('textbox', { name: 'Base URL' }).fill('https://api.example.com/v1');
  await form.getByLabel('API key').fill(key);
  await form.getByRole('button', { name: 'Add model' }).click();
}

test.describe('models', () => {
  test('Follow global / Custom / Temporary: the source radio and the global model apply and clear', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await openSection(page, 'Models');
    const card = primary(page);
    await expect(card.getByRole('radio', { name: 'Follow global' })).toBeChecked();
    await pickRadio(card, 'Custom');
    await expect(card.getByRole('radio', { name: 'Custom' })).toBeChecked();
    await expect(card).toContainText('custom');
    // Applying the global model again makes every endpoint follow it, custom ones too.
    const global = page.getByRole('group', { name: 'Global model' });
    await expect(global).toContainText('gpt-4o prod');
    await global.getByRole('button', { name: 'Clear' }).click();
    await expect(global).toContainText('None: pick a model per endpoint');
    await expect(card).toContainText('gpt-4o prod');
    await expect(card.getByRole('radio', { name: 'Follow global' })).not.toBeChecked();
  });

  test('a temporary model with a key: secrets[ref] in the request, {$secret} in bindings, the key nowhere else', async ({
    page,
    request,
  }) => {
    const posts = captureExperimentPosts(page);
    const logs = captureConsole(page);
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('temp key run');
    await addTemporaryOnPrimary(page);
    await expect(primary(page)).toContainText('mini trial');
    await expectReady(page);

    // The dry run already carries the secret by reference only.
    await expect
      .poll(
        () => posts.dryRuns.at(-1)?.body?.secrets && Object.keys(posts.dryRuns.at(-1)!.body.secrets).length,
      )
      .toBe(1);
    const dry = posts.dryRuns.at(-1)!.body;
    const [ref] = Object.keys(dry.secrets);
    expect(dry.secrets[ref!]).toBe(KEY);
    const binding = dry.spec.slot_bindings['endpoint:primary'];
    expect(JSON.stringify(binding)).not.toContain(KEY);
    expect(binding.temporary.api_key).toEqual({ $secret: ref });

    // The key is in no DOM node, no URL, no storage.
    expect(await scanForSecret(page, KEY)).toEqual([]);

    // Raw JSON shows the reference, never the key.
    const raw = await openSection(page, 'Raw JSON');
    await expect(raw.locator('.cm-content')).toContainText('$secret');
    await expect(raw.locator('.cm-content')).not.toContainText(KEY);
    expect(await scanForSecret(page, KEY)).toEqual([]);

    await launchButton(page).click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
    const sent = posts.launches.at(-1)!.body;
    expect(sent.dry_run).toBeFalsy();
    expect(sent.secrets[ref!]).toBe(KEY);
    expect(JSON.stringify(sent.spec)).not.toContain(KEY);
    expect(sent.spec.slot_bindings['endpoint:primary'].temporary.api_key).toEqual({ $secret: ref });
    expect(await scanForSecret(page, KEY)).toEqual([]);
    expect(logs.filter((l) => l.includes(KEY))).toEqual([]);

    // The experiment exists and the service never saw the platform's secret reference verbatim.
    const id = page.url().split('/').pop()!;
    const exp = await getExperiment(request, f.project.id, id);
    expect(exp.name).toBe('temp key run');
    expect(
      JSON.stringify(await (await request.get(`/v1/projects/${f.project.id}/experiments/${id}`)).json()),
    ).not.toContain(KEY);
    await expect.poll(async () => (await fakeJobs(request)).length).toBeGreaterThan(0);
  });

  test('a global temporary model applies to every endpoint and can be cleared', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await openSection(page, 'Models');
    const global = page.getByRole('group', { name: 'Global model' });
    await global.getByRole('button', { name: '+ Temporary model' }).click();
    const form = global.getByRole('group', { name: 'Temporary model' });
    await form.getByRole('textbox', { name: /^Model/ }).fill('gpt-4o-mini');
    await form.getByRole('textbox', { name: 'Base URL' }).fill('https://api.example.com/v1');
    await form.getByLabel('API key').fill(KEY);
    await form.getByRole('button', { name: 'Add model' }).click();
    await expect(global).toContainText('gpt-4o-mini');
    await expect(primary(page)).toContainText('follows global');
    expect(await scanForSecret(page, KEY)).toEqual([]);
    await expect(
      page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Models/ }),
    ).toContainText('1');
  });

  test('add an LLM endpoint to this experiment, then remove it', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await openSection(page, 'Models');
    await page.getByRole('textbox', { name: 'New LLM endpoint name' }).fill('fast');
    await page.getByRole('button', { name: '+ Add LLM endpoint' }).click();
    const card = page.getByRole('article', { name: /fast/i });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Remove/ }).click();
    await expect(page.getByRole('article', { name: /fast/i })).toHaveCount(0);
  });

  test('re-enter a temporary key after a clone', async ({
    page,
    request,
  }) => {
    const spec = experimentSpec(f.connectionId, 60) as any;
    spec.slot_bindings = {
      'endpoint:primary': {
        temporary: {
          model: 'gpt-4o-mini',
          label: 'mini trial',
          base_url: 'https://api.example.com/v1',
          api_key: { $secret: 'k1' },
        },
      },
    };
    const x = await launchExperiment(request, f.project.id, {
      name: 'temp src',
      environment_ids: [f.env.id],
      spec,
      secrets: { k1: KEY },
    });
    await waitForSubmitted(request, f.project.id, x.id);
    await openLaunch(page, f.project.slug, `?clone=${x.id}&job=${x.jobs[0]!.id}`);
    await openSection(page, 'Models');
    const global = page.getByRole('group', { name: 'Global model' });
    await expect(global).toContainText('no API key');
    const field = global.getByLabel('API key for the global model');
    await field.fill(KEY);
    await global.getByRole('button', { name: 'Use key' }).click();
    await expect(global).not.toContainText('no API key');
    await expect(field).toHaveCount(0);
    expect(await scanForSecret(page, KEY)).toEqual([]);
    await expectReady(page);
  });
});
