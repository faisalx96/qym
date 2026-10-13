/// <reference lib="dom" />
/** Analyzer scenario 14 (keyboard, axe) plus RTL input, the 800x900 viewport and a console-clean happy path. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import {
  analysisUrl,
  analyzeButton,
  analyzeToCompletion,
  jobCard,
  openPreview,
  previewDrawer,
  rail,
  seedAnalyzer,
  toggleBox,
  trackErrors,
  viewTabs,
  waitWorkspace,
} from './helpers';

async function expectNoSerious(page: Page, label: string): Promise<void> {
  // dialogs fade in: axe must not sample half-transparent text
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

test.describe('axe (14)', () => {
  test('the page, the Input mapping disclosure, the preview drawer, a test result and a finished job', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
    await expectNoSerious(page, 'page');

    // detected variable row + open path picker
    await page.getByRole('textbox', { name: 'Additional instructions' }).fill('Use {rubric}');
    const vars = page.getByLabel('Detected variables');
    await vars.getByRole('button', { name: /\{rubric\} source/ }).click();
    await page.getByRole('option', { name: 'input', exact: true }).click();
    await vars.getByRole('button', { name: 'Full value' }).click();
    await expect(page.getByRole('group', { name: '{rubric} fields' })).toBeVisible();
    await expectNoSerious(page, 'page with a variable and its picker');

    await page.getByRole('button', { name: /^Input mapping/ }).click();
    await expect(page.getByRole('button', { name: /Input source/ })).toBeVisible();
    await page.getByRole('button', { name: /^More options/ }).click();
    await expectNoSerious(page, 'disclosures open');

    await openPreview(page);
    await expectNoSerious(page, 'preview drawer');
    await page.keyboard.press('Escape');
    await expect(previewDrawer(page)).toBeHidden();

    await rail(page).getByRole('button', { name: /^Test selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await expectNoSerious(page, 'with a test result');

    await analyzeToCompletion(page);
    await expectNoSerious(page, 'finished job');
  });

  test('the three guidance tabs, a populated rule editor and the version dialogs', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
    await expect(page.getByRole('tab', { name: /^Diagnosis categories/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tablist', { name: 'Categories' })).toBeVisible();
    for (const label of ['Guidance', 'Subcategories', 'Examples']) {
      await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
      await expectNoSerious(page, `categories / ${label}`);
    }
    await page.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page.getByRole('heading', { name: 'Rules in v1' })).toBeVisible();
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Cite the context');
    await page
      .getByRole('textbox', { name: 'Instruction' })
      .fill('Say which context lines support the answer.');
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expectNoSerious(page, 'rules');
    await page.getByRole('button', { name: 'Publish' }).click();
    const publish = page.getByRole('dialog', { name: 'Publish v1' });
    await expect(publish).toBeVisible();
    await expectNoSerious(page, 'publish dialog');
    await page.keyboard.press('Escape');
    await expect(publish).toBeHidden();
    await page.getByRole('tab', { name: /^Documents/ }).click();
    await expect(page.getByRole('heading', { name: 'Reference documents' })).toBeVisible();
    await expectNoSerious(page, 'documents (empty)');
    await page
      .getByTestId('document-input')
      .setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('some reference text') });
    await expect(page.getByRole('list', { name: 'Document library' })).toContainText('a.txt');
    await expectNoSerious(page, 'documents (library)');
  });

  test('project landing and the sample picker', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    await gotoApp(page, `/projects/${seed.slug}/analysis`);
    await expect(page.getByText('Select a run to analyze')).toBeVisible();
    await expectNoSerious(page, 'landing');
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!));
    await expect(page.getByText('Choose a sample')).toBeVisible();
    await expectNoSerious(page, 'sample picker');
  });
});

test.describe('keyboard (14)', () => {
  test('Tab reaches the tabs and the rail with a visible focus ring; Enter opens the drawer', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(viewTabs(page).getByRole('tab')).toHaveCount(4);
    const previewBtn = rail(page).getByRole('button', { name: /^Prompt preview/ });
    await previewBtn.focus();
    const ring = await previewBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, shadow: cs.boxShadow, matches: el.matches(':focus-visible') };
    });
    expect(ring.matches).toBe(true);
    expect(ring.outline !== 'none' || ring.shadow !== 'none', JSON.stringify(ring)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(previewDrawer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(previewBtn).toBeFocused();
    // the Input mapping disclosure toggles with Space
    const mapping = page.getByRole('button', { name: /^Input mapping/ });
    await mapping.focus();
    await page.keyboard.press('Space');
    await expect(mapping).toHaveAttribute('aria-expanded', 'true');
  });

  test('arrow keys move between the guidance tabs; Escape closes dialogs', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
    const tabs = viewTabs(page);
    const first = tabs.getByRole('tab', { name: /^Diagnosis categories/ });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/scope=rules/);
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: /^Documents/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: /^Analyze run/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page).not.toHaveURL(/scope=/);
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/scope=categories/);

    // inner vertical category tabs use ArrowDown
    const cats = page.getByRole('tablist', { name: 'Categories' });
    await cats.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(cats.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');

    // Escape closes the remove-category confirm without removing anything
    await page.getByRole('button', { name: 'Remove category' }).click();
    const confirm = page
      .getByRole('alertdialog', { name: 'Remove category?' })
      .or(page.getByRole('dialog', { name: 'Remove category?' }));
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(cats.getByRole('tab')).toHaveCount(9);
  });

  test('Escape closes the human-label confirm and nothing is posted', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await request.post('/api/runs/update_root_cause', {
      data: {
        run_id: seed.runId,
        item_id: 'item-1',
        metric_name: 'exact_match',
        root_cause_issues: [{ category: 'Wrong Format', subcategory: 'x', finding: 'y' }],
      },
    });
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await toggleBox(page.getByRole('switch', { name: 'Re-analyze human labels' }));
    let posted = 0;
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/analysis-jobs') && (posted += 1));
    await analyzeButton(page).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByText('Overwrite human diagnoses?')).toBeVisible();
    await expectNoSerious(page, 'human-label confirm');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    expect(posted).toBe(0);
    await expect(analyzeButton(page)).toBeFocused();
  });
});

test.describe('layout', () => {
  test('Arabic item input renders right-to-left', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withArabic: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.arabicId!));
    await waitWorkspace(page);
    const first = page.getByRole('list', { name: 'Targets' }).getByRole('listitem').first();
    const text = first.locator('[dir="rtl"]', { hasText: 'اعرض' });
    await expect(text).toHaveCount(1);
    await expect(text).toHaveCSS('direction', 'rtl');
    // the preview body keeps dir=auto so the same text reads right-to-left there too
    await openPreview(page);
    const body = previewDrawer(page).getByRole('region', { name: 'Prompt messages' }).locator('pre').first();
    await expect(body).toHaveAttribute('dir', 'auto');
    await expect(body).toContainText('اعرض');
  });

  test('800x900: no horizontal page scroll on the page, its states or a guidance tab', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await page.setViewportSize({ width: 800, height: 900 });
    const overflow = () =>
      page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
    const expectFits = async (label: string) => {
      const o = await overflow();
      expect(o.doc, `${label}: documentElement overflows by ${o.doc}px`).toBeLessThanOrEqual(0);
      expect(o.body, `${label}: body overflows by ${o.body}px`).toBeLessThanOrEqual(0);
    };
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
    await expectFits('page');
    await page.getByRole('textbox', { name: 'Additional instructions' }).fill('Use {rubric}');
    await expectFits('with a variable');
    await page.getByRole('button', { name: /^Input mapping/ }).click();
    await expectFits('input mapping open');
    await openPreview(page);
    await expectFits('preview drawer');
    await page.keyboard.press('Escape');
    await rail(page).getByRole('button', { name: /^Test selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await expectFits('with a result');
    await analyzeToCompletion(page);
    await expectFits('finished job');
    for (const tab of ['categories', 'rules', 'documents']) {
      await gotoApp(page, `/projects/${seed.slug}/analysis?scope=${tab}`);
      await expect(viewTabs(page)).toBeVisible();
      await page.waitForTimeout(300);
      await expectFits(`guidance ${tab}`);
    }
  });

  test('the happy path logs no console errors or page errors', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    const t = trackErrors(page);
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!));
    await page.getByRole('button', { name: 'Analyze sample 1' }).click();
    await waitWorkspace(page);
    await openPreview(page);
    await page.keyboard.press('Escape');
    await rail(page).getByRole('button', { name: /^Test selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await analyzeToCompletion(page);
    await expect(jobCard(page)).toContainText('Analysis complete');
    for (const tab of ['categories', 'rules', 'documents']) {
      await gotoApp(page, `/projects/${seed.slug}/analysis?run=${seed.repeatId}&pass=1&scope=${tab}`);
      await expect(viewTabs(page)).toBeVisible();
      await page.waitForTimeout(400);
    }
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });
});
