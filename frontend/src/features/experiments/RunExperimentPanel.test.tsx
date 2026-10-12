import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RunExperimentPanel, displayValue, pointerLabel } from './RunExperimentPanel';

const panel = {
  origin: 'official',
  experiment_id: 'x1',
  experiment_name: 'sweep',
  experiment_available: true,
  environment_id: 'e1',
  environment_name: 'staging',
  combo_index: 1,
  attempt: 1,
  job_id: 'j1',
  job_available: true,
  job_status: 'SUCCEEDED',
  can_promote: true,
  sweep: { '/LLM_OVERRIDES/endpoints/primary/timeout': 30 },
  slot_bindings: { 'endpoint:primary': { name: 'gpt', model: 'gpt-4o' } },
};
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('RunExperimentPanel', () => {
  it('renders nothing for local runs', () => {
    const { container } = wrap(<RunExperimentPanel panel={{ origin: 'local' }} slug="p" runId="r" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('links rerun with clone and job and enables promote for completed runs', () => {
    wrap(<RunExperimentPanel panel={panel} slug="p" runId="r1" runStatus="COMPLETED" />);
    expect(screen.getByRole('link', { name: 'Rerun with this config' }).getAttribute('href')).toContain(
      'clone=x1&job=j1',
    );
    expect(screen.getByRole('link', { name: 'Promote to default preset' }).getAttribute('href')).toContain(
      'promote=run&id=r1',
    );
    expect(screen.getByText('#2 · retry 1')).toBeTruthy();
  });
  it('disables promote for running runs', () => {
    wrap(<RunExperimentPanel panel={panel} slug="p" runId="r1" runStatus="RUNNING" />);
    expect(screen.queryByRole('link', { name: 'Promote to default preset' })).toBeNull();
    expect(screen.getByText('Promote to default preset').getAttribute('aria-disabled')).toBe('true');
  });
  it('formats values', () => {
    expect(displayValue({ temporary: { label: 'T', model: 'm' } })).toBe('T (m)');
    expect(pointerLabel('/a/b/c')).toBe('b.c');
  });
});
