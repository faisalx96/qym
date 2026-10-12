import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryBlock } from '../entry/EntryBlock';
import { LaunchSection } from '../components/LaunchSection';
import { ReviewPane } from '../review/ReviewPane';
import { LaunchTestProvider, useLaunch } from '../LaunchContext';
import { createDocument, pointerToFieldName, type ValidationItem } from '../model';
import { envRecord, installFakePlatform, newClient, Providers } from './helpers';

afterEach(() => vi.unstubAllGlobals());

function renderWith(
  ui: React.ReactElement,
  overrides: Parameters<typeof LaunchTestProvider>[0]['overrides'] = {},
  doc?: ReturnType<typeof createDocument>,
) {
  installFakePlatform();
  const client = newClient();
  return render(
    <MemoryRouter>
      <Providers client={client}>
        <LaunchTestProvider
          datasetNames={['ds1', 'ds2']}
          doc={doc}
          overrides={{ envRecords: [envRecord()], ...overrides }}
        >
          {ui}
        </LaunchTestProvider>
      </Providers>
    </MemoryRouter>,
  );
}

describe('entry block', () => {
  it('lists environments with their tags and toggles one', async () => {
    const toggleEnv = vi.fn();
    renderWith(<EntryBlock />, { toggleEnv });
    expect(screen.getByRole('group', { name: 'Environments' })).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Priority up to HIGH')).toBeInTheDocument();
    expect(screen.getByText('Default preset v1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'staging' }));
    expect(toggleEnv).toHaveBeenCalledWith('e1', true);
  });

  it('offers the start-from cards and asks the provider to switch', async () => {
    const chooseBase = vi.fn(async () => true);
    const doc = createDocument({ environmentIds: ['e1'] });
    renderWith(
      <EntryBlock />,
      {
        chooseBase,
        selectedEnvs: [envRecord()],
        baseState: {
          envId: 'e1',
          presets: [],
          savedPresets: [],
          loading: false,
          note: '',
          label: 'Default preset v1',
          available: () => ({ ok: true }),
        },
      },
      doc,
    );
    const scratch = screen.getByRole('radio', { name: /From scratch/ });
    await userEvent.click(scratch);
    expect(chooseBase).toHaveBeenCalledWith('scratch');
    expect(screen.getByRole('radio', { name: /Default preset v1/ })).toBeInTheDocument();
  });

  it('shows a custom dataset a base carried, with Remove', async () => {
    const doc = createDocument({
      environmentIds: ['e1'],
      dataset: { mode: 'custom', name: '', ref: '', custom: 'golden' },
    });
    renderWith(<EntryBlock />, { selectedEnvs: [envRecord()] }, doc);
    expect(screen.getByText('A custom dataset')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('A custom dataset')).toBeNull());
  });
});

function Probe() {
  const { setDoc } = useLaunch();
  return (
    <button type="button" onClick={() => setDoc((d) => ({ ...d, name: 'x' }))}>
      edit
    </button>
  );
}

describe('review: problems', () => {
  it('clicking a problem focuses its field', async () => {
    renderWith(
      <>
        <EntryBlock />
        <ReviewPane onCancel={() => {}} />
        <Probe />
      </>,
    );
    const problem = screen.getByRole('button', { name: /Name.*Name the experiment/ });
    await userEvent.click(problem);
    await waitFor(() => expect(screen.getByLabelText('Experiment name')).toHaveFocus());
  });

  it('opens a closed section and falls back to its heading when the field is not there', async () => {
    const item: ValidationItem = {
      pointer: '/evaluator/config/nope',
      label: 'Evaluation inputs › Nope',
      message: 'Broken',
      stepId: 'eval',
      fieldName: pointerToFieldName('/evaluator/config/nope'),
      where: [],
      source: 'local',
    };
    function Harness() {
      const { focusIssue } = useLaunch();
      return (
        <>
          <button type="button" onClick={() => focusIssue(item)}>
            go
          </button>
          <LaunchSection id="evaluation">
            <p>body of evaluation</p>
          </LaunchSection>
        </>
      );
    }
    renderWith(<Harness />);
    expect(screen.queryByText('body of evaluation')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(screen.getByText('body of evaluation')).toBeInTheDocument());
    await waitFor(
      () => expect(screen.getByRole('button', { name: /Evaluation configurations/ })).toHaveFocus(),
      { timeout: 2000 },
    );
  });

  it('pluralises the run count', () => {
    renderWith(<ReviewPane onCancel={() => {}} />);
    expect(screen.getByText('runs to launch')).toBeInTheDocument();
    act(() => {});
  });
});
