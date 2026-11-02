import { open, ready, rect, overflow, BASE } from './lib.mjs';
for (const w of [1440, 1024, 390]) {
  const { browser, page } = await open(w);
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname); });
  await page.goto(BASE + '/feedback/new'); await page.waitForSelector('[data-testid=new-form]'); await page.waitForTimeout(600); await ready(page);
  const o = { w };
  o.page = await rect(page, '[data-testid=feedback-new-page]');
  o.form = await rect(page, '[data-testid=new-form]');
  o.radios = await page.evaluate(() => [...document.querySelectorAll('[data-testid=new-form] [role=radio], [data-testid=new-form] input[type=radio]')].map(e => [e.getAttribute('aria-label') || e.closest('label')?.textContent.trim().slice(0, 60), e.tabIndex]));
  o.radiogroup = await page.evaluate(() => { const g = document.querySelector('[role=radiogroup]'); return g ? [g.getAttribute('aria-label') || g.getAttribute('aria-labelledby'), g.textContent.slice(0, 200)] : null; });
  o.textarea = await page.evaluate(() => { const t = document.querySelector('[data-testid=new-form] textarea'); const r = t.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), t.rows, t.placeholder, t.maxLength]; });
  o.footer = await page.evaluate(() => [...document.querySelectorAll('[data-testid=new-form] button')].map(b => [b.textContent.trim(), b.disabled || b.getAttribute('aria-disabled'), +b.getBoundingClientRect().height.toFixed(1)]));
  o.formText = await page.evaluate(() => document.querySelector('[data-testid=new-form]').innerText.replace(/\n+/g, ' | ').slice(0, 700));
  o.howItWorks = await page.evaluate(() => { const h = [...document.querySelectorAll('h2,h3')].find(e => /how it works/i.test(e.textContent)); if (!h) return null; const c = h.closest('[class*=card], section, div'); const r = c.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), c.innerText.replace(/\n+/g, ' | ').slice(0, 400)]; });
  o.overflow = await overflow(page);
  // product option
  await page.getByText('A product I evaluate with qym').first().click(); await page.waitForTimeout(500);
  o.productFields = await page.evaluate(() => { const p = document.querySelector('[data-testid=product-fields]'); if (!p) return null; const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return { w: r.width, h: r.height, border: cs.borderTopWidth, order: [...p.querySelectorAll('label, [role=radiogroup], select, button[aria-haspopup]')].map(e => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30)), fields: [...p.querySelectorAll('input, button[aria-haspopup], select')].map(e => +e.getBoundingClientRect().height.toFixed(1)) }; });
  o.startDisabled = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /Start conversation/.test(b.textContent)); return b ? [b.disabled || b.getAttribute('aria-disabled')] : null; });
  o.calls = calls; o.doctitle = await page.title();
  console.log(JSON.stringify(o));
  await page.screenshot({ path: `${process.cwd()}/dl/new-${w}.png`, fullPage: true });
  await browser.close();
}
