// ../../../../../../tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/shot.mts
import { chromium } from "@playwright/test";
var [url, out, width = "1440", sel = ""] = process.argv.slice(2);
var w = Number(width);
var browser = await chromium.launch();
var page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: "dark" });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
if (sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: out });
} else await page.screenshot({ path: out, fullPage: false });
await browser.close();
