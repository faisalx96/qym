import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const H = (page: any, sel: string) => page.evaluate(`(()=>{const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]})()`);
const U = '/projects/pa/datasets/support-faq';
async function open(w: number, url: string, who = 'mgr') {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); return { ctx, p };
}
for (const w of [1440, 390]) {
  let { ctx, p } = await open(w, `${U}?v=v2`);
  console.log(w, 'meta-items', await p.getByTestId('meta-items').innerText(), await H(p, '[data-testid="meta-items"]'));
  await p.getByTestId('version-switcher').click(); await p.waitForTimeout(500);
  console.log(w, 'versions', await p.evaluate(`[...document.querySelectorAll('[data-testid="version-row-items"]')].map(e=>e.textContent)`));
  await p.keyboard.press('Escape');
  await p.getByTestId('hero-more').click().catch(()=>{}); await p.waitForTimeout(400);
  console.log(w, 'more menu', await p.evaluate(`[...document.querySelectorAll('[role=menuitem]')].map(m=>m.textContent)`));
  await p.keyboard.press('Escape');
  await p.getByTestId('publish').click().catch(()=>{}); await p.waitForTimeout(500);
  console.log(w, 'publish note', await p.getByTestId('publish-disabled-note').innerText().catch(()=>null), await H(p, '[data-testid="publish-disabled-note"]'));
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}/compare?base=v1&head=v2`));
  const t = await p.evaluate('document.body.innerText'); console.log(w, 'compare', JSON.stringify((t.match(/(ADDED|REMOVED|CHANGED|UNCHANGED|DISABLED|ENABLED)\s*\n?\s*\d+/gi)||[]).join(' ')), 'rows', await p.getByTestId('compare-state-row').count(), await p.evaluate(`document.querySelector('[data-testid="compare-state-row"]')?.innerText.replace(/\\n+/g,' ')`), await p.evaluate(`document.querySelector('[aria-label^="state changed"]')?.getAttribute('aria-label')`));
  if (w===1440) await p.screenshot({ path: path.join(shotsDir, `review-compare-${w}.png`) });
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}?v=v2&tab=lineage`));
  console.log(w, 'lineage', await p.evaluate(`(document.body.innerText.match(/[^\\n]*disabled[^\\n]*/gi)||[]).slice(0,4)`));
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}/items/faq-003?v=v2&tab=history`));
  console.log(w, 'history', await H(p, '[data-testid="rev-disabled"]'), await p.evaluate(`document.querySelector('[data-testid="rev-disabled"]')?.innerText.replace(/\\n+/g,' | ')`), 'revert btn', await p.evaluate(`document.querySelector('[data-testid="rev-disabled"]')?.querySelectorAll('button').length`));
  await ctx.close();
}
await b.close();
