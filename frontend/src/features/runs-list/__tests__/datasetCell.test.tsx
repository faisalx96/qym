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

  const versionOf = () => screen.getByTestId('dataset-version-tag').querySelector('[data-part="version"]');

  it('writes a single dataset as name, divider and version; the production version is green, with no word (cv4 B1)', () => {
    render(
      <DatasetCell
        row={row({
          dataset_count: 1,
          dataset_version_status: 'published',
          dataset_aliases: ['production', 'staging'],
        })}
      />,
    );
    expect(screen.queryByTestId('dataset-count-tag')).toBeNull();
    const tag = screen.getByTestId('dataset-version-tag');
    expect(screen.getByText('support-tickets')).toBeInTheDocument();
    expect(versionOf()).toHaveTextContent('v3');
    expect(versionOf()).toHaveAttribute('data-status', 'production');
    expect(tag.querySelector('[data-part="alias"]')).toHaveTextContent('staging');
    // the status is the version's colour and the tooltip, never a word after the tag
    expect(screen.queryByText('Production')).toBeNull();
    expect(screen.queryByText('production')).toBeNull();
    expect(tag.querySelector('[title]')).toHaveAttribute(
      'title',
      'support-tickets · version v3 · production · aliases: staging',
    );
  });

  it('colours a published version blue and a draft version amber by its status', () => {
    const { unmount } = render(
      <DatasetCell
        row={row({
          dataset_count: 1,
          dataset_version: '2',
          dataset_version_status: 'published',
          dataset_aliases: ['previous'],
        })}
      />,
    );
    expect(versionOf()).toHaveTextContent('v2');
    expect(versionOf()).toHaveAttribute('data-status', 'published');
    unmount();
    render(
      <DatasetCell
        row={row({
          dataset_count: 1,
          dataset_version: 'v4',
          dataset_version_status: 'draft',
          dataset_aliases: [],
        })}
      />,
    );
    expect(versionOf()).toHaveAttribute('data-status', 'draft');
    expect(screen.getByTestId('dataset-version-tag').querySelector('[title]')).toHaveAttribute(
      'title',
      'support-tickets · version v4 · draft',
    );
  });

  it('keeps the version neutral when the payload has no status', () => {
    render(<DatasetCell row={row({ dataset_count: 1, dataset_version: '2', dataset_aliases: [] })} />);
    expect(versionOf()).toHaveAttribute('data-status', 'none');
  });

  it('shows the name alone for a run with no dataset version', () => {
    render(<DatasetCell row={row({ dataset_count: 1, dataset_version: null, dataset_aliases: [] })} />);
    expect(screen.getByTestId('dataset-version-tag').querySelector('[data-part]')).toBeNull();
  });
});
