/** Multi-dataset round, QC-U31 / QC-U32: the Dataset cell of a union run and of a single-dataset run. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunRow } from '@/api/dashboardTypes';
import { DatasetCell } from '../cells';

const row = (over: Partial<RunRow>) =>
  ({
    dataset_name: 'support-tickets',
    dataset_version: 'v3',
    dataset_aliases: ['production'],
    ...over,
  }) as RunRow;

describe('DatasetCell', () => {
  it('shows a count tag titled with every dataset for a union run', () => {
    render(
      <DatasetCell
        row={row({
          dataset_count: 3,
          datasets: [
            { dataset: 'support-tickets', version: 'v3' },
            { dataset: 'support-tickets', version: 'v4' },
            { dataset: 'billing-faq', version: 'v7' },
          ],
        })}
      />,
    );
    const tag = screen.getByTestId('dataset-count-tag');
    expect(tag).toHaveTextContent('3 datasets');
    expect(tag).toHaveAttribute('title', 'support-tickets v3 · support-tickets v4 · billing-faq v7');
  });

  it('writes a single dataset as name, divider, version and the Production flag (cv4 B1)', () => {
    render(<DatasetCell row={row({ dataset_count: 1, dataset_aliases: ['production', 'staging'] })} />);
    expect(screen.queryByTestId('dataset-count-tag')).toBeNull();
    const tag = screen.getByTestId('dataset-version-tag');
    expect(screen.getByText('support-tickets')).toBeInTheDocument();
    expect(tag.querySelector('[data-part="version"]')).toHaveTextContent('v3');
    expect(tag.querySelector('[data-part="alias"]')).toHaveTextContent('staging');
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.queryByText('production')).toBeNull();
  });

  it('shows no Production flag for a version that is not the production version', () => {
    render(<DatasetCell row={row({ dataset_count: 1, dataset_version: '2', dataset_aliases: ['previous'] })} />);
    expect(screen.getByTestId('dataset-version-tag').querySelector('[data-part="version"]')).toHaveTextContent('v2');
    expect(screen.queryByText('Production')).toBeNull();
  });

  it('shows the name alone for a run with no dataset version', () => {
    render(<DatasetCell row={row({ dataset_count: 1, dataset_version: null, dataset_aliases: [] })} />);
    expect(screen.getByTestId('dataset-version-tag').querySelector('[data-part]')).toBeNull();
  });
});
