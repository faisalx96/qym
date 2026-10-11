import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { RawJsonSection } from '../sections/RawJsonSection';
import { createDocument } from '../model';
import { live, makeCtx, makeEnv, PRODUCTION, renderSection } from './sectionTestKit';

// jsdom cannot lay out CodeMirror; the section talks to the editor through its props only, so a
// textarea with the same contract stands in for the lazy chunk.
vi.mock('../raw/CodeMirrorEditor', () => ({
  default: forwardRef(function FakeEditor(
    props: { value: string; onChange?: (t: string) => void; label: string; readOnly?: boolean },
    ref,
  ) {
    const el = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => el.current?.focus() }), []);
    return (
      <textarea
        ref={el}
        aria-label={props.label}
        data-fake-codemirror
        value={props.value}
        readOnly={props.readOnly}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    );
  }),
}));

function setup() {
  const env = makeEnv(PRODUCTION, 'production');
  const doc = createDocument({
    environmentIds: [PRODUCTION],
    bindings: { 'endpoint:primary': { kind: 'connection', id: 'conn-prod' } },
  });
  const result = renderSection(<RawJsonSection />, {
    envs: [env],
    doc,
    overrides: { ctx: makeCtx({ envs: [env] }) },
  });
  return result;
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Raw JSON/ }));
  // the lazy chunk resolves after the textarea fallback
  return screen.findByLabelText('Raw JSON');
}

function type(editor: HTMLElement, value: string) {
  fireEvent.change(editor, { target: { value } });
}

describe('RawJsonSection', () => {
  it('starts in sync with the form and shows the document with refs only', async () => {
    const user = userEvent.setup();
    setup();
    const editor = await openEditor(user);
    expect(screen.getByText('In sync with the form')).toBeInTheDocument();
    const doc = JSON.parse((editor as HTMLTextAreaElement).value);
    expect(doc.slot_bindings['endpoint:primary']).toEqual({ connection_id: 'conn-prod' });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('refuses an unknown key: error list, launch blocked, form untouched', async () => {
    const user = userEvent.setup();
    setup();
    const editor = (await openEditor(user)) as HTMLTextAreaElement;
    const doc = JSON.parse(editor.value);
    type(editor, JSON.stringify({ ...doc, bogus: 1 }));
    expect(screen.getByText(/Unapplied edits/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    const list = await screen.findByRole('list', { name: 'Raw JSON errors' });
    expect(list).toHaveTextContent('Unknown key');
    expect(live.current?.raw.status).toBe('errors');
    // the review carries the error, so Launch (disabled while any item exists) stays blocked
    expect(live.current?.review.items.some((i) => i.pointer === '#advanced-json')).toBe(true);
    expect(live.current?.review.status).toMatch(/problem/);
    expect(live.current?.doc.values['/LLM_OVERRIDES/endpoints/primary/timeout']).toBeUndefined();
  });

  it('applies a valid edit to the form fields, then re-syncs', async () => {
    const user = userEvent.setup();
    setup();
    const editor = (await openEditor(user)) as HTMLTextAreaElement;
    const doc = JSON.parse(editor.value);
    doc.evaluator.dataset = 'support-qa';
    doc.env_overrides = { LLM_OVERRIDES: { endpoints: { primary: { timeout: 45 } } } };
    type(editor, JSON.stringify(doc, null, 2));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByText('In sync with the form')).toBeInTheDocument());
    expect(live.current?.doc.dataset.name).toBe('support-qa');
    expect(live.current?.doc.values['/LLM_OVERRIDES/endpoints/primary/timeout']).toBe(45);
    expect((screen.getByLabelText('Raw JSON') as HTMLTextAreaElement).value).toContain('"timeout": 45');
  });

  it('reverts to the form', async () => {
    const user = userEvent.setup();
    setup();
    const editor = (await openEditor(user)) as HTMLTextAreaElement;
    const original = editor.value;
    type(editor, '{ "evaluator": ');
    expect(screen.getByText(/Unapplied edits/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revert to form' }));
    await waitFor(() => expect(screen.getByText('In sync with the form')).toBeInTheDocument());
    expect((screen.getByLabelText('Raw JSON') as HTMLTextAreaElement).value).toBe(original);
  });

  it('refuses a literal API key in the text', async () => {
    const user = userEvent.setup();
    setup();
    const editor = (await openEditor(user)) as HTMLTextAreaElement;
    const doc = JSON.parse(editor.value);
    doc.slot_bindings['endpoint:primary'] = { temporary: { model: 'm', api_key: 'sk-LITERAL-1234' } };
    type(editor, JSON.stringify(doc));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('list', { name: 'Raw JSON errors' })).toBeInTheDocument();
    expect(live.current?.doc.bindings['endpoint:primary']).toEqual({ kind: 'connection', id: 'conn-prod' });
  });

  it('focuses the editor when the field the launch bar targets is focused', async () => {
    const user = userEvent.setup();
    setup();
    await openEditor(user);
    live.current?.focusField('f_23_advanced-json', 'raw');
    await waitFor(() => expect(screen.getByLabelText('Raw JSON')).toHaveFocus());
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = setup();
    const editor = (await openEditor(user)) as HTMLTextAreaElement;
    type(editor, '{');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('list', { name: 'Raw JSON errors' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
