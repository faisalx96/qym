import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { ModelsSection } from '../sections/ModelsSection';
import { addExtraEndpoints, createDocument, type ModelSlot } from '../model';
import { live, makeEnv, PRODUCTION, renderSection, docJson } from './sectionTestKit';

const KEY = 'sk-SECRET-123456';
const prodConn = { kind: 'connection', id: 'conn-prod' } as const;

function card(name: string) {
  return screen.getByRole('article', { name });
}

describe('ModelsSection', () => {
  it('switches a slot Follow global -> Custom -> Temporary and keeps the key out of the document', async () => {
    const user = userEvent.setup();
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      bindings: { 'endpoint:primary': prodConn },
      globalModel: prodConn,
    });
    renderSection(<ModelsSection />, { doc });
    const primary = card('Primary model');
    expect(within(primary).getByText('follows global')).toBeInTheDocument();

    await user.click(within(primary).getByRole('radio', { name: 'Custom' }));
    expect(within(card('Primary model')).getByText('custom')).toBeInTheDocument();
    expect(live.current?.doc.bindings['endpoint:primary']).toBeUndefined();

    await user.click(within(card('Primary model')).getByRole('radio', { name: 'Temporary' }));
    const form = within(card('Primary model')).getByRole('group', { name: 'Temporary model' });
    await user.type(within(form).getByRole('textbox', { name: /^Model/ }), 'gpt-4o-mini');
    await user.type(within(form).getByLabelText('API key'), KEY);
    await user.click(within(form).getByRole('button', { name: 'Add model' }));

    const chip = await screen.findByText('key kept in memory only');
    expect(chip).toBeInTheDocument();
    const binding = live.current?.doc.bindings['endpoint:primary'];
    expect(binding?.kind).toBe('temporary');
    // the document holds a ref only; the key lives in the SecretStore
    expect(docJson()).not.toContain(KEY);
    expect(live.current?.secrets.size).toBe(1);
    expect(document.body.innerHTML).not.toContain(KEY);
    const ref = binding?.kind === 'temporary' ? binding.secretRef : null;
    expect(ref).toBeTruthy();
    expect(live.current?.secrets.pick([ref as string])).toEqual({ [ref as string]: KEY });
    expect(JSON.stringify(live.current?.secrets)).toBe('{}');
  });

  it('applies and clears the global model', async () => {
    const user = userEvent.setup();
    renderSection(<ModelsSection />);
    expect(screen.getByText(/Pick a model to use it on every endpoint/)).toBeInTheDocument();
    const global = screen.getByRole('group', { name: 'Global model' });
    await user.click(within(global).getByRole('button', { name: /Global model/ }));
    await user.click(await screen.findByRole('option', { name: /gpt-4o prod/ }));
    await waitFor(() => expect(live.current?.doc.globalModel).toEqual(prodConn));
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual(prodConn);
    expect(screen.getByText('Every endpoint follows the global model.')).toBeInTheDocument();

    // one endpoint goes custom: the status names it, Apply to all brings it back
    await user.click(within(card('Primary model')).getByRole('radio', { name: 'Custom' }));
    expect(screen.getByText(/Custom: Primary model\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply to all endpoints' }));
    await waitFor(() => expect(live.current?.doc.bindings['endpoint:primary']).toEqual(prodConn));
    expect(screen.getByText('Every endpoint follows the global model.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(live.current?.doc.globalModel).toBeNull());
    // clearing keeps what the endpoints use
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual(prodConn);
  });

  it('adds an LLM endpoint with Enter and rejects a bad name', async () => {
    const user = userEvent.setup();
    const proposal: ModelSlot = {
      slot_key: 'endpoint:fast',
      kind: 'endpoint',
      label: 'fast',
      field_map: { model: '/LLM_OVERRIDES/endpoints/fast/model' },
      required: false,
      status: 'proposed',
    };
    const env = makeEnv(PRODUCTION, 'production');
    env.extra = { fast: proposal };
    renderSection(<ModelsSection />, {
      envs: [env],
      overrides: {
        loadProposal: async (names) => {
          const list = Array.isArray(names) ? names : [names];
          live.current?.setDoc((d) => addExtraEndpoints(d, live.current!.ctx, list));
          return list;
        },
      },
    });
    const input = screen.getByRole('textbox', { name: 'New LLM endpoint name' });
    await user.type(input, 'bad name!');
    await user.click(screen.getByRole('button', { name: '+ Add LLM endpoint' }));
    expect(await screen.findByText(/Use letters, digits/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'fast{Enter}');
    await waitFor(() => expect(live.current?.doc.extraEndpoints).toEqual(['fast']));
    const fast = await screen.findByRole('article', { name: 'fast' });
    expect(within(fast).getByText('this experiment')).toBeInTheDocument();
    expect(within(fast).getByRole('button', { name: 'Remove fast' })).toBeInTheDocument();
  });

  it('asks for a lost temporary key once and never stores it', async () => {
    const user = userEvent.setup();
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      bindings: {
        'endpoint:primary': { kind: 'temporary', model: 'gpt-x', secretRef: null, save: false, needsKey: true },
      },
    });
    renderSection(<ModelsSection />, { doc });
    expect(screen.getAllByText('no API key')).toHaveLength(1);
    expect(screen.getAllByLabelText('API key for Primary model')).toHaveLength(1);
    await user.type(screen.getByLabelText('API key for Primary model'), KEY);
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    await waitFor(() => expect(screen.queryByText('no API key')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('API key for Primary model')).not.toBeInTheDocument();
    expect(docJson()).not.toContain(KEY);
    expect(live.current?.secrets.size).toBe(1);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('sweeps models with chips and goes back to a single model', async () => {
    const user = userEvent.setup();
    renderSection(<ModelsSection />);
    const primary = card('Primary model');
    await user.click(within(primary).getByRole('button', { name: '+ models' }));
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual({ kind: 'sweep', items: [] });
    expect(screen.getByText(/Pick at least one model/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'gpt-4o prod · gpt-4o' }));
    await user.click(screen.getByRole('button', { name: 'gpt-4o mini · gpt-4o-mini' }));
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual({
      kind: 'sweep',
      items: [{ connection_id: 'conn-prod' }, { connection_id: 'conn-mini' }],
    });
    await user.click(screen.getByRole('button', { name: 'Single model' }));
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual(prodConn);
  });

  it('shows the changed marker with hidden text and resets the slot', async () => {
    const user = userEvent.setup();
    renderSection(<ModelsSection />);
    await user.click(within(card('Primary model')).getByRole('radio', { name: 'Temporary' }));
    expect(live.current?.doc.bindings['endpoint:primary']).toBeUndefined();
    const form = within(card('Primary model')).getByRole('group', { name: 'Temporary model' });
    await user.type(within(form).getByRole('textbox', { name: /^Model/ }), 'gpt-4o-mini');
    await user.click(within(form).getByRole('button', { name: 'Add model' }));
    expect(await screen.findByText('Changed from the starting point')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset Primary model to the starting model' }));
    expect(live.current?.doc.bindings['endpoint:primary']).toBeUndefined();
    expect(screen.queryByText('Changed from the starting point')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const doc = createDocument({
      environmentIds: [PRODUCTION],
      bindings: { 'endpoint:primary': prodConn },
      globalModel: prodConn,
    });
    const { container } = renderSection(<ModelsSection />, { doc });
    expect(await axe(container)).toHaveNoViolations();
  });
});
