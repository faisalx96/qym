import { open, ready, rect, overflow } from './lib.mjs';
const B = 'http://127.0.0.1:6017'; const H = { 'X-User-Email': 'sara@example.test' };
for (const w of [1440, 390]) {
  const { browser, page } = await open(w, { headers: H });
  const calls = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/feedback')) calls.push(r.method() + ' ' + u.pathname); });
  await page.goto(B + '/feedback'); await page.waitForSelector('[data-testid=feedback-list-page]'); await page.waitForTimeout(800);
  const o = { w };
  o.exportInDom = await page.locator('[data-testid=export-menu]').count(); o.exportBtn = await page.getByRole('button', { name: /export/i }).count();
  o.strip = await page.locator('[data-testid=drafts-strip]').count();
  o.rows = await page.locator('[aria-label="Feedback requests"] [role=row]').count();
  o.pageOverflow = await overflow(page);
  o.nav = await page.evaluate(() => [...document.querySelectorAll('[data-nav]')].map(e => e.dataset.nav));
  calls.length = 0;
  await page.goto(B + '/feedback/FB-0010'); await page.waitForSelector('[data-testid=feedback-request-page]'); await page.waitForTimeout(900);
  o.reqCalls = calls.slice(); o.triage = await page.locator('[data-testid=triage]').count();
  o.convTab = await (async () => { calls.length = 0; await page.getByRole('tab', { name: /Conversation/ }).click(); await page.waitForTimeout(600); return [page.url().includes('tab=conversation'), await rect(page, '[data-testid=transcript]'), calls.slice(), (await page.locator('[data-testid=transcript]').innerText()).slice(-160).replace(/\n+/g, ' | '), await page.evaluate(() => document.querySelector('[data-testid=transcript]').innerText.split('\n')[0])]; })();
  o.overflowReq = await overflow(page);
  await page.goto(B + '/feedback/new'); await page.waitForSelector('[data-testid=new-form]'); o.projectOptions = 'n/a';
  await page.getByText('A product I evaluate with qym').first().click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Select/ }).first().click(); o.projectsListed = await page.getByRole('option').allInnerTexts();
  o.adminTab = await page.goto(B + '/admin/feedback').then(r => r.status()); await page.waitForTimeout(800); o.adminBody = (await page.locator('main').innerText()).slice(0, 160).replace(/\n+/g, ' | ');
  console.log(JSON.stringify(o));
  await browser.close();
}
