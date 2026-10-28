import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const req = createRequire('/home/meshari-aldossari/Documents/qym/qym-wt-redesign8-sections/frontend/package.json');
export const { chromium } = req('playwright-core') as any;
export const S = process.env.S!;
export const ids = JSON.parse(readFileSync(S + '/sec-ids.json', 'utf8'));
export const legIds = JSON.parse(readFileSync('/home/meshari-aldossari/Documents/qym/qym-wt-redesign8-sections/docs/internal/ui-migration/redesign8/measure/seed-ids.json','utf8')).legacy;
export const REACT = 'http://127.0.0.1:8984';
export const LEG = 'http://127.0.0.1:8980';
export const cmpUrl = (n = ['base','a','b','c']) => `${REACT}/compare?${n.map(k => 'runs=' + (ids.cmp.runs[k] ?? ids.extra[k])).join('&')}`;
export const runUrl = (k = 'repeat') => `${REACT}/run/${ids.rd.runs[k]}`;
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function launch() { return chromium.launch({ args: ['--disable-dev-shm-usage'] }); }
export async function newPage(b: any, w: number, h = 900) {
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', deviceScaleFactor: 1 });
  await c.addInitScript('window.__name=(f)=>f'); return c.newPage();
}
/** scroll the shell once so lazy sections mount */
export async function warm(p: any) {
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < 30000; y += 450) {
      const more = await p.evaluate((yy: number) => { const m = document.getElementById('shell-content')!; m.scrollTop = yy; return yy < m.scrollHeight; }, y);
      await sleep(350); if (!more) break;
    }
  }
  await p.evaluate(() => { document.getElementById('shell-content')!.scrollTop = 0; }); await sleep(600);
}
export async function full(p: any, file: string, pad = 60) {
  const h: number = await p.evaluate(() => document.getElementById('shell-content')!.scrollHeight);
  const w = p.viewportSize().width;
  await p.setViewportSize({ width: w, height: Math.min(h + 60 + pad, 16000) });
  await sleep(1200);
  await p.screenshot({ path: file });
  return h;
}
