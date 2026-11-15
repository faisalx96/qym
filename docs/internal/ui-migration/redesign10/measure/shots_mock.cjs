// Screenshots of the round 10 mocks: composed pages (whole page, the shell element) at 1440 and 390, the K4 pages also as
// the viewport the user sees (1440x900, 1440x1400, 390x844), the state sheets at 1440. Usage: node shots_mock.cjs [filter]
const { chromium, base, SHOTS } = require('./pw.cjs');
const only = process.argv[2];
const PAGES = ['customize-where', 'customize-start', 'review', 'env-versions', 'env-versions-none', 'home-short'];
const VIEWPORT = ['home-short', 'customize-start', 'customize-where'];
const SHEETS = ['sheet-bar', 'sheet-versions', 'sheet-runs'];
(async () => {
  const browser = await chromium.launch();
  const shot = async (w, h, id, mode) => {
    if (only && !id.includes(only)) return;
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage();
    await page.goto(`${base}/__mock/round10/${id}`);
    const isPage = !id.startsWith('sheet-');
    const el = isPage ? page.locator('[data-testid=page-shell]').first() : page.locator('#root > *').first();
    await el.waitFor();
    await page.waitForTimeout(900);
    if (mode === 'viewport') {
      await page.screenshot({ path: `${SHOTS}/mock-page-${id}-${w}x${h}.png` });
      console.log(id, `${w}x${h}`, 'viewport');
    } else {
      // whole page: Chromium lays the full height out, so the sticky bar sits where the flow puts it (after the content)
      const box = await el.boundingBox();
      if (isPage) {
        // a viewport as tall as the page: the sticky bar then sits where the flow puts it, as it does at the end of a scroll
        const full = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: w, height: Math.max(h, full) });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/mock-page-${id}-${w}.png` });
      }
      else await el.screenshot({ path: `${SHOTS}/${id}-${w}.png` });
      console.log(id, w, box && `${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    await page.close();
  };
  for (const id of PAGES) {
    await shot(1440, 900, id, 'full');
    await shot(390, 844, id, 'full');
  }
  for (const id of VIEWPORT) {
    await shot(1440, 900, id, 'viewport');
    await shot(1440, 1400, id, 'viewport');
    await shot(390, 844, id, 'viewport');
  }
  for (const id of SHEETS) {
    await shot(1440, 900, id, 'full');
    if (id !== 'sheet-runs') await shot(390, 844, id, 'full');
  }
  await browser.close();
})();
