import { open, BASE } from './lib.mjs';
let { browser, page } = await open(1440);
await page.goto(BASE + '/feedback/new'); await page.waitForSelector('[data-testid=new-form]');
await page.locator('input[type=radio]').first().focus(); await page.keyboard.press('ArrowDown'); console.log('B arrow selects product:', await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map(r => r.checked)));
await page.keyboard.press('Tab'); console.log('B Tab from radio goes to:', await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 20) || document.activeElement?.type)));
await page.goto(BASE + '/feedback/new?subject=product&project=support-agent&kind=run'); await page.waitForTimeout(1500);
console.log('B prefill:', await page.evaluate(() => [[...document.querySelectorAll('input[type=radio]')].map(r => r.checked), document.querySelector('[data-testid=product-fields]')?.innerText.replace(/\n+/g, ' | ').slice(0, 260)]));
// product: open the target select and list options
await page.getByRole('button', { name: /Select|Run/ }).last().click().catch(() => {}); await page.waitForTimeout(500); console.log('B options:', await page.getByRole('option').allInnerTexts().then(a => a.slice(0, 5)));
await page.keyboard.press('Escape');
// focus ring ancestors
await page.goto(BASE + '/feedback/new'); await page.getByLabel('What do you need?').focus();
console.log('ring chain:', await page.evaluate(() => { const out = []; let e = document.activeElement; for (let i = 0; i < 4 && e; i++, e = e.parentElement) { const c = getComputedStyle(e); out.push([e.tagName, c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow.slice(0, 50), c.borderColor]); } return out; }));
await browser.close();
