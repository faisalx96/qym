import { open, ready, rect, overflow, BASE } from './lib.mjs';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.includes('feedback')) calls.push(r.method() + ' ' + u.pathname); });
  await page.goto(BASE + '/admin/feedback'); await page.waitForSelector('[data-testid=connection]'); await page.waitForTimeout(900); await ready(page);
  const o = { w };
  o.tabs = await page.evaluate(() => { const t = document.querySelector('[role=tablist]'); const r = t.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), t.scrollWidth - t.clientWidth, [...t.querySelectorAll('[role=tab]')].map(x => x.textContent.trim())]; });
  o.totals = await page.evaluate(() => { const e = [...document.querySelectorAll('section, div')].find(x => x.getAttribute('aria-label') === 'Feedback totals'); if (!e) return null; const r = e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), e.innerText.replace(/\n+/g, ' | ')]; });
  o.connection = await rect(page, '[data-testid=connection]');
  o.head = await page.evaluate(() => document.querySelector('[data-testid=connection]').innerText.split('\n').slice(0, 2));
  o.fields = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection] input')].map(e => [e.labels?.[0]?.textContent.trim(), e.type, e.placeholder, +e.getBoundingClientRect().width.toFixed(1), +e.getBoundingClientRect().height.toFixed(1), getComputedStyle(e).fontFamily.slice(0, 20)]));
  o.buttons = await page.evaluate(() => [...document.querySelectorAll('[data-testid=connection] button')].map(b => [b.textContent.trim(), +b.getBoundingClientRect().width.toFixed(1), +b.getBoundingClientRect().height.toFixed(1), b.disabled]));
  o.help = await page.evaluate(() => document.querySelector('[data-testid=connection]').innerText.replace(/\n+/g, ' | ').slice(0, 700));
  o.behaviour = await page.evaluate(() => { const h = [...document.querySelectorAll('h2,h3')].find(e => /Behaviour/i.test(e.textContent)); const c = h?.closest('section, [class*=card]'); return c ? c.innerText.replace(/\n+/g, ' | ').slice(0, 500) : null; });
  o.overflow = await overflow(page); o.calls = calls;
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/admin-${w}.png`, fullPage: true });
  await browser.close();
}
