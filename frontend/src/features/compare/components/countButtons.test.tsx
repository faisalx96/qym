/** C201: a count button that would filter to nothing is not drawn. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BaselineStats } from '../lib/baseline';
import { CountButtons } from './common';

const stats = (improved: number, regressed: number): BaselineStats => ({
  paired: improved + regressed,
  counts: { improved, regressed, same: 0 },
  mean: 0.1,
  halfWidth: 0.05,
  pValue: 0.01,
  verdict: 'improved',
});

describe('CountButtons', () => {
  it('draws only the counts above zero', () => {
    render(
      <CountButtons
        stats={stats(9, 0)}
        active={null}
        onToggle={() => {}}
        label="quality"
        direction="maximize"
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button').textContent).toBe('↑9');
  });

  it('keeps a pressed count so the filter can be turned off', () => {
    render(
      <CountButtons
        stats={stats(0, 0)}
        active="regressed"
        onToggle={() => {}}
        label="quality"
        direction="maximize"
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
