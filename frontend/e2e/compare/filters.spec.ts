/** Scenarios 3, 4 and 8: count-button filters, Overview tab, the rule builder, search, Display and panel chips. */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, expectShown, seedScenario, urlParams, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-flt');
});

const deltaLine = (page: Page) => page.locator('[aria-label="Change against the baseline"]');
const pageChips = (page: Page) => page.getByRole('group', { name: 'Filters set on the page' });
const open4 = async (page: Page, extra: Record<string, string> = {}) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(compareUrl([base, a, b, c], extra));
  await waitLoaded(page);
  if (!extra.filters) await expectShown(page, 40);
};
const filtersJson = (page: Page) =>
  JSON.parse(urlParams(page).get('filters') ?? '{}') as Record<string, unknown>;

test('count button in the delta line filters the list; chip and Clear restore it', async ({ page }) => {
  await open4(page);
  const up = deltaLine(page).getByRole('button', {
    name: '30 items improved vs baseline on quality; filter items',
  });
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await up.click();
  await expectShown(page, 30);
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(pageChips(page)).toContainText('improved on quality');
  await expect
    .poll(() => (filtersJson(page).baseline as { kind: string } | undefined)?.kind)
    .toBe('improved');
  expect((filtersJson(page).baseline as { metric: string }).metric).toBe('quality');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  // removing the chip restores the list
  await pageChips(page)
    .getByRole('button', { name: /^Remove filter:/ })
    .click();
  await expectShown(page, 40);
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  expect(urlParams(page).get('filters')).toBeNull();
  // pressing the same count again toggles it off; Clear also resets
  await up.click();
  await expectShown(page, 30);
  await up.click();
  await expectShown(page, 40);
  await deltaLine(page)
    .getByRole('button', { name: '26 items regressed vs baseline on quality; filter items' })
    .click();
  await expectShown(page, 26);
  await page.getByRole('button', { name: /^Clear \d/ }).click();
  await expectShown(page, 40);
  await expect(pageChips(page)).toHaveCount(0);
});

