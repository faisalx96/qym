/// <reference lib="dom" />
/**
 * Motion and loading model of the single-page workspace: nothing above the Results section moves between
 * idle, running and done; the rail keeps its height; no layout shift while a stub job runs; the target list
 * keeps its rows when the job completes; the main scrollbar never changes the content width.
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  analysisUrl,
  analyzeButton,
  failingItems,
  jobCard,
  pushRun,
  rail,
  seedAnalyzer,
  viewTabs,
  waitWorkspace,
} from './helpers';

interface Probe {
  tabs: number;
  setup: number;
  targets: number;
  rail: number;
  railHeight: number;
  width: number;
  rows: number;
}

/** Document-relative tops (scroll position does not matter) of everything above Results, plus the rail. */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __probe: Probe[]; __pi: number; __ls: number };
    w.__probe = [];
    const main = document.querySelector('main') as HTMLElement;
    const top = (el: Element | null) =>
      el ? Math.round((el.getBoundingClientRect().top + main.scrollTop) * 10) / 10 : -1;
    const heading = (name: string) =>
      Array.from(document.querySelectorAll('h3'))
        .find((h) => h.textContent === name)
        ?.closest('section') ?? null;
    w.__pi = window.setInterval(() => {
      const r = document.querySelector('section[aria-label="Analysis actions"]');
      w.__probe.push({
        tabs: top(document.querySelector('[role="tablist"]')),
        setup: top(heading('Setup')),
        targets: top(heading('Targets')),
        rail: Math.round(r ? r.getBoundingClientRect().top : -1),
        railHeight: Math.round(r ? r.getBoundingClientRect().height : -1),
        width: main.clientWidth,
        rows: document.querySelectorAll('ul[aria-label="Targets"] > li').length,
      });
    }, 50);
  });
}

async function readProbe(page: Page): Promise<Probe[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __probe: Probe[]; __pi: number };
    clearInterval(w.__pi);
    return w.__probe;
  });
}

test('nothing above Results moves, the rail keeps its size and the list keeps its rows through a job', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>)
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
  await installProbe(page);
  await page.waitForTimeout(300);
  await analyzeButton(page).click();
  await expect(jobCard(page)).toContainText('metric analyses succeeded', { timeout: 30_000 });
  await expect(rail(page).getByRole('link', { name: 'View run' })).toBeVisible();
  await page.waitForTimeout(500);
  const probe = await readProbe(page);
  expect(probe.length).toBeGreaterThan(10);
  const distinct = (key: keyof Probe) => [...new Set(probe.map((p) => p[key]))];
  expect(distinct('tabs'), 'tab row').toHaveLength(1);
  expect(distinct('setup'), 'Setup card top').toHaveLength(1);
  expect(distinct('targets'), 'Targets card top').toHaveLength(1);
  expect(distinct('railHeight'), 'rail height').toHaveLength(1);
  expect(distinct('width'), 'content width').toHaveLength(1);
  expect(distinct('rows'), 'target rows').toHaveLength(1);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls, `layout-shift score ${cls}`).toBeLessThan(0.01);
});

test('a test run fills the reserved Results section without moving the page above it', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await installProbe(page);
  await rail(page)
    .getByRole('button', { name: /^Test selected/ })
    .click();
  await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
  await page.waitForTimeout(300);
  const probe = await readProbe(page);
  for (const key of ['tabs', 'setup', 'targets', 'railHeight', 'width'] as const)
    expect([...new Set(probe.map((p) => p[key]))], key).toHaveLength(1);
  // the empty Results section already reserves its minimum height
  const slot = await page.locator('#analysis-results').evaluate((el) => el.getBoundingClientRect().height);
  expect(slot).toBeGreaterThanOrEqual(160);
});

test('the content width is the same on a short and a long page (scrollbar gutter is stable)', async ({
  page,
  request,
}) => {
  const seed = await seedAnalyzer(request);
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  const width = () => page.evaluate(() => (document.querySelector('main') as HTMLElement).clientWidth);
  const tall = await width();
  await viewTabs(page)
    .getByRole('tab', { name: /^Documents/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Reference documents' })).toBeVisible();
  expect(await width()).toBe(tall);
});

test('reduced motion removes the Disclosure and progress transitions', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoApp(page, analysisUrl(seed.slug, seed.runId));
  await waitWorkspace(page);
  await page.getByRole('button', { name: /^More options/ }).click();
  const panel = page.getByRole('button', { name: /^More options/ }).locator('xpath=ancestor::*[2]');
  await expect(panel.getByRole('textbox', { name: 'Timeout (s)' })).toBeVisible();
  const durations = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="group"][class*="panel"]')).map(
      (el) => `${el.className}:${getComputedStyle(el).transitionDuration}`,
    ),
  );
  expect(durations.length).toBeGreaterThan(0);
  for (const d of durations)
    expect(
      d
        .split(':')[1]!
        .split(',')
        .every((x) => parseFloat(x) <= 0.001),
      durations.join(' | '),
    ).toBe(true);
});

test('Test then Analyze on a 20-item run stays under the layout-shift budget', async ({ page, request }) => {
  const seed = await seedAnalyzer(request);
  const items = Array.from({ length: 5 }, (_, k) => failingItems(`b${k}`).slice(0, 4)).flat();
  const bigRun = await pushRun(request, seed.token, { name: `big-${seed.slug}`, items });
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>)
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await gotoApp(page, analysisUrl(seed.slug, bigRun));
  await waitWorkspace(page);
  await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  await rail(page)
    .getByRole('button', { name: /^Test selected/ })
    .click();
  await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
  await analyzeButton(page).click();
  await expect(jobCard(page)).toContainText('metric analyses succeeded', { timeout: 60_000 });
  await expect(page.getByText('analyzed', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(500);
  const end = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(end - start, `layout-shift during Test + Analyze: ${end - start}`).toBeLessThan(0.01);
});
