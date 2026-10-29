import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchTestProvider } from '../../LaunchContext';
import {
  addDataset,
  createDocument,
  setEntryRefs,
  setJobPriority,
  setRunShape,
  setTask,
  type DryRunJob,
  type DryRunResponse,
  type LaunchDocument,
} from '../../model';
import { makeEnv } from '../../model/__fixtures__/fixtures';
import { envRecord, installFakePlatform, newClient, Providers } from '../../__tests__/helpers';
import { live } from '../../__tests__/sectionTestKit';
import { ReviewStep, visibleColumns } from '../ReviewStep';

afterEach(() => vi.unstubAllGlobals());

const production = envRecord({ id: 'p', name: 'production', evaluator_capabilities: { datasets: true, task: true } });
const staging = envRecord({ id: 's', name: 'staging', evaluator_capabilities: { datasets: false, task: false } });

function four(): LaunchDocument {
  let doc = createDocument({ environmentIds: ['p', 's'], name: 'x' });
  doc = addDataset(doc, 'support-tickets');
  doc = setEntryRefs(doc, 'support-tickets', ['v:v3', 'v:v4']);
  doc = addDataset(doc, 'billing-faq');
  return setEntryRefs(doc, 'billing-faq', ['v:v1', 'v:v2']);
}

const sweepJobs = (): DryRunJob[] =>
  ['p', 's'].flatMap((env) =>
    [10, 30, 60].map((t, i) => ({
      environment_id: env,
      environment_name: env === 'p' ? 'production' : 'staging',
      combo_index: i,
      dataset_index: 0,
      label: `timeout ${t}`,
      dataset: { dataset: 'support-tickets', version: 'v3' },
      task: { id: 'answer-ticket', name: 'Answer ticket' },
    })),
  );

function preview(jobs: DryRunJob[], extra: Partial<DryRunResponse> = {}) {
  return { data: { dry_run: true, ok: true, errors: [], job_count: jobs.length, jobs, priority: 'NORMAL', ...extra } as DryRunResponse };
}

function mount(doc: LaunchDocument, jobs: DryRunJob[] = [], options: { manager?: boolean; extra?: Partial<DryRunResponse>; stagingCap?: 'NORMAL' | 'HIGH' } = {}) {
  installFakePlatform([production, staging]);
  const envs = [
    makeEnv('p', 'production', { capabilities: { datasets: true, task: true }, maxPriority: 'HIGH' }),
    makeEnv('s', 'staging', { capabilities: { datasets: false, task: false }, maxPriority: options.stagingCap ?? 'NORMAL' }),
  ];
  return render(
    <MemoryRouter>
      <Providers client={newClient()}>
        <LaunchTestProvider
          doc={doc}
          envs={envs}
          canManage={options.manager ?? true}
          datasetNames={['support-tickets', 'billing-faq']}
          preview={preview(jobs, options.extra)}
          overrides={{ selectedEnvs: [production, staging], envRecords: [production, staging] }}
        >
          <ReviewStep />
          <Probe />
        </LaunchTestProvider>
      </Providers>
    </MemoryRouter>,
  );
}

import { useEffect } from 'react';
import { useLaunch } from '../../LaunchContext';
function Probe() {
  const value = useLaunch();
  live.current = value; // eslint-disable-line react-hooks/immutability -- test probe
  useEffect(() => {
    live.current = value;
  });
  return null;
}

