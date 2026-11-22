/**
 * Factory → Rules: a row opens the rule popup (the facts, the rule, its evidence items), which walks the list and
 * carries the row actions.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FactoryDetailPage } from '../FactoryDetailPage';
import { renderPage, stubFetch } from './factoryFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rule popup', () => {
  it('opens a rule from its row with its evidence, walks the list and approves from the footer', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />);
    await screen.findByText('Amounts in SAR');
    await userEvent.click(screen.getByText('Amounts in SAR'));
    const dialog = await screen.findByTestId('rule-view');
    expect(within(dialog).getByRole('heading', { name: 'Amounts in SAR' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Proposed by the agent from 1 item');
    const facts = within(dialog).getByTestId('rule-view-facts');
    expect(facts).toHaveTextContent('Official');
    expect(facts).toHaveTextContent('General');
    expect(facts).toHaveTextContent('billing');
    expect(within(dialog).getByText('Amounts in SAR rule')).toBeInTheDocument();
    // The evidence items load from the rule route, each with a link to the item.
    const evidence = await within(dialog).findAllByTestId('rule-evidence-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toHaveTextContent('Evidence i1: how do I pay?');
    expect(evidence[0]).toHaveTextContent('Evidence i1: by card.');
    expect(within(evidence[0]!).getByRole('link', { name: /Open the item/ })).toHaveAttribute(
      'href',
      '/projects/demo/datasets/faq?v=v3&item=i1',
    );
    // The official rule's footer offers Take back; the next rule is proposed and hand-written.
    expect(within(dialog).getByTestId('rule-view-revoke')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByTestId('rule-view-next'));
    expect(within(dialog).getByRole('heading', { name: 'Greet back' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Written by hand');
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('rule-view-evidence')).toBeNull();
    await userEvent.click(within(dialog).getByTestId('rule-view-approve'));
    await waitFor(() => {
      const approve = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/factories/f1/rules/r2:approve'));
      expect(approve).toBeTruthy();
    });
    // Edit from the popup opens the editor on that rule.
    await userEvent.click(within(dialog).getByTestId('rule-view-edit'));
    const editor = await screen.findByTestId('rule-dialog');
    expect(within(editor).getByRole('textbox', { name: 'Title' })).toHaveValue('Greet back');
  });
});
