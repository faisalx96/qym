import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BestRunScopePayload } from '@/api/launch';
import { bestRunQuery } from '../../model/bestRun';
import { EMPTY_DRAFT, sameDraft, ScopePrompt } from '../ScopePrompt';

const options: BestRunScopePayload = {
  total_runs: 4,
  datasets: [
    {
      id: 'ds-1',
      name: 'Golden',
      run_count: 3,
      versions: [
        { id: 'dv-3', version: 'v3', run_count: 2 },
        { id: 'dv-1', version: 'v1', run_count: 1 },
      ],
    },
  ],
  versioning: {
    agent_version: [
      { value: 'v2', run_count: 1 },
      { value: 'v1', run_count: 2 },
    ],
    kb_version: [{ value: '381', run_count: 3 }],
  },
};

describe('best-run scope query', () => {
  it('leaving everything on Any asks for the global ranking (only a limit)', () => {
    expect(bestRunQuery({})).toBe('limit=5');
  });
  it('a chosen dataset, version and versioning value narrow the ranking', () => {
    expect(bestRunQuery({ datasetId: 'ds-1', versionId: 'dv-3', versioning: { agent_version: 'v2' } })).toBe(
      'dataset_id=ds-1&dataset_version_id=dv-3&versioning=agent_version%3Dv2&limit=5',
    );
  });
  it('back to any version drops only the version', () => {
    expect(bestRunQuery({ datasetId: 'ds-1', versionId: '', versioning: { agent_version: 'v2' } })).toBe(
      'dataset_id=ds-1&versioning=agent_version%3Dv2&limit=5',
    );
  });
});

describe('ScopePrompt', () => {
  const draft = { datasetId: 'ds-1', versionId: 'dv-3', versioning: { agent_version: 'v2' } };

  it('asks for the scope before anything is retrieved: hint shown, version needs a dataset, one select per versioning key', () => {
    render(
      <ScopePrompt options={options} draft={EMPTY_DRAFT} onDraft={vi.fn()} applied={null} onFind={vi.fn()} />,
    );
    expect(screen.getByText(/Choose a dataset, a version and versioning values/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find best runs' })).toBeEnabled();
    expect(screen.getAllByText(/Any agent version/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Any kb version/i).length).toBeGreaterThan(0);
    // the version select cannot be used before a dataset is chosen
    expect(screen.getByRole('button', { name: /Dataset version/ })).toBeDisabled();
  });

  it('after a Find the button reads "Update best runs" and is off until the scope changes', () => {
    const { rerender } = render(
      <ScopePrompt options={options} draft={draft} onDraft={vi.fn()} applied={draft} onFind={vi.fn()} />,
    );
    const update = screen.getByRole('button', { name: 'Update best runs' });
    expect(update).toBeDisabled();
    expect(screen.queryByText(/Choose a dataset, a version/)).not.toBeInTheDocument();
    rerender(
      <ScopePrompt
        options={options}
        draft={{ ...draft, versionId: '' }}
        onDraft={vi.fn()}
        applied={draft}
        onFind={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Update best runs' })).toBeEnabled();
  });

  it('sameDraft ignores the version when no dataset is chosen', () => {
    expect(sameDraft(null, EMPTY_DRAFT)).toBe(false);
    expect(sameDraft(EMPTY_DRAFT, { ...EMPTY_DRAFT, versionId: 'x' })).toBe(true);
    expect(sameDraft(draft, { ...draft, versioning: {} })).toBe(false);
  });
});
