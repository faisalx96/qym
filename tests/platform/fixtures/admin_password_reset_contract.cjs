/* Exercise the shipped user editor while reset and save requests are pending or fail. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = process.argv[2];
const staticDir = path.join(root, 'packages/platform/qym_platform/_static/dashboard');

const USERS = [
  { id: 'admin', email: 'admin@example.test', display_name: 'Admin', role: 'ADMIN', is_active: true },
  { id: 'u1', email: 'dev@example.test', display_name: 'Dev Person', role: 'MEMBER', is_active: true },
  { id: 'u2', email: 'ops@example.test', display_name: 'Ops Person', role: 'MEMBER', is_active: true },
];
const LOCKED = ['edit-user-save', 'edit-user-reset-password', 'edit-user-cancel', 'edit-user-close',
  'edit-user-email', 'edit-user-name', 'edit-user-role', 'edit-user-active'];

async function harness(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { resets: 0, saves: 0, holdReset: false, holdSave: false, failReset: false, failSave: false };
  await page.route('http://qym.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/qym/, '');
    const method = route.request().method();
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
    if (pathname === '/v1/auth/providers') return json({ auth_mode: 'oidc', providers: [], local_auth: { enabled: true, signup_enabled: true } });
    if (pathname === '/v1/admin/users' && method === 'GET') return json(USERS);
    if (pathname === '/v1/projects') return json({ projects: [] });
    if (pathname === '/api/runs/live' || pathname === '/api/runs/recent') return json({ runs: [], total_count: 0 });
    if (pathname === '/v1/admin/users/u1/reset-password') {
      assert.equal(method, 'POST');
      state.resets++;
      if (state.holdReset) await new Promise(resolve => { state.releaseReset = resolve; });
      if (state.failReset) return route.fulfill({ status: 400, json: { detail: 'Email/password auth is not enabled' } });
      return json({ ok: true, user_id: 'u1', temporary_password: 'Temp-Pass-0001' });
    }
    if (/^\/v1\/admin\/users\/(u1|admin)$/.test(pathname) && method === 'PUT') {
      state.saves++;
      if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
      if (state.failSave) return route.fulfill({ status: 409, json: { detail: 'Email already in use' } });
      return json({ id: 'u1', email: 'dev@example.test', ok: true });
    }
    return json({});
  });
  await page.goto('http://qym.test/qym/admin');
  await page.locator('#admin-tab-users').click();
  await page.locator('[data-user-edit="u1"]').click();
  await page.locator('#edit-user-modal').waitFor({ state: 'visible' });
  return { page, state, errors };
}

const modalOpen = page => page.evaluate(() => document.getElementById('edit-user-modal').style.display === 'flex');
const editingEmail = page => page.locator('#edit-user-email').inputValue();

async function assertLocked(page, locked) {
  for (const id of LOCKED) assert.equal(await page.locator(`#${id}`).isDisabled(), locked, `${id} should be ${locked ? "disabled" : "enabled"}`);
}

// Every way out of the editor, including opening another user behind the overlay.
// The buttons are re-enabled first so the clicks reach the script's own busy checks.
async function tryToLeave(page) {
  await page.locator('#edit-user-modal').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    for (const id of ['edit-user-cancel', 'edit-user-close', 'edit-user-save', 'edit-user-reset-password']) {
      const button = document.getElementById(id);
      button.disabled = false;
      button.click();
    }
    document.querySelector('[data-user-edit="u2"]').click();
  });
  const confirmOpen = await page.locator('#shell-confirm-dialog').count();
  assert.equal(confirmOpen, 0, 'A reset confirmation must not open while a request is pending');
}

async function resetWhilePending(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('#edit-user-reset-password').click();
  // A reset ends every session of the user, whatever they signed in with.
  assert.match(await page.locator('#shell-confirm-dialog').innerText(), /They are signed out of every browser\./);
  await page.locator('#shell-confirm-cancel').click();
  assert.equal(state.resets, 0, 'Cancelling the confirmation must not reset');
  assert.equal(await modalOpen(page), true);

  state.holdReset = true;
  await page.locator('#edit-user-reset-password').click();
  await page.locator('#shell-confirm-submit').click();
  while (!state.releaseReset) await page.waitForTimeout(20);
  await assertLocked(page, true);
  await tryToLeave(page);
  await page.waitForTimeout(100);
  assert.equal(await modalOpen(page), true, 'The editor must stay open while a reset is pending');
  assert.equal(await editingEmail(page), 'dev@example.test');
  assert.equal(state.resets, 1);
  assert.equal(state.saves, 0);

  state.releaseReset();
  await page.locator('#edit-user-temp-block').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#edit-user-temp-value').inputValue(), 'Temp-Pass-0001');
  await assertLocked(page, false);
  if (process.env.QYM_PASSWORD_RESET_SCREENSHOT) await page.screenshot({ path: process.env.QYM_PASSWORD_RESET_SCREENSHOT });

  await page.locator('#edit-user-cancel').click();
  assert.equal(await modalOpen(page), false);
  assert.equal(await page.locator('#edit-user-temp-value').inputValue(), '', 'Closing must clear the one-time password');
  assert.deepEqual(errors, []);
  await page.close();
}

async function saveWhilePending(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('#edit-user-name').fill('Dev Renamed');
  state.holdSave = true;
  await page.locator('#edit-user-save').click();
  while (!state.releaseSave) await page.waitForTimeout(20);
  await assertLocked(page, true);
  assert.equal(await page.locator('#edit-user-save').innerText(), 'Saving...');
  await tryToLeave(page);
  await page.waitForTimeout(100);
  assert.equal(await modalOpen(page), true, 'The editor must stay open while a save is pending');
  assert.equal(await editingEmail(page), 'dev@example.test');
  assert.equal(state.saves, 1);
  assert.equal(state.resets, 0, 'A reset must not start while a save is pending');

  state.releaseSave();
  await page.waitForFunction(() => document.getElementById('edit-user-modal').style.display === 'none');
  assert.match(await page.locator('#user-message').innerText(), /User updated/);
  await assertLocked(page, false);
  assert.equal(await page.locator('#edit-user-save').innerText(), 'Save Changes');
  assert.deepEqual(errors, []);
  await page.close();
}

async function saveStartedBehindConfirmation(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('#edit-user-reset-password').click();
  await page.locator('#shell-confirm-submit').waitFor();
  state.holdSave = true;
  await page.evaluate(() => document.getElementById('edit-user-save').click());
  while (!state.releaseSave) await page.waitForTimeout(20);
  await page.locator('#shell-confirm-submit').click();
  await page.waitForTimeout(100);
  assert.equal(state.resets, 0, 'A confirmed reset must not start while a save is pending');
  state.releaseSave();
  await page.waitForFunction(() => document.getElementById('edit-user-modal').style.display === 'none');
  assert.equal(state.resets, 0);
  assert.deepEqual(errors, []);
  await page.close();
}

async function selfEditKeepsRoleLocked(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('#edit-user-cancel').click();
  await page.locator('[data-user-edit="admin"]').click();
  assert.equal(await page.locator('#edit-user-password-group').isVisible(), false);
  state.failSave = true;
  await page.locator('#edit-user-save').click();
  await page.waitForFunction(() => document.getElementById('edit-user-error').textContent.includes('already in use'));
  assert.equal(await page.locator('#edit-user-role').isDisabled(), true, 'Your own role stays locked after a save');
  assert.equal(await page.locator('#edit-user-active').isDisabled(), true);
  assert.equal(await page.locator('#edit-user-name').isDisabled(), false);
  assert.deepEqual(errors, []);
  await page.close();
}

async function disableAsksFirstAndSkipsOwnRow(browser) {
  const { page, state, errors } = await harness(browser);
  await page.locator('#edit-user-cancel').click();
  assert.equal(await page.locator('[data-user-toggle="admin"]').count(), 0, 'Your own row has no Disable button');
  await page.locator('[data-user-toggle="u1"]').click();
  await page.locator('#shell-confirm-dialog').waitFor();
  assert.match(await page.locator('#shell-confirm-dialog').innerText(), /signed out everywhere/);
  await page.locator('#shell-confirm-cancel').click();
  await page.waitForTimeout(100);
  assert.equal(state.saves, 0, 'Cancelling the confirmation must not disable the user');
  await page.locator('[data-user-toggle="u1"]').click();
  await page.locator('#shell-confirm-submit').click();
  await page.waitForFunction(() => document.getElementById('user-message').textContent.includes('User disabled'));
  assert.equal(state.saves, 1);
  assert.deepEqual(errors, []);
  await page.close();
}

async function failuresKeepEditorUsable(browser) {
  const { page, state, errors } = await harness(browser);
  state.failReset = true;
  await page.locator('#edit-user-reset-password').click();
  await page.locator('#shell-confirm-submit').click();
  await page.waitForFunction(() => document.getElementById('edit-user-error').textContent.includes('not enabled'));
  await assertLocked(page, false);
  assert.equal(await page.locator('#edit-user-temp-block').isVisible(), false);

  state.failSave = true;
  await page.locator('#edit-user-save').click();
  await page.waitForFunction(() => document.getElementById('edit-user-error').textContent.includes('already in use'));
  assert.equal(await modalOpen(page), true, 'A failed save must keep the editor open');
  await assertLocked(page, false);
  assert.equal(await page.locator('#edit-user-save').innerText(), 'Save Changes');

  await page.keyboard.press('Escape');
  assert.equal(await modalOpen(page), false);
  assert.equal(state.resets, 1);
  assert.equal(state.saves, 1);
  assert.deepEqual(errors, []);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await resetWhilePending(browser);
    await saveWhilePending(browser);
    await saveStartedBehindConfirmation(browser);
    await selfEditKeepsRoleLocked(browser);
    await disableAsksFirstAndSkipsOwnRow(browser);
    await failuresKeepEditorUsable(browser);
  }
  finally { await browser.close(); }
  console.log('Admin password reset browser contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
