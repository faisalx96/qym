import { open, ready, rect, overflow, BASE } from './lib.mjs';
const A = await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'DELETE' }); console.log('DELETE', A.status);
for (const [label, B, H] of [['admin', BASE, {}], ['member', 'http://127.0.0.1:6017', { 'X-User-Email': 'sara@example.test' }]]) {
  for (const w of [1440, 390]) {
    const { browser, page } = await open(w, { headers: H });
    await page.goto(B + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(900);
    const o = { label, w };
    o.callout = await page.evaluate(() => [...document.querySelectorAll('[data-testid=feedback-list-page] [class*=callout]')].map(e => e.innerText.replace(/\n+/g, ' / ')).slice(0, 1));
    o.newBtn = await page.evaluate(() => { const b = document.querySelector('[data-testid=new-feedback-disabled]') ?? [...document.querySelectorAll('button,a')].find(e => /New feedback/.test(e.textContent)); return b ? [b.tagName, b.getAttribute('aria-disabled') ?? b.disabled, b.title || b.getAttribute('data-title'), b.getAttribute('aria-describedby')] : null; });
    o.strip = await page.locator('[data-testid=drafts-strip]').count(); o.rows = await page.locator('[aria-label="Feedback requests"] [role=row]').count();
    await page.goto(B + '/feedback/new'); await page.waitForSelector('[data-testid=feedback-unconfigured-page]'); await page.waitForTimeout(500); await ready(page);
    o.empty = await page.evaluate(() => { const e = document.querySelector('[data-testid=feedback-unconfigured-page]'); const c = e.querySelector('[class*=empty], [role=status]') ?? e; const r = c.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1), e.innerText.replace(/\n+/g, ' / ').slice(0, 300), [...e.querySelectorAll('a,button')].map(b => b.textContent.trim())]; });
    o.overflow = await overflow(page);
    console.log(JSON.stringify(o)); await page.screenshot({ path: `${process.cwd()}/dl/unconf-${label}-${w}.png`, fullPage: true }); await browser.close();
  }
}
const r = await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ llm_base_url: 'http://127.0.0.1:10010/v1', llm_model: 'feedback:ask_then_propose', llm_api_key: process.env.REVIEW_KEY, draft_retention_days: 30, max_user_messages: 30 }) }); console.log('re-PUT', r.status);
