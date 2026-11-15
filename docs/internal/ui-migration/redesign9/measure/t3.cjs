const { open, base, S, PROJ } = require('./pw.cjs');
(async () => {
  const { browser, page } = await open(1440, 900);
  await page.goto(base + PROJ + '/settings?tab=environments'); await page.waitForSelector('[data-row-id]'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${S}/shots/current-envtable-settings-1440.png` });
  await page.locator('[data-row-id]').first().locator('td').nth(1).hover(); await page.waitForTimeout(250);
  console.log(await page.evaluate(() => { const tr = document.querySelector('[data-row-id]'); return JSON.stringify({ cursor: getComputedStyle(tr).cursor, td: getComputedStyle(tr.children[1]).backgroundColor, clickable: tr.hasAttribute('data-clickable'), h: tr.getBoundingClientRect().height }); }));
  const b = page.url(); await page.locator('[data-row-id]').first().locator('td').nth(1).click(); await page.waitForTimeout(500); console.log('navigated', page.url() !== b);
  await browser.close();
})();
