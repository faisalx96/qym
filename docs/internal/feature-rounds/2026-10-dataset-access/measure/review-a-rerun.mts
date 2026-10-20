import { chromium } from './lib-a.mts';
const BASE='http://127.0.0.1:8985', R='eca8e788-2387-4661-9989-59ff7d859771';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const mk = async (w: number, who: string) => { const c = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } }); return { c, p: await c.newPage() }; };
for (const w of [1440, 390]) {
  const { c, p } = await mk(w, 'mem3'); await p.goto(`${BASE}/projects/pa/runs/${R}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.getByText('#1', { exact: true }).first().click(); await p.waitForTimeout(2500);
  console.log(w, 'run', await p.evaluate(`({red:document.querySelectorAll('[data-testid="run-item-redacted"]').length, loading:/Loading item details/.test(document.body.innerText), priv:(document.body.innerText.match(/private test set/gi)||[]).length, h:document.querySelector('[data-testid="run-item-redacted"]')?.getBoundingClientRect().height})`)); await c.close(); }
for (const w of [1440, 1024, 390]) {
  let { c, p } = await mk(w, 'mem3'); await p.goto(`${BASE}/projects/pa/datasets/support-faq`, { waitUntil: 'networkidle' }); 
  await p.goto(`${BASE}/projects/pa/datasets/legal-clauses`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  console.log(w, '403 alert', await p.evaluate(`(()=>{const a=document.querySelector('[data-testid="da-403"] [role="alert"]'); if(!a) return 'none: '+document.body.innerText.slice(0,100); return +a.getBoundingClientRect().height.toFixed(2)})()`)); await c.close();
  ({ c, p } = await mk(w, 'mem2')); await p.goto(`${BASE}/projects/pa/datasets`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  console.log(w, 'card badge', await p.evaluate(`(()=>{const e=[...document.querySelectorAll('[data-testid="da-card-badges"] *')].find(x=>x.textContent==='View only'&&x.children.length>=0&&x.getBoundingClientRect().height>10); const r=e.getBoundingClientRect(); const out=[]; document.querySelectorAll('[data-testid="da-card-badges"] > *').forEach(x=>{ if(/View only/.test(x.textContent)) out.push([+x.getBoundingClientRect().width.toFixed(1), +x.getBoundingClientRect().height.toFixed(1), x.querySelectorAll('svg').length]) }); return out})()`)); await c.close();
  ({ c, p } = await mk(w, 'mgr')); await p.goto(`${BASE}/projects/pa/datasets/support-faq?v=v2&tab=items&meta=domain:finance&meta=source.region.code:sa`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.getByTestId('all-matching').click(); await p.getByRole('menuitem', { name: /Disable all/ }).click(); await p.waitForTimeout(1200);
  console.log(w, 'batch dialog', await p.evaluate(`(()=>{const r=document.querySelector('[data-testid="da-modal"]').getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]})()`)); await c.close();
}
await b.close();
