/// <reference lib="dom" />
/**
 * Brief 01 J2/J3 (shell boot, in-app navigation), §8.7 scenarios 4, 11 and the
 * UX_DECISION adjustments (skip link, focus on route change, Escape from the
 * empty search, overlay sidebar ≤760px, user-menu navigation, collapse
 * persistence, legacy /run redirect, deep links, cross-tab run status).
 */
import { test, expect } from '@playwright/test';
import { archiveProject, createProject, gotoApp, trackPageLoads, uniqueSlug } from '../helpers';
import { expectContentFocused } from './support';

test.describe('shell chrome', () => {
  test('skip link is the first Tab stop and targets main#shell-content', async ({ page, request }) => {
    const p = await createProject(request, 'Skip Link', uniqueSlug('skip'));
    await gotoApp(page, `/projects/${p.slug}`);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    // Route change already focused the content; start from the body like a fresh user.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    const active = page.locator(':focus');
    await expect(active).toHaveText('Skip to content');
    await expect(active).toHaveAttribute('href', /#shell-content$/);
    await expect(active).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('shell-content');
  });

  test('focus moves to main#shell-content on every route change', async ({ page, request }) => {
    const p = await createProject(request, 'Focus Route', uniqueSlug('focus'));
    await gotoApp(page, `/projects/${p.slug}`);
    await page.locator('[data-nav="charts"]').click();
    await expect(page).toHaveURL(/\/charts$/);
    await expectContentFocused(page);
    await page.locator('[data-nav="settings"]').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expectContentFocused(page);
    await expect(page.locator('[data-settings-page]')).toBeVisible();
  });

  test('breadcrumb: last crumb carries aria-current=page; project crumb is the switcher', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Crumbs', uniqueSlug('crumbs'));
    await gotoApp(page, `/projects/${p.slug}/experiments/queue`);
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Queue');
    await expect(nav.getByRole('link', { name: 'Experiments' })).toBeVisible();
    await expect(nav.locator('[data-project-switcher]')).toContainText(p.name);
    await nav.getByRole('link', { name: 'Experiments' }).click();
    await expect(page).toHaveURL(/\/experiments$/);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Experiments');
  });

  test('sidebar collapse persists across in-app navigation and reload (qym:sidebar-collapsed)', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Collapse', uniqueSlug('collapse'));
    await gotoApp(page, `/projects/${p.slug}`);
    const shell = page.locator('[data-app-shell]');
    const toggle = page.locator('[data-sidebar-toggle]');
    await expect(shell).not.toHaveAttribute('data-collapsed', '');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'qym-sidebar');
    await toggle.click();
    await expect(shell).toHaveAttribute('data-collapsed', '');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => localStorage.getItem('qym:sidebar-collapsed'))).toBe('1');
    // collapsed items keep an accessible name
    await expect(page.locator('[data-nav="settings"]')).toHaveAttribute('aria-label', 'Project settings');
    await page.locator('[data-nav="settings"]').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(shell).toHaveAttribute('data-collapsed', '');
    await page.reload();
    await expect(page.locator('[data-app-shell]')).toHaveAttribute('data-collapsed', '');
    await page.locator('[data-sidebar-toggle]').click();
    await expect(page.locator('[data-app-shell]')).not.toHaveAttribute('data-collapsed', '');
    expect(await page.evaluate(() => localStorage.getItem('qym:sidebar-collapsed'))).toBe('0');
  });

  test('Escape closes the project switcher from the empty search and returns focus to the trigger', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Escape Switch', uniqueSlug('esc'));
    await gotoApp(page, `/projects/${p.slug}`);
    const trigger = page.locator('[data-project-switcher]');
    await trigger.click();
    const popover = page.getByRole('dialog', { name: 'Switch project' });
    await expect(popover.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    // and with text typed: Escape clears first (React Aria SearchField), a second Escape closes
    await trigger.click();
    await popover.getByRole('searchbox').fill('abc');
    await page.keyboard.press('Escape');
    if (await popover.isVisible()) {
      await expect(popover.getByRole('searchbox')).toHaveValue('');
      await page.keyboard.press('Escape');
    }
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('user menu: Profile navigates in-app; Escape returns focus to the trigger', async ({ page, request }) => {
    const p = await createProject(request, 'User Menu', uniqueSlug('umenu'));
    await gotoApp(page, `/projects/${p.slug}`);
    const trigger = page.locator('[data-user-menu]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByText('dev@local').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    const loads = trackPageLoads(page);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/app\/profile$/);
    await expect(page.locator('[data-profile-page]')).toBeVisible();
    expect(loads.count()).toBe(0);
    // auth mode none: there is no session, so no Sign out item
    await page.locator('[data-user-menu]').click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
  });

  test('Back after in-app navigation returns to the previous page without a full load', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'History', uniqueSlug('hist'));
    await gotoApp(page, `/projects/${p.slug}`);
    const loads = trackPageLoads(page);
    await page.locator('[data-nav="datasets"]').click();
    await expect(page).toHaveURL(/\/datasets$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${p.slug}$`));
    await expect(page.locator('[data-nav="runs"]')).toHaveAttribute('aria-current', 'page');
    expect(loads.count()).toBe(0);
  });
});

test.describe('command palette (UX_DECISION adjustment 2)', () => {
  test('Ctrl+K opens; Escape from the empty search closes; typing + Enter navigates without reload', async ({
    page,
    request,
  }) => {
    const here = await createProject(request, 'Palette Here', uniqueSlug('palhere'));
    const there = await createProject(request, 'Palette There', uniqueSlug('palthere'));
    await gotoApp(page, `/projects/${here.slug}`);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    const loads = trackPageLoads(page);
    await page.keyboard.press('Control+k');
    const palette = page.locator('[data-command-palette]');
    await expect(palette).toBeVisible();
    const input = palette.getByRole('combobox');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    await page.locator('[data-palette-trigger]').click();
    await expect(palette).toBeVisible();
    await input.fill(there.slug);
    await expect(palette.getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('option', { selected: true })).toContainText(there.name);
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${there.slug}$`));
    expect(loads.count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('qym:last-project-slug'))).toBe(there.slug);
  });

  test('actions: "Manage members" opens the Members settings tab', async ({ page, request }) => {
    const p = await createProject(request, 'Palette Actions', uniqueSlug('palact'));
    await gotoApp(page, `/projects/${p.slug}`);
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.locator('[data-command-palette]');
    await palette.getByRole('combobox').fill('manage members');
    await palette.getByRole('option', { name: /Manage members/ }).click();
    await expect(page).toHaveURL(/\/settings\?tab=members$/);
    await expect(page.getByRole('tab', { name: /Members/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('narrow viewport (≤760px, UX_DECISION adjustment 5)', () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test('auto-collapses; overlay closes on Escape / outside click / item choice and returns focus to the toggle', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Narrow', uniqueSlug('narrow'));
    await gotoApp(page, `/projects/${p.slug}`);
    const shell = page.locator('[data-app-shell]');
    const toggle = page.locator('[data-sidebar-toggle]');
    await expect(shell).toHaveAttribute('data-narrow', '');
    await expect(shell).toHaveAttribute('data-collapsed', '');
    await expect(page.locator('[data-topbar-stats]')).toBeHidden();
    // no page-level horizontal scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Escape
    await toggle.click();
    await expect(shell).not.toHaveAttribute('data-collapsed', '');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(shell).toHaveAttribute('data-collapsed', '');
    await expect(toggle).toBeFocused();

    // outside click (on the content area, away from the overlay)
    await toggle.click();
    await expect(shell).not.toHaveAttribute('data-collapsed', '');
    await page.locator('#shell-content').click({ position: { x: 400, y: 300 } });
    await expect(shell).toHaveAttribute('data-collapsed', '');
    // the mousedown default action focuses the clicked region after the close handler ran;
    // focus must at least not be lost (body) or stuck inside the hidden overlay
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('#qym-sidebar') === null && document.activeElement !== document.body))
      .toBe(true);

    // choosing a nav item
    await toggle.click();
    await expect(shell).not.toHaveAttribute('data-collapsed', '');
    await page.locator('[data-nav="charts"]').click();
    await expect(page).toHaveURL(/\/charts$/);
    await expect(shell).toHaveAttribute('data-collapsed', '');
  });
});

test.describe('archived project (§8.7 scenario 7)', () => {
  test('read-only banner, hidden Auto-analysis/Reviews nav, /analysis shows the not-found panel', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Archived One', uniqueSlug('archived'));
    await archiveProject(request, p.id);
    await gotoApp(page, `/projects/${p.slug}`);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    await expect(page.locator('[data-archived-banner]')).toContainText('is archived and read-only');
    await expect(page.locator('[data-archived-banner]').getByRole('link', { name: 'Unarchive it' })).toBeVisible();
    await expect(page.locator('[data-topbar]').getByText('Read-only')).toBeVisible();
    await expect(page.locator('[data-project-switcher]').getByText('archived', { exact: true })).toBeVisible();
    await expect(page.locator('[data-nav="analysis"]')).toHaveCount(0);
    await expect(page.locator('[data-nav="reviews"]')).toHaveCount(0);
    await expect(page.locator('[data-nav="settings"]')).toBeVisible();

    await gotoApp(page, `/projects/${p.slug}/analysis`);
    await expect(page.locator('[data-project-not-found="not_found"]')).toBeVisible();
    await expect(page.getByText('Not available for an archived project')).toBeVisible();
    await expect(page.locator('[data-not-found]')).toHaveCount(0);

    await gotoApp(page, `/projects/${p.slug}/reviews`);
    await expect(page.locator('[data-project-not-found="not_found"]')).toBeVisible();

    // the archived project is reachable from the switcher (with its tag) while on it
    await page.locator('[data-project-switcher]').click();
    await expect(page.locator(`[data-switch-to="${p.slug}"]`).getByText('archived', { exact: true })).toBeVisible();
  });

  test('project switch away from an archived project does not remember it as the last slug', async ({
    page,
    request,
  }) => {
    const active = await createProject(request, 'Active Two', uniqueSlug('active'));
    const archived = await createProject(request, 'Archived Two', uniqueSlug('archived2'));
    await archiveProject(request, archived.id);
    await gotoApp(page, `/projects/${active.slug}`);
    await expect(page.locator('[data-project-switcher]')).toContainText(active.name);
    await gotoApp(page, `/projects/${archived.slug}`);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('qym:last-project-slug'))).toBe(active.slug);
  });
});

