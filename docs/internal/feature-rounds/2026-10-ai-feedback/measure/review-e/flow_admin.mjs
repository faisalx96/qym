import { open, ready, rect, overflow, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
const reqs = [];
page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('feedback')) reqs.push(r.method() + ' ' + r.url().split('/v1')[1] + ' ' + (r.postData() ?? '').replace(/"llm_api_key":"[^"]*"/, '"llm_api_key":<redacted-len>')); });
const bodies = [];
page.on('response', async r => { if (r.url().includes('feedback-agent')) { const t = await r.text().catch(() => ''); bodies.push(t); } });
await page.goto(BASE + '/admin/feedback'); await page.waitForSelector('[data-testid=connection]'); await page.waitForTimeout(700);
const C = page.locator('[data-testid=connection]');
await C.getByRole('button', { name: 'Test connection' }).click(); await page.waitForTimeout(900);
console.log('test ok:', (await C.locator('[role=status], [role=alert], [class*=callout]').allInnerTexts()).map(s => s.replace(/\n+/g, ' / ')), JSON.stringify(await rect(page, '[data-testid=connection]')));
// failing: change model to no_tools and test
await C.getByLabel(/Model/).fill('feedback:no_tools'); await C.getByRole('button', { name: 'Test connection' }).click(); await page.waitForTimeout(900);
console.log('test no_tools:', (await C.locator('[class*=callout]').allInnerTexts()).map(s => s.replace(/\n+/g, ' / ')));
await C.getByLabel(/Model/).fill('feedback:bad_key'); await C.getByRole('button', { name: 'Test connection' }).click(); await page.waitForTimeout(900);
console.log('test bad_key:', (await C.locator('[class*=callout]').allInnerTexts()).map(s => s.replace(/\n+/g, ' / ')));
await C.getByLabel(/Base URL/).fill('http://127.0.0.1:1/v1'); await C.getByRole('button', { name: 'Test connection' }).click(); await page.waitForTimeout(900);
console.log('test unreachable:', (await C.locator('[class*=callout]').allInnerTexts()).map(s => s.replace(/\n+/g, ' / ')));
console.log('stored still:', await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent').then(r => r.json()).then(d => d.connection));
// save back with unchanged key
await page.reload(); await page.waitForSelector('[data-testid=connection]'); await page.waitForTimeout(500);
await C.getByLabel(/Model/).fill('feedback:ask_then_propose'); await C.getByRole('button', { name: 'Save connection' }).click(); await page.waitForTimeout(900);
console.log('save toast:', await page.locator('[role=status]').allInnerTexts().then(a => a.filter(x => /Saved|Connection/i.test(x))));
// behaviour
const B = page.getByText('Keep drafts for (days)').locator('xpath=ancestor::section[1]|ancestor::div[contains(@class,"card")][1]').first();
await page.getByRole('textbox', { name: 'Keep drafts for (days)' }).fill('0'); await page.getByRole('button', { name: 'Save behaviour' }).click(); await page.waitForTimeout(600);
console.log('retention 0:', (await page.locator('main').innerText()).match(/1 to 365[^\n]*/)?.[0]);
await page.getByRole('textbox', { name: 'Keep drafts for (days)' }).fill('45'); await page.getByRole('button', { name: 'Save behaviour' }).click(); await page.waitForTimeout(600);
console.log('retention 45 saved ->', await fetch('http://127.0.0.1:9010/v1/admin/feedback-agent').then(r => r.json()).then(d => d.behaviour));
await page.getByRole('textbox', { name: 'Keep drafts for (days)' }).fill('30'); await page.getByRole('button', { name: 'Save behaviour' }).click(); await page.waitForTimeout(600);
console.log('mutating requests:', reqs);
console.log('key anywhere in responses:', bodies.some(b => b.includes(process.env.REVIEW_KEY)));
// remove -> confirm dialog
await C.getByRole('button', { name: 'Remove connection' }).click(); await page.waitForTimeout(400);
const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')); console.log('dialog:', (await dlg.innerText()).replace(/\n+/g, ' / '), '| focus:', await page.evaluate(() => document.activeElement?.textContent));
await page.keyboard.press('Escape'); await page.waitForTimeout(300); console.log('closed on Escape, focus returns to:', await page.evaluate(() => document.activeElement?.textContent), 'dialog open', await dlg.count());
await browser.close();
