const { open, base, S, PROJ, ENVS, measure } = require('./pw.cjs');
(async () => {
  for (const w of [1440, 390]) {
    const { browser, page } = await open(w, w === 390 ? 844 : 900);
    await page.goto(`${base}${PROJ}/experiments/new?clone=ff4c6660-4a0f-460c-91ed-d6d69693662c&step=where`);
    await page.getByRole('checkbox', { name: 'production' }).waitFor();
    await page.getByRole('checkbox', { name: 'production' }).click({ force: true });
    await page.waitForTimeout(1500);
    await page.goto(`${base}${PROJ}/experiments/new?clone=ff4c6660-4a0f-460c-91ed-d6d69693662c&step=review`);
    await page.waitForTimeout(2500);
    console.log('url', page.url());
    await page.screenshot({ path: `${S}/shots/current-review-sweep-${w}.png`, fullPage: true });
    const info = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label=Review]');
      const q = (s) => Array.from(aside.querySelectorAll(s));
      const rect = (e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
      const fs = (e) => { const c = getComputedStyle(e); return `${c.fontSize}/${c.fontWeight}/${c.fontFamily.split(',')[0]}/${c.color}`; };
      const out = { text: aside.innerText.slice(0, 900), card: rect(aside) };
      const dl = aside.querySelector('dl');
      if (dl) { out.dl = rect(dl); out.dts = Array.from(dl.querySelectorAll('dt')).map((e) => rect(e) + ' ' + fs(e) + ' ' + e.innerText); out.dds = Array.from(dl.querySelectorAll('dd')).map((e) => rect(e) + ' ' + fs(e)); out.dlDisplay = getComputedStyle(dl).display + ' ' + getComputedStyle(dl).gridTemplateColumns; }
      out.headings = Array.from(aside.querySelectorAll('h3,h4,summary')).map((e) => e.tagName + ' ' + rect(e) + ' ' + fs(e) + ' ' + e.innerText);
      out.runs = Array.from(aside.querySelectorAll('[class*=runs]')).map((e) => rect(e) + ' ' + fs(e) + ' ' + e.innerText.replace(/\n/g, ' '));
      out.math = Array.from(aside.querySelectorAll('p')).map((e) => rect(e) + ' ' + fs(e) + ' ' + e.innerText);
      out.lis = Array.from(aside.querySelectorAll('li')).map((e) => rect(e) + ' ' + e.innerText.replace(/\n/g, ' | '));
      return out;
    });
    console.log(w, JSON.stringify(info, null, 1));
    // open run names
    const sm = page.locator('aside[aria-label=Review] summary');
    if (await sm.count()) { await sm.click(); await page.waitForTimeout(300); const ol = await page.evaluate(() => { const o = document.querySelector('aside[aria-label=Review] ol'); const r = o.getBoundingClientRect(); return { w: r.width, h: r.height, n: o.children.length, li: Math.round(o.children[0].getBoundingClientRect().height), txt: Array.from(o.children).map(e => e.innerText) }; }); console.log('names', JSON.stringify(ol)); await page.screenshot({ path: `${S}/shots/current-review-sweep-names-${w}.png`, fullPage: true }); }
    await browser.close();
  }
})();
