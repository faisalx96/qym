/**
 * QA fix list for the run page (docs/internal/ui-migration/qa/run-detail.md): Display submenus, sticky
 * section nav and filter bar, anchors, hide_field on badges, Approve gating, Raw span JSON, no verdict chips on
 * failed rows, 0 ms, edited tooltip + reset, empty spans, Repeat tab, per-metric pass compare, warnings, CSV
 * headers, narrow viewport, tailored 403 copy, live counter and runtime.
 */
import { test, expect, type Page } from '@playwright/test';
import { PERCENT, seedCustomRun, type CustomItem } from './cutover-support';
import {
  itemButton,
  openRun,
  scrollTop,
  seedClassic,
  seedProject,
  seedRepeat,
  settleDashboard,
  client,
  type Seeded,
} from './support';
import { seedRunningRun } from './seed';

let s: Seeded;
let classic: string;
let repeat: string;
let custom: string;

const items: CustomItem[] = [
  {
    id: 'zero',
    input: 'zero latency question',
    latency: 0,
    scores: { accuracy: { score: 0.2 } },
    metadata: {
      complexity: 'hard',
      domain: 'support',
      analysis_warning: 'No taxonomy configured for this project',
    },
  },
  { id: 'one', input: 'second question', scores: { accuracy: { score: 0.9 } } },
];

test.beforeAll(async () => {
  s = await seedProject('rd-qa-fixes');
  classic = await seedClassic(s);
  repeat = await seedRepeat(s);
  custom = await seedCustomRun(s, { name: 'qa-custom', specs: { accuracy: PERCENT }, items });
});

const card = (page: Page, id: string) => page.locator(`[data-testid=item-card][data-item-id="${id}"]`);

test.describe('Display popover submenus', () => {
  test('Item fields opens inline with the mouse, toggles a field into the URL, Escape folds it first', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: 'Display' }).click();
    const fields = page.getByRole('button', { name: /Item fields/ });
    await fields.click();
    await expect(fields).toHaveAttribute('aria-expanded', 'true');
    await page.getByText('domain', { exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.getAll('hide_field')).toEqual(['domain']);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(fields).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Metric fields works from the keyboard: Enter opens, Arrow moves, Space toggles', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page.getByRole('button', { name: 'Display' }).click();
    const fields = page.getByRole('button', { name: /Metric fields/ });
    await fields.focus();
    await page.keyboard.press('Enter');
    await expect(fields).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('textbox', { name: /Search Metric fields/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('checkbox').first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect.poll(() => new URL(page.url()).searchParams.getAll('hide_metric_field').length).toBe(1);
  });
});

test.describe('sticky section nav and filter bar', () => {
  test('both stay under the topbar while the table scrolls; the spy follows; links work', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic);
    const nav = page.getByRole('navigation', { name: 'Run sections' });
    const filters = page.getByRole('search', { name: 'Filter items' });
    await expect(nav.getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'location');
    await nav.getByRole('link', { name: /^Items/ }).click();
    await page.evaluate(() => document.getElementById('shell-content')?.scrollBy(0, 200));
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(300);
    const scroller = await page.locator('#shell-content').boundingBox();
    const navBox = await nav.boundingBox();
    const filterBox = await filters.boundingBox();
    expect(Math.abs(navBox!.y - scroller!.y)).toBeLessThan(2);
    expect(filterBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 2);
    expect(filterBox!.y).toBeLessThan(navBox!.y + navBox!.height + 40);
    await expect(nav.getByRole('link', { name: /^Items/ })).toHaveAttribute('aria-current', 'location');
    await nav.getByRole('link', { name: 'Summary' }).click();
    await expect.poll(() => scrollTop(page)).toBeLessThan(5);
  });

  test('old #run-section-* anchors scroll to the section and to the table', async ({ page }) => {
    await page.goto(`/projects/${s.slug}/runs/${classic}#run-section-errors`);
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect(page.locator('#run-section-errors')).toBeInViewport();
    await page.goto(`/projects/${s.slug}/runs/${classic}#run-section-items`);
    await expect(page.getByTestId('items-count')).toBeVisible();
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  });

  test('nav links scroll to the analysis sections', async ({ page }) => {
    await openRun(page, s.slug, classic);
    await page
      .getByRole('navigation', { name: 'Run sections' })
      .getByRole('link', { name: /Latency/ })
      .click();
    await expect(page.locator('#run-section-latency')).toBeInViewport();
  });
});

