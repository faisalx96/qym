/** cv4 review fixes in the item field editor: Expand opens the field large (E4), JSON is coloured while edited (E6). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FieldEditor, fillWeight, initialFieldState, type FieldState } from '../FieldEditor';

function Editable({ value, jsonOnly }: { value: unknown; jsonOnly?: boolean }) {
  const [state, setState] = useState<FieldState>(initialFieldState(value, jsonOnly));
  return (
    <FieldEditor
      compact
      fill
      label="Input"
      value={value}
      editable
      jsonOnly={jsonOnly}
      state={state}
      onChange={setState}
    />
  );
}

describe('FieldEditor expand (cv4 E4)', () => {
  it('opens the field in a dialog, and an edit there is the same edit as in the card', async () => {
    const user = userEvent.setup();
    render(<Editable value={{ a: 1 }} />);
    await user.click(screen.getByRole('button', { name: 'Expand Input' }));
    const dialog = await screen.findByRole('dialog');
    const big = within(dialog).getByRole('textbox', { name: 'Input' });
    fireEvent.change(big, { target: { value: '{"a": 2}' } });
    const card = screen.getAllByRole('textbox', { hidden: true }).find((t) => !dialog.contains(t))!;
    expect((card as HTMLTextAreaElement).value).toBe('{"a": 2}');
  });

  it('opens a read-only field in the dialog too', async () => {
    const user = userEvent.setup();
    render(<FieldEditor label="Expected output" value="the answer" editable={false} />);
    await user.click(screen.getByRole('button', { name: 'Expand Expected output' }));
    expect(within(await screen.findByRole('dialog')).getByText('the answer')).toBeInTheDocument();
  });
});

describe('FieldEditor JSON colours while editing (cv4 E6)', () => {
  it('lays a token-coloured copy of the JSON text under the textarea', () => {
    const { container } = render(<Editable value={{ name: 'x', n: 3, ok: true }} />);
    const under = container.querySelector('[data-testid="json-colour"]')!;
    expect(under).toBeInTheDocument();
    expect(under).toHaveAttribute('aria-hidden', 'true');
    expect(under.textContent).toBe((container.querySelector('textarea') as HTMLTextAreaElement).value);
    expect(under.querySelectorAll('span').length).toBeGreaterThanOrEqual(6);
  });

  it('shows no colour layer for a string edited as text', () => {
    const { container } = render(<Editable value="plain words" />);
    expect(container.querySelector('[data-testid="json-colour"]')).toBeNull();
  });

  it('follows the edited text', () => {
    const { container } = render(<Editable value={{ a: 1 }} jsonOnly />);
    const area = container.querySelector('textarea')!;
    fireEvent.change(area, { target: { value: '{"b": null}\n' } });
    expect(container.querySelector('[data-testid="json-colour"]')!.textContent).toBe('{"b": null}\n ');
  });
});

describe('fillWeight (cv4 E7)', () => {
  it('gives longer values a larger share, from 2 to 8', () => {
    expect(fillWeight('x')).toBe(2);
    expect(fillWeight('a\nb\nc\nd')).toBe(4);
    expect(fillWeight('x'.repeat(10_000))).toBe(8);
  });
});

describe('FieldEditor code strings (feedback 17 Nov D4)', () => {
  it('shows a SQL string as a mono code block with the keywords coloured', () => {
    const { container } = render(
      <FieldEditor label="Expected output" value="select id, name from users where id = 1" editable={false} />,
    );
    const pre = container.querySelector('pre[data-lang="sql"]')!;
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveAttribute('data-kind', 'code');
    const words = Array.from(pre.querySelectorAll('span')).map((s) => s.textContent?.trim().toUpperCase());
    expect(words).toEqual(expect.arrayContaining(['SELECT', 'FROM', 'WHERE']));
  });

  it('shows a JSON string as a JSON code block', () => {
    const { container } = render(<FieldEditor label="Output" value='{"a": 1}' editable={false} />);
    expect(container.querySelector('pre[data-lang="json"]')).toBeInTheDocument();
  });

  it('keeps prose as prose, even when it starts with a SQL word', () => {
    const { container } = render(
      <FieldEditor label="Input" value="Select the best answer from the list below." editable={false} />,
    );
    expect(container.querySelector('pre[data-lang]')).toBeNull();
    expect(screen.getByText('Select the best answer from the list below.')).toBeInTheDocument();
  });

  it('colours SQL keywords under the textarea while a SQL string is edited', () => {
    const { container } = render(<Editable value="select * from t where a = 1" />);
    expect(container.querySelector('textarea')).toHaveAttribute('data-mode', 'sql');
  });
});
