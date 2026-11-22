import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryJob } from '@/api/factory';
import { FactoryDetailPage } from '../FactoryDetailPage';
import { FactoryListPage } from '../FactoryListPage';
import { parseFactoryRoute, factoryPath } from '../lib/route';
import { parseJsonObject } from '../dialogs';
import { JOB, LIST, detail, renderPage, stubFetch } from './factoryFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('factory routes', () => {
  it('parses the list, the detail, its tab and the open attempt', () => {
    expect(parseFactoryRoute('f1', new URLSearchParams('tab=generation&job=j9'))).toMatchObject({
      mode: 'detail',
      factoryId: 'f1',
      tab: 'generation',
      jobId: 'j9',
    });
    // A job belongs to the Generation tab only.
    expect(parseFactoryRoute('f1', new URLSearchParams('tab=rules&job=j9')).jobId).toBeNull();
    expect(factoryPath('demo', 'f1', 'generation', 'j9')).toBe('/projects/demo/factory/f1?tab=generation&job=j9');
    expect(factoryPath('demo', 'f1', 'rules', 'j9')).toBe('/projects/demo/factory/f1');
    expect(parseFactoryRoute('', new URLSearchParams())).toEqual({
      mode: 'list',
      factoryId: null,
      tab: 'rules',
      jobId: null,
    });
    expect(parseFactoryRoute('f1', new URLSearchParams('tab=access'))).toEqual({
      mode: 'detail',
      factoryId: 'f1',
      tab: 'access',
      jobId: null,
    });
    expect(parseFactoryRoute('f1/extra', new URLSearchParams('tab=nope'))).toEqual({
      mode: 'detail',
      factoryId: 'f1',
      tab: 'rules',
      jobId: null,
    });
    expect(factoryPath('demo', 'f1', 'generation')).toBe('/projects/demo/factory/f1?tab=generation');
    expect(factoryPath('demo')).toBe('/projects/demo/factory');
  });

  it('parses a JSON object or names the problem', () => {
    expect(parseJsonObject('')).toEqual({ value: null, error: null });
    expect(parseJsonObject('{"type": "object"}')).toEqual({ value: { type: 'object' }, error: null });
    expect(parseJsonObject('[1]').error).toMatch(/JSON object/);
    expect(parseJsonObject('{nope').error).toMatch(/not valid JSON/);
  });
});

describe('FactoryListPage', () => {
  it('lists the connected datasets with their counts and grouping', async () => {
    stubFetch();
    renderPage(<FactoryListPage />, {}, '/projects/demo/factory');
    const card = await screen.findByTestId('factory-card');
    expect(within(card).getByRole('heading', { name: 'Faq' })).toBeInTheDocument();
    expect(within(card).getByText('2 rules')).toBeInTheDocument();
    expect(within(card).getByText('1 official')).toBeInTheDocument();
    expect(within(card).getByText('topic')).toBeInTheDocument();
    expect(screen.getByTestId('connect-dataset')).toBeInTheDocument();
    expect(screen.getByText('1 connected dataset')).toBeInTheDocument();
  });

  it('shows the empty state without the action when read-only', async () => {
    stubFetch({ list: { ...LIST, factories: [], connected_dataset_ids: [] } });
    renderPage(<FactoryListPage />, { readOnly: true }, '/projects/demo/factory');
    expect(await screen.findByText('No dataset is connected yet')).toBeInTheDocument();
    expect(screen.queryByTestId('connect-dataset')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect dataset' })).toBeNull();
  });
});

describe('FactoryDetailPage', () => {
  it('shows the rules with their status and approves a proposed one', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />);
    expect(await screen.findByRole('heading', { name: 'Faq' })).toBeInTheDocument();
    expect(screen.getByText('Connected dataset · v3 · 120 items')).toBeInTheDocument();
    await screen.findByText('Amounts in SAR');
    expect(screen.getByText('Greet back')).toBeInTheDocument();
    expect(screen.getAllByText('Official')).not.toHaveLength(0);
    expect(screen.getAllByText('Proposed')).not.toHaveLength(0);
    // The official rule offers "take back", the proposed one "make official".
    expect(screen.getByTestId('rule-revoke')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('rule-approve'));
    await waitFor(() => {
      const approve = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/api/factories/f1/rules/r2:approve'),
      );
      expect(approve).toBeTruthy();
      expect((approve![1] as RequestInit).method).toBe('POST');
    });
  });

  it('starts a generation with the chosen parameters and opens the Generation tab', async () => {
    const fetchMock = stubFetch();
    renderPage(<FactoryDetailPage factoryId="f1" />);
    await screen.findByText('Amounts in SAR');
    await userEvent.click(screen.getByTestId('generate'));
    const dialog = await screen.findByTestId('generate-dialog');
    expect(within(dialog).getByTestId('generate-estimate').textContent).toMatch(
      /120 base items \(v3\), up to 360 generated items, 1 official rule/,
    );
    const layers = within(dialog).getByRole('textbox', { name: 'Max layers' });
    await userEvent.clear(layers);
    await userEvent.type(layers, '2');
    await userEvent.click(screen.getByTestId('factory-dialog-submit'));
    await waitFor(() => {
      const start = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/api/factories/f1/jobs') && (i as RequestInit).method === 'POST',
      );
      expect(start).toBeTruthy();
      const sent = JSON.parse(String((start![1] as RequestInit).body)) as {
        kind: string;
        params: Record<string, unknown>;
      };
      expect(sent.kind).toBe('generation');
      expect(sent.params).toMatchObject({
        max_layers: 2,
        branching: 3,
        max_items: 500,
        official_only: true,
        group_values: null,
        dataset_name: null,
      });
    });
    // The new attempt opens in the Generation tab (?job=j2): its chart and its items.
    expect(await screen.findByTestId('attempt-view')).toBeInTheDocument();
    expect(await screen.findByTestId('attempt-dataset')).toHaveTextContent('Faq generated 1');
    expect(screen.getByTestId('attempt-meta')).toHaveTextContent('6 items of at most 500 · layer 2 of 2');
    expect(await screen.findAllByTestId('layer-row')).toHaveLength(3);
    // Back to the attempts table.
    await userEvent.click(screen.getByTestId('attempt-back'));
    expect(await screen.findByTestId('job-dataset')).toHaveTextContent('Faq generated 1');
    expect(screen.getByText('2 approved · 0 rejected · 4 pending')).toBeInTheDocument();
  });

  it('hides every change control for a viewer and shows the running job line', async () => {
    const job: FactoryJob = {
      ...JOB,
      id: 'j3',
      status: 'running',
      progress: { message: 'Layer 1 of 2: 4 item(s) generated' },
    };
    stubFetch({
      detail: {
        ...detail,
        active_job: job,
        permissions: { ...detail.permissions, access_level: 'view', can_modify: false, can_approve: false },
      },
    });
    renderPage(<FactoryDetailPage factoryId="f1" />, { readOnly: true, viewer: true });
    await screen.findByText('Amounts in SAR');
    expect(screen.queryByTestId('generate')).toBeNull();
    expect(screen.queryByTestId('analyze')).toBeNull();
    expect(screen.queryByTestId('add-rule')).toBeNull();
    expect(screen.queryByTestId('rule-approve')).toBeNull();
    const notice = screen.getByTestId('active-job');
    expect(notice).toHaveTextContent('Generation running.');
    expect(notice).toHaveTextContent('Layer 1 of 2: 4 item(s) generated');
    expect(screen.queryByTestId('cancel-job')).toBeNull();
  });
});
