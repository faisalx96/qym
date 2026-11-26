import { afterEach, expect, it, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatTableDate } from '@/lib/dates';
import { PlatformSignIn } from '../components/platform/SessionDialog';
import { PlatformCharts } from '../components/platform/PlatformProgress';
import { PlatformRun } from '../components/platform/PlatformRun';
import { MixedHome } from '../components/platform/PlatformHome';
import { platformTarget, platformRunRead, platformHome } from '../platform-fixtures';
import { setup, response } from './areaHarness';

afterEach(() => vi.restoreAllMocks());

for (const [hint, label] of [
  ['1 cookie, saved 1999-01-01T00:00:00Z', '1 cookie'],
  ['1 cookies, saved old', '1 cookie'],
  ['3 cookies, saved old', '3 cookies'],
  ['unrecognized hint', 'Saved'],
] as const) {
  it(`formats sign-in metadata from the saved fields: ${hint}`, () => {
    const token = {
      ...platformTarget.tokens[0]!,
      hint,
      updated_by: 'Demo Person',
      updated_at: '2026-11-25T17:27:56Z',
    };
    setup(<PlatformSignIn slug="demo" target={{ ...platformTarget, tokens: [token] }} />, { server: {} });
    expect(screen.getAllByText(label, { exact: false })[0]).toBeVisible();
    expect(screen.getByText(formatTableDate(token.updated_at), { exact: false })).toBeVisible();
    expect(screen.getByText('Demo Person')).toBeVisible();
    expect(document.body.textContent).not.toContain('1999-01-01');
    expect(document.body.textContent).not.toContain('unrecognized hint');
  });
}
it('gives both time charts distinct decimal axis labels', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  const read = platformRunRead('finished');
  read.summary!.levels.forEach((level) => {
    level.open_p95_ms = 2300;
    level.filter_p95_ms = 420;
  });
  setup(<PlatformCharts read={read} />, { server: {} });
  await waitFor(() =>
    expect(document.querySelectorAll('svg text[text-anchor="end"]').length).toBeGreaterThan(5),
  );
  for (const chart of screen.getAllByRole('img').filter((el) => el.tagName === 'svg')) {
    const ticks = [...chart.querySelectorAll('text[text-anchor="end"]')]
      .map((el) => el.textContent)
      .filter((text) => /^\d.*s$/.test(text ?? ''));
    expect(new Set(ticks).size).toBe(ticks.length);
  }
});
it('does not put a users unit after an unknown capacity or create an empty header item', () => {
  const read = platformRunRead('finished');
  read.summary!.headline.breaking_level_users = null;
  read.summary!.headline.safe_load_users = null;
  read.summary!.headline.recommended_max_users = null;
  setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={() => undefined} />, {
    server: {},
  });
  expect(
    within(screen.getByLabelText('The run in numbers')).getByText('Not reached', { exact: true }),
  ).toBeVisible();
  expect(screen.getByLabelText('The run in numbers').textContent).not.toMatch(/[–—]\s*users/);
  const meta = document.querySelector('[data-page-header]');
  expect(meta?.querySelector('[data-platform-meta]')).not.toBeNull();
  expect(
    [...meta!.querySelectorAll('[data-platform-meta] > span')].every((el) => el.textContent?.trim()),
  ).toBe(true);
});
it('uses measurement words for a platform history row without data', () => {
  const home = platformHome();
  home.runs.rows = [{ ...home.runs.rows[0]!, verdict: 'invalid_no_data' }];
  setup(<MixedHome slug="demo" home={home} staleSince={null} onRetry={() => undefined} />, { server: {} });
  expect(screen.getByText('Not valid: no measurement')).toBeVisible();
  expect(screen.queryByText(/no answers/i)).not.toBeInTheDocument();
});
it('explains that sign-in waiting is excluded from dashboard open times', () => {
  const read = platformRunRead('waiting');
  setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={() => undefined} />, {
    server: {},
  });
  expect(screen.getByText(/Time spent waiting is not counted in dashboard open times/)).toBeVisible();
});
it('renders a refreshed rotation event once, with the replacement message rather than an appended event', async () => {
  const read = platformRunRead('running');
  const event = {
    id: 9,
    at: '2026-11-25T18:00:00Z',
    level: 'info',
    code: 'token_rotated',
    message: 'The sign-in was renewed 2 times',
    details: { count: 2, latest_version: 3, last_at: '2026-11-25T18:01:00Z' },
  };
  let current = event;
  const view = setup(<PlatformRun slug="demo" runId={read.run.id} read={read} onRetry={() => undefined} />, {
    server: { reads: { [`/runs/${read.run.id}/events`]: () => response({ events: [current] }) } },
  });
  await userEvent.click(screen.getByRole('tab', { name: 'Log' }));
  await userEvent.click(screen.getByRole('radio', { name: /^Events$/ }));
  expect(await screen.findByText(event.message)).toBeVisible();
  current = {
    ...event,
    message: 'The sign-in was renewed 4 times',
    details: { ...event.details, count: 4, latest_version: 5 },
  };
  await view.client.invalidateQueries();
  expect(await screen.findByText(current.message)).toBeVisible();
  expect(screen.queryByText(event.message)).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Events of this run')).getAllByText(current.message)).toHaveLength(1);
  expect(document.body.textContent).not.toContain('2026-11-25T18:01');
});
