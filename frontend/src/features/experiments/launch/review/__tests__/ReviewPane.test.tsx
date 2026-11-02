import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchTestProvider } from '../../LaunchContext';
import { addDataset, createDocument, setEntryRefs, setRunShape, setTask, type LaunchDocument } from '../../model';
import { makeEnv } from '../../model/__fixtures__/fixtures';
import { envRecord, installFakePlatform, newClient, Providers } from '../../__tests__/helpers';
import { ReviewPane } from '../ReviewPane';

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

function mount(doc: LaunchDocument, maxJobs: number | null = null) {
  installFakePlatform([production, staging]);
  const envs = [
    makeEnv('p', 'production', { capabilities: { datasets: true, task: true } }),
    makeEnv('s', 'staging', { capabilities: { datasets: false, task: false } }),
  ];
  return render(
    <MemoryRouter>
      <Providers client={newClient()}>
        <LaunchTestProvider
          doc={doc}
          envs={envs}
          datasetNames={['support-tickets', 'billing-faq']}
          preview={maxJobs ? { data: { dry_run: true, ok: true, errors: [], max_jobs: maxJobs } } : undefined}
          overrides={{ selectedEnvs: [production, staging], envRecords: [production, staging] }}
        >
          <ReviewPane onCancel={() => undefined} />
        </LaunchTestProvider>
      </Providers>
    </MemoryRouter>,
  );
}

describe('ReviewPane with several dataset versions', () => {
  it('QD-42 a single dataset reads as before', () => {
    mount(createDocument({ environmentIds: ['p', 's'], name: 'x', dataset: { mode: 'project', name: 'support-tickets', ref: '', custom: '' } }));
    expect(document.body).toHaveTextContent(/Environments\s*production, staging/);
    expect(screen.queryByTestId('review-env-lines')).toBeNull();
    expect(screen.queryByTestId('review-datasets')).toBeNull();
    expect(screen.queryByText('Run shape')).toBeNull();
  });

  it('QD-40/QD-41 per-environment lines, dataset lines and the run shape', () => {
    mount(setTask(four(), 'p', 'answer-ticket'));
    const lines = within(screen.getByTestId('review-env-lines')).getAllByRole('listitem');
    expect(lines.map((l) => l.textContent)).toEqual([
      'production1 combined run of 4 dataset versions · task answer-ticket',
      'staging4 runs, one per dataset version (older Evaluation Service) · Worker default task',
    ]);
    const datasets = within(screen.getByTestId('review-datasets')).getAllByRole('listitem');
    expect(datasets.map((l) => l.textContent)).toEqual(['support-tickets v3, v4', 'billing-faq v1, v2']);
    expect(screen.getByText('Run shape')).toBeInTheDocument();
    expect(screen.getByText('Combine into one run')).toBeInTheDocument();
    expect(screen.getByText('Datasets')).toBeInTheDocument();
  });

  it('QD-43 the runs count and the maths follow the real job count', () => {
    const { unmount } = mount(four());
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs');
    unmount();
    mount(setRunShape(four(), 'one_each'));
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('1 combination × (2 environments × 4 dataset versions) = 8 runs');
  });

  it('QD-44 over the cap the callout points at Combine into one run', () => {
    mount(setRunShape(four(), 'one_each'), 6);
    expect(screen.getAllByText('Over the run limit').length).toBeGreaterThan(0);
    expect(document.body).toHaveTextContent('choose “Combine into one run”');
  });
});
