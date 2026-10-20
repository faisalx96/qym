import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const API = async (who: string, method: string, p: string, body?: unknown) => { const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', 'x-user-email': `${who}@x.com`, origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
if (process.argv[2]!=='noseed') await API('mgr', 'PUT', '/v1/datasets/support-faq/access?project_slug=pa', { access_mode: 'project', grants: [] });
if (process.argv[2]!=='noseed') for (const n of [3, 5, 50, 70, 90, 120]) await API('mgr', 'POST', `/v1/datasets/support-faq/versions/v2/items/faq-${String(n).padStart(3, '0')}:disable?project_slug=pa`, { reason: 'duplicate of faq-014' });
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const R = `(sel)=>{const e=document.querySelector(sel); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]}`;
async function open(w: number, url: string, who = 'mgr') {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(700); return { ctx, p };
}
const tb = (p: any) => p.evaluate(`(()=>{const q=${R}; const s=document.querySelector('[data-testid="items-state"]'); let t=s; while(t && !(t.querySelector('[data-testid="items-search"]') && (t.className+'').match(/oolbar/))) t=t.parentElement; const tr=t&&t.getBoundingClientRect(); return { state:q('[data-testid="items-state"]'), stateText:s&&s.innerText.replace(/\\n+/g,' '), meta:q('[data-testid="metadata-filter"]'), all:q('[data-testid="all-matching"]'), search:q('[data-testid="items-search"]'), toolbarH: tr&&+tr.height.toFixed(1), chips:q('[data-testid="filter-chips"]'), count:document.querySelector('[data-testid="items-count"]')?.innerText, hs:document.documentElement.scrollWidth<=innerWidth }})()`);
for (const w of [1440, 1024, 390]) {
  let { ctx, p } = await open(w, '/projects/pa/datasets/support-faq?v=v2&tab=items');
  console.log(w, 'default', JSON.stringify(await tb(p)));
  await p.screenshot({ path: path.join(shotsDir, `review-toolbar-${w}.png`) }); await ctx.close();
  ({ ctx, p } = await open(w, '/projects/pa/datasets/support-faq?v=v2&tab=items&meta=domain:finance&meta=source.region.code:sa&label=edge'));
  console.log(w, 'filtered?', JSON.stringify(await tb(p)));
  await ctx.close();
}
await b.close();
