const { open, base, S, PROJ } = require('./pw.cjs');
(async () => {
  for (const [label, path] of [['page', '/environments'], ['settings', '/settings?tab=environments']]) {
    const { browser, page } = await open(390, 844);
    await page.goto(base + PROJ + path);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${S}/shots/current-envtable-${label}-390.png` });
    const info = await page.evaluate(() => { const m = document.querySelector('main'); return { text: m.innerText.slice(0, 500), rows: document.querySelectorAll('[data-row-id]').length, tables: document.querySelectorAll('table').length, cards: Array.from(document.querySelectorAll('[role=row],[data-card]')).length }; });
    console.log(label, JSON.stringify(info));
    await browser.close();
  }
})();
