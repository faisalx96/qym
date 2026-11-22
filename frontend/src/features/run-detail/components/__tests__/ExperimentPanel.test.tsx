/** RD1: the Experiment box of an official run starts collapsed; the reader's stored choice wins. RD2: empty values hide. */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPERIMENT_OPEN_KEY, ExperimentPanel } from '../RunPanels';
import type { Run } from '../../types';

const run = {
  run_id: 'r1',
  status: 'COMPLETED',
  experiment: {
    origin: 'official',
    experiment_id: 'e1',
    experiment_name: 'Prompt sweep',
    experiment_available: true,
    environment_name: 'staging',
    job_available: true,
    sweep: { temperature: 0.2, stop: [], extra: {} },
  },
} as unknown as Run;

const draw = () =>
  render(
    <MemoryRouter>
      <ExperimentPanel run={run} slug="p" />
    </MemoryRouter>,
  );

describe('ExperimentPanel (RD1)', () => {
  afterEach(() => localStorage.clear());

  it('starts collapsed: the title and actions show, the fields do not', () => {
    draw();
    expect(screen.getByTestId('experiment-panel')).toHaveTextContent('Experiment');
    const toggle = screen.getByTestId('experiment-details-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Show details');
    expect(screen.queryByText('Environment')).toBeNull();
  });

  it('"Show details" opens the fields and stores the choice', () => {
    draw();
    fireEvent.click(screen.getByTestId('experiment-details-toggle'));
    expect(screen.getByTestId('experiment-details-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(localStorage.getItem(EXPERIMENT_OPEN_KEY)).toBe('true');
  });

  it('a stored "open" choice wins: the box starts open', () => {
    localStorage.setItem(EXPERIMENT_OPEN_KEY, 'true');
    draw();
    expect(screen.getByTestId('experiment-details-toggle')).toHaveTextContent('Hide details');
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('RD2: an empty swept value is left out; a real one stays', () => {
    localStorage.setItem(EXPERIMENT_OPEN_KEY, 'true');
    draw();
    const panel = screen.getByTestId('experiment-panel');
    expect(panel).toHaveTextContent('0.2');
    expect(panel).not.toHaveTextContent('[]');
    expect(panel).not.toHaveTextContent('{}');
  });
});
