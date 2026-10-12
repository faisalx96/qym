/** J1 + scenarios 1 and 12: open a run, hero, metric cards, counts, error states, legacy URL, virtualization. */
import { test, expect } from '@playwright/test';
import {
  itemRow,
  itemsCount,
  metricCard,
  openRun,
  runUrl,
  seedClassic,
  seedProject,
  seedRepeat,
  type Seeded,
} from './support';

let s: Seeded;
let classic: string;
let repeat: string;

test.beforeAll(async () => {
  s = await seedProject('rd-overview');
  classic = await seedClassic(s);
  repeat = await seedRepeat(s);
});

test.describe('open a run (J1, scenario 1)', () => {
  test('hero shows id, status, pager, metric cards, items count; title names the run', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const hero = page.getByRole('region', { name: 'Run summary' });
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText(classic);
    await expect(hero).toContainText('COMPLETED');
    await expect(page).toHaveTitle(new RegExp(classic));
    await expect(hero.getByRole('navigation', { name: 'Previous and next run' })).toBeVisible();
    // items count + stat strip
    expect(await itemsCount(page)).toEqual([240, 240]);
    const strip = page.getByLabel('Run counts');
    await expect(strip).toContainText('240');
    // one card per metric in the analysis panel
    for (const m of ['exact_match', 'quality', 'hallucination', 'tokens_used']) {
      await expect(metricCard(page, m)).toBeVisible();
    }
    // default 20 per page
    await expect(page.getByText('1–20 of 240 items')).toBeVisible();
    // the table is virtualized: only the rows in view (up to the page of 20) are in the DOM
    const rows = await page.getByRole('button', { name: /^Open item #\d+$/ }).count();
    expect(rows).toBeGreaterThanOrEqual(10);
    expect(rows).toBeLessThanOrEqual(20);
  });

  test('run details toggle shows the meta grid, execution context and versioning details', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    const toggle = page.getByRole('button', { name: 'Show run details' });
    await expect(page.getByTestId('versioning-details')).toBeHidden();
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Hide run details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const hero = page.getByRole('region', { name: 'Run summary' });
    await expect(hero.getByRole('link', { name: 'rag_answer' })).toHaveAttribute('href', /task=rag_answer/);
    await expect(hero.getByRole('link', { name: 'qa-arabic-v3' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'gpt-5-mini' })).toBeVisible();
    await expect(hero).toContainText('Execution context');
    await expect(hero).toContainText('Temperature');
    await expect(page.getByTestId('versioning-details')).toContainText('retriever_index');
    await expect(page.getByTestId('hero-runtime')).toBeVisible();
    await page.getByRole('button', { name: 'Hide run details' }).click();
    await expect(page.getByTestId('versioning-details')).toBeHidden();
  });

  test('J10: Export HTML points at the legacy export endpoint', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await expect(page.getByRole('link', { name: 'Export HTML' })).toHaveAttribute(
      'href',
      `/api/runs/${classic}/export-html`,
    );
  });

  test('metric cards: boolean split, score histogram, numeric range, error notes', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const em = metricCard(page, 'exact_match');
    await expect(em.locator('[data-segment=passed]')).toBeVisible();
    await expect(em.locator('[data-segment=failed]')).toBeVisible();
    await expect(em.locator('[data-segment=metric_errors]')).toBeVisible();
    await expect(em).toContainText('12 task errors');
    const q = metricCard(page, 'quality');
    await expect(q.locator('button[data-bucket]').first()).toBeVisible();
    await expect(q).toContainText('8 scorer errors');
    await expect(metricCard(page, 'hallucination')).toContainText('not counted in the mean');
    await expect(metricCard(page, 'tokens_used')).toContainText('Total');
  });

  test('legacy /run/<id> redirects to the project-scoped page', async ({ page }) => {
    await page.goto(`/run/${classic}`);
    await expect(page).toHaveURL(new RegExp(`/projects/[^/]+/runs/${classic}`));
    await expect(page.getByTestId('items-count')).toBeVisible();
  });

  test('legacy /run/<id> lands under the run\u2019s own project, not the last visited one', async ({
    page,
  }) => {
    const other = await seedProject('rd-other');
    await page.goto(`/projects/${other.slug}`);
    await page.goto(`/run/${classic}?item=item-0003`);
    await expect(page).toHaveURL(new RegExp(`/projects/${s.slug}/runs/${classic}\\?item=item-0003`));
  });

  test('a run link carrying the wrong project is corrected to the run\u2019s project', async ({ page }) => {
    const other = await seedProject('rd-wrong');
    await page.goto(`/projects/${other.slug}/runs/${classic}?show=failed`);
    await expect(page).toHaveURL(new RegExp(`/projects/${s.slug}/runs/${classic}\\?show=failed`));
    await expect(page.getByTestId('items-count')).toBeVisible();
  });

  test('document title follows the pass view', async ({ page }) => {
    await openRun(page, s.slug, repeat, 'pass=2');
    await expect(page).toHaveTitle(/Pass 2/);
  });
});

