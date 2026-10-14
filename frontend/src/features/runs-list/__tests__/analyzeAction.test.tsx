import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { AnalyzeAction, analyzeLabel, analyzeState } from '../AnalyzeAction';

describe('Analyze action state', () => {
  it('maps cause count and activity to one of three states and labels', () => {
    expect(analyzeState(0, false)).toBe('idle');
    expect(analyzeState(3, false)).toBe('done');
    expect(analyzeState(3, true)).toBe('running');
    expect(analyzeLabel('idle', 0)).toBe('Analyze');
    expect(analyzeLabel('running', 0)).toBe('Analyzing');
    expect(analyzeLabel('done', 1)).toBe('1 cause');
    expect(analyzeLabel('done', 4)).toBe('4 causes');
  });

  it('renders a link-button per state with an accessible name, no axe violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <AnalyzeAction to="/a" causeCount={0} subject="run-1" />
        <AnalyzeAction to="/b" causeCount={0} analyzing subject="run-2" />
        <AnalyzeAction to="/c" causeCount={2} subject="run-3" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Analyze run-1' })).toHaveAttribute('data-state', 'idle');
    expect(screen.getByRole('link', { name: 'Analyzing run-2 (running)' })).toHaveAttribute(
      'data-state',
      'running',
    );
    expect(screen.getByRole('link', { name: '2 causes run-3' })).toHaveAttribute('data-state', 'done');
    expect(await axe(container)).toHaveNoViolations();
  });
});
