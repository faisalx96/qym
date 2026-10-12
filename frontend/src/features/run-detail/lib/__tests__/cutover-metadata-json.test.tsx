/**
 * Cutover of test_run_metadata_json_browser.py: run metadata that holds JSON opens in the shared JSON
 * viewer (objects, arrays and strings holding JSON show a compact preview; clicking it opens a
 * collapsible tree with expand / collapse all and copy; scalars keep their plain text).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JsonPreview } from '@/ui';
import { executionContextEntries } from '../heroModel';
import type { Run } from '../../types';

const METADATA = {
  prompt_version: 'v7',
  retrieval: { top_k: 5, rerank: true, filters: { lang: ['ar', 'en'], since: null }, index: 'docs-2026' },
  tags: ['nightly', 'baseline'],
  pipeline_json: JSON.stringify({ stages: [{ name: 'plan' }, { name: 'act' }] }),
  not_json: '{broken',
  empty_obj: {},
};

describe('run metadata in the hero', () => {
  const entries = executionContextEntries({ metadata: METADATA, config: {} } as unknown as Run);
  const byKey = (key: string) => entries.find((e) => e.key === key)!;

  it('flags objects, arrays and JSON strings for the viewer; scalars and invalid JSON stay plain text', () => {
    expect(entries.filter((e) => e.json).map((e) => e.key)).toEqual([
      'retrieval',
      'tags',
      'pipeline_json',
      'empty_obj',
    ]);
    expect(byKey('prompt_version').json).toBe(false);
    expect(byKey('prompt_version').value).toBe('v7');
    expect(byKey('not_json').json).toBe(false);
    expect(byKey('not_json').value).toBe('{broken');
  });

  it('the preview says how many keys or items, and opens a tree dialog', async () => {
    const user = userEvent.setup();
    render(<JsonPreview value={byKey('retrieval').raw} title="Retrieval" compact />);
    const preview = screen.getByRole('button', { name: 'View Retrieval as JSON (4 keys)' });
    expect(preview).toHaveTextContent('4 keys');
    render(<JsonPreview value={byKey('tags').raw} title="Tags" compact />);
    expect(screen.getByRole('button', { name: 'View Tags as JSON (2 items)' })).toHaveTextContent('2 items');
    await user.click(preview);
    const dialog = await screen.findByRole('dialog', { name: 'Retrieval' });
    const tree = within(dialog).getByRole('tree', { name: 'Retrieval' });
    // syntax roles
    expect(within(tree).getByText(/top_k/)).toBeInTheDocument();
    expect(within(tree).getByText('5')).toBeInTheDocument();
    expect(within(tree).getByText('true')).toBeInTheDocument();
    expect(within(tree).getByText('"docs-2026"')).toBeInTheDocument();
    // two levels open by default: filters is open, its list "lang" is collapsed and lazy
    const filters = within(tree).getByRole('button', { name: 'filters' }).closest('[role=treeitem]')!;
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    const lang = within(filters as HTMLElement)
      .getByRole('button', { name: 'lang' })
      .closest('[role=treeitem]')!;
    expect(lang).toHaveAttribute('aria-expanded', 'false');
    expect(within(lang as HTMLElement).queryByText('"ar"')).toBeNull();
    await user.click(within(lang as HTMLElement).getByRole('button', { name: 'lang' }));
    expect(within(lang as HTMLElement).getByText('"ar"')).toBeInTheDocument();
    expect(within(filters as HTMLElement).getByText('null')).toBeInTheDocument();
    // collapse all keeps the root open but folds every child; expand all opens them
    await user.click(within(dialog).getByRole('button', { name: 'Collapse all' }));
    const folded = within(dialog).getByRole('tree', { name: 'Retrieval' });
    expect(
      within(folded).getByRole('button', { name: 'filters' }).closest('[role=treeitem]'),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(dialog).getByRole('button', { name: 'Expand all' }));
    expect(within(dialog).getByRole('tree', { name: 'Retrieval' })).toHaveTextContent('"en"');
  });

  it('copies the JSON of the value', async () => {
    const user = userEvent.setup();
    // jsdom is not a secure context: copying falls back to a textarea and execCommand('copy')
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = (document.body.lastElementChild as HTMLTextAreaElement).value;
      return true;
    });
    render(<JsonPreview value={byKey('retrieval').raw} title="Retrieval" compact />);
    await user.click(screen.getByRole('button', { name: /View Retrieval/ }));
    await user.click(await screen.findByRole('button', { name: 'Copy JSON' }));
    expect(JSON.parse(copied)).toEqual(METADATA.retrieval);
  });

  it('a string holding JSON opens parsed', async () => {
    const user = userEvent.setup();
    render(<JsonPreview value={METADATA.pipeline_json} title="Pipeline Json" compact />);
    await user.click(screen.getByRole('button', { name: /View Pipeline Json/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Pipeline Json' });
    await user.click(within(dialog).getByRole('button', { name: 'Expand all' }));
    expect(within(dialog).getByText('"plan"')).toBeInTheDocument();
  });
});
