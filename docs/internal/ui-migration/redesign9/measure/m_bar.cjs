const { open, base, S, PROJ, ENVS } = require('./pw.cjs');
(async () => {
  for (const w of [1440, 1024, 390]) {
    const { browser, page } = await open(w, w === 390 ? 844 : 900);
    for (const step of ['where', 'start', 'models', 'settings', 'evaluation', 'review']) {
      await page.goto(`${base}${PROJ}/experiments/new?env=${ENVS.staging}&step=${step}`);
      await page.waitForSelector('[role=region][aria-label=Launch], aside[aria-label=Review]');
      await page.waitForTimeout(2200);
      await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
      await page.screenshot({ path: `${S}/shots/current-step-${step}-${w}.png`, fullPage: true });
      const info = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const btns = (root) => Array.from(root.querySelectorAll('button,a')).filter(vis).map((b) => { const r = b.getBoundingClientRect(); return `${(b.getAttribute('aria-label') || b.innerText).trim().replace(/\s+/g, ' ')}[${Math.round(r.x)},${Math.round(r.y + scrollY)},h${Math.round(r.height)}]`; });
        const out = {};
        const bar = document.querySelector('[role=region][aria-label=Launch]');
        if (bar) { const cs = getComputedStyle(bar); const r = bar.getBoundingClientRect(); out.bar = { pos: cs.position, h: Math.round(r.height), w: Math.round(r.width), btns: btns(bar) }; }
        const nav = Array.from(document.querySelectorAll('nav[aria-label="Step navigation"]')).filter((n) => !n.closest('[role=region][aria-label=Launch]'))[0];
        if (nav) { const cs = getComputedStyle(nav); const r = nav.getBoundingClientRect(); out.stepNav = { pos: cs.position, h: Math.round(r.height), btns: btns(nav) }; }
        const aside = document.querySelector('aside[aria-label=Review]');
        if (aside) { const r = aside.getBoundingClientRect(); const cs = getComputedStyle(aside.parentElement); out.review = { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), parentPos: cs.position, btns: btns(aside).filter(x => /Cancel|Raw|Launch|Edit/.test(x) && !/Edit/.test(x)) }; }
        out.docH = document.querySelector('main').scrollHeight;
        return out;
      });
      console.log(w, step, JSON.stringify(info));
    }
    await browser.close();
  }
})();
