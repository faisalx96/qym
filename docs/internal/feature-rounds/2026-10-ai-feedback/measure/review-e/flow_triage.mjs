import { open, ready, rect, BASE } from './lib.mjs';
const { browser, page } = await open(1440);
const patches = [];
page.on('request', r => { if (r.method() === 'PATCH') patches.push(r.url().split('/v1')[1] + ' ' + r.postData()); });
await page.goto(BASE + '/feedback/FB-0009'); await page.waitForSelector('[data-testid=triage]'); await page.waitForTimeout(700);
const T = page.locator('[data-testid=triage]');
const pick = async (name, option) => { await T.locator('button').nth(1).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
await pick(0, 'Critical');
console.log('pending:', await page.locator('[data-testid=pending-changes]').innerText().catch(() => 'none'));
await T.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(300);
console.log('no-note save -> patches', patches.length, '| msg:', await T.innerText().then(t => t.match(/Add a note[^\n]*/)?.[0]), '| focus', await page.evaluate(() => document.activeElement?.tagName + ':' + document.activeElement?.getAttribute('aria-label')));
console.log('save enabled?', !(await T.getByRole('button', { name: 'Save changes' }).isDisabled()));
await T.getByLabel('Note for the history').fill('Blocks the Q4 report');
await T.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(900);
console.log('patch:', patches.at(-1)); console.log('toast:', await page.locator('[role=status]').allInnerTexts().then(a => a.filter(x => /Saved/.test(x))));
console.log('history:', (await page.locator('[data-testid=history]').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
console.log('strip:', (await page.getByLabel('Priority and complexity').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
// reset
await pick(0, 'Low'); await T.getByLabel('Note for the history').fill('x'); await T.getByRole('button', { name: 'Reset' }).click();
console.log('after reset note=', JSON.stringify(await T.getByLabel('Note for the history').inputValue()), 'priority btn=', await T.locator('button').nth(1).innerText());
// Escape does not reset
await pick(0, 'Low'); await T.getByLabel('Note for the history').focus(); await page.keyboard.press('Escape'); console.log('after Escape priority still Low?', (await T.locator('button').nth(1).innerText()));
await T.getByRole('button', { name: 'Reset' }).click();
// duplicate
await T.getByRole('button', { name: 'Not a duplicate' }).click(); const opts = await page.getByRole('option').allInnerTexts(); console.log('duplicate options:', opts.map(s => s.replace(/\n+/g, ' ').slice(0, 40)));
await page.getByRole('option', { name: /FB-0001/ }).click(); console.log('pending:', await page.locator('[data-testid=pending-changes]').innerText().catch(() => 'none'));
await T.getByLabel('Note for the history').fill('Same ask'); await T.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(900);
console.log('dup patch:', patches.at(-1)); console.log('callout:', await page.locator('[data-testid=feedback-request-page] [role=status]').allInnerTexts());
await page.goto(BASE + '/feedback/FB-0001'); await page.waitForTimeout(900); console.log('canonical related:', (await page.locator('[data-testid=related-card]').innerText()).replace(/\n+/g, ' | ').slice(0, 250));
// 409 has_duplicates via UI: mark FB-0001 as duplicate of FB-0002
await page.locator('[data-testid=triage]').getByRole('button', { name: 'Not a duplicate' }).click(); await page.getByRole('option', { name: /FB-0002/ }).click(); await page.locator('[data-testid=triage]').getByLabel('Note for the history').fill('x'); await page.locator('[data-testid=triage]').getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(700);
console.log('has_duplicates UI:', (await page.locator('[data-testid=triage]').innerText()).match(/Move its duplicates first\.[^\n]*/)?.[0]);
// decline
await page.goto(BASE + '/feedback/FB-0004'); await page.waitForSelector('[data-testid=triage]'); await page.waitForTimeout(500);
const T2 = page.locator('[data-testid=triage]'); await T2.getByRole('button', { name: /^Planned/ }).click(); await page.getByRole('option', { name: 'Declined' }).click();
await T2.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(400); console.log('decline no reason msg:', (await T2.innerText()).match(/Say why[^\n]*/)?.[0]);
await T2.getByLabel(/Note|Reason/).first().fill('Out of scope this quarter'); await T2.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(900);
console.log('decline patch:', patches.at(-1)); console.log('declined callout:', await page.locator('[data-testid=feedback-request-page] [role=alert], [data-testid=feedback-request-page] [role=status]').allInnerTexts());
// stale: two tabs
await page.goto(BASE + '/feedback/FB-0007'); await page.waitForSelector('[data-testid=triage]'); await page.waitForTimeout(500);
const r = await fetch('http://127.0.0.1:9010/v1/feedback/FB-0007').then(x => x.json()); await fetch('http://127.0.0.1:9010/v1/feedback/FB-0007/triage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'planned', expected_updated_at: r.request.updated_at }) });
const T3 = page.locator('[data-testid=triage]'); await T3.getByRole('button', { name: /^Done/ }).click(); await page.getByRole('option', { name: 'Accepted' }).click(); await T3.getByRole('button', { name: 'Save changes' }).click(); await page.waitForTimeout(800);
console.log('stale msg:', (await T3.innerText()).match(/Someone else[^\n]*/)?.[0]);
// tab order
await page.goto(BASE + '/feedback/FB-0010'); await page.waitForSelector('[data-testid=triage]'); await page.waitForTimeout(500);
await T.locator('button').first().focus(); const order = []; for (let i = 0; i < 8; i++) { order.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 24))); await page.keyboard.press('Tab'); } console.log('tab order from Status:', order);
await browser.close();
