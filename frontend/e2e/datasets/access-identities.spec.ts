/**
 * Review-A fix pass: the restricted-run states with REAL identities (no rewritten answers). Needs the
 * platform in header-auth mode, where each request names its user:
 *
 *   QYM_E2E_AUTH_MODE=proxy_headers QYM_ADMIN_BOOTSTRAP_TOKEN=e2e-bootstrap npx playwright test e2e/datasets/access-identities.spec.ts
 *
 * The first account claims admin with the bootstrap token and seeds a project with a restricted dataset
 * and a run on it. A member without a grant (level none) then opens the run and the compare page.
 */
import { test, expect, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { createUser, uniqueSlug } from '../helpers';
import { runUrl } from '../run-detail/support';
import { near, setAccess, size } from './access-support';
import {
  bulkItems,
  createApiKey,
  createDataset,
  createVersion,
  ingestRun,
  publishVersion,
  sampleItems,
} from './support';

const PROXY = process.env.QYM_E2E_AUTH_MODE === 'proxy_headers';
const TOKEN = process.env.QYM_ADMIN_BOOTSTRAP_TOKEN ?? '';
const HIDDEN = 'Hidden: you don’t have access to this dataset’s items.';

test.describe('a member with no access to a restricted dataset (real identities)', () => {
  test.skip(!PROXY, 'needs QYM_E2E_AUTH_MODE=proxy_headers');
  test.skip(PROXY && !TOKEN, 'needs QYM_ADMIN_BOOTSTRAP_TOKEN');
  test.describe.configure({ mode: 'serial' });

  let admin: APIRequestContext;
  let slug = '';
  let runId = '';
  let runB = '';
  const noneEmail = `${uniqueSlug('none')}@e2e.local`;
  const viewEmail = `${uniqueSlug('view')}@e2e.local`;

  async function as(browser: Browser, email: string, baseURL: string | undefined): Promise<BrowserContext> {
    const context = await browser.newContext({
      baseURL,
      colorScheme: 'dark',
      extraHTTPHeaders: { 'X-User-Email': email, Origin: baseURL ?? '' },
    });
    await context.addInitScript(() => {
      (window as unknown as { __QYM_APP__: unknown }).__QYM_APP__ = {
        rootPath: '',
        authMode: 'proxy_headers',
        sessionAuth: false,
        environment: 'test',
      };
    });
    return context;
  }

  test.beforeAll(async ({ playwright, baseURL }) => {
    const email = `${uniqueSlug('admin')}@e2e.local`;
    admin = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Email': email, Origin: baseURL ?? '' },
    });
    const claimed = await admin.post('/v1/auth/bootstrap-admin', { data: { bootstrap_token: TOKEN } });
    expect(claimed.ok(), await claimed.text()).toBeTruthy();
    slug = uniqueSlug('ident');
    const project = await (await admin.post('/v1/projects', { data: { name: 'Identities', slug } })).json();
    const members = [] as { id: string; email: string }[];
    for (const e of [noneEmail, viewEmail]) {
      const user = await createUser(admin, e, e.split('@')[0]);
      await admin.post(`/v1/projects/${project.id}/members`, { data: { user_id: user.id, role: 'MEMBER' } });
      members.push({ id: user.id, email: e });
    }
    const key = await createApiKey(admin, project.id);
    const d = await createDataset(admin, slug, 'Legal clauses');
    const v = await createVersion(admin, slug, d.slug);
    const items = sampleItems(6);
    await bulkItems(admin, slug, d.slug, v.version, items);
    await publishVersion(admin, slug, d.slug, v.version, true);
    await setAccess(admin, slug, d.slug, 'restricted', [{ user_id: members[1]!.id, level: 'view' }]);
    const run = await ingestRun(admin, {
      apiKey: key,
      task: 'faq',
      runName: 'restricted run',
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    runId = run.id;
    runB = (
      await ingestRun(admin, {
        apiKey: key,
        task: 'faq',
        runName: 'restricted run B',
        dataset: d,
        version: { ...v, status: 'published' },
        items,
      })
    ).id;
  });
  test.afterAll(async () => {
    await admin?.dispose();
  });

  test('the run page names the right cause, never the private test set, and an open item shows the redacted line (F1, F2)', async ({
    browser,
    baseURL,
  }) => {
    const context = await as(browser, noneEmail, baseURL);
    for (const width of [1440, 390]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(runUrl(slug, runId));
      await expect(page.getByTestId('restricted-dataset-banner')).toBeVisible();
      await expect(page.getByTestId('items-count')).toBeVisible();
      // F1: the cause is the dataset, in the table and on the whole page.
      await expect(page.locator('body')).not.toContainText(/private test set/i);
      await expect(page.locator('body')).toContainText(HIDDEN);
      // F2: expanding an item renders its card: one redacted line, no spinner.
      const open = page.getByRole('button', { name: /^Open item #1$/ }).first();
      await open.click();
      const card = page.locator('[data-testid=item-card]');
      await expect(card).toHaveCount(1);
      await expect(page.getByTestId('run-item-redacted')).toHaveCount(1);
      await expect(page.getByTestId('run-item-redacted')).toHaveText(HIDDEN);
      await expect(page.getByText('Loading item details…')).toHaveCount(0);
      const line = await size(page.getByTestId('run-item-redacted'));
      expect(line.h).toBeLessThan(40); // one line of base text (two at 390 where it may wrap)
      await expect(page.locator('body')).not.toContainText(/private test set/i);
      await page.close();
    }
    // The details endpoint words it the same way and leaks nothing.
    const details = await context.request.post(`/api/runs/${runId}/items/details`, {
      data: { item_ids: ['q-001'] },
    });
    expect(details.ok(), await details.text()).toBeTruthy();
    const text = await details.text();
    expect(text).toContain(HIDDEN);
    expect(text).not.toMatch(/private test set/i);
    expect(text).not.toContain('refund policy');
    await context.close();
  });

  test('compare output cards show the dataset-access line (F3)', async ({ browser, baseURL }) => {
    const context = await as(browser, noneEmail, baseURL);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/compare?cohortA=${runId}&cohortB=${runB}&tab=items`);
    const notes = page.getByText(HIDDEN);
    await expect(notes.first()).toBeVisible();
    expect(await notes.count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('body')).not.toContainText(/private test set/i);
    await context.close();
  });

  test('a member with a view grant sees the catalog badge at 91.5 x 20 (F5)', async ({
    browser,
    baseURL,
  }) => {
    const context = await as(browser, viewEmail, baseURL);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${slug}/datasets`);
    const badge = page.locator('[data-dataset-card] ').getByText('View only', { exact: true });
    await expect(badge).toBeVisible();
    const box = await size(badge);
    near(box.w, 91.5, 1);
    expect(box.h).toBe(20);
    await context.close();
  });
});
