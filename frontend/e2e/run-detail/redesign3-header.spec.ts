/// <reference lib="dom" />
/** Round 3 P6 (run-detail.md section 6): the run header shows what was run without a click, within height ceilings. P6-1 .. P6-12. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { client, openRun, seedClassic, seedProject, seedWideRepeat, type Seeded } from './support';
import { createRun, EventStream } from './seed';

let s: Seeded;
let classic: string;
let wide: string;
let bare: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  s = await seedProject('rd-r3-header');
  classic = await seedClassic(s);
  wide = await seedWideRepeat(s);
  // a run with no config, no metadata and no versioning at all
  const specs = {
    ok: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  };
  bare = await createRun(client, s.token, {
    task: 'bare_task',
    dataset: 'bare-set',
    model: 'openai/gpt-5-mini',
    metrics: ['ok'],
    metric_specs: specs,
  });
  const st = new EventStream(client, s.token, bare, 3);
  st.push('run_started', {
    task: 'bare_task',
    dataset: 'bare-set',
    model: 'openai/gpt-5-mini',
    metrics: ['ok'],
    metric_specs: specs,
    total_items: 2,
    started_at: new Date(Date.UTC(2026, 9, 5, 9)).toISOString(),
  });
  for (let i = 0; i < 2; i++) {
    st.push('item_started', { item_id: `b${i}`, index: i, input: `q${i}`, expected: 'a' });
    st.push('metric_scored', { item_id: `b${i}`, metric_name: 'ok', score_numeric: 1, score_raw: true });
    st.push('item_completed', { item_id: `b${i}`, index: i, output: 'a', latency_ms: 500 });
  }
  st.push('run_completed', {
    ended_at: new Date(Date.UTC(2026, 9, 5, 9, 5)).toISOString(),
    final_status: 'COMPLETED',
  });
  await st.flush();
});

const hero = (page: Page) => page.getByTestId('run-hero');

/** The element's box lies inside the clamped chip flow (it is not cut off by the clamp). */
async function inClamp(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    const flow = node.closest('#run-hero-chips')!.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return r.bottom <= flow.bottom + 1 && r.top >= flow.top - 1;
  });
}

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('P6-1, P6-2: every field is visible at load, there is no chevron, the only disclosure is "+ N more"', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const h = hero(page);
      await expect(h.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(h.getByText('COMPLETED')).toBeVisible();
      await expect(h.getByRole('link', { name: 'Export HTML' })).toBeVisible();
      await expect(h.getByRole('navigation', { name: 'Previous and next run' })).toBeVisible();
      await expect(h.getByRole('button', { name: 'Copy run id' })).toBeVisible();
      const facts = h.getByRole('list', { name: 'Run facts' }).or(h.locator('dl[aria-label="Run facts"]'));
      for (const label of ['Task', 'Dataset', 'Model', 'Owner', 'Project', 'Started', 'Runtime'])
        await expect(facts.getByText(label, { exact: true })).toBeVisible();
      await expect(facts.getByRole('link', { name: 'rag_answer' })).toBeVisible();
      await expect(facts.getByRole('link', { name: 'qa-arabic-v3' })).toBeVisible();
      await expect(facts.getByRole('link', { name: 'gpt-5-mini' })).toBeVisible();
      await expect(h.getByTestId('hero-runtime')).toBeVisible();
      // versioning, git, config and the first metadata chips are in view without a click
      const band = h.getByRole('group', { name: 'Versioning, config and metadata' });
      const texts = [
        'model_tag',
        '2026-09',
        'prompt',
        'v7',
        'retriever_index',
        'qa-v3',
        'main • abc1234',
        'temperature',
        '0.2',
        'max_tokens',
        '512',
      ];
      for (const text of texts) {
        const el = band.getByText(text, { exact: true }).first();
        await expect(el).toBeVisible();
        expect(await inClamp(el), text).toBe(true);
      }
      // no chevron, no "Show run details"
      await expect(h.getByRole('button', { name: /run details/i })).toHaveCount(0);
      await expect(h.locator('[aria-controls="run-hero-details"]')).toHaveCount(0);
      const buttons = await h.getByRole('button').allInnerTexts();
      // (an object or array chip is a button that opens its JSON: "{ 3 keys }" / "[ 4 items ]")
      for (const t of buttons)
        expect(t).toMatch(
          /\+ \d+ more|Show less|^\s*$|Copy|Export|Previous|Next|^[[{] \d+ (keys?|items?) [\]}]$/,
        );
      // the passes tag on a repeat run
      await openRun(page, s.slug, wide);
      await expect(hero(page).getByText('x10 passes')).toBeVisible();
    });

    test('P6-3, P6-4: height ceilings and the first section close to the top', async ({ page }) => {
      await openRun(page, s.slug, classic);
      const h = (await hero(page).boundingBox())!.height;
      const ceiling = width === 1440 ? 200 : 570; // compact ceiling amended 520 -> 570 (run-detail.md P6-3)
      expect(h).toBeLessThanOrEqual(ceiling);
      if (width === 1440) {
        const top = await page
          .locator('#run-section-overview')
          .evaluate((el) => el.getBoundingClientRect().top);
        expect(top).toBeLessThanOrEqual(380);
      }
    });

    test('P6-5, P6-6, P6-7: facts in one row (two columns on a phone); chip order, height and caps', async ({
      page,
    }) => {
      await openRun(page, s.slug, classic);
      const tops = await hero(page)
        .locator('dl[aria-label="Run facts"] dd')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(tops).toHaveLength(7);
      if (width === 1440) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
      else expect(new Set(tops).size).toBe(4);
      const chips = await hero(page)
        .locator('[data-chip]')
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            const list = e.closest('[role=list]')!.getAttribute('aria-label');
            const kv = e.firstElementChild as HTMLElement;
            return {
              list,
              h: Math.round(kv.getBoundingClientRect().height),
              title: kv.getAttribute('title') ?? '',
              key: kv.children[0]!.textContent!.length,
              val: kv.children[1]!.textContent!.length,
              top: r.top,
            };
          }),
        );
      const order = chips.map((c) => c.list);
      expect(order.indexOf('Versioning')).toBe(0);
      expect(order.lastIndexOf('Versioning')).toBeLessThan(order.indexOf('Config'));
      expect(order.lastIndexOf('Config')).toBeLessThan(order.indexOf('Metadata'));
      for (const c of chips) {
        expect(c.h).toBe(24);
        expect(c.key).toBeLessThanOrEqual(20);
        expect(c.val).toBeLessThanOrEqual(30);
        expect(c.title).toContain(': ');
      }
      // an object value shows one token; the full compact JSON is in its title
      const retriever = hero(page)
        .locator('[data-chip]', { hasText: 'retriever' })
        .filter({ hasText: '{ 2 keys }' });
      await expect(retriever.first()).toBeVisible();
      // a group label shares a line with its first chip
      const lead = await hero(page)
        .locator('[role=list] > span:first-child')
        .evaluateAll((els) =>
          els.map((e) => {
            const label = e.firstElementChild!.getBoundingClientRect();
            const chip = e.lastElementChild!.getBoundingClientRect();
            return Math.abs(label.top + label.height / 2 - (chip.top + chip.height / 2));
          }),
        );
      for (const d of lead) expect(d).toBeLessThanOrEqual(4);
    });

    test('P6-12: nothing in the header overflows its card', async ({ page }) => {
      await openRun(page, s.slug, classic);
      const over = await hero(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll('*'))
          .filter((n) => !n.closest('#run-hero-chips'))
          .filter((n) => n.getBoundingClientRect().right > r.right + 1)
          .map((n) => n.tagName)
          .slice(0, 5);
      });
      expect(over).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

