/**
 * Baseline of the pages the feedback feature borrows from (runs list, run detail header, project LLM connections form,
 * Admin tabs, app shell navigation) at 1440 / 1024 / 390. Writes measure/baseline-e/*.json and shots/baseline-e-*.png.
 *   SLUG=support-agent RUN_ID=<id> node baseline.mts
 */
import { API, APP, WIDTHS, boxes, chromium, open, save, shot } from './lib.mts';

const slug = process.env.SLUG ?? 'support-agent';
let runId: string | undefined = process.env.RUN_ID;
const browser = await chromium.launch();
const shell = {
  sidebar: 'aside, [class*="sidebar"]',
  navItems: '[data-nav][]',
  topbar: 'header',
  main: 'main',
  userMenu: '[class*="user"]',
};
for (const w of WIDTHS) {
  const { ctx, page } = await open(browser, w, 900);
  const go = async (p: string, ready: string) => {
    await page.goto(APP + p, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready, { timeout: 15000 });
    await page.waitForTimeout(600);
  };
  // runs list
  await go(`/projects/${slug}`, '[data-testid="runs-table"]');
  const rl = await boxes(page, {
    pageHeader: 'h1', page: '[data-testid="runs-page"]', filterBar: '[data-testid="filter-bar"]', table: '[data-testid="runs-table"]',
    headerCells: 'th[]', firstRow: 'tbody tr', rows: 'tbody tr[]', search: '[data-testid="filter-bar"] input', ...shell,
  });
  save('baseline-e', `runs-list-${w}`, rl);
  await shot(page, `baseline-e-runs-list-${w}`);
  if (!runId) runId = (await page.locator('tbody a[href*="/runs/"]').first().getAttribute('href'))?.replace(/^.*\/runs\//, '') ?? undefined;
  // shell navigation (at 1440/1024 sidebar expanded; 390 collapsed rail)
  save('baseline-e', `shell-${w}`, await boxes(page, { ...shell, brand: 'a[title="Projects"]', navSections: 'nav[]', navItem: '[data-nav]' }));
  // run detail
  if (runId) {
    await go(`/projects/${slug}/runs/${runId}`, '[data-testid="run-hero"]');
    save('baseline-e', `run-detail-${w}`, await boxes(page, {
      hero: '[data-testid="run-hero"]', strip: '[data-testid="run-hero-strip"]', title: '[data-testid="run-hero"] h1', ctx: '[data-testid="hero-context"]',
    }));
    await shot(page, `baseline-e-run-detail-${w}`, undefined, false);
  }
  // project LLM connections (borrowed form)
  await go(`/projects/${slug}/settings?tab=llm`, '[aria-label="LLM connections"]');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.waitForSelector('[data-llm-form]');
  save('baseline-e', `settings-llm-${w}`, await boxes(page, {
    page: '[data-settings-page]', tabs: '[role=tablist]', table: '[aria-label="LLM connections"]', form: '[data-llm-form]',
    formCard: '[data-llm-form] > div', fields: '[data-llm-form] input[]', labels: '[data-llm-form] label[]', buttons: '[data-llm-form] button[]',
    header: 'h1',
  }));
  await shot(page, `baseline-e-settings-llm-${w}`);
  // admin
  await go('/admin/maintenance', '[data-admin-page]');
  save('baseline-e', `admin-maintenance-${w}`, await boxes(page, {
    page: '[data-admin-page]', header: 'h1', tabs: '[role=tablist]', tabItems: '[role=tab][]', panel: '[role=tabpanel]', cards: '[data-admin-page] section[]',
  }));
  await shot(page, `baseline-e-admin-${w}`);
  await go('/admin/users', '[data-admin-page]');
  save('baseline-e', `admin-users-${w}`, await boxes(page, { page: '[data-admin-page]', tabs: '[role=tablist]', panel: '[role=tabpanel]', table: 'table', rows: 'tbody tr[]' }));
  await ctx.close();
}
await browser.close();
console.log('baseline done', runId);
