import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const H = (page: any, sel: string) => page.evaluate(`(()=>{const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]})()`);
const U = '/projects/pa/datasets/support-faq';
for (const [v, id, who] of [['v2', 'faq-002', 'mgr'], ['v2', 'faq-003', 'mgr'], ['v1', 'faq-003', 'mgr'], ['v2', 'faq-003', 'mem2']] as const) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(BASE + `${U}?v=${v}&tab=items&state=all`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.getByText(id, { exact: true }).first().click(); await p.waitForTimeout(1200);
  console.log(v, id, who, 'action', await H(p, '[data-testid="item-state-action"]'), await p.getByTestId('item-state-action').textContent().catch(() => null), 'enable', await H(p, '[data-testid="enable-item"]'), 'banner', await H(p, '[data-testid="disabled-banner"]'), 'url', new URL(p.url()).search);
  if (who === 'mgr') await p.screenshot({ path: path.join(shotsDir, `review-pane-${v}-${id}-1440.png`) });
  await ctx.close();
}
await b.close();
