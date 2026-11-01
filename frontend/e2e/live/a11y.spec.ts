/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { AXE_PATH, describeViolations, type AxeViolation } from '../shell/support';
import { seedLive } from './support';

let seed: Awaited<ReturnType<typeof seedLive>>;
test.beforeAll(async ({ request }) => {
  seed = await seedLive(request, uniqueSlug('live-a11y'), { days: 14 });
});

async function focusRing(target: Locator) {
  await expect(target).toBeFocused();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const style = getComputedStyle(element);
        if (!element.matches(':focus-visible') && !element.hasAttribute('data-focus-visible')) return false;
        if (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) return true;
        // DataTable draws its focused row as inset top/bottom borders on every cell.
        const cells = Array.from(element.querySelectorAll(':scope > td'));
        return (
          element.matches('[data-live-day]') &&
          cells.length > 0 &&
          cells.every((cell) => {
            const shadow = getComputedStyle(cell).boxShadow;
            return (
              shadow.includes('inset') &&
              shadow.includes('0px 2px 0px 0px') &&
              shadow.includes('0px -2px 0px 0px')
            );
          })
        );
      }),
    )
    .toBe(true);
}

/** Advance from the current focus, never focus the target directly or wrap through the page. */
async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 120; step++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      await focusRing(target);
      return;
    }
    expect(
      await page.evaluate(() => document.activeElement === document.body),
      'Tab wrapped before reaching the next Live control',
    ).toBe(false);
  }
  throw new Error(`Tab did not reach ${await target.evaluate((element) => element.outerHTML)}`);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  for (const surface of ['overview', 'turns', 'turn'] as const) {
    test(`LV-32: axe has zero violations on ${surface} at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const day = seed.days.at(-1)!.day;
      const suffix =
        surface === 'overview'
          ? ''
          : surface === 'turns'
            ? '/turns'
            : `/turns/${encodeURIComponent(`${day}/turn-1`)}`;
      await gotoApp(
        page,
        `/projects/${seed.projectSlug}/live${suffix}?${new URLSearchParams({ source: seed.sourceKey, day })}`,
      );
      const ready =
        surface === 'overview'
          ? '[data-live-day]'
          : surface === 'turns'
            ? '[data-live-turn-row]'
            : '[data-live-answer]';
      await expect(page.locator(ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ path: AXE_PATH });
      // Same tags as the shell/feedback suites, with every violation retained for LV-32.
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: { run: (context: Document, options: unknown) => Promise<{ violations: AxeViolation[] }> };
          }
        ).axe;
        return (
          await axe.run(document, {
            resultTypes: ['violations'],
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
          })
        ).violations;
      });
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }

  test(`LV-32: overview keyboard order and visible focus at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await gotoApp(
      page,
      `/projects/${seed.projectSlug}/live?${new URLSearchParams({ source: seed.sourceKey, day: seed.days.at(-1)!.day })}`,
    );
    await expect(page.locator('[data-live-day]').first()).toBeVisible();
    // The shell's route focus target is the start of page content.
    await page.locator('#shell-content').focus();
    for (const target of [
      page
        .locator('[data-live-block="day-switcher"]')
        .getByRole('button', { name: 'Previous day', exact: true }),
      page.locator('[data-live-stat="turns"] a'),
      page.locator('[data-live-block="mix-plot"] [data-live-label] a').first(),
      page.locator('[data-live-trend-day]').first(),
      page.locator('[data-live-day]').first(),
    ]) {
      await tabTo(page, target);
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === `/projects/${seed.projectSlug}/live/turns`);
  });

  test(`LV-32: turn tabs activate with Arrow keys at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const id = `${seed.days.at(-1)!.day}/turn-1`;
    await gotoApp(
      page,
      `/projects/${seed.projectSlug}/live/turns/${encodeURIComponent(id)}?${new URLSearchParams({ source: seed.sourceKey })}`,
    );
    const tabs = page.getByRole('tablist', { name: 'Turn sections' });
    const diagnosis = tabs.getByRole('tab', { name: 'Diagnosis', exact: true });
    await expect(diagnosis).toHaveAttribute('aria-selected', 'true');
    await page.locator('#shell-content').focus();
    await tabTo(page, diagnosis);
    for (const [name, key] of [
      ['Answer and SQL', 'answer'],
      ['Judges', 'judges'],
      ['Charts', 'charts'],
      ['Services and tools', 'services'],
      ['Conversation', 'conversation'],
      ['Evaluator', 'evaluator'],
    ]) {
      await page.keyboard.press('ArrowRight');
      const tab = tabs.getByRole('tab', { name, exact: true });
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await focusRing(tab);
      await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
      await expect(page).toHaveURL((url) => url.searchParams.get('tab') === key);
    }
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Conversation', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Home');
    await focusRing(diagnosis);
    await expect(diagnosis).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL((url) => !url.searchParams.has('tab'));
  });
}
