import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  for (const state of ['discovery', 'running', 'waiting']) {
    test(`platform ${state} keeps all six statistics readable at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/__mock/performance/platform-${state}`);
      const strip = page.getByRole('group', { name: 'The run in numbers' });
      await expect(strip).toBeVisible();
      const cells = strip.locator(':scope > [data-variant]');
      await expect(cells).toHaveCount(6);
      const facts = await cells.evaluateAll((elements) =>
        elements.map((cell) => {
          const stack = cell.firstElementChild!;
          const [label, value, note] = Array.from(stack.children);
          return {
            text: cell.textContent,
            overflow: cell.scrollWidth - cell.clientWidth,
            labelWrap: getComputedStyle(label!).whiteSpace,
            valueWrap: getComputedStyle(value!).whiteSpace,
            labelTop: label!.getBoundingClientRect().top,
            valueTop: value!.getBoundingClientRect().top,
            noteBelow:
              !note ||
              note.getBoundingClientRect().top >=
                Math.max(label!.getBoundingClientRect().bottom, value!.getBoundingClientRect().bottom),
          };
        }),
      );
      for (const fact of facts) {
        expect(fact.overflow, fact.text ?? '').toBeLessThanOrEqual(1);
        expect(fact.labelWrap).toBe('nowrap');
        expect(fact.valueWrap).toBe('nowrap');
        expect(Math.abs(fact.labelTop - fact.valueTop)).toBeLessThanOrEqual(2);
        expect(fact.noteBelow).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`${state}-${width}.png`), fullPage: true });
    });
  }
}
