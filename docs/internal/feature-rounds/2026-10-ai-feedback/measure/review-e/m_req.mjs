import { open, ready, rect, overflow, BASE } from './lib.mjs';
const ref = process.argv[2];
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname); });
  await page.goto(BASE + '/feedback/' + ref); await page.waitForSelector('[data-testid=feedback-request-page]'); await page.waitForTimeout(900); await ready(page);
  const o = { w, ref };
  o.header = await page.evaluate(() => { const h = document.querySelector('[data-testid=feedback-request-page] h1').closest('header'); const r = h.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), h.innerText.replace(/\n+/g, ' | ')]; });
  o.tabs = await page.evaluate(() => { const t = document.querySelector('[role=tablist]'); const r = t.getBoundingClientRect(); return [t.getAttribute('aria-label'), +r.width.toFixed(1), +r.height.toFixed(1), t.innerText.replace(/\n+/g, ' | ')]; });
  for (const [k, s] of [['strip', '[data-testid=feedback-request-page] [aria-label="Priority and complexity"]'], ['card', '[data-testid=request-card]'], ['history', '[data-testid=history]'], ['relatedCard', '[data-testid=related-card]'], ['triage', '[data-testid=triage]']]) o[k] = await rect(page, s);
  o.relItems = await page.evaluate(() => [...document.querySelectorAll('[data-testid=related-card] li')].map(e => [+e.getBoundingClientRect().height.toFixed(1), e.innerText.replace(/\n+/g, ' / ').slice(0, 110)]));
  o.callout = await page.evaluate(() => [...document.querySelectorAll('[data-testid=feedback-request-page] [role=status], [data-testid=feedback-request-page] [role=alert]')].map(e => e.innerText.replace(/\n+/g, ' / ').slice(0, 160)));
  o.strip_text = await page.evaluate(() => { const e = document.querySelector('[data-testid=feedback-request-page]'); return e.innerText.match(/(Confirmed by|Revised by)[^\n]*/g); });
  o.railX = await page.evaluate(() => { const c = document.querySelector('[data-testid=request-card]').getBoundingClientRect(), r = (document.querySelector('[data-testid=related-card]') ?? document.querySelector('[data-testid=triage]'))?.getBoundingClientRect(); return r ? (r.left > c.right - 2 ? 'rail-right' : 'below') : 'none'; });
  o.cardText = await page.evaluate(() => [...document.querySelectorAll('[data-testid=request-card] [class*=eyebrow], [data-testid=request-card] h3, [data-testid=request-card] h4, [data-testid=request-card] dt')].map(e => e.textContent.trim()));
  o.overflow = await overflow(page); o.title = await page.title(); o.calls = calls;
  o.target = await page.evaluate(() => document.querySelector('[data-testid=target-link]')?.outerHTML.slice(0, 120));
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/req-${ref}-${w}.png`, fullPage: true });
  await browser.close();
}