test('P6-8, P6-9: the clamp keeps 54px (84 compact), "+ N more" is exact, opening shows the rest and is remembered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 20 chips: stub the run payload with many metadata entries
  await page.route(new RegExp(`/api/runs/${classic}\\?view=compact(&fields=scores|$)`), async (route) => {
    // (a request the dev server's StrictMode repeats after the test ended has nothing left to answer)
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    // a response the page already navigated away from is disposed: nothing left to answer
    const body = await res.json().catch(() => null);
    if (!body) return;
    const extra: Record<string, string> = {};
    for (let i = 0; i < 20; i++) extra[`meta_key_${String(i).padStart(2, '0')}`] = `value number ${i}`;
    body.run.metadata = { ...(body.run.metadata ?? {}), ...extra };
    await route.fulfill({ json: body });
  });
  await openRun(page, s.slug, classic);
  const h = hero(page);
  const flow = h.locator('#run-hero-chips');
  await expect(flow).toBeVisible();
  const info = await flow.evaluate((el) => {
    const flowBox = el.getBoundingClientRect();
    const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip]'));
    const hidden = chips.filter((c) => c.getBoundingClientRect().bottom > flowBox.bottom + 1).length;
    return { height: flowBox.height, hidden, total: chips.length, visible: chips.length - hidden };
  });
  expect(info.height).toBeLessThanOrEqual(54 + 1);
  expect(info.visible).toBeGreaterThanOrEqual(6);
  expect(info.hidden).toBeGreaterThan(0);
  const more = h.getByRole('button', { name: /^\+ \d+ more$/ });
  await expect(more).toHaveText(`+ ${info.hidden} more`);
  expect((await h.boundingBox())!.height).toBeLessThanOrEqual(200);
  await more.click();
  await expect(h.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  await expect(h.getByText('Run ID', { exact: true })).toBeVisible();
  const after = await flow.evaluate((el) => {
    const flowBox = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll<HTMLElement>('[data-chip]')).every(
      (c) => c.getBoundingClientRect().bottom <= flowBox.bottom + 1,
    );
  });
  expect(after).toBe(true);
  await page.reload();
  await expect(h.getByRole('button', { name: 'Show less' })).toBeVisible();
  await h.getByRole('button', { name: 'Show less' }).click();
  await page.evaluate(() => localStorage.removeItem('qym:run-hero-more'));
});

