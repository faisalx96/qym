const { open, base, S } = require('./pw.cjs');
(async () => {
  const { browser, page } = await open(1800, 1000);
  await page.goto(`${base}/__mock/round9/environments-table`);
  const shellEl = page.locator('[data-testid=page-shell]');
  await shellEl.waitFor(); await page.waitForTimeout(800);
  const row = page.locator('[data-row-id]').nth(1);
  await row.locator('td').nth(2).hover(); await page.waitForTimeout(300);
  const info = await page.evaluate(() => { const tr = document.querySelectorAll('[data-row-id]')[1]; return { cursor: getComputedStyle(tr).cursor, td: getComputedStyle(tr.children[1]).backgroundColor, h: tr.getBoundingClientRect().height }; });
  console.log(JSON.stringify(info));
  await shellEl.screenshot({ path: `${S}/shots/mock-page-environments-table-hover-1440.png` });
  await page.mouse.move(5, 5); await page.keyboard.press('Tab'); 
  await page.locator('[data-row-id]').first().focus(); await page.waitForTimeout(200);
  await shellEl.screenshot({ path: `${S}/shots/mock-page-environments-table-focus-1440.png` });
  await browser.close();
})();
