import { open, ready, rect, overflow, BASE } from './lib.mjs';
for (const w of [1440, 1024]) {
  const { browser, page } = await open(w);
  await page.goto(BASE + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(800); await ready(page);
  const r = await page.evaluate(() => {
    const out = { headers: [], ell: [] };
    document.querySelectorAll('[aria-label="Feedback requests"] [role=columnheader]').forEach(c => {
      const lab = c.querySelector('button, span, div') ; const t = c.querySelector('[class*=label], button') ?? c;
      const range = document.createRange(); range.selectNodeContents(c); const rr = range.getBoundingClientRect();
      out.headers.push({ text: c.textContent.trim(), cw: c.clientWidth, sw: c.scrollWidth, h: +c.getBoundingClientRect().height.toFixed(1), content: +rr.width.toFixed(1), fs: getComputedStyle(c).fontSize, fw: getComputedStyle(c).fontWeight, ws: getComputedStyle(c).whiteSpace });
    });
    document.querySelectorAll('[aria-label="Feedback requests"] *').forEach(e => { const cs = getComputedStyle(e); if (cs.textOverflow === 'ellipsis' || (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1)) out.ell.push([e.tagName, e.className.toString().slice(0, 40), cs.textOverflow, e.scrollWidth, e.clientWidth, e.textContent.trim().slice(0, 40)]); });
    return out;
  });
  console.log(w, JSON.stringify(r.headers)); console.log(JSON.stringify(r.ell));
  await browser.close();
}
