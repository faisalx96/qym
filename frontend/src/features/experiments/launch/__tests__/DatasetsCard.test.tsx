import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetsCard, pairCountText } from '../entry/DatasetsCard';
import { addDataset, createDocument, datasetPairs, setEntryRefs, type LaunchDocument } from '../model';
import { live, makeEnv, renderSection } from './sectionTestKit';

/** The Datasets card: one Select while nothing is chosen, then a box per dataset (QD-1 to QD-13). */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const VERSIONS: Record<string, string[]> = {
  'support-tickets': ['v4', 'v3', 'v2', 'v1'],
  'billing-faq': ['v2', 'v1'],
  'refund-cases': ['v1'],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const match = /\/v1\/datasets\/([^/]+)\/versions/.exec(String(input));
      if (!match) return new Response('{}', { status: 404 });
      const name = decodeURIComponent(match[1]!);
      return json({
        versions: (VERSIONS[name] ?? []).map((version, i) => ({
          version,
          status: version === 'v4' && name === 'support-tickets' ? 'draft' : 'published',
          aliases: i === 1 ? ['production'] : [],
        })),
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const names = Object.keys(VERSIONS);
const datasets = names.map((name) => ({
  id: name,
  name,
  slug: name,
  private_test_set: name === 'refund-cases',
  access_mode: name === 'billing-faq' ? 'restricted' : 'project',
}));

function render(doc: LaunchDocument) {
  return renderSection(<DatasetsCard />, {
    envs: [makeEnv('e', 'staging')],
    doc,
    overrides: { datasets, datasetNames: names },
  });
}
const empty = () => createDocument({ environmentIds: ['e'] });
const current = () => live.current!.doc;
const box = (name: string) => document.querySelector(`[data-dataset-box="${name}"]`) as HTMLElement;
const count = () => screen.getByTestId('pair-count').textContent;

describe('DatasetsCard', () => {
  it('QD-1/QD-9 starts as today single Select and one dataset costs two clicks', async () => {
    render(empty());
    expect(screen.queryByTestId('datasets-fieldset')).toBeNull();
    expect(screen.queryByTestId('run-shape')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Dataset/ }));
    await userEvent.click(await screen.findByRole('option', { name: /support-tickets/ }));
    // QD-2: the Select is replaced by the fieldset with one box, on Latest, without a run shape.
    const fieldset = await screen.findByTestId('datasets-fieldset');
    expect(within(fieldset).getByText('Datasets', { selector: 'legend' })).toBeInTheDocument();
    expect(fieldset.querySelectorAll('li[data-dataset-box]')).toHaveLength(1);
    expect(screen.queryByTestId('run-shape')).toBeNull();
    expect(current().dataset).toMatchObject({ name: 'support-tickets', ref: '' });
    expect(count()).toBe('1 dataset version');
  });

  it('QD-3/QD-4 a box names its versions trigger and shows the chosen references as tags', async () => {
    render(setEntryRefs(addDataset(empty(), 'support-tickets'), 'support-tickets', ['v:v3', 'v:v4']));
    const b = box('support-tickets');
    const trigger = within(b).getByRole('button', { name: /^Versions.* of support-tickets$/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveTextContent('Versions');
    expect(trigger).toHaveTextContent('· 2');
    expect(within(b).getByText('v3')).toBeInTheDocument();
    expect(within(b).getByText('v4')).toBeInTheDocument();
    expect(within(b).getByRole('button', { name: 'Remove support-tickets' })).toBeInTheDocument();
  });

  it('QD-5/QD-6 ticking a version updates the tags and the count at once; QD-7 the last one snaps back to Latest', async () => {
    render(addDataset(empty(), 'support-tickets'));
    const b = box('support-tickets');
    await userEvent.click(within(b).getByRole('button', { name: /^Versions.* of support-tickets$/ }));
    const panel = await screen.findByRole('dialog');
    // Latest first, then versions newest first (a draft is tagged), then aliases.
    const labels = within(panel).getAllByRole('checkbox').map((c) => c.closest('label')?.textContent ?? '');
    expect(labels[0]).toBe('Latest version');
    expect(labels.slice(1, 5).map((l) => l.replace(/draft$/, '').trim())).toEqual([
      'Version v4',
      'Version v3',
      'Version v2',
      'Version v1',
    ]);
    expect(labels[1]).toMatch(/draft$/);
    expect(labels.at(-1)).toBe('Alias production');
    await userEvent.click(within(panel).getByRole('checkbox', { name: /Version v3/ }));
    await waitFor(() => expect(count()).toBe('2 dataset versions from 1 dataset'));
    expect(datasetPairs(current()).map((p) => p.version)).toEqual([null, 'v3']);
    // Untick Latest and v3: the dataset keeps one reference, Latest.
    await userEvent.click(within(panel).getByRole('checkbox', { name: /Latest version/ }));
    await userEvent.click(within(panel).getByRole('checkbox', { name: /Version v3/ }));
    expect(datasetPairs(current()).map((p) => p.version)).toEqual([null]);
    expect(count()).toBe('1 dataset version: Latest version');
  });

  it('QD-8 removing the last dataset returns to the single Select', async () => {
    render(addDataset(empty(), 'support-tickets'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove support-tickets' }));
    expect(screen.queryByTestId('datasets-fieldset')).toBeNull();
    expect(screen.getByRole('button', { name: /Dataset/ })).toBeInTheDocument();
    expect(current().dataset.name).toBe('');
  });

  it('QD-11 Add another dataset lists the project datasets that are not chosen yet', async () => {
    render(addDataset(empty(), 'support-tickets'));
    await userEvent.click(screen.getByRole('button', { name: 'Add another dataset' }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items.join('|')).toContain('Restricted');
    expect(items.join('|')).toContain('Private test set');
    expect(items.join('|')).not.toContain('support-tickets');
    await userEvent.click(screen.getAllByRole('menuitem')[0]!);
    await waitFor(() => expect(count()).toBe('2 dataset versions from 2 datasets'));
  });

  it('QD-11 with every dataset chosen the button is disabled', () => {
    let doc = empty();
    for (const n of names) doc = addDataset(doc, n);
    render(doc);
    expect(screen.getByRole('button', { name: 'Add another dataset' })).toBeDisabled();
  });

  it('QD-12/QD-13 the run shape appears from two dataset versions and its help follows the choice', async () => {
    let doc = addDataset(empty(), 'support-tickets');
    doc = addDataset(doc, 'billing-faq');
    render(doc);
    const shape = screen.getByTestId('run-shape');
    const group = within(shape).getByRole('radiogroup', { name: 'Run shape' });
    expect(within(group).getByRole('radio', { name: 'Combine into one run' })).toBeChecked();
    expect(shape).toHaveTextContent(
      'One run over the 2 dataset versions together. Every item records its dataset and version, and scores break down per dataset.',
    );
    await userEvent.click(within(group).getByRole('radio', { name: 'One run each' }));
    expect(shape).toHaveTextContent('2 runs per environment, one per dataset version, grouped under this experiment.');
    expect(current().selection.runShape).toBe('one_each');
  });

  it('QD-15 chips and the token help line, per dataset box', () => {
    let doc = addDataset(empty(), 'billing-faq');
    doc = addDataset(doc, 'refund-cases');
    render(doc);
    expect(within(box('billing-faq')).getByTestId('dataset-chip')).toHaveTextContent('Restricted');
    expect(within(box('refund-cases')).getByTestId('dataset-chip')).toHaveTextContent('Private test set');
    expect(screen.getAllByTestId('dataset-token-help')).toHaveLength(1);
  });

  it('QD-6 the count text', () => {
    expect(pairCountText(1, 1)).toBe('1 dataset version');
    expect(pairCountText(2, 2)).toBe('2 dataset versions from 2 datasets');
    expect(pairCountText(4, 2)).toBe('4 dataset versions from 2 datasets');
  });

  it('QD-17 Tab order inside a box: Versions, Remove, then Add another dataset', async () => {
    render(addDataset(empty(), 'support-tickets'));
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('Versions · 1 of support-tickets');
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('Remove support-tickets');
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('Add another dataset');
    void act;
    void fireEvent;
  });
});
