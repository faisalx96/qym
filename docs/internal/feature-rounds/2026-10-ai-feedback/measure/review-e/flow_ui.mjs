import { open, ready, rect, overflow, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
const calls = [];
page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname.replace(/[0-9a-f-]{36}/, ':id')); });
await page.goto(BASE + '/feedback'); await page.waitForTimeout(600);
await page.getByRole('link', { name: /New feedback/ }).or(page.getByRole('button', { name: /New feedback/ })).first().click();
await page.waitForSelector('[data-testid=new-form]');
console.log('sessionStorage kept QE-32:'); await page.getByLabel('What do you need?').fill('We need to share comparison results outside the platform.');
await page.reload(); await page.waitForSelector('[data-testid=new-form]');
console.log('  after reload value =', JSON.stringify(await page.getByLabel('What do you need?').inputValue()));
const start = page.getByRole('button', { name: 'Start conversation' });
await start.dblclick();
await page.waitForURL(/\/feedback\/[0-9a-f-]{36}/, { timeout: 15000 });
const uuid = page.url().split('/').pop();
console.log('moved to', uuid.slice(0, 8), 'creates:', calls.filter(c => c === 'POST /v1/feedback').length);
const samples = [];
for (let i = 0; i < 80; i++) {
  samples.push(await page.evaluate(() => { const l = document.querySelector('[data-testid=chat-log]'); const ta = document.querySelector('[data-testid=chat] textarea'); const items = l ? [...l.querySelectorAll('ol > li')] : []; const last = items[items.length - 1]; return { t: Date.now(), busy: l?.getAttribute('aria-busy'), n: items.length, lastLen: last ? last.innerText.length : 0, ta: ta?.disabled, status: document.querySelector('[data-testid=chat-status]')?.textContent, btn: [...document.querySelectorAll('[data-testid=chat] button')].map(b => b.textContent.trim()).filter(Boolean).join(','), meta: last?.innerText.includes('writing') }; }));
  await page.waitForTimeout(60);
}
const u = []; let prev = null; for (const s of samples) { const k = JSON.stringify([s.busy, s.n, s.ta, s.status, s.btn, s.meta]); if (k !== prev) { u.push({ ...s, t: s.t - samples[0].t }); prev = k; } }
console.log('timeline (state changes):'); u.forEach(x => console.log('  ', JSON.stringify(x)));
const lens = samples.map(s => s.lastLen); console.log('assistant text grows through lens:', [...new Set(lens)].slice(0, 12).join(','));
console.log('checklist title', await page.evaluate(() => document.querySelector('[data-testid=checklist]').innerText.split('\n').slice(0, 2).join(' ')));
console.log('proposal card present after incomplete answer:', await page.locator('[data-testid=proposal]').count());
console.log('focus after send in composer? active=', await page.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('aria-label') || '')));
// second message via keyboard: Enter sends, Shift+Enter newline
const ta = page.getByLabel('Your reply');
await ta.click(); await ta.type('Five analysts, weekly.'); await page.keyboard.press('Shift+Enter'); await ta.type('We paste screenshots into slides.');
console.log('after Shift+Enter value has newline:', (await ta.inputValue()).includes('\n'), 'messages count before', await page.locator('[data-testid=chat-log] ol > li').count());
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
console.log('optimistic user message visible immediately:', await page.locator('[data-testid=chat-log] ol > li').count(), 'composer value', JSON.stringify(await ta.inputValue()), 'focus', await page.evaluate(() => document.activeElement?.tagName));
console.log('composer disabled & hint:', await ta.isDisabled(), await page.locator('#composer-hint').innerText());
await page.waitForSelector('[data-testid=proposal]', { timeout: 20000 });
await page.waitForTimeout(1500);
console.log('proposal focus on heading:', await page.evaluate(() => { const p = document.querySelector('[data-testid=proposal]'); const hid = p.getAttribute('aria-labelledby'); return [document.activeElement?.id === hid, document.activeElement?.textContent, p.getBoundingClientRect().top]; }));
console.log('announce:', await page.locator('[data-testid=chat-status]').innerText(), '| log has announce line:', (await page.locator('[data-testid=chat-log]').innerText()).includes('proposed a request'));
console.log('chat card height with proposal:', JSON.stringify(await rect(page, '[data-testid=chat]')), 'proposal', JSON.stringify(await rect(page, '[data-testid=proposal]')));
console.log('related block (none):', await page.locator('[data-testid=proposal] [data-testid=related]').count(), 'callout:', await page.locator('[data-testid=proposal] [role=status]').count());
await page.screenshot({ path: process.cwd() + '/dl/flow-proposal.png', fullPage: true });
// edit priority & complexity
const prio = page.locator('[data-testid=proposal]').getByRole('button', { name: /^Medium/ }); await prio.click(); await page.getByRole('option', { name: 'High' }).click();
const cx = page.locator('[data-testid=proposal]').getByRole('button', { name: /^M · / }); await cx.click(); await page.getByRole('option', { name: /^L · / }).click();
console.log('changed lines:', await page.evaluate(() => [...document.querySelectorAll('[data-testid=proposal] *')].filter(e => e.children.length === 0 && /changed it from|Assistant proposed/i.test(e.textContent)).map(e => e.textContent)));
// clear description -> disabled
const desc = page.locator('[data-testid=proposal] textarea'); const orig = await desc.inputValue(); await desc.fill('');
console.log('submit disabled with empty description:', await page.getByRole('button', { name: /^Submit/ }).isDisabled(), '| msg:', await page.evaluate(() => document.querySelector('[data-testid=proposal]').innerText.match(/The description cannot be empty\./)?.[0]));
await desc.fill(orig);
// keep talking
await page.getByRole('button', { name: 'Keep talking' }).click(); console.log('keep talking -> focus:', await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.getAttribute('aria-label')), 'proposal still:', await page.locator('[data-testid=proposal]').count());
await page.getByRole('button', { name: /^Submit/ }).click();
await page.waitForURL(/\/feedback\/FB-\d+/, { timeout: 15000 });
console.log('submitted ->', page.url(), 'toast:', await page.locator('[role=status], [role=alert], [data-toast]').allInnerTexts().then(t => t.filter(x => /Submitted as/.test(x))));
await page.waitForTimeout(1200); await ready(page);
console.log('calls:', JSON.stringify(calls));
await page.screenshot({ path: process.cwd() + '/dl/flow-request.png', fullPage: true });
console.log('request title:', await page.title());
await browser.close();
