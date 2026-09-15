/* Exercise the shipped admin page against reordered and failed API responses. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = process.argv[2];
const staticDir = path.join(root, 'packages/platform/qym_platform/_static/dashboard');

async function harness(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const schedule = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 10000 ? 100 : ms, ...args);
  });
  const run = {
    run_id: 'normal-sdk-run', run_name: 'Coder evaluation', status: 'RUNNING',
    can_force_stop: true, task_name: 'Answer quality', progress_completed: 17,
    progress_total: 50, total_items: 17, last_event_at: new Date().toISOString(),
    owner: { display_name: 'SDK user' }, project: { name: 'Support', slug: 'support' },
  };
  const state = { stopped: false, failStop: false, stops: 0, liveReads: 0, holdLive: false, holdStop: false };
  await page.route('http://qym.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/qym/, '');
    const json = data => route.fulfill({ json: data });
    if (pathname === '/admin') {
      const html = fs.readFileSync(path.join(staticDir, 'admin.html'), 'utf8')
        .replace('<head>', '<head><script>window.__QYM_ROOT_PATH__="/qym";</script>')
        .replaceAll('"/static/', '"/qym/static/');
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    if (pathname.startsWith('/static/')) {
      const file = path.join(staticDir, pathname.slice('/static/'.length));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ path: file });
    }
    if (pathname === '/v1/me') return json({ id: 'admin', role: 'ADMIN', email: 'admin@example.test', display_name: 'Admin' });
    if (pathname === '/v1/admin/users') return json([]);
    if (pathname === '/v1/projects') return json({ projects: [{ id: 'p', name: 'Support', slug: 'support', is_active: true, run_count: 1 }] });
    if (pathname === '/api/runs/live') {
      state.liveReads++;
      const runs = state.stopped ? [] : [{ ...run }];
      if (state.holdLive) {
        state.holdLive = false;
        await new Promise(resolve => { state.releaseLive = resolve; });
      }
      return json({ runs, total_count: runs.length });
    }
    if (pathname === '/api/runs/recent') {
      const runs = state.stopped ? [{ ...run, status: 'STOPPED', status_reason: 'admin_force_stopped', can_force_stop: false }] : [];
      return json({ runs, total_count: runs.length });
    }
    if (pathname === '/api/runs/normal-sdk-run/force-stop') {
      assert.equal(route.request().method(), 'POST');
      state.stops++;
      if (state.holdStop) await new Promise(resolve => { state.releaseStop = resolve; });
      if (state.failStop) return route.fulfill({ status: 409, json: { detail: 'Run has already finished' } });
      state.stopped = true;
      return json({ ok: true, run_id: run.run_id, status: 'STOPPED', status_reason: 'admin_force_stopped', can_force_stop: false });
    }
    return json({});
  });
  await page.goto('http://qym.test/qym/admin');
  await page.locator('[data-force-stop]').waitFor();
  return { page, state, errors };
}

async function success(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('[data-force-stop]').click();
  await page.locator('#shell-confirm-cancel').click();
  assert.equal(state.stops, 0);
  // Keep a pre-stop RUNNING response in flight while the action succeeds.
  state.holdLive = true;
  while (!state.releaseLive) await page.waitForTimeout(20);
  state.holdStop = true;
  await page.locator('[data-force-stop]').click();
  await page.locator('#shell-confirm-submit').click();
  await page.waitForFunction(() => document.querySelector('[data-force-stop]')?.disabled);
  while (!state.releaseStop) await page.waitForTimeout(20);
  assert.equal(state.stops, 1);
  state.releaseStop();
  await page.waitForFunction(() => document.querySelector('#recent-runs-tbody').textContent.includes('STOPPED'));
  state.releaseLive();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-force-stop]').count(), 0);
  assert.match(await page.locator('#live-runs-tbody').innerText(), /No live runs/);
  assert.match(await page.locator('#run-message').innerText(), /Further updates are blocked/);
  if (process.env.QYM_FORCE_STOP_SCREENSHOT) await page.screenshot({ path: process.env.QYM_FORCE_STOP_SCREENSHOT, fullPage: true });
  // Navigation must release the admin polling timer.
  await page.evaluate(() => document.dispatchEvent(new Event('qym:before-navigate')));
  await page.waitForTimeout(150);
  const count = state.liveReads;
  await page.waitForTimeout(250);
  assert.equal(state.liveReads, count);
  assert.deepEqual(errors, []);
  await page.close();
}

async function failure(browser) {
  const { page, state, errors } = await harness(browser);
  state.failStop = true;
  await page.locator('[data-force-stop]').click();
  await page.locator('#shell-confirm-submit').click();
  await page.waitForFunction(() => document.querySelector('#run-message').textContent.includes('already finished'));
  assert.equal(state.stopped, false);
  assert.equal(await page.locator('[data-force-stop]').isEnabled(), true);
  assert.equal(state.stops, 1);
  assert.deepEqual(errors, []);
  await page.close();
}

async function runPolling(browser, terminalCode) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const schedule = window.setTimeout;
    // The checks below must span several polling intervals. Keep the actual
    // scheduling code, but accelerate its two-second interval for this test.
    window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 2000 ? 100 : ms, ...args);
  });
  const uiDir = path.join(root, 'packages/platform/qym_platform/_static/ui');
  let reads = 0;
  let release;
  const payload = status => ({
    run: { run_id: 'r', status, run_name: 'Coder evaluation', metric_names: [] },
    snapshot: { rows: [], stats: { total: 1, pending: 0, in_progress: 1 } },
  });
  await page.route('http://qym.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/qym/run/r') return route.fulfill({ path: path.join(uiDir, 'index.html') });
    if (pathname.startsWith('/qym/ui/')) return route.fulfill({ path: path.join(uiDir, pathname.slice('/qym/ui/'.length)) });
    if (pathname === '/qym/api/runs/r') {
      reads++;
      if (reads === 1) return route.fulfill({ json: payload('RUNNING') });
      await new Promise(resolve => { release = resolve; });
      return route.fulfill({ status: terminalCode, json: terminalCode === 200 ? payload('STOPPED') : { detail: 'Closed' } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://qym.test/qym/run/r');
  while (!release) await page.waitForTimeout(20);
  await page.waitForTimeout(750);
  assert.equal(reads, 2, 'A slow poll must not overlap the next poll');
  release();
  await page.waitForTimeout(850);
  assert.equal(reads, 2, 'Terminal state must end polling even with unfinished items');
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await success(browser);
    await failure(browser);
    for (const terminalCode of [200, 401, 410]) await runPolling(browser, terminalCode);
  }
  finally { await browser.close(); }
  console.log('Admin force-stop browser contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