test('count button in the Metrics table selects that metric and filters the list', async ({ page }) => {
  await open4(page);
  const table = page.getByRole('table', { name: /Average per run/ });
  const btn = table.getByRole('button', { name: '9 items improved vs baseline on correct; filter items' });
  await btn.click();
  await expectShown(page, 9);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect(urlParams(page).get('metric')).toBe('correct');
  expect(filtersJson(page).baseline as { metric: string; kind: string }).toMatchObject({
    metric: 'correct',
    kind: 'improved',
  });
  await expect(pageChips(page)).toContainText('improved on correct');
  await btn.click();
  await expectShown(page, 40);
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('Overview: threshold slider changes Pass@K and is written to ?thr=', async ({ page }) => {
  await open4(page);
  await page.getByRole('tab', { name: 'Overview' }).click();
  const slider = page.getByRole('slider', { name: /Pass if/ });
  await expect(slider).toBeVisible();
  const strip = async () => {
    const out: string[] = [];
    for (const l of ['Pass@4', 'Pass^4', 'Max@4', 'Consistency', 'Reliability', 'Avg score'])
      out.push(await page.getByText(l, { exact: true }).locator('xpath=ancestor::*[2]').innerText());
    return out.join(' | ').replace(/\s+/g, ' ');
  };
  const before = await strip();
  await slider.focus();
  await page.keyboard.press('ArrowLeft'); // 70 -> 65
  await page.keyboard.press('ArrowLeft'); // 65 -> 60
  await expect.poll(() => urlParams(page).getAll('thr')).toEqual(['quality:0.6']);
  await expect.poll(strip).not.toBe(before);
  await expect(page.getByText(/A run passes when its score is/)).toContainText('60');
});

test('Overview: Winner bar and Runs-correct distribution bars set filter chips', async ({ page }) => {
  await open4(page);
  await page.getByRole('tab', { name: 'Overview' }).click();
  const win = page.getByRole('group', { name: 'Items won by each run' }).getByRole('button').first();
  const label = (await win.getAttribute('aria-label')) ?? '';
  const wins = Number(/won (\d+) items/.exec(label)?.[1]);
  await win.click();
  await expect(pageChips(page)).toContainText(/won/);
  await expectShown(page, wins);
  expect(urlParams(page).get('winner')).toMatch(/^win_\d$/);
  await win.click();
  await expectShown(page, 40);
  expect(urlParams(page).get('winner')).toBeNull();

  const bar = page.getByRole('button', { name: /items with 2 of 4 runs correct; filter/ });
  const n = Number(/^(\d+) items/.exec((await bar.getAttribute('aria-label')) ?? '')?.[1]);
  expect(n).toBeGreaterThan(0);
  await bar.click();
  await expect(pageChips(page)).toContainText('Passing runs = 2 of 4');
  await expectShown(page, n);
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => filtersJson(page).passRate).toEqual(['eq', 2]);
});

test('rule builder: "+ Condition" adds an editable condition row', async ({ page }) => {
  await open4(page);
  await page.getByRole('button', { name: /^Filters/ }).click();
  const builder = page.getByTestId('filter-builder');
  await expect(builder).toContainText('No rules yet');
  await builder.getByRole('button', { name: '+ Condition' }).click();
  await expect(builder.getByTestId('filter-condition')).toHaveCount(1);
  const cond = builder.getByTestId('filter-condition').first();
  await cond
    .getByRole('combobox')
    .or(cond.getByRole('button', { name: /field/i }))
    .first()
    .click();
  await page.getByRole('option', { name: 'Comparison · Passing runs' }).click();
  await cond.getByRole('textbox', { name: /Passing runs value/ }).fill('2');
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expect.poll(() => JSON.stringify(filtersJson(page).rules ?? {})).toContain('pass_count');
});

test('rule builder: a rules deep link edits, switches AND/OR and deletes; count and badge follow', async ({
  page,
}) => {
  const rules = (op: string) => ({
    op,
    children: [
      { field: 'pass_count', oper: 'gte', value: '2' },
      { field: 'error', oper: 'is', value: 'true' },
    ],
  });
  const total = async () =>
    Number(
      /(\d+) of/.exec(
        (await page
          .getByRole('status')
          .filter({ hasText: /of 40 items/ })
          .textContent()) ?? '',
      )![1],
    );
  // data cross-check: items with >= 2 passing runs (Overview distribution)
  await open4(page);
  await page.getByRole('tab', { name: 'Overview' }).click();
  const dist = await page
    .getByRole('button', { name: /items with \d of 4 runs correct; filter/ })
    .evaluateAll((els) =>
      els
        .map((e) => /^(\d+) items with (\d) of/.exec(e.getAttribute('aria-label') ?? '')!)
        .map((m) => [Number(m[2]), Number(m[1])]),
    );
  const atLeast = (k: number) => dist.filter(([r]) => r >= k).reduce((s, [, n]) => s + n, 0);

  await open4(page, {
    filters: JSON.stringify({
      rules: { op: 'and', children: [{ field: 'pass_count', oper: 'gte', value: '2' }] },
    }),
  });
  const builder = page.getByTestId('filter-builder');
  await expect(builder).toBeVisible(); // a link with rules opens the builder
  await expect(builder.getByTestId('filter-condition')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await expect(builder).toContainText('1 rule applied');
  await expect.poll(total).toBe(atLeast(2));
  expect(atLeast(2)).toBeLessThan(40);
  // edit the value
  await builder.getByRole('textbox', { name: /Passing runs value/ }).fill('4');
  await expect.poll(total).toBe(atLeast(4));
  await expect.poll(() => JSON.stringify(filtersJson(page).rules)).toContain('"value":"4"');

  // AND with a second rule can only narrow; OR can only widen
  await open4(page, { filters: JSON.stringify({ rules: rules('and') }) });
  await expect(builder.getByTestId('filter-condition')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('2');
  await expect.poll(total).toBeLessThanOrEqual(atLeast(2));
  const andCount = await total();
  await builder.getByRole('radiogroup', { name: 'Match mode' }).first().getByText('OR').click();
  await expect(builder).toContainText('any rule below may match');
  await expect.poll(total).toBeGreaterThan(andCount);
  await expect.poll(() => (filtersJson(page).rules as { op: string }).op).toBe('or');

  // delete both conditions
  await builder.getByRole('button', { name: 'Delete condition' }).nth(1).click();
  await builder.getByRole('button', { name: 'Delete condition' }).first().click();
  await expectShown(page, 40);
  await expect(page.getByRole('button', { name: /^Filters/ })).not.toContainText('1');
});

test('rule builder: "+ Group" adds a nested group', async ({ page }) => {
  await open4(page, {
    filters: JSON.stringify({
      rules: { op: 'and', children: [{ field: 'pass_count', oper: 'gte', value: '2' }] },
    }),
  });
  const builder = page.getByTestId('filter-builder');
  await builder.getByRole('button', { name: '+ Group' }).click();
  await expect(builder.getByRole('group', { name: 'Rule group' })).toBeVisible();
  await builder.getByRole('button', { name: 'Delete group' }).click();
  await expect(builder.getByRole('group', { name: 'Rule group' })).toHaveCount(0);
});

test('search debounces into ?q= and calls POST /items/search', async ({ page }) => {
  await open4(page);
  const req = page.waitForRequest((r) => r.method() === 'POST' && /\/items\/search/.test(r.url()));
  const box = page.getByRole('searchbox', { name: 'Search items' });
  await box.pressSequentially('Question 1', { delay: 20 });
  // not yet written (debounce 250 ms)...
  expect(urlParams(page).get('q')).toBeNull();
  // ...then it lands
  await expect.poll(() => urlParams(page).get('q'), { timeout: 3000 }).toBe('Question 1');
  await req;
  await expectShown(page, 11);
  await page.getByRole('button', { name: /^Clear \d/ }).click();
  await expectShown(page, 40);
  await expect(box).toHaveValue('');
  expect(urlParams(page).get('q')).toBeNull();
});

test('Display popover: sort and Raw / Rendered', async ({ page }) => {
  await open4(page);
  await page.getByRole('button', { name: 'Display' }).click();
  await page.getByRole('button', { name: /Sort/ }).click();
  await page.getByRole('option', { name: 'Latency, fast to slow' }).click();
  await expect.poll(() => urlParams(page).get('sort')).toBe('latency_asc');
  const mode = page.getByRole('radiogroup', { name: 'Text mode' });
  await mode.getByText('Rendered').click();
  await expect(mode.getByRole('radio', { name: 'Rendered' })).toBeChecked();
  await mode.getByText('Raw').click();
  await expect(mode.getByRole('radio', { name: 'Raw' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radiogroup', { name: 'Text mode' })).toHaveCount(0);
});

test('Categories and Errors tabs: pressing a row / card filters the items and adds a chip', async ({
  page,
}) => {
  await open4(page);
  await page.getByRole('tab', { name: 'Categories' }).click();
  const easy = page.getByRole('button', { name: /^easy \d+$/ }).first();
  const n = Number(/(\d+)$/.exec((await easy.innerText()).trim())![1]);
  await easy.click();
  await expectShown(page, n);
  await expect(pageChips(page)).toContainText('Complexity: easy');
  await expect(easy).toHaveAttribute('aria-pressed', 'true');
  await easy.click();
  await expectShown(page, 40);

  await page.getByRole('tab', { name: 'Errors' }).click();
  const card = page.getByRole('button', { name: /TimeoutError/ }).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(pageChips(page)).toContainText(/Task error/);
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const shown = Number(
    /^(\d+) of/.exec(
      (await page
        .getByRole('status')
        .filter({ hasText: /of 40 items/ })
        .textContent()) ?? '',
    )![1],
  );
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(40);
  expect(((filtersJson(page).errors ?? {}) as Record<string, unknown>).task).toBeTruthy();
  await pageChips(page)
    .getByRole('button', { name: /^Remove filter:/ })
    .click();
  await expectShown(page, 40);
});
