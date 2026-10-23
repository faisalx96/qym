import { open, ready, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
const axeSrc = fs.readFileSync('/home/meshari-aldossari/Documents/qym/qym-wt-ai-feedback/frontend/node_modules/axe-core/axe.min.js', 'utf8');
const surfaces = [['list', '/feedback'], ['new', '/feedback/new'], ['draft-asking', '/feedback/' + ids.asking], ['draft-proposal', '/feedback/' + ids.dup], ['request', '/feedback/FB-0010'], ['conversation', '/feedback/FB-0010?tab=conversation'], ['request-admin-triage', '/feedback/FB-0001'], ['admin', '/admin/feedback']];
for (const w of [1440, 390]) for (const [name, url] of surfaces) {
  const { browser, page } = await open(w);
  await page.goto(BASE + url); await page.waitForTimeout(1500); await ready(page);
  await page.evaluate(axeSrc);
  const r = await page.evaluate(async () => { const res = await window.axe.run(document, { resultTypes: ['violations'] }); return res.violations.map(v => [v.id, v.impact, v.nodes.length, v.nodes[0].target.join(' ').slice(0, 80)]); });
  console.log(w, name, r.length === 0 ? '0 violations' : JSON.stringify(r));
  await browser.close();
}
