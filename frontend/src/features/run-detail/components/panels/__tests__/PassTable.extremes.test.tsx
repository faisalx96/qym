/**
 * By pass (RD6): every value keeps its score-band colour. The best and the worst pass of each metric are a subtle green
 * or red highlight behind the value (`data-extreme`), with a title and a hidden word; no glyph and no key line. The
 * table ends after the last pass (no Mean, Best or Worst rows).
 */
import { fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { RunModel } from '../../../lib/runModel';
import { PassTable } from '../PassTable';

const model = {
  metricNames: ['quality', 'notes', 'flat'],
  metricTypes: { quality: 'percentage', notes: 'numeric', flat: 'percentage' },
  metricDirections: { quality: 'maximize', notes: null, flat: 'maximize' },
} as unknown as RunModel;

const passes = [0.82, 0.64, 0.71, 0.82].map((v, i) => ({
  pass_number: i + 1,
  metric_means: { quality: v, notes: 2 + i, flat: 0.5 },
  items_total: 10,
}));

const renderTable = (rows = passes) =>
  render(
    <MemoryRouter>
      <PassTable passes={rows} model={model} metric="quality" basePath="/r" medianHint="" queued={null} />
    </MemoryRouter>,
  );

const cell = (container: HTMLElement, pass: number, col: string) =>
  container.querySelectorAll('tbody tr')[pass - 1]!.querySelector(`td[data-col="${col}"]`)!;

describe('PassTable best / worst highlight (RD6)', () => {
  it('has no foot rows: the table ends after the last pass', () => {
    const { container } = renderTable();
    expect(container.querySelector('tfoot')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('marks every tied best pass and the worst pass with a highlight, a title and a hidden word', () => {
    const { container } = renderTable();
    for (const n of [1, 4]) {
      const mark = cell(container, n, 'metric:quality').querySelector('[data-extreme]')!;
      expect(mark.getAttribute('data-extreme')).toBe('best');
      expect(mark.getAttribute('title')).toBe('Best pass for quality');
      expect(mark).toHaveTextContent('82.0%, best pass');
    }
    const worst = cell(container, 2, 'metric:quality').querySelector('[data-extreme]')!;
    expect(worst.getAttribute('data-extreme')).toBe('worst');
    expect(worst.getAttribute('title')).toBe('Worst pass for quality');
    // pass 3 is neither
    expect(cell(container, 3, 'metric:quality').querySelector('[data-extreme], svg')).toBeNull();
  });

  it('keeps the score-band colour of the value and draws no glyph', () => {
    const { container } = renderTable();
    const body = container.querySelector('tbody')!;
    expect(body.querySelector('[data-tone=success], [data-tone=danger]')).toBeNull();
    expect(body.querySelector('td[data-col^="metric:"] svg')).toBeNull();
    expect(cell(container, 2, 'metric:quality').querySelector('[data-band]')).not.toBeNull();
  });

  it('marks nothing for a metric with no direction or when every pass shows the same value', () => {
    const { container } = renderTable();
    expect(container.querySelector('td[data-col="metric:notes"] [data-extreme]')).toBeNull();
    expect(container.querySelector('td[data-col="metric:flat"] [data-extreme]')).toBeNull();
  });

  it('has no key line, and the Pass column stays pinned', () => {
    const { container } = renderTable();
    expect(container.querySelector('[data-testid="pass-key"]')).toBeNull();
    expect(container.querySelector('[data-col="pass"]')!.getAttribute('data-pin')).toBe('start');
  });

  it('is a full table: a metric head sorts the passes from the highest, then from the lowest', () => {
    const { container } = renderTable();
    const order = () =>
      [...container.querySelectorAll('tbody tr td[data-col="pass"]')].map((td) => td.textContent);
    expect(order()).toEqual(['Pass 1', 'Pass 2', 'Pass 3', 'Pass 4']);
    const head = container.querySelector('thead th[data-col="metric:quality"]') as HTMLElement;
    const sortButton = within(head).getAllByRole('button')[0]!;
    fireEvent.click(sortButton);
    expect(order()).toEqual(['Pass 1', 'Pass 4', 'Pass 3', 'Pass 2']);
    expect(head.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(sortButton);
    expect(order()).toEqual(['Pass 2', 'Pass 3', 'Pass 1', 'Pass 4']);
  });
});
