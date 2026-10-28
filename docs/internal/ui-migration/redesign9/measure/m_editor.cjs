const { open, base, S, PROJ, ENVS } = require('./pw.cjs');
(async () => {
  for (const w of [1440, 1024, 390]) {
    const { browser, page } = await open(w, w === 390 ? 844 : 900);
    await page.goto(`${base}${PROJ}/environments/${ENVS.staging}/default-preset/edit`);
    await page.waitForSelector('[data-testid=editor-entry]');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${S}/shots/current-preset-editor-${w}.png`, fullPage: true });
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const heads = Array.from(main.querySelectorAll('h1,h2,h3,h4,legend')).map((h) => h.tagName + ':' + h.innerText.trim().slice(0, 40));
      const nav = Array.from(main.querySelectorAll('nav')).map((n) => (n.getAttribute('aria-label') || '') + ':' + Array.from(n.querySelectorAll('button,a')).map((b) => b.innerText.trim()).join('|'));
      const aside = main.querySelector('aside[aria-label="Review and publish"]'); const ar = aside && aside.getBoundingClientRect();
      const btns = aside ? Array.from(aside.querySelectorAll('button')).map((b) => b.innerText.trim() + ' h' + Math.round(b.getBoundingClientRect().height)) : [];
      const stepper = !!main.querySelector('[aria-label=Steps]'); const bar = !!main.querySelector('[role=region][aria-label=Launch]');
      return { docH: main.scrollHeight, heads, nav, aside: ar && `${Math.round(ar.x)},${Math.round(ar.y)} ${Math.round(ar.width)}x${Math.round(ar.height)}`, btns, stepper, bar };
    });
    console.log(w, JSON.stringify(info));
    await browser.close();
  }
})();
