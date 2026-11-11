const { open, base, S, PROJ, ENVS } = require('./pw.cjs');
(async () => {
  for (const w of [1440, 390]) {
    for (const [label, path, drawer] of [['page', `/environments/${ENVS.staging}`, false], ['settings', `/settings?tab=environments&env=${ENVS.staging}`, true]]) {
      const { browser, page } = await open(w, w === 390 ? 844 : 900);
      await page.goto(base + PROJ + path);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${S}/shots/current-envdetail-${label}-${w}.png`, fullPage: !drawer });
      const info = await page.evaluate((drawer) => {
        const root = drawer ? document.querySelector('[role=dialog]') : document.querySelector('[data-environment-page]');
        if (!root) return null;
        const r = root.getBoundingClientRect();
        const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4')).map((h) => h.tagName + ':' + h.innerText.trim() + '@' + Math.round(h.getBoundingClientRect().y + scrollY));
        const btns = Array.from(root.querySelectorAll('button,a')).filter((b) => b.getBoundingClientRect().width > 0).map((b) => (b.getAttribute('aria-label') || b.innerText).trim().replace(/\s+/g, ' ')).filter(Boolean);
        const body = root.querySelector('[data-env-body]');
        const b = body && body.getBoundingClientRect();
        const secs = body ? Array.from(body.children).map((c) => c.tagName + '.' + (c.getAttribute('aria-label') || c.getAttribute('data-testid') || (c.className || '').toString().slice(0, 25)) + ' ' + Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)) : [];
        return { root: Math.round(r.width) + 'x' + Math.round(r.height), bodyW: b && Math.round(b.width), heads, btns, secs, title: document.title };
      }, drawer);
      console.log(label, w, JSON.stringify(info, null, 0));
      await browser.close();
    }
  }
})();