test.describe('deep links (brief 01 §8 route contract)', () => {
  test('unknown project slug shows the project not-found panel', async ({ page }) => {
    await gotoApp(page, `/projects/${uniqueSlug('nope')}/settings`);
    await expect(page.locator('[data-project-not-found="not_found"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'All projects' })).toBeVisible();
  });

  test('unknown app path shows the 404 panel', async ({ page }) => {
    await gotoApp(page, '/this/does/not/exist');
    await expect(page.locator('[data-not-found]')).toBeVisible();
    await expect(page.locator('[data-not-found]')).toContainText('/this/does/not/exist');
  });

  test('every brief 01 §8 URL renders a page or the ComingSoon placeholder, never the 404 panel', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Deep Links', uniqueSlug('deep'));
    const runId = 'eval/2026-01-01/abc';
    const encodedRun = runId.split('/').map(encodeURIComponent).join('/');
    const urls: { path: string; expect: 'coming-soon' | 'run' | 'settings' | 'projects' | 'profile' }[] = [
      { path: '/', expect: 'projects' },
      { path: '/profile', expect: 'profile' },
      { path: '/admin', expect: 'coming-soon' },
      { path: '/admin/users', expect: 'coming-soon' },
      { path: '/trash', expect: 'coming-soon' },
      { path: '/compare', expect: 'coming-soon' },
      { path: '/reviews', expect: 'coming-soon' },
      { path: '/docs-guide', expect: 'coming-soon' },
      { path: '/docs/sdk', expect: 'coming-soon' },
      { path: `/projects/${p.slug}`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/overview`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/charts`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/models`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/experiments`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/experiments/queue`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/experiments/exp-1`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/environments/env-1`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/datasets`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/datasets/ds-1`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/analysis`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/reviews`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/runs/${encodedRun}`, expect: 'run' },
      { path: `/projects/${p.slug}/runs/${encodedRun}/analyzer`, expect: 'coming-soon' },
      { path: `/projects/${p.slug}/settings`, expect: 'settings' },
      { path: `/projects/${p.slug}/settings?tab=apikeys`, expect: 'settings' },
      { path: `/projects/${p.slug}/settings?tab=environments&env=e1&promote=saved&id=x`, expect: 'settings' },
    ];
    for (const u of urls) {
      await gotoApp(page, u.path);
      await expect(page.locator('[data-app-shell]'), u.path).toBeVisible();
      await expect(page.locator('[data-not-found]'), u.path).toHaveCount(0);
      await expect(page.locator('[data-project-not-found]'), u.path).toHaveCount(0);
      if (u.expect === 'coming-soon') {
        await expect(page.getByRole('heading', { name: /coming soon/ }), u.path).toBeVisible();
      } else if (u.expect === 'run') {
        // the run page (run-detail area) renders its own loaded or error state inside the shell
        await expect(page.getByRole('main'), u.path).toBeVisible();
      } else if (u.expect === 'settings') {
        await expect(page.locator('[data-settings-page]'), u.path).toBeVisible();
      } else if (u.expect === 'projects') {
        await expect(page.locator('[data-projects-page]'), u.path).toBeVisible();
      } else {
        await expect(page.locator('[data-profile-page]'), u.path).toBeVisible();
      }
    }
    // run ids with slashes survive the round trip into the breadcrumb
    await gotoApp(page, `/projects/${p.slug}/runs/${encodedRun}`);
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav.locator('[aria-current="page"]')).toHaveText(runId);
    await expect(nav.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', new RegExp(`/app/projects/${p.slug}$`));
  });

  test('legacy /app/run/<id> resolves: redirects to the project run page (guessed) or shows the error state', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Legacy Run', uniqueSlug('legacy'));
    await gotoApp(page, `/projects/${p.slug}`);
    await expect(page.locator('[data-project-switcher]')).toContainText(p.name);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('qym:last-project-slug'))).toBe(p.slug);
    const loads = trackPageLoads(page);
    await gotoApp(page, '/run/no-such-run?view=compact');
    await expect
      .poll(async () => {
        if (/\/app\/projects\/[^/]+\/runs\/no-such-run\?view=compact$/.test(page.url())) return 'redirected';
        if (await page.getByRole('alert').filter({ hasText: 'Couldn’t open this run' }).isVisible()) return 'error';
        return 'pending';
      })
      .not.toBe('pending');
    await expect(page.locator('[data-not-found]')).toHaveCount(0);
    // the run does not exist, so the remembered project is the guess
    if (/\/runs\//.test(page.url())) {
      expect(page.url()).toContain(`/app/projects/${p.slug}/runs/no-such-run?view=compact`);
    }
    expect(loads.count()).toBeLessThanOrEqual(1);
  });
});

