const { open, base, S } = require('./pw.cjs');
const only = process.argv[2];
const ids = ['create-home','create-home-flagged','customize-where','customize-models','customize-settings','review','preset-edit','preset-publish','environment-experiments','environment-settings','environments-table','sheet-bar','sheet-boxes','sheet-task','sheet-priority','sheet-table'];
(async () => {
  const { chromium } = require('/home/meshari-aldossari/Documents/qym/qym-wt-redesign9/frontend/node_modules/@playwright/test');
  const browser = await chromium.launch();
  for (const [w, vw] of [[1440, 1800], [390, 480]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: 1000 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    for (const id of ids) {
      if (only && !id.includes(only)) continue;
      await page.goto(`${base}/__mock/round9/${id}`);
      const isPage = !id.startsWith('sheet-');
      const el = isPage ? page.locator('[data-testid=page-shell]').first() : page.locator('#root > *').first();
      await el.waitFor();
      await page.waitForTimeout(900);
      const box = await el.boundingBox();
      console.log(id, w, box && `${Math.round(box.width)}x${Math.round(box.height)}`);
      await el.screenshot({ path: `${S}/shots/${isPage ? 'mock-page-' + id : id}-${w}.png` });
    }
    await ctx.close();
  }
  await browser.close();
})();
