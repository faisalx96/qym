/** RD7: Performance across attempts as a table: centred number and score columns, values coloured by ScoreValue. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CurveTable } from '../RepeatTab';

const series = [
  {
    name: 'Pass@k',
    points: [
      { k: 1, value: 0.42 },
      { k: 2, value: 0.9 },
    ],
  },
  {
    name: 'Pass^k',
    points: [
      { k: 1, value: 0.42 },
      { k: 2, value: null },
    ],
  },
];

describe('CurveTable (RD7)', () => {
  it('centres k and the series, and colours each value through ScoreValue bands', () => {
    const { container } = render(
      <CurveTable
        series={series}
        selectedLabel="Compare"
        passesAxis={false}
        numeric={false}
        valueType="percentage"
        valueDirection="maximize"
      />,
    );
    expect(screen.getByRole('grid', { name: 'Compare values' })).toBeInTheDocument();
    const kCells = [...container.querySelectorAll('td[data-col="k"]')];
    expect(kCells.map((c) => c.getAttribute('data-align'))).toEqual(['center', 'center']);
    expect(kCells.map((c) => c.textContent)).toEqual(['1', '2']);
    const pass = [...container.querySelectorAll('td[data-col="Pass@k"]')];
    expect(pass.every((c) => c.getAttribute('data-align') === 'center')).toBe(true);
    const values = pass.map((c) => c.querySelector('[data-band]'));
    expect(values.map((v) => v?.textContent)).toEqual(['42.0%', '90.0%']);
    expect(values[1]!.getAttribute('data-band')).not.toBe(values[0]!.getAttribute('data-band'));
    expect(container.querySelectorAll('td[data-col="Pass^k"]')[1]).toHaveTextContent('—');
  });
});
