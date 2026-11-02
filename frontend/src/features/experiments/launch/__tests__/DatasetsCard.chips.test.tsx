import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatasetsCard } from '../entry/DatasetsCard';
import { createDocument } from '../model';
import { DATASET_HELP_PRIVATE, DATASET_HELP_RESTRICTED } from '../copy';
import { makeEnv, renderSection } from './sectionTestKit';

const datasets = [
  { id: '1', name: 'golden', slug: 'golden', private_test_set: false, access_mode: 'restricted' },
  { id: '2', name: 'support-eval', slug: 'support-eval', private_test_set: true, access_mode: 'project' },
  { id: '3', name: 'intake-v2', slug: 'intake-v2', private_test_set: false, access_mode: 'project' },
];

function doc(name: string) {
  return createDocument({
    environmentIds: ['e'],
    dataset: { mode: 'project', name, ref: '', custom: '' },
  });
}

describe('DatasetsCard badges', () => {
  it('badges a restricted dataset and explains the token', () => {
    renderSection(<DatasetsCard />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('golden'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.getByTestId('dataset-chip').textContent).toBe('Restricted');
    expect(screen.getByTestId('dataset-token-help').textContent).toBe(DATASET_HELP_RESTRICTED);
  });

  it('badges a private test set', () => {
    renderSection(<DatasetsCard />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('support-eval'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.getByTestId('dataset-chip').textContent).toBe('Private test set');
    expect(screen.getByTestId('dataset-token-help').textContent).toBe(DATASET_HELP_PRIVATE);
  });

  it('lists every dataset in the single Select while none is chosen (QD-1)', () => {
    renderSection(<DatasetsCard />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc(''),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.queryByTestId('datasets-fieldset')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Dataset/ })[0] as HTMLElement);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    for (const option of screen.getAllByRole('option')) expect(option.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows nothing extra for a plain dataset and gates nothing', () => {
    renderSection(<DatasetsCard />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('intake-v2'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.queryByTestId('dataset-chip')).toBeNull();
    expect(screen.queryByTestId('dataset-token-help')).toBeNull();
    // The add menu offers every other dataset of the project, none of them gated (QD-11).
    fireEvent.click(screen.getByRole('button', { name: 'Add another dataset' }));
    const items = screen.getAllByRole('menuitem');
    const text = items.map((i) => i.textContent ?? '').join('|');
    expect(text).toContain('golden');
    expect(text).toContain('support-eval');
    expect(text).not.toContain('intake-v2');
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.getAttribute('aria-disabled')).not.toBe('true');
  });
});