test.describe('cross-tab run status (§8.7 scenario 11)', () => {
  test('BroadcastChannel message from a second page dispatches qym:run-status in the first', async ({
    context,
    request,
  }) => {
    const p = await createProject(request, 'Broadcast', uniqueSlug('bc'));
    const first = await context.newPage();
    await first.goto(`/app/projects/${p.slug}`);
    await expect(first.locator('[data-app-shell]')).toBeVisible();
    await first.evaluate(() => {
      const w = window as unknown as { __received: unknown[] };
      w.__received = [];
      document.addEventListener('qym:run-status', (e) => w.__received.push((e as CustomEvent).detail));
      // Ensure the shared channel is open in this tab (pages subscribe when they need it).
      new BroadcastChannel('qym-run-status').onmessage = (ev) => {
        if (ev.data && Array.isArray(ev.data.runIds)) {
          document.dispatchEvent(new CustomEvent('qym:run-status:raw', { detail: ev.data }));
        }
      };
      document.addEventListener('qym:run-status:raw', (e) => {
        (window as unknown as { __raw: unknown[] }).__raw = [
          ...((window as unknown as { __raw?: unknown[] }).__raw ?? []),
          (e as CustomEvent).detail,
        ];
      });
    });
    const second = await context.newPage();
    await second.goto(`/app/projects/${p.slug}`);
    await expect(second.locator('[data-app-shell]')).toBeVisible();
    await second.evaluate(() => {
      new BroadcastChannel('qym-run-status').postMessage({ runIds: ['run-1', 'run-2'], status: 'STOPPED' });
    });
    // The raw channel always delivers across tabs; the app bus must re-dispatch it as the document event.
    await expect
      .poll(() => first.evaluate(() => (window as unknown as { __raw?: unknown[] }).__raw?.length ?? 0))
      .toBeGreaterThan(0);
    await expect
      .poll(() => first.evaluate(() => (window as unknown as { __received: unknown[] }).__received.length), {
        timeout: 3000,
      })
      .toBeGreaterThan(0);
    const received = await first.evaluate(() => (window as unknown as { __received: unknown[] }).__received[0]);
    expect(received).toEqual({ runIds: ['run-1', 'run-2'], status: 'STOPPED' });
  });
});
