/// <reference lib="dom" />
/** QA fix list (docs/internal/ui-migration/qa/analyzer.md): job outcome, drafts, redirects, defaults, confirmations. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, patchJson, seedAnalyzer, step, toggleBox, waitWorkspace } from './helpers';

const jobRegion = (page: Page) => page.getByRole('region', { name: 'Analysis job' });
const isRuleSave = (r: { method(): string; url(): string }) =>
  r.method() === 'PATCH' && /analysis-context$/.test(r.url());

async function openRun(page: Page, slug: string, runId: string, query = ''): Promise<void> {
  await gotoApp(page, analysisUrl(slug, runId, query));
  await waitWorkspace(page);
  await step(page, 'Run').click();
  await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeVisible();
}

test.describe('job outcome (1, 6, 12)', () => {
  test('every analysis failed: bar, Review card and toast say "Analysis failed"', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request, { model: 'bad-model' });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    await expect(jobRegion(page)).toContainText('0 of 6 metric analyses succeeded, 6 failed', {
      timeout: 30_000,
    });
    await expect(jobRegion(page).getByText('Analysis failed', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Analysis failed: 0 of 6 metric analyses succeeded, 6 failed').first(),
    ).toBeVisible();
    await jobRegion(page).getByRole('button', { name: 'Review results' }).click();
    const card = jobRegion(page);
    await expect(card).toContainText('0 of 6 metric analyses succeeded, 6 failed.');
    await expect(card.getByText('Analysis failed', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('Created ', { exact: false })).toHaveCount(0);
    // never filed under the generic "error" code
    await expect(card.getByRole('list', { name: 'Errors by code' })).not.toContainText(/^error\b/);
  });

  test('completed job shows categories and keeps the sample in View run', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!, '&pass=2'));
    await waitWorkspace(page);
    await expect(page.getByRole('link', { name: 'View run' })).toHaveAttribute(
      'href',
      new RegExp(`/runs/${seed.repeatId}\\?pass=2$`),
    );
    await step(page, 'Run').click();
    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    await expect(jobRegion(page)).toContainText('metric analyses succeeded', { timeout: 30_000 });
    await expect(jobRegion(page).getByRole('link', { name: 'View run' })).toHaveAttribute(
      'href',
      /\?pass=2$/,
    );
    await jobRegion(page).getByRole('button', { name: 'Review results' }).click();
    await expect(jobRegion(page)).toContainText(/Created \d+ categor/);
  });
});

test.describe('project and run errors (7, 8)', () => {
  test('a run opened under another project lands under its own project', async ({ page, request }) => {
    const a = await seedAnalyzer(request);
    const b = await seedAnalyzer(request, { slugPrefix: 'other' });
    await gotoApp(page, analysisUrl(b.slug, a.runId));
    await expect(page).toHaveURL(new RegExp(`/projects/${a.slug}/analysis\\?run=${a.runId}`));
    await waitWorkspace(page);
  });

  test('unknown run: "Unable to load auto-analysis" with an Open Runs link', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, 'nope'));
    await expect(page.getByRole('heading', { name: 'Unable to load auto-analysis' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Runs' })).toHaveAttribute(
      'href',
      `/projects/${seed.slug}`,
    );
  });
});

test.describe('settings (4, 15, 16, 21)', () => {
  test('an emptied or 0 timeout / max issues restores the default; help text is present', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    const timeout = page.getByRole('textbox', { name: 'Timeout (s)' });
    const issues = page.getByRole('textbox', { name: 'Max issues per item' });
    await expect(
      page.getByText(/each retry doubles the previous timeout|retries are disabled/),
    ).toBeVisible();
    await expect(page.getByText('Limits how many root-cause issues')).toBeVisible();
    const before = await timeout.inputValue();
    const beforeIssues = await issues.inputValue();
    await timeout.fill('');
    await timeout.blur();
    await expect(timeout).toHaveValue(before);
    await timeout.fill('0');
    await timeout.blur();
    await expect(timeout).toHaveValue(before);
    await issues.fill('');
    await issues.blur();
    await expect(issues).toHaveValue(beforeIssues);
    await step(page, 'Run').click();
    const body = page.waitForRequest((r) => r.url().includes('/analyze-test'));
    await page.getByRole('button', { name: 'Test Selected (1)' }).click();
    expect(((await body).postDataJSON() as { timeout_seconds: number }).timeout_seconds).toBe(Number(before));
  });

  test('zero targets with Skip analyzed offers Open Reviews; the last step has no disabled Done', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: 'Analyze 4 items' }).click();
    await expect(jobRegion(page)).toContainText('metric analyses succeeded', { timeout: 30_000 });
    await step(page, 'Configure').click();
    await expect(page.getByRole('link', { name: 'Open Reviews' })).toHaveAttribute(
      'href',
      `/projects/${seed.slug}/reviews`,
    );
    await step(page, 'Review').click();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to Configure' }).click();
    await expect(page).not.toHaveURL(/step=review/);
  });
});

test.describe('guidance (2, 3, 9)', () => {
  test('a rule typed and left within the debounce window is still saved', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=rules`);
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Flush me');
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Saved even when I leave early.');
    const saved = page.waitForRequest(isRuleSave);
    await page.getByRole('tab', { name: /^Documents/ }).click();
    expect(JSON.stringify((await saved).postDataJSON())).toContain('Flush me');
    await page.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page.getByRole('button', { name: 'Flush me', exact: true })).toBeVisible();
  });

  test('deleting rules asks first (single and bulk)', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=rules`);
    for (const n of [1, 2]) {
      await page.getByRole('button', { name: 'Add rule' }).click();
      await page.getByRole('textbox', { name: 'Title' }).fill(`Rule ${n}`);
      await page.getByRole('textbox', { name: 'Instruction' }).fill(`Do thing ${n}.`);
    }
    await page.getByRole('button', { name: 'Delete rule Rule 1' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete this rule?' });
    await dialog.getByRole('button', { name: 'Keep' }).click();
    await expect(page.getByTestId('rule-count')).toContainText('2 rules');
    await page.getByRole('button', { name: 'Delete rule Rule 1' }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete this rule?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByTestId('rule-count')).toContainText('1 rule ');
    await toggleBox(page.getByRole('checkbox', { name: 'Select Rule 2' }));
    await page.getByRole('button', { name: /^Delete selected/ }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete this rule?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByTestId('rule-count')).toContainText('0 rules');
  });

  test('diagnosis search keeps list and editor on the same category', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
    const tabs = page.getByRole('tablist', { name: 'Categories' });
    await expect(tabs.getByRole('tab').nth(1)).toBeVisible();
    const names = (await tabs.getByRole('tab').allInnerTexts()).map((t) => t.split('\n')[0] ?? '');
    const target = names.find((n) => n.length > 3) ?? names[0]!;
    const search = page.getByRole('searchbox').first();
    await search.fill(target.slice(0, 3).toLowerCase());
    const selected = tabs.getByRole('tab', { selected: true });
    await expect(selected).toContainText(new RegExp(`^${target.slice(0, 3)}`, 'i'));
    await search.fill('zzzqq');
    await expect(page.getByText('No matching categories')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove category' })).toHaveCount(0);
  });
});

test.describe('connection without a key (11)', () => {
  test('is labelled, not selectable, and Test / Analyze stay off for it', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await patchJson(page, /analysis-config/, (json) => {
      const list = json.llm_connections as Array<Record<string, unknown>>;
      return {
        ...json,
        llm_connections: [...list, { ...list[0], id: 'no-key', name: 'nokey', llm_api_key_set: false }],
      };
    });
    await openRun(page, seed.slug, seed.runId);
    await page.getByRole('button', { name: /LLM connection/ }).click();
    const option = page.getByRole('option', { name: /key missing/ });
    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await option.click({ force: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Test Selected (1)' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /LLM connection/ })).not.toContainText('nokey');
  });
});
