/**
 * C006: re-importing a file into a draft. Review shows how many records match items already in the draft,
 * Skip is the default, the choice goes to the server as `on_existing`, and the toast names each count.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { ToastProvider } from '@/ui';
import type { BulkSummary, Dataset, DatasetVersion } from '@/api/datasets';

const api = vi.hoisted(() => ({ bulkItems: vi.fn(), previewBulkItems: vi.fn() }));
vi.mock('@/api/datasets', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  bulkItems: api.bulkItems,
  previewBulkItems: api.previewBulkItems,
}));
// jsdom's File has no arrayBuffer(): read it with FileReader and parse inline, as the no-Worker fallback does.
vi.mock('../../lib/parseClient', async () => {
  const { parseUpload } = await import('../../lib/parse.worker');
  const bytes = (f: File) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(f);
    });
  return {
    parseFile: async (f: File, encoding?: string) =>
      parseUpload({ bytes: await bytes(f), fileName: f.name, encoding }),
  };
});

import { UploadWizard } from '../UploadWizard';

const dataset = { id: 'd1', name: 'Support FAQ', slug: 'support-faq' } as Dataset;
const draft = { id: 'v1', version: 'v1', status: 'draft' } as DatasetVersion;
const FAQ = [1, 2, 3, 4].map((n) => ({ item_id: `faq-10${n}`, input: `q${n}`, expected_output: `a${n}` }));
const jsonl = FAQ.map((r) => JSON.stringify(r)).join('\n');

function summary(over: Partial<BulkSummary>): BulkSummary {
  return { created: 0, updated: 0, skipped: 0, deleted: 0, ...over };
}

async function openReview(file = jsonl) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <UploadWizard
          open
          onOpenChange={() => {}}
          slug="proj"
          mode="add-to-draft"
          target={dataset}
          draft={draft}
          onDone={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  const input = document.querySelector<HTMLInputElement>('#wizard-file');
  if (!input) throw new Error('no file input');
  await user.upload(input, new File([file], 'faq-import-fixed.jsonl', { type: 'text/plain' }));
  await screen.findByText(/Detected format:/);
  await user.click(screen.getByTestId('wizard-next'));
  await screen.findByText(/preview shows first/);
  return user;
}

beforeEach(() => {
  api.bulkItems.mockReset();
  api.previewBulkItems.mockReset();
});

describe('UploadWizard re-import into a draft (C006)', () => {
  it('counts the matching records before Review and skips them by default', async () => {
    api.previewBulkItems.mockResolvedValue({ dry_run: true, matched: 4, summary: summary({ skipped: 4 }) });
    api.bulkItems.mockResolvedValue({
      summary: summary({ skipped: 4 }),
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
    });
    const user = await openReview();

    // The dry run sends the ids only, and asks for the skip counts.
    expect(api.previewBulkItems).toHaveBeenCalledTimes(1);
    const [slug, ref, version, body] = api.previewBulkItems.mock.calls[0]!;
    expect([slug, ref, version]).toEqual(['proj', 'support-faq', 'v1']);
    expect(body).toEqual({ upserts: FAQ.map((r) => ({ item_id: r.item_id })), on_existing: 'skip' });

    expect(screen.getByText('4 of 4 records match items already in v1.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Skip matching items/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Replace matching items/ })).not.toBeChecked();

    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(api.bulkItems).toHaveBeenCalledTimes(1));
    expect(api.bulkItems.mock.calls[0]![3]).toEqual({ upserts: FAQ, on_existing: 'skip' });
    expect(await screen.findByText('0 added, 4 skipped')).toBeInTheDocument();
  });

  it('sends replace when the user chooses it and reports the replaced count', async () => {
    api.previewBulkItems.mockResolvedValue({
      dry_run: true,
      matched: 3,
      summary: summary({ created: 1, skipped: 3 }),
    });
    api.bulkItems.mockResolvedValue({
      summary: summary({ created: 1, updated: 3 }),
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
    });
    const user = await openReview();
    expect(screen.getByText('3 of 4 records match items already in v1.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Replace matching items/ }));
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(api.bulkItems).toHaveBeenCalledTimes(1));
    expect(api.bulkItems.mock.calls[0]![3]).toMatchObject({ on_existing: 'replace' });
    expect(await screen.findByText('1 added, 3 replaced')).toBeInTheDocument();
  });

  it('shows no choice when no record matches, and the toast keeps "N items added"', async () => {
    api.previewBulkItems.mockResolvedValue({ dry_run: true, matched: 0, summary: summary({ created: 4 }) });
    api.bulkItems.mockResolvedValue({
      summary: summary({ created: 4 }),
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
    });
    const user = await openReview();
    expect(screen.queryByTestId('wizard-matches')).toBeNull();
    await user.click(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('4 items added')).toBeInTheDocument();
  });

  it('does not run the check for records without ids', async () => {
    api.bulkItems.mockResolvedValue({
      summary: summary({ created: 2 }),
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
    });
    await openReview('{"input": "q1"}\n{"input": "q2"}');
    expect(api.previewBulkItems).not.toHaveBeenCalled();
    expect(screen.queryByTestId('wizard-matches')).toBeNull();
  });

  it('keeps Skip as the default when the check fails, and says so', async () => {
    api.previewBulkItems.mockRejectedValue(new ApiError(500, 'boom'));
    api.bulkItems.mockResolvedValue({
      summary: summary({ skipped: 4 }),
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
    });
    const user = await openReview();
    expect(screen.getByTestId('wizard-matches')).toHaveTextContent(
      /Could not check which records match items already in v1 .*Matching items are skipped unless you choose Replace\./,
    );
    expect(screen.getByRole('radio', { name: /Skip matching items/ })).toBeChecked();
    await user.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(api.bulkItems).toHaveBeenCalledTimes(1));
    expect(api.bulkItems.mock.calls[0]![3]).toMatchObject({ on_existing: 'skip' });
  });
});