test('P6-8 compact: five lines (144px, spec amended) and at least six chips at 279px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route(new RegExp(`/api/runs/${classic}\\?view=compact(&fields=scores|$)`), async (route) => {
    // (a request the dev server's StrictMode repeats after the test ended has nothing left to answer)
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    // a response the page already navigated away from is disposed: nothing left to answer
    const body = await res.json().catch(() => null);
    if (!body) return;
    const extra: Record<string, string> = {};
    for (let i = 0; i < 20; i++) extra[`meta_key_${String(i).padStart(2, '0')}`] = `value number ${i}`;
    body.run.metadata = { ...(body.run.metadata ?? {}), ...extra };
    await route.fulfill({ json: body });
  });
  await openRun(page, s.slug, classic);
  const flow = hero(page).locator('#run-hero-chips');
  const info = await flow.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip]'));
    return {
      height: b.height,
      visible: chips.filter((c) => c.getBoundingClientRect().bottom <= b.bottom + 1).length,
    };
  });
  expect(info.height).toBeLessThanOrEqual(144 + 1);
  expect(info.visible).toBeGreaterThanOrEqual(6);
  expect((await hero(page).boundingBox())!.height).toBeLessThanOrEqual(570);
  await expect(hero(page).getByRole('button', { name: /^\+ \d+ more$/ })).toBeVisible();
});

test('P6-10: a run with no config, metadata or versioning has no chip band and is at most 125px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, bare);
  await expect(hero(page).getByTestId('hero-context')).toHaveCount(0);
  expect((await hero(page).boundingBox())!.height).toBeLessThanOrEqual(125);
});

test('P6-11: a stopped run shows its reason as one muted line under band 1, not in a pass view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(new RegExp(`/api/runs/${classic}\\?view=compact(&fields=scores|$)`), async (route) => {
    // (a request the dev server's StrictMode repeats after the test ended has nothing left to answer)
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    // a response the page already navigated away from is disposed: nothing left to answer
    const body = await res.json().catch(() => null);
    if (!body) return;
    body.run.status = 'STOPPED';
    body.run.status_reason_label = 'Stopped by an administrator';
    await route.fulfill({ json: body });
  });
  await openRun(page, s.slug, classic);
  const line = hero(page).getByTestId('hero-stop-reason');
  await expect(line).toHaveText('Stopped: Stopped by an administrator');
  const [a, b] = await Promise.all([hero(page).locator('h1').boundingBox(), line.boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
});

test('QA: an object metadata chip opens its JSON in a dialog while the band is clamped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // one object-valued metadata entry, and few enough chips that nothing is hidden (no "+ N more")
  await page.route(new RegExp(`/api/runs/${classic}\\?view=compact(&fields=scores|$)`), async (route) => {
    const res = await route.fetch().catch(() => null);
    if (!res) return;
    // a response the page already navigated away from is disposed: nothing left to answer
    const body = await res.json().catch(() => null);
    if (!body) return;
    body.run.metadata = { ...(body.run.metadata ?? {}), judge: { model: 'gpt-5', rubric: 'strict', k: 3 } };
    await route.fulfill({ json: body });
  });
  await openRun(page, s.slug, classic);
  const h = hero(page);
  const band = h.getByRole('group', { name: 'Versioning, config and metadata' });
  const chip = band.getByRole('button', { name: 'View judge as JSON { 3 keys }' });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('{ 3 keys }');
  // the band is clamped (no "Show less") and still the chip is clickable
  await expect(h.getByRole('button', { name: 'Show less' })).toHaveCount(0);
  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'judge' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tree', { name: 'judge' })).toContainText('rubric');
  await expect(dialog.getByRole('tree', { name: 'judge' })).toContainText('strict');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