describe('ReviewStep (round 9, points 4-6)', () => {
  it('C-5-1 Summary rows: label column then value, the task by name', () => {
    mount(setTask(setRunShape(four(), 'combined'), 'answer-ticket'));
    const summary = screen.getByRole('region', { name: 'Summary' });
    const rows = Array.from(summary.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(expect.arrayContaining(['name', 'base', 'task', 'env', 'ds', 'shape', 'prio']));
    expect(within(summary).getByText('production, staging')).toBeInTheDocument();
    expect(summary.querySelector('[data-row=task] dd')).toHaveTextContent('answer-ticket');
    expect(summary.querySelector('[data-row=shape] dd')).toHaveTextContent('Combine into one run');
  });

  it('C-5-3 / C-5-4 one row per run and only the columns that vary', () => {
    const jobs = sweepJobs();
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), jobs);
    const table = screen.getByRole('grid', { name: 'Runs to launch' });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(Array.from(table.querySelectorAll('th')).map((h) => h.textContent)).toEqual(['#', 'Environment', 'Swept setting', 'Priority']);
    expect(visibleColumns([])).toEqual([]);
  });

  it('C-5-5 the run count is a mono 18px figure next to "runs to launch"', () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs());
    expect(document.querySelector('[data-part=run-count]')).toHaveTextContent('6');
  });

  it('C-6-1 / C-6-2 one select per run with Low, Normal, High; nothing marked changed on load', async () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs());
    const selects = screen.getAllByRole('button', { name: /Priority of run/ });
    expect(selects).toHaveLength(6);
    expect(document.querySelectorAll('[data-part=run-changed]')).toHaveLength(0);
    await userEvent.click(selects[0]!);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      expect.stringContaining('Low'),
      expect.stringContaining('Normal'),
      expect.stringContaining('High'),
    ]);
  });

  it('C-6-3 choosing High on run 1 marks only run 1 and asks for the acknowledgement', async () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs());
    expect(document.querySelector('[data-part=review-ack]')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /Priority of run 1/ })[0]!);
    await userEvent.click(await screen.findByRole('option', { name: /High/ }));
    expect(live.current!.doc.jobPriorities).toEqual({ 'p:0:0': 'HIGH' });
    expect(document.querySelectorAll('[data-part=run-changed]')).toHaveLength(1);
    const ack = document.querySelector('[data-part=review-ack]') as HTMLElement;
    expect(ack).toHaveTextContent('1 run is High.');
    expect(within(ack).getByRole('checkbox')).not.toBeChecked();
    await userEvent.click(within(ack).getByRole('checkbox'));
    expect(live.current!.preemptionAck).toBe(true);
  });

  it('C-6-4 a non-manager cannot choose High', async () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs(), { manager: false });
    await userEvent.click(screen.getAllByRole('button', { name: /Priority of run 1/ })[0]!);
    const high = await screen.findByRole('option', { name: /High/ });
    expect(high).toHaveAttribute('aria-disabled', 'true');
    expect(high).toHaveTextContent('Only project managers');
  });

  it('C-6-5 an environment capped at Normal cannot take High, one capped at High can', async () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs());
    await userEvent.click(screen.getAllByRole('button', { name: /Priority of run 4/ })[0]!);
    const high = await screen.findByRole('option', { name: /High/ });
    expect(high).toHaveAttribute('aria-disabled', 'true');
    expect(high).toHaveTextContent('Capped at Normal on staging');
  });

  it('C-6-6 the acknowledgement names the High runs’ environments and is absent without High runs', () => {
    const doc = setJobPriority(createDocument({ environmentIds: ['p', 's'], name: 'x' }), 'p:1:0', 'HIGH', 'NORMAL');
    mount(doc, sweepJobs(), { extra: { preemption_warning: 'Launching at HIGH cancels every running LOW/NORMAL job on production for all users.' } });
    expect(document.querySelector('[data-part=review-ack]')).toHaveTextContent('on production');
    expect(document.querySelector('[data-part=review-ack]')).not.toHaveTextContent('staging');
  });

  it('C-6-7 "Set every run to" changes all rows and Reset appears when any row differs', async () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x' }), sweepJobs());
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    await userEvent.click(within(document.querySelector('[data-part=review-priority-all]') as HTMLElement).getByRole('button'));
    await userEvent.click(await screen.findByRole('option', { name: /Low/ }));
    expect(Object.keys(live.current!.doc.jobPriorities)).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(live.current!.doc.jobPriorities).toEqual({});
  });

  it('C-6-10 a single run draws no table', () => {
    mount(createDocument({ environmentIds: ['p'], name: 'x' }), sweepJobs().slice(0, 1));
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('button', { name: /Priority of run/ })).toBeNull();
    expect(screen.queryByText('Set every run to')).toBeNull();
  });

  it('C-5-7 Changes and Checks are cards; Checks lists the problems', () => {
    mount(setRunShape(four(), 'one_each'), sweepJobs());
    expect(screen.getByRole('region', { name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Checks' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Runs to launch' })).toBeInTheDocument();
  });
});
