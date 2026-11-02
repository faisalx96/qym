import { open, ready, rect, BASE } from './lib.mjs';
import fs from 'node:fs';
const ids = JSON.parse(fs.readFileSync('ids.json', 'utf8'));
// A) chat card height vs viewport height
for (const h of [600, 700, 900, 1100, 1300]) {
  const { browser, page } = await open(1440, { height: h });
  await page.goto(BASE + '/feedback/' + ids.asking); await page.waitForSelector('[data-testid=chat]'); await page.waitForTimeout(500);
  console.log('A viewport', h, 'chat h', (await rect(page, '[data-testid=chat]')).h);
  await browser.close();
}
// long conversation: autoscroll, load earlier, 4000 chars, sessionStorage, Arabic
let { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/' + ids.long); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(900);
const sc = () => page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); return [l.scrollTop, l.scrollHeight, l.clientHeight, Math.round(l.scrollHeight - l.scrollTop - l.clientHeight)]; });
console.log('F loaded: [scrollTop, scrollHeight, clientHeight, distToEnd]', await sc(), '| items', await page.locator('[data-testid=chat-log] ol > li').count(), '| earlier btn', await page.locator('[data-testid=load-earlier]').count());
await page.locator('[data-testid=load-earlier]').click(); await page.waitForTimeout(800); console.log('G after load earlier: items', await page.locator('[data-testid=chat-log] ol > li').count(), 'btn', await page.locator('[data-testid=load-earlier]').count());
// scroll to the top, then send message, check it does not jump
await page.evaluate(() => { document.querySelector('[data-testid=chat-log]').scrollTop = 0; }); await page.waitForTimeout(200);
const ta = page.getByLabel('Your reply');
// 4000-char
await ta.fill('x'.repeat(3650)); console.log('C counter @3650:', await page.locator('#composer-hint').innerText(), '| font', await page.evaluate(() => getComputedStyle(document.querySelector('#composer-hint [class*=counter]')).fontFamily.slice(0, 20)));
await ta.fill('x'.repeat(4001)); console.log('C @4001:', (await page.locator('[data-testid=chat]').innerText()).match(/4,000 characters at most/)?.[0], '| send disabled', await page.getByRole('button', { name: 'Send' }).isDisabled());
// sessionStorage per draft
await ta.fill('typed but not sent'); await page.reload(); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(600); console.log('C kept after reload:', JSON.stringify(await page.getByLabel('Your reply').inputValue()));
await page.getByLabel('Your reply').fill('');
// Arabic message dir
const ar = 'أريد مشاركة النتائج مع الفريق'; await page.getByLabel('Your reply').fill(ar); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
console.log('E arabic dir:', await page.evaluate((t) => { const els = [...document.querySelectorAll('[data-testid=chat-log] *')].filter(e => e.children.length === 0 && e.textContent.includes(t)); return els.map(e => [e.tagName, e.getAttribute('dir'), e.getAttribute('lang'), getComputedStyle(e).direction, getComputedStyle(e).lineHeight, e.closest('li') && getComputedStyle(e.closest('li')).direction]); }, ar));
console.log('E arabic reply dir:', await page.evaluate(() => { const li = [...document.querySelectorAll('[data-testid=chat-log] ol > li')].at(-1); const t = li.querySelector('[dir]'); return [t?.getAttribute('dir'), t?.getAttribute('lang'), t?.textContent.slice(0, 20)]; }));
await browser.close();
// D) reduced motion + focus ring
({ browser, page } = await open(1440, { reducedMotion: 'reduce' }));
await page.goto(BASE + '/feedback/' + ids.asking); await page.waitForSelector('[data-testid=chat-log]'); await page.waitForTimeout(500);
console.log('D reduced motion: log scroll-behavior', await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=chat-log]')).scrollBehavior), '| anims', await page.evaluate(() => document.getAnimations().length));
await page.getByLabel('Your reply').focus(); console.log('focus ring composer:', await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); const p = getComputedStyle(e.closest('[class*=field], [class*=control]') ?? e); return [c.outlineStyle, c.outlineWidth, c.outlineColor, p.outlineStyle, p.outlineWidth, p.boxShadow.slice(0, 60)]; }));
await page.keyboard.press('Shift+Tab'); console.log('focus log ring:', await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return [e.getAttribute('data-testid'), c.outlineStyle, c.outlineWidth, c.outlineColor]; }));
await browser.close();
// B) new page radios and prefill
({ browser, page } = await open(1440));
await page.goto(BASE + '/feedback/new'); await page.waitForSelector('[data-testid=new-form]');
await page.locator('[role=radio]').first().focus(); await page.keyboard.press('ArrowDown'); console.log('B arrow selects product:', await page.evaluate(() => [...document.querySelectorAll('[role=radio]')].map(r => r.getAttribute('aria-checked') ?? r.checked)));
await page.keyboard.press('Tab'); console.log('B one tab stop (next focus is not a radio):', await page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 20))));
await page.goto(BASE + '/feedback/new?subject=product&project=support-agent&kind=run'); await page.waitForTimeout(1200);
console.log('B prefill:', await page.evaluate(() => [[...document.querySelectorAll('[role=radio]')].map(r => r.getAttribute('aria-checked') ?? r.checked), document.querySelector('[data-testid=product-fields]')?.innerText.replace(/\n+/g, ' | ').slice(0, 200)]));
await browser.close();
