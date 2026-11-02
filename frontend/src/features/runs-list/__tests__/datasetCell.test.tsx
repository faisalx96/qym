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

  it('keeps today’s dataset tag for a single dataset', () => {
    render(<DatasetCell row={row({ dataset_count: 1 })} />);
    expect(screen.queryByTestId('dataset-count-tag')).toBeNull();
    expect(screen.getByText('support-tickets')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });
});
