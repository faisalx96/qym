/** Round 8: run identity is swatch + letter badge + name everywhere (C-run-5, C-page-4, owner decision H1, D2). */
import { expect, test } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { client, compareUrl, waitLoaded } from './support';
import { createApiKey, ensureProject, seedCompareRun } from './seed';
import { box, openCompare, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
const dup: string[] = [];
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-ident');
  const project = await ensureProject(client, 'Dup names', uniqueSlug('r8-dup'));
  const token = await createApiKey(client, project.id);
  for (const seed of [11, 12])
    dup.push(await seedCompareRun(client, token, { name: 'nightly', model: 'openai/gpt-5-mini', skill: 0, items: 10, seed }));
});

test('C-run-5: one run is one colour in every section, and the four runs are four colours', async ({ page }) => {
  await openCompare(page, s.four, 1440);
  // open an item so the output toggles and cards exist as well
  await page.locator('[data-part="item-head"]').first().click();
  await expect(page.getByTestId('output-card')).toHaveCount(4);
  const rows = await page.evaluate(() => {
    const out: Array<{ where: string; letter: string; colour: string }> = [];
    const where = (e: Element) => e.closest('[data-part^="section-"]')?.getAttribute('data-part') ?? 'page';
    for (const e of Array.from(document.querySelectorAll('[data-part="run-name"]'))) {
      const letter = e.querySelector('[data-part="run-letter"]')?.textContent ?? '';
      const sw = e.firstElementChild as HTMLElement;
      out.push({ where: where(e), letter, colour: getComputedStyle(sw).backgroundColor });
    }
    for (const chip of Array.from(document.querySelectorAll('[data-part="item-score-chip"]'))) {
      const letter = chip.querySelector('span:nth-child(2)')?.textContent ?? '';
      out.push({ where: 'item-chip', letter, colour: getComputedStyle(chip.firstElementChild as HTMLElement).backgroundColor });
    }
    for (const card of Array.from(document.querySelectorAll('[data-part="run-card"]'))) {
      const letter = card.querySelector('[data-part="run-letter"]')?.textContent ?? '';
      out.push({ where: 'run-card-rail', letter, colour: getComputedStyle(card.firstElementChild as HTMLElement).borderInlineStartColor });
    }
    return out;
  });
  const byLetter = new Map<string, Set<string>>();
  for (const r of rows) if (r.letter && r.colour !== 'rgba(0, 0, 0, 0)') byLetter.set(r.letter, (byLetter.get(r.letter) ?? new Set()).add(r.colour));
  expect([...byLetter.keys()].sort()).toEqual(['A', 'B', 'C', 'D']);
  for (const [letter, set] of byLetter) expect([...set], `run ${letter} colours`).toHaveLength(1);
  expect(new Set([...byLetter.values()].map((x) => [...x][0])).size).toBe(4);
  const places = new Set(rows.map((r) => r.where));
  for (const p of ['section-runs', 'section-averages', 'section-overview', 'section-categories', 'section-errors', 'section-items'])
    expect(places, `identity shown in ${p}`).toContain(p);
});

test('H1/C-run-2: the letter badge is 16x16 mono in the run colour, beside the swatch and the full name', async ({
  page,
}) => {
  await openCompare(page, s.four, 1440);
  const card = part(page, 'run-card').first();
  const letter = card.locator('[data-part="run-letter"]');
  const b = await box(letter);
  within(b.w, 16, 1, 'badge width');
  within(b.h, 16, 1, 'badge height');
  const css = await letter.evaluate((e) => ({ f: getComputedStyle(e).fontFamily, c: getComputedStyle(e).color }));
  expect(css.f).toMatch(/mono/i);
  const swatch = await card.locator('[data-part="run-name"]').evaluate((e) => getComputedStyle(e.firstElementChild!).backgroundColor);
  expect(css.c).toBe(swatch.replace(/ ?\/ ?[\d.]+\)/, ')'));
  // the name is never replaced by the letter and never cut
  await expect(card.locator('[data-part="run-name"]')).toContainText('baseline-gpt-mini');
  await expect(card.locator('[data-part="baseline-tag"]')).toHaveText('Baseline');
  expect(await part(page, 'baseline-tag').count()).toBeGreaterThan(1); // card, column head, key; never a star
  await expect(page.getByRole('img', { name: 'baseline' })).toHaveCount(0);
});

test('C-page-4: a long run name wraps and is never cut anywhere', async ({ page }) => {
  await openCompare(page, s.eight, 1024);
  const cut = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-part="run-name"]'))
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis')
      .map((e) => e.textContent),
  );
  expect(cut).toEqual([]);
});

test('D2: two different runs with the same name carry their start time and a number in every place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(compareUrl(dup));
  await waitLoaded(page);
  const names = await part(page, 'run-card').locator('[data-part="run-name"]').allInnerTexts();
  const clean = names.map((n) => n.replace(/^[A-Z]\s*/, '').replace(/\s*Baseline$/, '').trim());
  expect(new Set(clean).size).toBe(2);
  for (const n of clean) expect(n).toMatch(/^nightly · .+ #\d$/);
  // the same labels in the Averages heads
  const heads = await part(page, 'averages-colhead').allInnerTexts();
  for (const n of clean) expect(heads.join('|')).toContain(n);
});
