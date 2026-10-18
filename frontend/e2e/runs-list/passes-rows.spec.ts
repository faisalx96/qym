/**
 * Redesign 4: the passes of a repeat run are rows of the runs table (docs/internal/ui-migration/redesign4/runs-passes.md).
 * One test per criterion group, named after the criteria (Q1 .. Q32).
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import {
  axeSeriousViolations,
  clickBox,
  describeViolations,
  freshProject,
  openRuns,
  rowOf,
  table,
} from './support';

const NAME = 'rag-answer-v7';
const METRICS = { accuracy: BOOL, quality: SCORE, latency_s: LOWER };

async function seedRepeat(
  request: APIRequestContext,
  opts: { name?: string; samples?: number; status?: 'COMPLETED' | 'RUNNING'; items?: number } = {},
) {
  const s = await freshProject(request, 3, { running: false });
  const n = opts.items ?? 6;
  await seedRun(request, s.token, {
    name: opts.name ?? NAME,
    task: 'summarize',
    dataset: 'cnn-sample',
    model: 'openai/gpt-4o',
    metrics: METRICS,
    items: Array.from({ length: n }, (_, j) => ({ accuracy: j % 2, quality: 0.5 + j / 20, latency_s: 0.5 })),
    samples: opts.samples ?? 3,
    status: opts.status ?? 'COMPLETED',
  });
  return s;
}

const passRows = (page: Page) => table(page).locator('tbody tr[data-pass-row]');
const strip = (page: Page) =>
  table(page).locator('tr[data-strip-row] [role="group"][aria-label="Group metrics"]');
const chevron = (page: Page, k = 3, name = NAME, open = false) =>
  rowOf(page, name).getByRole('button', { name: `${open ? 'Collapse' : 'Expand'} ${k} passes of ${name}` });
const scroller = (page: Page) => table(page).locator('[data-dt-scroller]').first();
const settle = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

async function open(page: Page, request: APIRequestContext, opts: Parameters<typeof seedRepeat>[1] = {}) {
  const s = await seedRepeat(request, opts);
  await openRuns(page, s.project.slug);
  return s;
}
async function expand(page: Page, k = 3, name = NAME) {
  await chevron(page, k, name).click();
  await expect(passRows(page)).toHaveCount(k);
  await settle(page);
}

type Rect = { left: number; width: number; height: number };
const rectsOf = (tr: Locator): Promise<Record<string, Rect>> =>
  tr.evaluate((el) =>
    Object.fromEntries(
      Array.from(el.querySelectorAll('td[data-col]')).map((td) => {
        const r = td.getBoundingClientRect();
        return [td.getAttribute('data-col')!, { left: r.left, width: r.width, height: r.height }];
      }),
    ),
  );
const colSeq = (tr: Locator) =>
  tr.evaluate((el) =>
    Array.from(el.querySelectorAll('td[data-col]')).map((td) => td.getAttribute('data-col')),
  );
const setScroll = (page: Page, x: number) =>
  scroller(page).evaluate((el, v) => {
    el.scrollLeft = v;
    return el.scrollLeft;
  }, x);

type PassesBody = { samples: number; passes: Array<Record<string, unknown>> };
async function mockPasses(page: Page, mutate: (body: PassesBody) => PassesBody) {
  await page.route(/\/api\/runs\/[^/]+\/passes$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: mutate(body) });
  });
}

test.describe('runs table: passes are rows of the table (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Q1 collapsed by default', async ({ page, request }) => {
    await open(page, request);
    await expect(page.getByRole('button', { name: /^Expand \d+ passes of / })).toHaveCount(1); // one repeat run
    await expect(chevron(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-pass-row]')).toHaveCount(0);
    await expect(page.locator('tr[data-strip-row]')).toHaveCount(0);
  });

  test('Q2 chevron adds the passes as rows of the same table', async ({ page, request }) => {
    await open(page, request);
    const tables = await page.locator('table').count();
    await chevron(page).click();
    const row = rowOf(page, NAME);
    await expect(passRows(page)).toHaveCount(3);
    for (let i = 1; i <= 3; i++)
      await expect(row.locator(`xpath=following-sibling::tr[${i}]`)).toHaveAttribute(
        'data-pass-row',
        String(i),
      );
    expect(await page.locator('table').count()).toBe(tables);
    await expect(page.locator('[role="region"][aria-label^="Passes of"]')).toHaveCount(0);
    await expect(chevron(page, 3, NAME, true)).toHaveAttribute('aria-expanded', 'true');
    await chevron(page, 3, NAME, true).click();
    await expect(passRows(page)).toHaveCount(0);
  });

  test('Q3 keyboard', async ({ page, request }) => {
    await open(page, request);
    const c = chevron(page);
    await c.focus();
    await page.keyboard.press('Enter');
    await expect(c.or(chevron(page, 3, NAME, true))).toHaveAttribute('aria-expanded', 'true');
    const open1 = chevron(page, 3, NAME, true);
    await expect(open1).toBeFocused();
    await page.keyboard.press('Space');
    await expect(chevron(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(chevron(page)).toBeFocused();
    // row focused: Right expands, Left collapses
    await rowOf(page, NAME).focus();
    await page.keyboard.press('ArrowRight');
    await expect(passRows(page)).toHaveCount(3);
    await page.keyboard.press('ArrowLeft');
    await expect(passRows(page)).toHaveCount(0);
    // a pass row: Left goes to its run row
    await page.keyboard.press('ArrowRight');
    await expect(passRows(page)).toHaveCount(3);
    await page.keyboard.press('ArrowDown');
    await expect(passRows(page).first()).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(rowOf(page, NAME)).toBeFocused();
  });

  test('Q4 pass cells line up with the run cells', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    const run = await rectsOf(rowOf(page, NAME));
    expect(Object.keys(run).length).toBeGreaterThan(8);
    for (let i = 0; i < 3; i++) {
      const p = await rectsOf(passRows(page).nth(i));
      expect(Object.keys(p)).toEqual(Object.keys(run));
      for (const id of Object.keys(run)) {
        expect(Math.abs(p[id]!.left - run[id]!.left), `${id} left`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(p[id]!.width - run[id]!.width), `${id} width`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  test('Q5 scroll moves run and passes together', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    const col = 'metric-quality';
    const cell = (tr: Locator) => tr.locator(`td[data-col="${col}"]`);
    const x0 = [
      await cell(rowOf(page, NAME)).boundingBox(),
      await cell(passRows(page).first()).boundingBox(),
    ];
    const moved = await setScroll(page, 400);
    expect(moved).toBeGreaterThan(100);
    const x1 = [
      await cell(rowOf(page, NAME)).boundingBox(),
      await cell(passRows(page).first()).boundingBox(),
    ];
    expect(Math.abs(x0[0]!.x - x1[0]!.x - moved)).toBeLessThanOrEqual(1);
    expect(Math.abs(x0[1]!.x - x1[1]!.x - moved)).toBeLessThanOrEqual(1);
    expect(Math.abs(x1[0]!.x - x1[1]!.x)).toBeLessThanOrEqual(0.5);
  });

  test('Q6 reorder applies to the passes', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    const before = await colSeq(rowOf(page, NAME));
    const i = before.indexOf('metric-quality');
    await page.locator('thead th[data-col="metric-quality"]').focus();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    await expect.poll(async () => (await colSeq(rowOf(page, NAME))).indexOf('metric-quality')).toBe(i - 1);
    const run = await colSeq(rowOf(page, NAME));
    for (let n = 0; n < 3; n++) expect(await colSeq(passRows(page).nth(n))).toEqual(run);
    const a = await rectsOf(rowOf(page, NAME));
    const b = await rectsOf(passRows(page).first());
    for (const id of ['metric-quality', run[i]!])
      expect(Math.abs(a[id]!.left - b[id]!.left)).toBeLessThanOrEqual(0.5);
  });

  test('Q7 a frozen column applies to the passes', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    await page.locator('thead th[data-col="metric-quality"]').focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Freeze column' }).click();
    await expect(table(page).locator('thead th[data-col="metric-quality"][data-pin="start"]')).toHaveCount(1);
    const moved = await setScroll(page, 400);
    expect(moved).toBeGreaterThan(100);
    const q = (tr: Locator) => tr.locator('td[data-col="metric-quality"]');
    const free = (tr: Locator) => tr.locator('td[data-col="metric-accuracy"]');
    const runQ = (await q(rowOf(page, NAME)).boundingBox())!.x;
    for (let n = 0; n < 3; n++) {
      expect(Math.abs((await q(passRows(page).nth(n)).boundingBox())!.x - runQ)).toBeLessThanOrEqual(0.5);
      const bg = await q(passRows(page).nth(n)).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toMatch(/^rgb\(/); // opaque: rgba() would let the scrolling cells show through
    }
    const a = (await free(rowOf(page, NAME)).boundingBox())!.x;
    const ap = (await free(passRows(page).first()).boundingBox())!.x;
    expect(Math.abs(a - ap)).toBeLessThanOrEqual(0.5);
  });

  test('Q8 hide and resize apply to the passes', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    const w0 = [
      (await rectsOf(rowOf(page, NAME)))['status']!.width,
      (await rectsOf(passRows(page).first()))['status']!.width,
    ];
    const handle = page.locator('thead th[data-col="status"] [role="separator"]');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    const w1 = [
      (await rectsOf(rowOf(page, NAME)))['status']!.width,
      (await rectsOf(passRows(page).first()))['status']!.width,
    ];
    expect(Math.abs(w1[0]! - w0[0]! - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(w1[1]! - w0[1]! - 40)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: /^Columns/ }).click();
    await page
      .getByRole('checkbox', { name: /quality/ })
      .first()
      .uncheck({ force: true })
      .catch(async () => {
        await clickBox(page.getByRole('checkbox', { name: /quality/ }).first());
      });
    await page.keyboard.press('Escape');
    await expect(table(page).locator('td[data-col="metric-quality"]')).toHaveCount(0);
    await expect(page.getByText(/Show all metrics/)).toHaveCount(0);
  });

  test('Q9 density', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    for (const [label, h] of [
      ['Compact', 32],
      ['Regular', 40],
      ['Comfortable', 52],
    ] as const) {
      await page.getByRole('button', { name: 'Row density' }).click();
      await page.getByRole('menuitem', { name: label }).click();
      await expect.poll(async () => (await rowOf(page, NAME).boundingBox())!.height).toBeCloseTo(h, 0);
      for (let n = 0; n < 3; n++)
        expect((await passRows(page).nth(n).boundingBox())!.height).toBeCloseTo(h, 0);
    }
  });

  test('Q10 to Q12 cells and actions', async ({ page, request }) => {
    await open(page, request);
    await mockPasses(page, (b) => {
      b.passes[1].task_error_count = 1;
      b.passes[1].error_count = 1;
      return b;
    });
    await page.reload();
    await expect(chevron(page)).toBeVisible();
    await expand(page);
    const rows = passRows(page);
    for (let n = 1; n <= 3; n++) {
      const r = rows.nth(n - 1);
      await expect(r.locator('td[data-col="run"]')).toHaveText(`Pass ${n}`);
      const link = r.getByRole('link', { name: `Pass ${n} of 3 of run ${NAME}` });
      await expect(link).toHaveAttribute('href', new RegExp(`pass=${n}$`));
      await expect(
        r.locator('td[data-col="status"] [data-tone], td[data-col="status"] span').first(),
      ).toBeVisible();
      expect(((await r.locator('td[data-col="status"]').innerText()) ?? '').trim()).toMatch(/^[A-Z ]+$/);
      await expect(r.locator('td[data-col="time"] time')).toBeVisible();
    }
    const leftOf = (el: Locator, sel: string) =>
      el.locator(sel).evaluate((e) => e.getBoundingClientRect().left);
    expect(
      Math.abs(
        (await leftOf(rows.first(), 'td[data-col="run"] a')) -
          (await leftOf(rowOf(page, NAME), 'td[data-col="run"] a')),
      ),
    ).toBeLessThanOrEqual(1); // "Pass n" starts where the run name starts
    await expect(rows.nth(1).getByRole('img', { name: '1 task error in this pass' })).toBeVisible();
    await expect(rows.nth(1).locator('td[data-col="signals"]')).toContainText('!1');
    await expect(rows.first().locator('td[data-col="signals"]')).toHaveText('–');
    // inherited facts stay empty, own values are shown
    for (let n = 0; n < 3; n++)
      for (const id of ['task', 'model', 'dataset', 'owner', 'experiment', 'version']) {
        const c = rows.nth(n).locator(`td[data-col="${id}"]`);
        if (await c.count()) expect((await c.textContent())?.trim()).toBe('');
      }
    await expect(rows.first().getByRole('link', { name: /^Analyze pass 1/ })).toBeVisible();
    for (const id of ['latency', 'duration', 'metric-quality', 'metric-accuracy']) {
      const c = rows.first().locator(`td[data-col="${id}"]`);
      if (await c.count()) expect((await c.textContent())?.trim()).not.toBe('');
    }
    // actions: delete per pass, no submit, no run-level delete
    for (let n = 1; n <= 3; n++)
      await expect(rows.nth(n - 1).getByRole('button', { name: `Delete pass ${n}` })).toBeVisible();
    await expect(rows.first().getByRole('button', { name: /^Submit / })).toHaveCount(0);
    await rows.nth(1).getByRole('button', { name: 'Delete pass 2' }).click();
    await expect(
      page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete pass 2?' })),
    ).toBeVisible();
  });

  test('Q13 group marker', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    const probe = (v: string) =>
      page.evaluate((name) => {
        const e = document.createElement('i');
        e.style.color = `var(${name})`;
        document.body.append(e);
        const c = getComputedStyle(e).color;
        e.remove();
        return c;
      }, v);
    const accent = await probe('--accent-primary');
    const void_ = await probe('--bg-void');
    const rows = passRows(page);
    for (let n = 0; n < 3; n++) {
      const first = rows.nth(n).locator('td').first();
      const css = await first.evaluate((el) => {
        const s = getComputedStyle(el);
        return { shadow: s.boxShadow, bg: s.backgroundColor };
      });
      expect(css.shadow).toContain('3px');
      expect(css.shadow).toContain(accent);
      expect(css.bg).toBe(void_);
      expect(await rows.nth(n).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expect(rows.nth(n).locator('[data-series]')).toHaveCount(0);
    }
    const runCss = await rowOf(page, NAME)
      .locator('td')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(runCss).toContain('3px');
    const stripShadow = await table(page)
      .locator('tr[data-strip-row] [role="group"]')
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(stripShadow).toContain(accent);
    const other = await table(page)
      .locator('tbody tr[data-run-id]')
      .last()
      .locator('td')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(other).not.toBe(void_);
  });

  test('Q14 to Q17 the strip', async ({ page, request }) => {
    await open(page, request);
    const reqs: URL[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() === 'GET' && u.pathname.endsWith('/group-metrics')) reqs.push(u);
    });
    await expand(page);
    await expect.poll(() => reqs.length).toBeGreaterThan(0);
    await expect(table(page).locator('tr[data-strip-row]')).toHaveCount(1);
    const order = await table(page)
      .locator('tbody')
      .evaluate((tb) =>
        Array.from(tb.children).map((tr) =>
          tr.hasAttribute('data-strip-row') ? 'strip' : tr.hasAttribute('data-pass-row') ? 'pass' : 'run',
        ),
      );
    const at = order.indexOf('strip');
    expect(order.slice(at - 3, at + 1)).toEqual(['pass', 'pass', 'pass', 'strip']);
    expect(order[at - 4]).toBe('run');
    const cols = await table(page).locator('thead tr:last-child th').count();
    expect(
      await table(page)
        .locator('tr[data-strip-row] td')
        .evaluate((td) => (td as HTMLTableCellElement).colSpan),
    ).toBe(cols);
    const sc = (await scroller(page).boundingBox())!;
    const st = strip(page);
    for (const x of [0, 400, 1000]) {
      await setScroll(page, x);
      const b = (await st.boundingBox())!;
      expect(Math.abs(b.x - sc.x), `left at ${x}`).toBeLessThanOrEqual(2);
      expect(
        Math.abs(b.width - (await scroller(page).evaluate((e) => e.clientWidth))),
        `width at ${x}`,
      ).toBeLessThanOrEqual(2);
      expect(await st.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
    await setScroll(page, 0);
    const box = (await st.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(56);
    const tops = await st.evaluate((el) => {
      const pick = [
        el.querySelector('button'),
        el.querySelector('[data-testid="pass-threshold-chip"]'),
        el.querySelector('dl'),
        el.querySelector('button[aria-label^="Explain"]'),
      ];
      return pick.map((e) =>
        Math.round(e!.getBoundingClientRect().top + e!.getBoundingClientRect().height / 2),
      );
    });
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2); // amended Q15: centres, not tops
    await expect(st).toContainText('Passes');
    await expect(st).toContainText(/3 · \d+ items/);
    await expect(st.getByTestId('pass-threshold-chip')).toHaveText(/^Pass if [≥≤] \d+%$/);
    for (const label of ['Pass@3', 'Pass^3', 'Avg@3', 'Consistency', 'Reliability'])
      await expect(st).toContainText(label);
    const stats = st.locator('dl').first().locator('dd');
    expect(await stats.allInnerTexts()).toHaveLength(5);
    for (const t of await stats.allInnerTexts()) expect(t.trim()).toMatch(/^\d+(\.\d)?%$/);
    await expect(st.getByRole('button', { name: /^Explain / })).toHaveCount(1);
    await expect(st).not.toContainText('Avg latency');
    // select + threshold issue new requests
    const n0 = reqs.length;
    await st.getByRole('button', { name: /Metric/ }).click();
    await page.getByRole('option', { name: 'quality' }).click();
    await expect.poll(() => reqs.length).toBeGreaterThan(n0);
    const n1 = reqs.length;
    await st.getByTestId('pass-threshold-chip').click();
    await page.getByRole('dialog', { name: 'Pass threshold' }).getByRole('button', { name: '90%' }).click();
    await expect.poll(() => reqs.length).toBeGreaterThan(n1);
    expect(reqs.at(-1)!.searchParams.get('threshold')).toBe('0.9');
  });

  test('Q18 sort keeps the passes under their run', async ({ page, request }) => {
    const s = await seedRepeat(request);
    await seedRun(request, s.token, {
      name: 'zz-single',
      task: 'summarize',
      dataset: 'cnn-sample',
      model: 'openai/gpt-4o',
      metrics: METRICS,
      items: [{ accuracy: 1, quality: 0.9, latency_s: 0.5 }],
      status: 'COMPLETED',
    });
    await openRuns(page, s.project.slug);
    await expand(page);
    const check = async () => {
      const chain = await table(page)
        .locator('tbody')
        .evaluate((tb) => {
          const out: string[] = [];
          let last = '';
          for (const tr of Array.from(tb.children)) {
            if (tr.hasAttribute('data-run-id')) {
              last = tr.getAttribute('data-run-id')!;
              out.push('run');
            } else if (tr.hasAttribute('data-pass-row'))
              out.push(
                `${tr.getAttribute('data-parent-run') === last ? 'ok' : 'BAD'}${tr.getAttribute('data-pass-row')}`,
              );
          }
          return out.join(',');
        });
      expect(chain).toContain('ok1,ok2,ok3');
      expect(chain).not.toContain('BAD');
    };
    const header = page.locator('thead th[data-col="metric-quality"]');
    await check();
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', /ascending|descending/);
    await check();
    await header.click();
    await check();
    await page.locator('thead th[data-col="time"]').click();
    await check();
    await expect(
      table(page).locator('thead th[aria-sort="ascending"], thead th[aria-sort="descending"]'),
    ).toHaveCount(1);
    await expect(table(page).locator('tbody tr[data-pass-row] [data-sorted]')).toHaveCount(0);
  });

  test('Q19 select mode', async ({ page, request }) => {
    await open(page, request);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expand(page);
    const box = (n: number) =>
      passRows(page)
        .nth(n - 1)
        .getByRole('checkbox', { name: `Select pass ${n} of 3 of run ${NAME}` });
    const parent = page.getByRole('checkbox', { name: `Select ${NAME}`, exact: true });
    const runBoxLeft = await rowOf(page, NAME)
      .locator('td[data-pseudo="select"]')
      .evaluate((e) => e.getBoundingClientRect().left);
    expect(
      await passRows(page)
        .first()
        .locator('td[data-pseudo="select"]')
        .evaluate((e) => e.getBoundingClientRect().left),
    ).toBe(runBoxLeft);
    await clickBox(box(1));
    await clickBox(box(3));
    await expect(page.getByTestId('selection-bar')).toContainText('2 executions selected');
    // the native checkbox is `indeterminate`, which assistive technology reads as mixed
    await expect.poll(() => parent.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    await clickBox(box(2));
    await expect(page.getByTestId('selection-bar')).toContainText('3 executions selected');
    await expect(parent).toBeChecked();
    await clickBox(parent);
    await expect(page.getByTestId('selection-bar')).toContainText('0 executions selected');
    // shift range from pass 1 to pass 3
    await clickBox(box(1));
    await page.keyboard.down('Shift');
    await clickBox(box(3));
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('selection-bar')).toContainText('3 executions selected');
    for (const n of [1, 2, 3]) await expect(box(n)).toBeChecked();
  });

  test('Q21 to Q22 loading and error states', async ({ page, request }) => {
    await open(page, request);
    let delay = true;
    await page.route(/\/api\/runs\/[^/]+\/passes$/, async (route) => {
      if (delay) await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await chevron(page).click();
    await expect(table(page).locator('tr[data-loading-row]')).toHaveCount(3);
    await expect(rowOf(page, NAME)).toHaveAttribute('aria-busy', 'true');
    for (let n = 0; n < 3; n++)
      expect((await table(page).locator('tr[data-loading-row]').nth(n).boundingBox())!.height).toBeCloseTo(
        32,
        0,
      );
    await expect(table(page).locator('tr[data-loading-row]').first()).toContainText('Loading passes');
    const h0 = (await table(page).locator('table').boundingBox())!.height;
    await expect(passRows(page)).toHaveCount(3);
    await settle(page);
    const h1 = (await table(page).locator('table').boundingBox())!.height;
    expect(Math.abs(h1 - h0)).toBeLessThanOrEqual(1);
    delay = false;
    // error then retry
    await chevron(page, 3, NAME, true).click();
    await page.unroute(/\/api\/runs\/[^/]+\/passes$/);
    await page.evaluate(() => undefined);
    await page.reload();
    await expect(chevron(page)).toBeVisible();
    await page.route(/\/api\/runs\/[^/]+\/passes$/, (r) => r.abort());
    await chevron(page).click();
    const err = table(page).locator('tr[data-error-row]');
    await expect(err).toHaveCount(1, { timeout: 20_000 });
    await expect(err).toContainText('Could not load passes');
    await page.unroute(/\/api\/runs\/[^/]+\/passes$/);
    await err.getByRole('button', { name: 'Retry' }).click();
    await expect(passRows(page)).toHaveCount(3);
  });

  test('Q23 queued passes', async ({ page, request }) => {
    await open(page, request, { status: 'RUNNING', samples: 3 });
    await mockPasses(page, (b) => {
      b.samples = 5;
      b.passes = [b.passes[0], { ...b.passes[0], pass_number: 2, status: 'completed' }];
      return b;
    });
    await page.reload();
    await expect(chevron(page)).toBeVisible();
    await chevron(page).click();
    await expect(passRows(page)).toHaveCount(2);
    await expect(passRows(page).first()).toHaveAttribute('aria-setsize', '5'); // samples, not started passes
    const q = table(page).locator('tr[data-queued-row]');
    await expect(q).toHaveCount(1);
    await expect(q).toContainText(/Passes 3[–-]5 waiting to start/);
    await expect(q).toContainText('QUEUED');
    expect((await q.boundingBox())!.height).toBeCloseTo(32, 0);
    for (const id of ['metric-quality', 'duration'])
      expect(((await q.locator(`td[data-col="${id}"]`).textContent()) ?? '').trim()).toBe('');
    await mockPasses(page, (b) => b);
  });

  test('Q24 live refetch keeps the rows and the focus', async ({ page, request }) => {
    test.setTimeout(90_000);
    await open(page, request, { status: 'RUNNING', samples: 3 });
    await chevron(page).click();
    await expect(passRows(page).first()).toBeVisible();
    await settle(page);
    await setScroll(page, 300);
    const first = passRows(page).first();
    await first.evaluate((el) => el.setAttribute('data-probe', 'kept'));
    await first.focus();
    const refetch = page.waitForResponse((r) => /\/passes$/.test(r.url()) && r.request().method() === 'GET', {
      timeout: 30_000,
    });
    await refetch;
    await page.waitForTimeout(500);
    await expect(passRows(page).first()).toHaveAttribute('data-probe', 'kept');
    await expect(passRows(page).first()).toBeFocused();
    expect(await scroller(page).evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
    await expect(chevron(page, 3, NAME, true)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Q25 persistence', async ({ page, request }) => {
    const s = await open(page, request);
    await expand(page);
    expect(new URL(page.url()).search).not.toContain('expanded');
    await passRows(page)
      .nth(1)
      .getByRole('link', { name: `Pass 2 of 3 of run ${NAME}` })
      .click();
    await expect(page).toHaveURL(/pass=2/);
    await page.goBack();
    await expect(passRows(page)).toHaveCount(3);
    const stored = await page.evaluate(
      (slug) => sessionStorage.getItem(`qym:runs:expanded:${slug}`),
      s.project.slug,
    );
    expect(JSON.parse(stored!)).toHaveLength(1);
    await page.reload();
    await expect(passRows(page)).toHaveCount(3);
    expect(page.url()).not.toMatch(/[?&]expanded/);
  });

  test('Q26 accessibility', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    await expect(table(page).locator('table')).toHaveAttribute('role', 'treegrid');
    await expect(rowOf(page, NAME)).toHaveAttribute('aria-level', '1');
    for (let n = 1; n <= 3; n++) {
      const r = passRows(page).nth(n - 1);
      await expect(r).toHaveAttribute('aria-level', '2');
      await expect(r).toHaveAttribute('aria-posinset', String(n));
      await expect(r).toHaveAttribute('aria-setsize', '3');
      await expect(r).toHaveAttribute('aria-label', `Pass ${n} of 3 of run ${NAME}`);
    }
    const sr = table(page).locator('tr[data-strip-row]');
    await expect(sr).toHaveAttribute('aria-level', '2');
    await expect(sr).toHaveAttribute('aria-label', `Group metrics of ${NAME}`);
    let v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await settle(page);
    v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('Q27 heights', async ({ page, request }) => {
    const s = await seedRepeat(request);
    await seedRun(request, s.token, {
      name: 'ten-passes',
      task: 'summarize',
      dataset: 'cnn-sample',
      model: 'openai/gpt-4o',
      metrics: METRICS,
      items: Array.from({ length: 3 }, (_, j) => ({ accuracy: j % 2, quality: 0.6, latency_s: 0.5 })),
      samples: 10,
      status: 'COMPLETED',
    });
    await openRuns(page, s.project.slug);
    const groupHeight = async (name: string) =>
      table(page)
        .locator('tbody')
        .evaluate((tb, nm) => {
          const rows = Array.from(tb.children) as HTMLElement[];
          const i = rows.findIndex((tr) => tr.hasAttribute('data-run-id') && tr.textContent?.includes(nm));
          let sum = 0;
          for (let j = i + 1; j < rows.length && !rows[j]!.hasAttribute('data-run-id'); j++)
            sum += rows[j]!.getBoundingClientRect().height;
          return {
            sum,
            run: rows[i]!.getBoundingClientRect().height,
            strip:
              (
                rows.find((r) => r.hasAttribute('data-strip-row')) as HTMLElement | undefined
              )?.getBoundingClientRect().height ?? 0,
          };
        }, name);
    await expand(page, 3, NAME);
    const a = await groupHeight(NAME);
    expect(a.run).toBe(32);
    expect(a.strip).toBeLessThanOrEqual(56);
    expect(a.sum).toBeLessThanOrEqual(150);
    await chevron(page, 3, NAME, true).click();
    await chevron(page, 10, 'ten-passes').click();
    await expect(passRows(page)).toHaveCount(10);
    await settle(page);
    const b = await groupHeight('ten-passes');
    expect(b.sum).toBeLessThanOrEqual(380);
  });

  test('Q31 motion', async ({ page, request }) => {
    await open(page, request);
    await chevron(page).click();
    const r = passRows(page).first();
    await expect(r).toBeVisible();
    const css = await r.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        dur: s.animationDuration,
        name: s.animationName,
        anims: el
          .getAnimations()
          .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => Object.keys(k))),
      };
    });
    expect(css.name).not.toBe('none');
    expect(parseFloat(css.dur) * 1000).toBeLessThanOrEqual(150);
    expect(css.anims.flat()).not.toContain('height');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await chevron(page, 3, NAME, true).click();
    await chevron(page).click();
    const red = await passRows(page)
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { tr: s.transitionDuration, an: s.animationName, n: el.getAnimations().length };
      });
    expect(parseFloat(red.tr) * 1000).toBeLessThanOrEqual(0.001); // base.css: 0.001 ms under reduced motion
    expect(red.an).toBe('none');
    expect(red.n).toBe(0);
  });

  test('Q32 the embedded panel is gone', async ({ page, request }) => {
    await open(page, request);
    await expand(page);
    await expect(page.locator('[role="region"][aria-label^="Passes of"]')).toHaveCount(0);
    await expect(page.locator('table[aria-label$=" passes"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show all metrics/ })).toHaveCount(0);
  });
});

test.describe('runs table: 1024 strip', () => {
  test.use({ viewport: { width: 1024, height: 800 } });
  test('Q15 at 1024 the strip is at most 96 px; Q1 holds', async ({ page, request }) => {
    await open(page, request);
    await expect(page.locator('[data-pass-row]')).toHaveCount(0);
    await expand(page);
    expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(96);
  });
});

test.describe('runs table: virtualised groups (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('Q20 many open groups stay continuous', async ({ page, request }) => {
    test.setTimeout(300_000);
    const s = await freshProject(request, 3, { running: false });
    for (let i = 0; i < 47; i++) {
      const rep = i < 20; // 20 ten-pass runs: 30 + 20 x 12 = 270 display rows once all are open
      await seedRun(request, s.token, {
        name: `bulk-${String(i).padStart(2, '0')}`,
        task: 'summarize',
        dataset: 'cnn-sample',
        model: 'openai/gpt-4o',
        metrics: METRICS,
        items: [{ accuracy: 1, quality: 0.5 + (i % 5) / 10, latency_s: 0.5 }],
        samples: rep ? 10 : 1,
        status: 'COMPLETED',
      });
    }
    const { waitForProjection } = await import('./seed');
    await waitForProjection(request, s.project.slug, 50);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openRuns(page, s.project.slug);
    const chevs = page.getByRole('button', { name: /^Expand 10 passes of / });
    const n = await chevs.count();
    expect(n).toBe(20);
    for (let i = 0; i < n; i++) {
      const c = page.getByRole('button', { name: /^Expand 10 passes of / }).first();
      await c.scrollIntoViewIfNeeded();
      const id = await c.locator('xpath=ancestor::tr[1]').getAttribute('data-run-id');
      const row = table(page).locator(`tbody tr[data-run-id="${id}"]`);
      const before = (await row.boundingBox())!.y;
      await c.click();
      await expect(row).toHaveAttribute('aria-expanded', 'true'); // children may be outside the mounted window
      expect(Math.abs((await row.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
    }
    const rowcount = Number(await table(page).locator('table').getAttribute('aria-rowcount'));
    expect(rowcount).toBeGreaterThan(200); // past VIRTUAL_AFTER: the window is mounted, not the list
    expect(await table(page).locator('tbody tr[data-index]').count()).toBeLessThan(rowcount / 2);
    const continuous = async () => {
      const idx = await table(page)
        .locator('tbody tr[data-index]')
        .evaluateAll((trs) => trs.map((t) => Number(t.getAttribute('data-index'))));
      for (let i = 1; i < idx.length; i++) expect(idx[i]! - idx[i - 1]!).toBe(1);
    };
    await continuous();
    await page.getByTestId('runs-page').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(400);
    await continuous();
    await page.mouse.wheel(0, -40000);
    await page.waitForTimeout(400);
    await continuous();
    await expect(page.getByRole('button', { name: /^Collapse 10 passes of / })).not.toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('runs table: card mode (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const card = (page: Page) =>
    page.locator(`[data-testid="runs-table"] li[data-run-id]`).filter({ hasText: NAME });

  test('Q28 to Q30 pass lines inside the run card', async ({ page, request }) => {
    await open(page, request);
    await expect(page.locator('[role="group"][aria-label^="Passes of"]')).toHaveCount(0);
    await card(page)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const lines = card(page).locator('[role="group"][aria-label="Passes of ' + NAME + '"] li');
    await expect(lines).toHaveCount(3);
    await expect(lines.first()).toContainText('Pass 1'); // the passes arrived (placeholders say Loading)
    for (let n = 0; n < 3; n++) {
      await lines.nth(n).scrollIntoViewIfNeeded();
      const b = (await lines.nth(n).boundingBox())!;
      expect(b.height).toBeLessThanOrEqual(56);
      await expect(lines.nth(n)).toContainText(`Pass ${n + 1}`);
      await expect(
        lines.nth(n).getByRole('button', { name: new RegExp(`More actions for pass ${n + 1}`) }),
      ).toBeVisible();
    }
    expect(await card(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
    // Q29 strip stacked inside the card
    const st = card(page).locator('[role="group"][aria-label="Group metrics"]');
    await st.scrollIntoViewIfNeeded();
    const sb = (await st.boundingBox())!;
    expect(sb.height).toBeLessThanOrEqual(190);
    const inner = await st.evaluate((el) => {
      const s = getComputedStyle(el);
      return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    });
    const selectW = (await st.locator('button').first().boundingBox())!.width;
    expect(Math.abs(selectW - inner)).toBeLessThanOrEqual(2);
    const dd = await st
      .locator('dl > div')
      .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(dd).toBe(2);
    const label = async () => (await lines.first().textContent()) ?? '';
    const before = await label();
    await st.getByRole('button', { name: /Metric/ }).click();
    await page.getByRole('listbox').getByRole('option', { name: 'quality' }).click();
    await expect.poll(label).not.toBe(before);
    // axe
    const v = await axeSeriousViolations(page);
    expect(v, describeViolations(v)).toEqual([]);
  });

  test('Q30 card select mode', async ({ page, request }) => {
    await open(page, request);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await card(page)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    const box = (n: number) =>
      card(page).getByRole('checkbox', { name: `Select pass ${n} of 3 of run ${NAME}` });
    await clickBox(box(1));
    await clickBox(box(3));
    await expect
      .poll(() =>
        card(page)
          .getByRole('checkbox', { name: `Select ${NAME}`, exact: true })
          .evaluate((el) => (el as HTMLInputElement).indeterminate),
      )
      .toBe(true);
    await expect(page.getByTestId('selection-bar')).toContainText('2 executions selected');
  });

  test('Q32 no embedded panel at 390', async ({ page, request }) => {
    await open(page, request);
    await card(page)
      .getByRole('button', { name: `Expand 3 passes of ${NAME}` })
      .click();
    await expect(page.locator('[role="region"][aria-label^="Passes of"]')).toHaveCount(0);
    await expect(page.locator('table[aria-label$=" passes"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show all metrics/ })).toHaveCount(0);
  });
});
