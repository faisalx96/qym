import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const H = (page: any, sel: string) => page.evaluate(`(()=>{const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]})()`);
async function open(w: number, url: string, who = 'mgr') {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(800); return { ctx, p };
}
const U = '/projects/pa/datasets/support-faq';
const shot = (p: any, n: string, w: number) => p.screenshot({ path: path.join(shotsDir, `review-${n}-${w}.png`) });
for (const w of [1440, 1024, 390]) {
  let { ctx, p } = await open(w, `${U}?v=v2&tab=items`);
  console.log(w, 'toolbar default', await H(p, '[data-dt-toolbar]'));
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}?v=v2&tab=items&meta=domain:finance&meta=source.region.code:sa&label=edge`));
  console.log(w, 'toolbar filtered (1 label+2 meta)', await H(p, '[data-dt-toolbar]'), 'chips', await H(p, '[data-testid="filter-chips"]'));
  await ctx.close();
  // all-matching, state=disabled rows
  ({ ctx, p } = await open(w, `${U}?v=v2&tab=items&state=disabled`));
  console.log(w, 'disabled rows', await p.evaluate(`(()=>{const rows=[...document.querySelectorAll('tbody tr, [role=row]')].filter(r=>/Disabled/.test(r.innerText)); const r=rows[0]; const x=r&&r.getBoundingClientRect(); return { n:rows.length, h:x&&+x.height.toFixed(1), badge:[...document.querySelectorAll('span')].filter(s=>s.textContent==='Disabled').slice(0,1).map(s=>{const q=s.getBoundingClientRect(); return [q.width.toFixed(1),q.height.toFixed(1)]}), color: r&&getComputedStyle(r.querySelector('td, [role=cell]')||r).color, opacity: r&&getComputedStyle(r).opacity, count: document.querySelector('[data-dt-toolbar]')?.innerText.match(/\\d+ items?/)?.[0] }})()`));
  if (w !== 390) { await shot(p, 'items-disabled', w); }
  await ctx.close();
  // popover
  ({ ctx, p } = await open(w, `${U}?v=v2&tab=items`));
  await p.getByTestId('metadata-filter').click(); await p.waitForTimeout(800);
  console.log(w, 'popover', await H(p, '[data-testid="meta-popover"]'), 'values', await H(p, '[data-testid="facet-values"]'));
  await shot(p, 'meta-popover', w); await ctx.close();
  // all matching menu with a filter
  ({ ctx, p } = await open(w, `${U}?v=v2&tab=items&meta=domain:finance&meta=source.region.code:sa`));
  await p.getByTestId('all-matching').click(); await p.waitForTimeout(500);
  const menu = await p.evaluate(`[...document.querySelectorAll('[role=menuitem]')].map(m=>[m.textContent, m.getAttribute('aria-disabled'), +m.getBoundingClientRect().width.toFixed(1)])`);
  console.log(w, 'menu', JSON.stringify(menu));
  await shot(p, 'all-matching-menu', w);
  await p.getByRole('menuitem', { name: /Disable all/ }).click(); await p.waitForTimeout(1200);
  console.log(w, 'batch dialog', await H(p, '[data-testid="da-modal"]'), await p.evaluate(`document.querySelector('[data-testid="batch-numbers"]')?.innerText`), await p.evaluate(`document.querySelector('[data-testid="batch-ids"]')?.innerText.replace(/\\n+/g,' ')`), await H(p, '[data-testid="batch-numbers"]'));
  console.log(w, 'dialog title', await p.evaluate(`document.querySelector('[role=dialog] h2, [role=dialog] [class*=title]')?.textContent`));
  await shot(p, 'batch-dialog', w); await ctx.close();
}
await b.close();