test('hide_field also hides the complexity and domain badges', async ({ page }) => {
  await openRun(page, s.slug, custom, 'item=zero');
  await expect(card(page, 'zero').getByTitle('complexity')).toBeVisible();
  await expect(card(page, 'zero').getByTitle('domain')).toBeVisible();
  await openRun(page, s.slug, custom, 'item=zero&hide_field=complexity&hide_field=domain');
  await expect(card(page, 'zero')).toBeVisible();
  await expect(card(page, 'zero').getByTitle('complexity')).toHaveCount(0);
  await expect(card(page, 'zero').getByTitle('domain')).toHaveCount(0);
});

test('an item analysis warning shows above the output', async ({ page }) => {
  await openRun(page, s.slug, custom, 'item=zero');
  const w = card(page, 'zero').getByTestId('analysis-warning');
  await expect(w).toContainText('No taxonomy');
  await expect(w).toContainText('No taxonomy configured for this project');
});

test('0 ms latency is shown, not a dash', async ({ page }) => {
  await openRun(page, s.slug, custom, 'item=zero');
  await expect(page.locator('[data-cell=latency]').first()).toHaveText('0ms');
  await expect(card(page, 'zero').locator('[data-kind=output]')).toContainText('0ms');
});

test.describe('failed rows', () => {
  test('a task error shows no metric chips and no Add-issue cards', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0008');
    const c = card(page, 'item-0008');
    await expect(c).toBeVisible();
    await expect(c.locator('[data-kind=output]')).toContainText('ERROR');
    await expect(c.locator('[role=listitem][data-metric]')).toHaveCount(0);
    await expect(c.getByTestId('metric-analysis-card')).toHaveCount(0);
    await expect(c.getByRole('button', { name: '+ Add issue' })).toHaveCount(0);
  });

  test('a not-received item says so and has no chips or cards', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0240');
    const c = card(page, 'item-0240');
    await expect(c).toContainText('Output not received');
    await expect(c.locator('[role=listitem][data-metric]')).toHaveCount(0);
    await expect(c.getByTestId('metric-analysis-card')).toHaveCount(0);
  });

  test('a failing item still gets its chips and cards', async ({ page }) => {
    await openRun(page, s.slug, classic, 'item=item-0003');
    const c = card(page, 'item-0003');
    await expect(c.locator('[role=listitem][data-metric=quality]')).toBeVisible();
    await expect(c.getByTestId('metric-analysis-card').first()).toBeVisible();
  });
});

