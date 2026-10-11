import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RunExperimentPanel, type RunExperimentPanelData } from './RunExperimentPanel';

const base: RunExperimentPanelData = {
  origin: 'official',
  experiment_id: 'x1',
  experiment_name: 'sweep',
  experiment_available: true,
  environment_id: 'e1',
  environment_name: 'staging',
  combo_index: 0,
  attempt: 0,
  job_id: 'j1',
  job_available: true,
  job_status: 'SUCCEEDED',
  can_promote: true,
  remote_job_id: 'remote-42',
  base_source: { kind: 'official', preset_version_id: 'pv-123456789' },
  remote_versioning: { agent_version: '1.12', kb_version: '381' },
  slot_bindings: { 'endpoint:primary': { temporary: { label: 'Scratch', model: 'm' } } },
  remote_result: { score: 0.9 },
};
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('RunExperimentPanel states', () => {
  it('shows base, remote job, versioning and models', () => {
    wrap(<RunExperimentPanel panel={base} slug="p" runId="r1" runStatus="COMPLETED" />);
    expect(screen.getByRole('heading', { name: 'Experiment' })).toBeTruthy();
    expect(screen.getByText('Default preset')).toBeTruthy();
    expect(screen.getByText('remote-42')).toBeTruthy();
    expect(screen.getByText('agent_version')).toBeTruthy();
    expect(screen.getByText('Scratch (m)')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('opens the service result on demand', async () => {
    wrap(<RunExperimentPanel panel={base} slug="p" runId="r1" runStatus="COMPLETED" />);
    const summary = screen.getByText('Service result');
    expect(summary.closest('details')?.open).toBe(false);
    await userEvent.click(summary);
    expect(summary.closest('details')?.open).toBe(true);
  });

  it('a deleted experiment disables rerun and says the job is gone', () => {
    wrap(
      <RunExperimentPanel
        panel={{ ...base, experiment_available: false, job_available: false }}
        slug="p"
        runId="r1"
        runStatus="COMPLETED"
      />,
    );
    expect(screen.queryByRole('link', { name: 'Rerun with this config' })).toBeNull();
    expect(screen.getByText('Rerun with this config').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Open experiment' })).toBeNull();
    expect(screen.getByText(/launch job is no longer available/)).toBeTruthy();
  });

  it('hides promote for people who cannot manage the environment', () => {
    wrap(<RunExperimentPanel panel={{ ...base, can_promote: false }} slug="p" runId="r1" runStatus="COMPLETED" />);
    expect(screen.queryByText('Promote to default preset')).toBeNull();
  });

  it('retry attempts and job errors are shown; the export has no actions', () => {
    wrap(
      <RunExperimentPanel
        panel={{ ...base, attempt: 2, job_status: 'FAILED', error: 'worker crashed' }}
        slug="p"
        runId="r1"
        runStatus="FAILED"
        isExport
      />,
    );
    expect(screen.getByText('#1 · retry 2')).toBeTruthy();
    expect(screen.getByText('worker crashed')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing without a panel', () => {
    const { container } = wrap(<RunExperimentPanel panel={null} slug="p" runId="r1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
