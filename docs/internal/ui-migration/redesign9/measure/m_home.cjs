const { open, base, S, measure, contrast, PROJ } = require('./pw.cjs');
(async () => {
  for (const w of [1440, 1024, 390]) {
    const { browser, page } = await open(w, w === 390 ? 844 : 900);
    await page.goto(base + PROJ + '/experiments/new');
    await page.getByRole('checkbox', { name: 'production' }).waitFor();
    await page.screenshot({ path: `${S}/shots/current-create-home-empty-${w}.png`, fullPage: true });
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await page.getByRole('checkbox', { name: 'staging' }).click({ force: true });
    await page.getByRole('button', { name: /^Choose a dataset/ }).click();
    await page.getByRole('option', { name: /support-tickets/ }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${S}/shots/current-create-home-${w}.png`, fullPage: true });
    console.log('== width', w);
    const sels = [
      'main', '[data-testid=launch-home]', '[data-testid=launch-home] > div > div:nth-child(1)', 'fieldset ul > li', 'li[data-selected=true]', '[data-env-task]', '[data-env-task] button', '[data-dataset-box]', '[data-testid=datasets-fieldset]', '[role=radio]', '[role=region][aria-label=Launch]'];
    for (const s of sels) {
      const r = await measure(page, s); if (!r) { console.log(s, 'none'); continue; }
      console.log(JSON.stringify(r));
    }
    // cards (outer) -- the Card wrapping env fieldset
    const card = await page.evaluate(() => { const f = document.querySelector('fieldset'); let n = f; const out = []; for (let i = 0; i < 4 && n; i++, n = n.parentElement) { const cs = getComputedStyle(n); out.push(n.tagName + '.' + n.className.slice(0, 30) + ' bg=' + cs.backgroundColor + ' border=' + cs.borderTopWidth + ' ' + cs.borderTopColor + ' pad=' + cs.padding); } return out; });
    console.log(card.join('\n'));
    await browser.close();
  }
})();
