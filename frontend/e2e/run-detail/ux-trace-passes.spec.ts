/**
 * C009: a repeat run's trace drawer shows one pass at a time. Chips 'Pass 1' to 'Pass N' replace 'All attempts', a
 * chip fetches only its pass (?trace_pass=N), and React stays quiet.
 */
import { test, expect } from '@playwright/test';
import { openRun, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let repeat: string;
test.beforeAll(async () => {
  s = await seedProject('rd-ux-trace-pass');
  repeat = await seedRepeat(s);
});

test('pass chips, one pass at a time, and React stays quiet', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(m.text().slice(0, 160));
  });
  await openRun(page, s.slug, repeat, 'trace=sql-001');
  const group = page.getByRole('group', { name: 'Passes' });
  await expect(group).toBeVisible();
  const names = (await group.getByRole('button').allInnerTexts()).map((n) => n.trim());
  expect(names[0]).toBe('Pass 1');
  expect(names.every((n) => /^Pass \d+$/.test(n))).toBe(true);
  await expect(page.getByRole('button', { name: 'All attempts' })).toHaveCount(0);
  await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);
  const pass2 = page.waitForRequest((r) => /\/items\/sql-001\/trace\?pass_number=2/.test(r.url()));
  await group.getByRole('button', { name: 'Pass 2' }).click();
  await pass2;
  await expect(
    page.getByRole('group', { name: 'Passes' }).getByRole('button', { name: 'Pass 2' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('trace_pass')).toBe('2');
  expect(problems.filter((p) => /same key|unique "key"|Encountered two children/.test(p))).toEqual([]);
});
