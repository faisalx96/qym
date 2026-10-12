/** UX review (group C): a repeat run's item trace lists one attempt per pass without duplicate React keys. */
import { test, expect } from '@playwright/test';
import { openRun, seedProject, seedRepeat, type Seeded } from './support';

let s: Seeded;
let repeat: string;
test.beforeAll(async () => {
  s = await seedProject('rd-ux-trace-pass');
  repeat = await seedRepeat(s);
});

test('attempt chips are per pass, selectable one at a time, and React stays quiet', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) problems.push(m.text().slice(0, 160));
  });
  await openRun(page, s.slug, repeat, 'trace=sql-001');
  const group = page.getByRole('group', { name: 'Attempts' });
  await expect(group).toBeVisible();
  const chips = group.getByRole('checkbox').or(group.getByRole('button'));
  const names = await chips.allInnerTexts();
  expect(names.map((n) => n.trim())).toEqual(
    expect.arrayContaining([
      'All attempts',
      'Pass 1 · attempt 1',
      expect.stringMatching(/^Pass 2 · attempt 1/),
      'Pass 3 · attempt 1',
    ]),
  );
  await group.getByRole('button', { name: /^Pass 2 · attempt 1/ }).click();
  await expect(group.getByRole('button', { name: /^Pass 2 · attempt 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(group.getByRole('button', { name: 'Pass 1 · attempt 1' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(problems.filter((p) => /same key|unique "key"|Encountered two children/.test(p))).toEqual([]);
});
