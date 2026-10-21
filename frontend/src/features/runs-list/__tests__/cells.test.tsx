import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { RunNameCell } from '../cells';

/** QA3-25 to QA3-31: the latency tag in the Run cell. */
function run(extra: Partial<RunRow> = {}): RunRow {
  return {
    run_id: 'r1',
    run_name: 'latency check',
    external_run_id: 'latency check',
    samples: 1,
    origin: 'official',
    experiment: { id: 'e1', name: 'latency check', job_id: 'j1', latency_sensitive: true },
    ...extra,
  } as RunRow;
}

function cell(row: RunRow) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RunNameCell row={row} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RunNameCell latency tag', () => {
  it('shows one passive, named icon tag in the leading slot for a flagged experiment', async () => {
    const { container } = cell(run());
    const tag = screen.getByTestId('run-latency-tag');
    expect(tag).toHaveAttribute('role', 'img');
    expect(tag).toHaveAttribute('aria-label', 'Latency-sensitive experiment');
    expect(tag).toHaveAttribute('title', 'Latency-sensitive experiment');
    expect(tag).toHaveAttribute('data-tone', 'info');
    expect(tag.getAttribute('tabindex')).toBeNull();
    // Leading slot: the tag comes before the name.
    const kids = Array.from(screen.getByTestId('run-cell').children);
    expect(kids.indexOf(tag.parentElement as Element)).toBe(0);
    expect(kids[1]?.textContent).toBe('latency check');
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ['an unflagged experiment', run({ experiment: { id: 'e', name: 'n', job_id: 'j', latency_sensitive: false } })],
    ['a local run', run({ origin: 'local', experiment: null })],
    ['a descriptor without the field', run({ experiment: { id: 'e', name: 'n', job_id: 'j' } })],
  ])('shows no tag for %s', (_label, row) => {
    cell(row);
    expect(screen.queryByTestId('run-latency-tag')).toBeNull();
  });

  it('a repeat run keeps its chevron and gets the tag after Official', () => {
    cell(run({ samples: 3 }));
    const kids = Array.from(screen.getByTestId('run-cell').children);
    expect(kids[0]?.tagName).toBe('BUTTON');
    expect(kids[kids.length - 1]).toBe(screen.getByTestId('run-latency-tag'));
    expect(screen.getAllByTestId('run-latency-tag')).toHaveLength(1);
  });
});
