import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatasetPicker } from '../entry/DatasetPicker';
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

describe('DatasetPicker badges', () => {
  it('badges a restricted dataset and explains the token', () => {
    renderSection(<DatasetPicker />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('golden'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.getByTestId('dataset-chip').textContent).toBe('Restricted');
    expect(screen.getByTestId('dataset-token-help').textContent).toBe(DATASET_HELP_RESTRICTED);
  });

  it('badges a private test set', () => {
    renderSection(<DatasetPicker />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('support-eval'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.getByTestId('dataset-chip').textContent).toBe('Private test set');
    expect(screen.getByTestId('dataset-token-help').textContent).toBe(DATASET_HELP_PRIVATE);
  });

  it('shows nothing extra for a plain dataset and gates nothing', () => {
    renderSection(<DatasetPicker />, {
      envs: [makeEnv('e', 'staging')],
      doc: doc('intake-v2'),
      overrides: { datasets, datasetNames: datasets.map((d) => d.name) },
    });
    expect(screen.queryByTestId('dataset-chip')).toBeNull();
    expect(screen.queryByTestId('dataset-token-help')).toBeNull();
    const trigger = screen.getAllByRole('button', { name: /Dataset/ })[0] as HTMLElement;
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    for (const option of screen.getAllByRole('option')) expect(option.getAttribute('aria-disabled')).not.toBe('true');
  });
});
