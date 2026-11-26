import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PerformanceLogFilters, PerformanceLogLine, PerformanceLogPage } from '@/api/performance';
import {
  performanceLogPage,
  performanceRunEvents,
  performanceRunRunning,
} from '@/features/dev/performanceFixtures';
import { LogViewer } from '../components/run/LogViewer';
import { LOG_KEEP, LOG_PAGE, loadLogTail } from '../components/run/logTail';
import { reads, setup } from './runHarness';

// The Log tab: the end of a long log without walking it from the start, a viewer that draws only what is
// near the visible part and lets go of the tail when the person scrolls, and the events in words.

const line = (seq: number): PerformanceLogLine => ({
  seq,
  at: new Date(Date.UTC(2026, 10, 20, 11, 0, 0) + seq * 1000).toISOString(),
  level: seq % 2 ? 'info' : 'warning',
  message: `line ${seq}`,
});

/** A log of `size` lines behind the log route: lines after a number, at most `limit`, filtered by level. */
function logRoute(size: () => number) {
  return vi.fn(async (filters: PerformanceLogFilters): Promise<PerformanceLogPage> => {
    const all = Array.from({ length: size() }, (_, index) => line(index + 1)).filter(
      (item) => !filters.level?.length || filters.level.includes(item.level),
    );
    const after = all.filter((item) => item.seq > (filters.after_seq ?? 0));
    const lines = after.slice(0, filters.limit ?? LOG_PAGE);
    return {
      lines,
      next_after_seq: after.length > lines.length ? lines[lines.length - 1]!.seq : null,
      last_seq: size(),
      total: all.length,
      dropped: 0,
    };
  });
}

describe('the end of the log', () => {
  it('skips to the last lines of a long log instead of walking it from the first', async () => {
    const route = logRoute(() => 12_000);
    const tail = await loadLogTail(route, { level: [], q: '' });
    expect(route.mock.calls.map(([filters]) => filters.after_seq)).toEqual([0, 11_000]);
    expect(tail.lines).toHaveLength(LOG_PAGE);
    expect(tail.lines[0]!.seq).toBe(11_001);
    expect(tail.lines.at(-1)!.seq).toBe(12_000);
    expect(tail).toMatchObject({ cursor: 12_000, total: 12_000, dropped: 0 });
  });

  it('walks a filtered log, whose lines are few, and keeps every matching line in order', async () => {
    const route = logRoute(() => 5_000);
    const tail = await loadLogTail(route, { level: ['warning'], q: '' });
    expect(route).toHaveBeenCalledTimes(3);
    expect(tail.lines).toHaveLength(2_500);
    expect(tail.lines.every((item, index) => item.seq === (index + 1) * 2)).toBe(true);
    expect(tail.total).toBe(2_500);
  });

  it('later asks only for what came after the lines it holds, and keeps the newest 5,000', async () => {
    let size = 5_000;
    const route = logRoute(() => size);
    const held = await loadLogTail(route, { level: [], q: '' });
    route.mockClear();
    size = 5_030;
    const next = await loadLogTail(route, { level: [], q: '' }, held);
    expect(route.mock.calls.map(([filters]) => filters.after_seq)).toEqual([held.cursor]);
    const kept = await loadLogTail(
      route,
      { level: [], q: '' },
      { ...next, lines: [...held.lines, ...held.lines] },
    );
    expect(next.lines.at(-1)!.seq).toBe(5_030);
    expect(kept.lines.length).toBeLessThanOrEqual(LOG_KEEP);
  });
});

describe('the log viewer', () => {
  const many = Array.from({ length: 5_000 }, (_, index) => line(index + 1));

  it('draws only the lines near the visible part, each with its time to the second, level and text', () => {
    // The page has no layout here: the well is given the 480px it has on screen.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1166);
    render(<LogViewer lines={many} follow={false} onFollowChange={() => undefined} />);
    const well = screen.getByRole('log', { name: 'Log lines' });
    expect(well).toHaveAttribute('tabindex', '0');
    const drawn = well.querySelectorAll('[data-index]');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(100);
    expect(drawn[0]!.textContent).toMatch(/^\d\d:\d\d:\d\dinfoline 1$/);
    expect(drawn[1]).toHaveAttribute('data-level', 'warning');
  });

  it('lets go of the tail when the person scrolls up, not when the page itself scrolls', () => {
    const onFollowChange = vi.fn();
    render(<LogViewer lines={many} follow onFollowChange={onFollowChange} />);
    const well = screen.getByRole('log', { name: 'Log lines' });
    Object.defineProperty(well, 'scrollHeight', { configurable: true, value: 95_000 });
    Object.defineProperty(well, 'clientHeight', { configurable: true, value: 480 });
    well.scrollTop = 40_000;
    fireEvent.scroll(well);
    expect(onFollowChange).not.toHaveBeenCalled();
    fireEvent.wheel(well, { deltaY: -400 });
    fireEvent.scroll(well);
    expect(onFollowChange).toHaveBeenCalledWith(false);
  });
});

describe('the Log tab', () => {
  it('shows all lines with how many of the log they are, a level filter and the download', async () => {
    const user = userEvent.setup();
    const { fetch, runId } = setup(performanceRunRunning, { initial: { tab: 'log' } });
    const note = await waitFor(() => {
      const found = document.querySelector('[data-performance-block="log-note"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(note).toHaveTextContent(
      `The last ${performanceLogPage.lines.length.toLocaleString('en-US')} of ${performanceLogPage.total.toLocaleString('en-US')} lines.`,
    );
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      `/api/projects/demo/performance/runs/${runId}/log.txt`,
    );
    expect(screen.getByRole('switch', { name: 'Follow' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Level filter' }));
    await user.click(await screen.findByRole('checkbox', { name: /^Info/ }));
    await waitFor(() => expect(reads(fetch, '/log').at(-1)!.getAll('level')).toEqual(['error', 'warning']));
  });

  it('shows the events newest first', async () => {
    const user = userEvent.setup();
    setup(performanceRunRunning, { initial: { tab: 'log' } });
    await user.click(await screen.findByRole('radio', { name: 'Events' }));
    const list = await screen.findByRole('list', { name: 'Events of this run' });
    const text = list.textContent ?? '';
    const events = performanceRunEvents.events;
    expect(text.indexOf(events.at(-1)!.message)).toBeLessThan(text.indexOf(events[0]!.message));
    expect(within(list).getAllByRole('listitem')).toHaveLength(events.length);
    expect(screen.getByRole('switch', { name: 'Follow' })).toBeDisabled();
  });
});