test.describe('not received items (scenario 12)', () => {
  test('are labelled and excluded from Completed', async ({ page }) => {
    await openRun(page, s.slug, classic);
    const strip = page.getByLabel('Run counts');
    await expect(strip).toContainText('Not received');
    const text = (await strip.innerText()).replace(/\s+/g, '');
    const val = (label: string) =>
      Number(new RegExp(`${label}(\\d[\\d,]*)`).exec(text)?.[1]?.replace(/,/g, ''));
    expect(val('Items')).toBe(240);
    expect(val('Notreceived')).toBe(3);
    // Completed leaves out the three items whose outcome never arrived
    expect(val('Completed')).toBe(240 - 3);
    // last page shows the three not-received rows
    await page.getByRole('button', { name: 'Last page' }).click();
    await expect(page.getByText('221–240 of 240 items')).toBeVisible();
    await expect
      .poll(async () => {
        await page.evaluate(() => {
          const el = document.getElementById('shell-content');
          if (el) el.scrollTop = el.scrollHeight;
        });
        return itemRow(page, 240).count();
      })
      .toBe(1);
    await expect(itemRow(page, 240)).toContainText('Not received');
    await expect(itemRow(page, 239)).toContainText('Not received');
    await expect(itemRow(page, 238)).toContainText('Not received');
    // opening one explains it
    await page.getByRole('button', { name: 'Open item #240', exact: true }).click();
    await expect(page.getByRole('note').filter({ hasText: 'Output not received' })).toBeVisible();
  });
});

test.describe('error states', () => {
  test('unknown run id shows a not-found ErrorState without Retry', async ({ page }) => {
    await page.goto(runUrl(s.slug, 'does-not-exist-123'));
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });

  test('a 500 offers Retry and Retry recovers', async ({ page }) => {
    let fail = true;
    await page.route(new RegExp(`/api/runs/${classic}\\?`), async (route) => {
      if (fail) await route.fulfill({ status: 500, json: { detail: 'boom' } });
      else await route.continue();
    });
    await page.goto(runUrl(s.slug, classic));
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(retry).toHaveCount(0);
  });
});

test.describe('virtualization', () => {
  test('page size 500 renders far fewer than 240 rows in the DOM', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('qym:run-page-size', '500'));
    await openRun(page, s.slug, classic);
    await expect(page.getByText('1–240 of 240 items')).toBeVisible();
    const rendered = await page.getByRole('button', { name: /^Open item #\d+$/ }).count();
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(100);
    // scrolling reaches the end of the list
    await page.getByTestId('items-count').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const el = document.getElementById('shell-content');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByRole('button', { name: 'Open item #240', exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: /^Open item #\d+$/ }).count()).toBeLessThan(100);
  });

  test('the Pagination size control switches the page size', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('combobox', { name: 'items per page' }).selectOption('50');
    await expect(page.getByText('1–50 of 240 items')).toBeVisible();
  });
});

test.describe('keyboard reachability', () => {
  test('filter bar controls and item rows are reachable by Tab and rows open with Enter', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    const search = page.getByRole('searchbox', { name: 'Search inputs and outputs' });
    await search.focus();
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return (a?.getAttribute('aria-label') || a?.textContent || a?.tagName || '').trim().slice(0, 40);
      });
      seen.add(name);
    }
    const joined = [...seen].join('|');
    expect(joined).toMatch(/Analysis metric|quality/);
    expect(joined).toMatch(/Filters/);
    expect(joined).toMatch(/Display/);
    // a row button opens its item by keyboard
    const open = page.getByRole('button', { name: 'Open item #2', exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid=item-card][data-item-id="item-0002"]')).toBeVisible();
  });
});
