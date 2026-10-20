import { chromium, shotsDir } from './lib-a.mts';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8985';
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
const H = (page: any, sel: string) => page.evaluate(`(()=>{const e=document.querySelector('${sel}'); if(!e) return null; const r=e.getBoundingClientRect(); return [+r.width.toFixed(1), +r.height.toFixed(1)]})()`);
async function open(w: number, url: string, who = 'mgr') {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', extraHTTPHeaders: { 'x-user-email': `${who}@x.com` } });
  const p = await ctx.newPage(); await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); return { ctx, p };
}
const U = '/projects/pa/datasets/support-faq';
const shot = (p: any, n: string, w: number) => p.screenshot({ path: path.join(shotsDir, `review-${n}-${w}.png`) });
for (const w of [1440, 1024]) {
  let { ctx, p } = await open(w, `${U}?v=v2&item=faq-002`);
  console.log(w, 'pane active: action', await H(p, '[data-testid="item-state-action"]'), (await p.getByTestId('item-state-action').textContent()), 'banner', await H(p, '[data-testid="disabled-banner"]'));
  await shot(p, 'pane-active', w);
  await p.getByTestId('item-state-action').click(); await p.waitForTimeout(500);
  console.log(w, 'dialog', await H(p, '[data-testid="da-modal"]'), 'counter', await H(p, '[data-testid="reason-counter"]'), await p.evaluate(`document.querySelector('[role=dialog]').innerText.replace(/\\n+/g,' | ')`));
  await p.keyboard.type('x'); console.log('counter text', await p.getByTestId('reason-counter').textContent());
  await shot(p, 'disable-dialog', w);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  console.log('focus after esc', await p.evaluate(`document.activeElement?.getAttribute('data-testid')`));
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}?v=v2&item=faq-003`));
  console.log(w, 'pane disabled: banner', await H(p, '[data-testid="disabled-banner"]'), await p.getByTestId('disabled-banner').innerText().catch(()=>null), 'enable', await H(p, '[data-testid="enable-item"]'), 'footer action', await H(p, '[data-testid="item-state-action"]'));
  await shot(p, 'pane-disabled', w); await ctx.close();
  ({ ctx, p } = await open(w, `${U}?v=v1&item=faq-003`));
  console.log(w, 'pane published active: action', await p.getByTestId('item-state-action').textContent().catch(()=>null), await H(p, '[data-testid="item-state-action"]'));
  await ctx.close();
  ({ ctx, p } = await open(w, `${U}?v=v2&item=faq-003`, 'mem2'));
  console.log(w, 'pane as mem (project mode, modify)', await p.getByTestId('item-state-action').count(), await p.getByTestId('enable-item').count());
  await ctx.close();
}
// published version with disabled item: make a published version with disabled
// item page
{
  let { ctx, p } = await open(1440, `${U}/items/faq-003?v=v2`);
  console.log('item page url ok?', p.url());
  await ctx.close();
}
await b.close();
