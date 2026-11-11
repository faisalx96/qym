/**
 * Round 9, points 7 and 9 (docs/internal/ui-migration/redesign9/experiments.md sections 8 and 10):
 * one environment page for both entries (C-7-*) and environment tables whose whole row opens it (C-9-*).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  createEnvironment,
  resetFakes,
  seedProject,
  setFakeCapabilities,
  setFakeTasks,
  test,
} from './support';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

const envsPath = (slug: string) => `/projects/${slug}/environments`;
const settingsList = (slug: string) => `/projects/${slug}/settings?tab=environments`;
const rows = (page: Page) => page.locator('tr[data-row-id]');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const SECTIONS = [
  'status',
  'schema',
  'tasks',
  'groups',
  'preset',
  'saved-presets',
  'ranking',
  'policies',
  'connection',
];

interface World {
  slug: string;
  staging: { id: string };
  loose: { id: string };
}

async function seed(request: Parameters<typeof seedProject>[0], tasks = true): Promise<World> {
  await resetFakes(request);
  await setFakeCapabilities(request, FAKE_A, { task: tasks });
  await setFakeTasks(request, FAKE_A, {
    tasks: [
      { id: 'answer-ticket', name: 'Answer ticket', default: true },
      { id: 'classify-intent', name: 'Classify intent' },
    ],
  });
  const { project } = await seedProject(request, 'r9env');
  const staging = await createEnvironment(request, project.id, 'staging');
  const loose = await createEnvironment(request, project.id, 'dev-sandbox', {
    port: FAKE_B,
    confirmSlots: false,
    maxPriority: 'NORMAL',
  });
  return { slug: project.slug, staging, loose };
}

const normal = (s: string) =>
  s.replace(/(\d+\s?\w+|just now|a few seconds) ago/g, 'T ago').replace(/\s+/g, ' ');

async function pageFacts(page: Page) {
  await expect(page.locator('[data-part="env-page"]')).toBeVisible();
  await expect(page.locator('[data-part="env-section-tasks"] [data-tasks-status]')).not.toHaveAttribute(
    'data-tasks-status',
    'loading',
  );
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-part="env-page"]')!;
    return {
      path: location.pathname,
      sections: Array.from(body.querySelectorAll('[data-part^="env-section-"]')).map((e) =>
        (e.getAttribute('data-part') ?? '').replace('env-section-', ''),
      ),
      width: Math.round(body.getBoundingClientRect().width),
      text: body.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('r9 environment page (C-7)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('both entries land on the same page; header, footer and Tasks as specified', async ({
    page,
    request,
  }) => {
    const w = await seed(request);
    // C-7-1: Experiments -> Environments, click the URL cell (not the name)
    await gotoApp(page, envsPath(w.slug));
    await row(page, 'staging').locator('td').nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${w.slug}/environments/${w.staging.id}$`));
    const a = await pageFacts(page);
    await expect(page.getByRole('link', { name: 'All environments' })).toHaveAttribute(
      'href',
      envsPath(w.slug),
    );
    // C-7-5
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('staging');
    await expect(page.getByRole('tab', { name: 'Environments' })).toHaveAttribute('aria-selected', 'true');
    // C-7-6
    const foot = page.locator('[data-part="env-footer"]');
    await expect(foot.getByRole('button')).toHaveText(['Delete environment', 'Save changes']);
    expect((await foot.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    expect((await foot.boundingBox())!.height).toBeLessThanOrEqual(57);
    await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0);
    // C-7-7
    const tasks = page.locator('[data-part="env-section-tasks"]');
    await expect(tasks.locator('[data-task-id]')).toHaveText(['Answer ticket', 'Classify intent']);
    await expect(tasks).toContainText('default: Answer ticket');

    // C-7-1: Project settings -> Environments opens the same pathname, with the back link to settings
    await gotoApp(page, settingsList(w.slug));
    await row(page, 'staging').locator('td').nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/environments/${w.staging.id}\\?from=settings$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const b = await pageFacts(page);
    // C-7-2
    expect(b.path).toBe(a.path);
    expect(b.sections).toEqual(a.sections);
    for (const s of SECTIONS) expect(b.sections).toContain(s);
    expect(normal(b.text)).toBe(normal(a.text));
    expect(a.width).toBeGreaterThanOrEqual(1190);
    expect(a.width).toBeLessThanOrEqual(1196);
    expect(b.width).toBe(a.width);
    // J1: the back link names the place it returns to
    const back = page.locator('#shell-content').getByRole('link', { name: 'Project settings' });
    await expect(back).toHaveAttribute('href', settingsList(w.slug));
    await expect(page.getByRole('link', { name: 'All environments' })).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(/settings\?tab=environments$/);
  });

  test('C-7-4: the legacy ?env= URL redirects (one history entry); ?promote= still reaches the editor', async ({
    page,
    request,
  }) => {
    const w = await seed(request);
    await gotoApp(page, settingsList(w.slug));
    await gotoApp(page, `${settingsList(w.slug)}&env=${w.staging.id}`);
    await expect(page).toHaveURL(new RegExp(`/environments/${w.staging.id}\\?from=settings$`));
    await page.goBack();
    await expect(page).toHaveURL(/settings\?tab=environments$/);
    await gotoApp(page, `${settingsList(w.slug)}&env=${w.staging.id}&promote=run&id=r1`);
    await expect(page).toHaveURL(/default-preset\/edit\?promote=run&id=r1/);
  });

  test('C-7-7: a service without task selection shows the line and no tags', async ({ page, request }) => {
    const w = await seed(request);
    await gotoApp(page, `${envsPath(w.slug)}/${w.loose.id}`);
    const tasks = page.locator('[data-part="env-section-tasks"]');
    await expect(tasks).toContainText('This service does not offer task selection');
    await expect(tasks.locator('[data-task-id]')).toHaveCount(0);
  });

  test('C-7-3: 390 wide, same sections, 279 px body, no horizontal overflow', async ({ page, request }) => {
    const w = await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, `${envsPath(w.slug)}/${w.staging.id}`);
    const f = await pageFacts(page);
    for (const s of SECTIONS) expect(f.sections).toContain(s);
    expect(f.width).toBeGreaterThanOrEqual(277);
    expect(f.width).toBeLessThanOrEqual(281);
    expect(f.overflow).toBeLessThanOrEqual(0);
  });
});

async function cssOf(loc: Locator, prop: string) {
  return loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

test.describe('r9 environment tables (C-9)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('C-9-1/3/4/5/6/7/9: affordances, hover, focus, keyboard, link, chevron, both places alike', async ({
    page,
    request,
    context,
  }) => {
    const w = await seed(request);
    const parts: string[][] = [];
    for (const path of [envsPath(w.slug), settingsList(w.slug)]) {
      await gotoApp(page, path);
      await expect(rows(page)).toHaveCount(2);
      const tr = row(page, 'staging');
      // C-9-1
      await expect(tr).toHaveAttribute('data-clickable', '');
      expect(await cssOf(tr, 'cursor')).toBe('pointer');
      expect(Math.round((await tr.boundingBox())!.height)).toBe(40);
      // merge review Q6: no decorative open chevron (the whole row opens)
      await expect(page.locator('[data-part="env-row-chevron"]')).toHaveCount(0);
      // C-9-6: the name is a real link
      const link = tr.getByRole('link', { name: 'staging' });
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`/environments/${w.staging.id}(\\?from=settings)?$`),
      );
      // C-9-3: hover on the URL cell
      await tr.locator('td').nth(1).hover();
      for (const td of await tr.locator('td').all())
        expect(await cssOf(td, 'background-color')).toBe('rgb(42, 42, 60)');
      // A-17: the name turns green on row hover, never underlined
      expect(await cssOf(link, 'text-decoration-line')).toBe('none');
      // C-9-4: keyboard focus draws the accent ring; C-9-5: Enter opens
      await page.mouse.move(0, 0);
      await tr.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(tr).toBeFocused();
      expect(await cssOf(tr.locator('td').nth(1), 'box-shadow')).toContain('inset');
      await page.keyboard.press('Space');
      await expect(page).toHaveURL(new RegExp(path.replace('?', '\\?') + '$'));
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/environments/${w.staging.id}`));
      // ctrl-click on a row opens a new tab
      await gotoApp(page, path);
      const popup = context.waitForEvent('page');
      await row(page, 'staging')
        .locator('td')
        .nth(1)
        .click({ modifiers: ['Control'] });
      const tab = await popup;
      await expect(tab).toHaveURL(new RegExp(`/environments/${w.staging.id}`));
      await tab.close();
      await expect(page).toHaveURL(new RegExp(path.replace('?', '\\?') + '$'));
      // C-9-9: the data-part list of a row
      parts.push(
        await row(page, 'staging').evaluate((el) =>
          Array.from(el.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part') ?? ''),
        ),
      );
    }
    expect(parts[1]).toEqual(parts[0]);
  });

  test('C-9-2: any cell opens; the row menu and a text drag do not', async ({ page, request }) => {
    const w = await seed(request);
    await gotoApp(page, envsPath(w.slug));
    const cells = await row(page, 'staging').locator('td').count();
    for (let i = 0; i < cells; i++) {
      await gotoApp(page, envsPath(w.slug));
      const td = row(page, 'staging').locator('td').nth(i);
      // the actions cell holds buttons; click its empty edge only when it is not the actions column
      const hasButton = (await td.getByRole('button').count()) > 0;
      if (hasButton) continue;
      await td.click({ position: { x: 4, y: 4 } });
      await expect(page).toHaveURL(new RegExp(`/environments/${w.staging.id}$`));
    }
    await gotoApp(page, envsPath(w.slug));
    await row(page, 'staging').getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Test staging' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${envsPath(w.slug)}$`));
    await page.keyboard.press('Escape');
    const run = row(page, 'staging').getByRole('button', { name: /Run default preset/ });
    expect(await run.count()).toBe(0); // no default preset on this environment: nothing to launch from the row
    // a drag across the URL text selects it and must not navigate
    const url = row(page, 'staging').locator('td').nth(1);
    const box = (await url.boundingBox())!;
    await page.mouse.move(box.x + 6, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect(page).toHaveURL(new RegExp(`${envsPath(w.slug)}$`));
  });
});

test.describe('r9 environment cards (C-9-8)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the whole card opens, no chevron, More does not navigate', async ({ page, request }) => {
    const w = await seed(request);
    for (const path of [envsPath(w.slug), settingsList(w.slug)]) {
      await gotoApp(page, path);
      const cards = page.locator('li[data-row-key][data-clickable]');
      await expect(cards).toHaveCount(2);
      await expect(page.locator('li[data-row-key] [data-part="env-row-chevron"]')).toHaveCount(0);
      const card = cards.filter({ hasText: 'staging' });
      expect(Math.round((await card.boundingBox())!.width)).toBeGreaterThanOrEqual(277);
      expect(await cssOf(card, 'cursor')).toBe('pointer');
      await card.getByRole('button', { name: 'More' }).click();
      await expect(card.getByRole('button', { name: 'Less' })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(path.replace('?', '\\?') + '$'));
      await card
        .locator('dl')
        .first()
        .click({ position: { x: 4, y: 4 } });
      await expect(page).toHaveURL(new RegExp(`/environments/${w.staging.id}`));
    }
  });
});

// After-shots for docs/internal/ui-migration/redesign9/shots: QYM_R9_SHOTS=<dir> npx playwright test e2e/experiments/r9-environments.spec.ts -g shots
test.describe('r9 after-shots', () => {
  test.skip(!process.env.QYM_R9_SHOTS, 'set QYM_R9_SHOTS to a directory to write the after-shots');
  test('shots', async ({ page, request }) => {
    const dir = process.env.QYM_R9_SHOTS!;
    const w = await seed(request);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await gotoApp(page, `${envsPath(w.slug)}/${w.staging.id}`);
      await pageFacts(page);
      await page.screenshot({
        path: `${dir}/after-page-environment-experiments-${width}.png`,
        fullPage: true,
      });
      await gotoApp(page, `${envsPath(w.slug)}/${w.staging.id}?from=settings`);
      await pageFacts(page);
      await page.screenshot({ path: `${dir}/after-page-environment-settings-${width}.png`, fullPage: true });
      await gotoApp(page, envsPath(w.slug));
      await expect(page.locator('tr[data-row-id]').first()).toBeVisible();
      await page.screenshot({ path: `${dir}/after-page-environments-table-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, envsPath(w.slug));
    await expect(rows(page)).toHaveCount(2);
    await row(page, 'staging').locator('td').nth(1).hover();
    await page.screenshot({ path: `${dir}/after-page-environments-table-hover-1440.png` });
    await page.mouse.move(0, 0);
    await row(page, 'staging').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.screenshot({ path: `${dir}/after-page-environments-table-focus-1440.png` });
  });
});