test.describe('Approve gating by the server review status', () => {
  const stub = async (page: Page, status: string) =>
    page.route(/\/items\/details/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const row of body.rows ?? []) {
        if (row.item_id !== 'item-0003') continue;
        row.item_metadata = {
          ...row.item_metadata,
          metric_analyses: {
            quality: {
              root_cause_issues: [
                {
                  issue_id: 'i1',
                  category: 'Retrieval',
                  subcategory: 's',
                  finding: 'f',
                  review_status: 'pending',
                },
              ],
            },
          },
        };
        row.review_issue_statuses = { quality: [{ issue_id: 'i1', status }] };
      }
      await route.fulfill({ response, json: body });
    });

  test('a rejected issue offers no Approve and says Rejected', async ({ page }) => {
    await stub(page, 'rejected');
    await openRun(page, s.slug, classic, 'item=item-0003');
    const issue = card(page, 'item-0003').getByTestId('issue');
    await expect(issue).toContainText('Rejected');
    await expect(issue.getByRole('button', { name: /Approve issue/ })).toHaveCount(0);
    await expect(issue.getByRole('button', { name: 'Edit' })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a decided review wins over a stale pending issue; a pending one keeps Approve', async ({ page }) => {
    await stub(page, 'approved');
    await openRun(page, s.slug, classic, 'item=item-0003');
    await expect(card(page, 'item-0003').getByTestId('issue')).toContainText('Approved');
    await expect(card(page, 'item-0003').getByRole('button', { name: /Approve issue/ })).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await stub(page, 'pending');
    await openRun(page, s.slug, classic, 'item=item-0003');
    await expect(card(page, 'item-0003').getByRole('button', { name: /Approve issue/ })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('scores', () => {
  test('the edited badge says who, when and old to new, and its reset action restores the scorer value', async ({
    page,
  }) => {
    await openRun(page, s.slug, classic, 'item=item-0006');
    const chip = card(page, 'item-0006').locator('[role=listitem][data-metric=quality]');
    await chip.getByRole('button', { name: 'Edit quality score' }).click();
    await chip.getByRole('textbox', { name: 'New quality score' }).fill('0.5');
    await chip.getByRole('button', { name: 'Save' }).click();
    const badge = chip.getByText('edited', { exact: true });
    await expect(badge).toBeVisible();
    const title = (await badge.getAttribute('title')) ?? '';
    expect(title).toMatch(/^Edited by .+ on /);
    expect(title).toContain('→');
    expect(title).toContain('Original score:');
    await chip.getByRole('button', { name: /^Reset quality to its original score/ }).click();
    await expect(page.getByText(/quality reset to its original score/i)).toBeVisible();
    await expect(chip.getByText('edited', { exact: true })).toHaveCount(0);
  });
});

test.describe('traces', () => {
  test('the Raw tab shows the span as ingested, without the tree builder fields', async ({ page }) => {
    await openRun(page, s.slug, classic, 'trace=item-0004');
    const detail = page.getByRole('region', { name: 'Span details' });
    await page
      .getByRole('tree', { name: 'Span tree' })
      .getByRole('treeitem', { name: /ChatOpenAI/ })
      .click();
    await detail.getByRole('tab', { name: 'Raw' }).click();
    const raw = detail.getByRole('tabpanel');
    await expect(raw).toContainText('span_id');
    for (const internal of [
      '_children',
      '_depth',
      '_orphan',
      '_groupParent',
      '_retry',
      '_try',
      '_failed',
      '"_i"',
    ]) {
      await expect(raw).not.toContainText(internal);
    }
  });

  test('an item with a trace id but no spans explains itself', async ({ page }) => {
    await page.route(/\/items\/item-0004\/trace/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, spans: [], attempts: [], summary: { ...(body.summary ?? {}), span_count: 0 } },
      });
    });
    await openRun(page, s.slug, classic, 'trace=item-0004');
    await expect(page.getByTestId('trace-empty')).toContainText('Spans were not captured');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('repeat runs', () => {
  test('the Repeat tab switches statistic, shows median latency and the queued passes, with direction-aware help', async ({
    page,
  }) => {
    await page.route(/\/api\/runs\/[^/]+\/passes/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.passes = [
        ...body.passes,
        { pass_number: body.passes.length + 1, status: 'pending', queued: true },
      ];
      body.samples = body.passes.length;
      await route.fulfill({ response, json: body });
    });
    await openRun(page, s.slug, repeat, 'panel=repeat');
    const panel = page.getByTestId('repeat-analysis');
    await expect(panel.getByRole('columnheader', { name: 'Median latency' })).toBeVisible();
    await expect(panel.getByTestId('queued-passes')).toContainText(/Pass \d of \d queued/);
    const group = panel.getByRole('radiogroup', { name: 'Repeat performance view' });
    await expect(group.getByRole('radio')).toHaveCount(4);
    await group.getByText('Pass^k', { exact: true }).click();
    await expect(panel).toContainText('Probability that all k selected attempts pass.');
    await group.getByText('Average', { exact: true }).click();
    await expect(panel).toContainText('Average score as observed passes are added.');
    await expect(panel.locator('[data-stat=pass_at_k]')).toHaveAttribute(
      'title',
      /(≥\d+%|perfect score|best score)/,
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a repeat item lines up one metric across the passes', async ({ page }) => {
    await openRun(page, s.slug, repeat);
    await itemButton(page, 1).click();
    const compare = page.getByTestId('pass-metric-compare').first();
    await expect(compare).toBeVisible();
    await expect(compare.locator('[data-pass]')).toHaveCount(3);
  });
});

test('the pager arrow previews the neighbouring run', async ({ page }) => {
  settleDashboard();
  await openRun(page, s.slug, custom);
  const step = page.getByRole('link', { name: /^(Previous|Next) run:/ }).first();
  await expect(step).toBeVisible();
  await step.hover();
  const peek = page.getByTestId('pager-peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText(/claude-sonnet-4|gpt-5-mini|cutover\/model/);
  await expect(peek).toContainText(/2026/);
});

test('a heatmap cell opens its own pass', async ({ page }) => {
  await openRun(page, s.slug, repeat, 'view=heatmap');
  await page
    .getByRole('grid', { name: /by item and pass/ })
    .getByRole('button', { name: /^Item #2 pass 2:/ })
    .click();
  await expect.poll(() => new URL(page.url()).searchParams.get('pass')).toBe('2');
  await expect(card(page, 'sql-002')).toBeVisible();
});

test('the CSV header uses the old page keys', async ({ page }) => {
  await openRun(page, s.slug, custom);
  await page.getByTestId('csv-button').click();
  const dlg = page.getByRole('dialog');
  const download = page.waitForEvent('download', { timeout: 20_000 });
  await dlg.getByTestId('csv-download').click();
  const path = await (await download).path();
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(path, 'utf8');
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim().split('\r\n');
  const head = lines[0]!.split(',');
  expect(head[0]).toBe('#');
  expect(head).toEqual(
    expect.arrayContaining(['meta:domain', 'accuracy_score', 'accuracy:root_cause_issues', 'latency_ms']),
  );
  // the 0 ms item keeps its zero
  expect(lines[1]!.split(',')[head.indexOf('latency_ms')]).toBe('0');
});

test('at 420px neither the page nor the topbar title overflows', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await openRun(page, s.slug, classic);
  const overflow = await page.evaluate(() => {
    const sc = document.getElementById('shell-content')!;
    return sc.scrollWidth - sc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.getElementById('shell-content')?.scrollTo(0, 400));
  const doc = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.inner);
  const boxes = await page.evaluate(() => {
    const crumbs = Array.from(document.querySelectorAll('header nav ol > li')).map((li) => {
      const r = li.getBoundingClientRect();
      return { l: r.left, r: r.right };
    });
    const trigger = document.querySelector('header nav ol > li:first-child button')!.getBoundingClientRect();
    return { crumbs, triggerRight: trigger.right, firstRight: crumbs[0]!.r };
  });
  expect(boxes.triggerRight).toBeLessThanOrEqual(boxes.firstRight + 1);
});

test('a 403 says "No access to this run" and links back to the Dashboard', async ({ page }) => {
  await page.route(new RegExp(`/api/runs/${classic}\\?`), (route) =>
    route.fulfill({ status: 403, json: { detail: 'forbidden' } }),
  );
  await page.goto(`/projects/${s.slug}/runs/${classic}`);
  await expect(page.getByRole('heading', { name: 'No access to this run' })).toBeVisible();
  const back = page.getByRole('link', { name: /Back to Dashboard/ });
  await expect(back).toHaveAttribute('href', `/projects/${s.slug}`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test.describe('live run', () => {
  test.setTimeout(60_000);
  test('the runtime ticks beside the status and "updated Ns ago" restarts on every probe', async ({
    page,
  }) => {
    const { runId } = await seedRunningRun(client, s.token, 10);
    await openRun(page, s.slug, runId);
    await expect(page.getByTestId('hero-runtime-live')).toContainText('Runtime');
    const indicator = page.getByTestId('live-indicator');
    await expect(indicator).toContainText(/updated \d+s ago/);
    // probes land every 3 s: the counter never climbs far past that
    await page.waitForTimeout(8000);
    const secs = Number(/updated (\d+)s ago/.exec((await indicator.textContent()) ?? '')?.[1]);
    expect(secs).toBeLessThanOrEqual(4);
  });
});
