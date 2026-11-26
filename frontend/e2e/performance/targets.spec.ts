import { test, expect, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { asMember, pageApi, performanceWrites, seedPerformance } from './support';

const PLAYGROUND = { name: 'QA - Playground', address: 'https://playground.qa-target.example.test' };
const MOVED = 'https://playground-two.qa-target.example.test';

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

test('a Manager adds a target, saves its sign-in, changes its address, archives and restores it', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-targets'));
  const slug = seed.projectSlug;
  await gotoApp(page, `/projects/${slug}/performance/targets`);
  await expect(page.getByRole('heading', { name: 'Targets', exact: true })).toBeVisible();
  await expect(row(page, 'QA - Preprod')).toContainText('Sign-in saved');

  // Add.
  await page.getByRole('button', { name: 'Add target' }).click();
  await page.getByRole('dialog').getByText('Insightor chat', { exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a target' });
  await add.getByRole('textbox', { name: 'Name' }).fill(PLAYGROUND.name);
  await add.getByRole('textbox', { name: 'Address' }).fill(PLAYGROUND.address);
  await add.getByRole('button', { name: 'Save target' }).click();
  await expect(add).toHaveCount(0);
  await expect(row(page, PLAYGROUND.name)).toContainText(PLAYGROUND.address);
  await expect(row(page, PLAYGROUND.name)).toContainText('No sign-in saved');

  // Sign-in: saved on the New run page's first step, the only place a page takes tokens.
  await gotoApp(page, `/projects/${slug}/performance/new`);
  await page
    .getByRole('radiogroup', { name: 'Target' })
    .getByRole('radio', { name: /QA - Playground/ })
    .click({ force: true });
  const signIn = page.locator('[data-performance-block="sign-in"]');
  await signIn.getByLabel('Access token').fill('qa-playground-access-1111');
  await signIn.getByLabel('Refresh token').fill('qa-playground-refresh-2222');
  await signIn.getByRole('button', { name: 'Save tokens' }).click();
  await expect(signIn.getByRole('button', { name: 'Replace tokens' })).toBeVisible();
  await expect(signIn).toContainText('2222');
  await expect(page.getByText('qa-playground-refresh-2222')).toHaveCount(0);

  await gotoApp(page, `/projects/${slug}/performance/targets`);
  const playground = row(page, PLAYGROUND.name);
  await expect(playground).toContainText('Sign-in saved');
  await expect(playground).toContainText('Refresh token ends in 2222');
  await expect(page.getByText('qa-playground-refresh-2222')).toHaveCount(0);
  await expect(page.getByText('qa-playground-access-1111')).toHaveCount(0);

  // A new address clears the tokens.
  await playground.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit target' });
  await edit.getByRole('textbox', { name: 'Address' }).fill(MOVED);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(playground).toContainText(MOVED);
  await expect(playground).toContainText('No sign-in saved');
  await expect(playground).not.toContainText('Refresh token ends in');
  const read = (await (await request.get(pageApi(slug, '/targets'))).json()) as {
    targets: { name: string; tokens: unknown[] }[];
  };
  expect(read.targets.find((target) => target.name === PLAYGROUND.name)?.tokens).toEqual([]);

  // Archive, then restore.
  await playground.getByRole('button', { name: 'Archive', exact: true }).click();
  const archive = page
    .getByRole('alertdialog', { name: /Archive the target/ })
    .or(page.getByRole('dialog', { name: /Archive the target/ }));
  await archive.getByRole('button', { name: 'Archive target' }).click();
  await expect(playground).toContainText('Archived');
  await expect(playground.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await playground.getByRole('button', { name: 'Restore' }).click();
  await expect(playground).not.toContainText('Archived');
  await expect(playground.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('with the reads a Member gets, the Targets page and the target step offer no target writes', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-targets-member'));
  await asMember(page);
  const writes = performanceWrites(page);
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/targets`);
  await expect(row(page, 'QA - Preprod')).toContainText('Sign-in saved');
  // Writes the role does not allow are shown disabled in place, with the reason, not hidden (A5).
  await expect(page.getByRole('button', { name: 'Add target' })).toBeDisabled();
  for (const name of ['Edit', 'Archive']) {
    const tiles = page.getByRole('button', { name, exact: true });
    await expect(tiles.first()).toBeVisible();
    for (const tile of await tiles.all()) await expect(tile).toBeDisabled();
  }

  await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
  const targets = page.getByRole('radiogroup', { name: 'Target' });
  await expect(targets.locator('[data-performance-target="add"]')).toHaveAttribute('aria-disabled', 'true');
  await targets.getByRole('radio', { name: /QA - Preprod/ }).click({ force: true });
  await expect(page.getByRole('button', { name: 'Edit target' })).toBeDisabled();
  expect(writes).toEqual([]);
});

test('a name that another target already has is refused in the dialog, in words', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-targets-taken'), {
    runner: false,
    dataset: false,
  });
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/targets`);
  await page.getByRole('button', { name: 'Add target' }).click();
  await page.getByRole('dialog').getByText('Insightor chat', { exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a target' });
  await add.getByRole('textbox', { name: 'Name' }).fill('QA - Preprod');
  await add.getByRole('textbox', { name: 'Address' }).fill('https://another.qa-target.example.test');
  // The dialog knows the list: the name is refused before any request is sent.
  const writes = performanceWrites(page);
  await expect(add).toContainText(/already/i);
  await expect(add.getByRole('button', { name: 'Save target' })).toBeDisabled();
  expect(writes).toEqual([]);
  // The API refuses the same name on its own, with the code the dialog's words are written for.
  const refused = await request.post(pageApi(seed.projectSlug, '/targets'), {
    data: { name: 'QA - Preprod', base_url: 'https://another.qa-target.example.test', is_production: false },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('target_name_taken');
  const read = (await (await request.get(pageApi(seed.projectSlug, '/targets'))).json()) as {
    targets: unknown[];
  };
  expect(read.targets).toHaveLength(1);
});
