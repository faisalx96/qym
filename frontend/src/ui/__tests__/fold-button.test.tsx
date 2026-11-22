/**
 * G4 (owner: "expand all and collapse all shall be subtle icons not full buttons for simpler viusals"): every Expand all /
 * Collapse all pair of a key tree, a JSON tree or a span tree is two quiet icon actions (`FoldButton`): the default
 * IconButton (no tile, no close marker), the `unfold` / `fold` glyphs (not the pane's `expand` / `collapse`), the old
 * words as the accessible name and in the shared Tooltip. Read docs/DESIGN_LANGUAGE.md "Icon action".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FoldButton, JsonTree, StructuredValue } from '@/ui';

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf-8');

describe('FoldButton (G4)', () => {
  it('draws the unfold / fold glyph in a plain icon action named by the words', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <FoldButton action="open" onPress={onOpen} />
        <FoldButton action="close" label="Collapse all keys" onPress={onClose} />
      </>,
    );
    const open = screen.getByRole('button', { name: 'Expand all' });
    const close = screen.getByRole('button', { name: 'Collapse all keys' });
    expect(open.querySelector('svg[data-icon="unfold"]')).toBeTruthy();
    expect(close.querySelector('svg[data-icon="fold"]')).toBeTruthy();
    for (const b of [open, close]) {
      expect(b).not.toHaveAttribute('data-tile');
      expect(b).not.toHaveAttribute('data-close');
      expect(b).toHaveAttribute('data-tone', 'default');
      expect(b.hasAttribute('title')).toBe(false);
      expect(b.textContent).toBe('');
    }
    await user.click(open);
    await user.click(close);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the words in the shared tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<FoldButton action="close" label="Collapse all in meta" onPress={vi.fn()} />);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Collapse all');
  });

  it('the Icon set has its own fold glyphs, apart from the widen / narrow pair', () => {
    const icon = src('Icon/Icon.tsx');
    for (const n of ['unfold', 'fold', 'expand', 'collapse'])
      expect(icon).toMatch(new RegExp(`\\n  ${n}: '`));
  });

  it('JsonTree, StructuredValue (keys and sections) and the key rows use it, with no worded button left', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<JsonTree data={{ a: { b: 1 } }} label="Span JSON" />);
    expect(
      screen.getByRole('button', { name: 'Expand all' }).querySelector('[data-icon="unfold"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Collapse all' }).querySelector('[data-icon="fold"]'),
    ).toBeTruthy();
    expect(screen.queryByText('Expand all')).toBeNull();
    unmount();

    const keys = render(
      <StructuredValue value={{ meta: { source: 'kb', nested: { deep: true } } }} variant="keys" />,
    );
    expect(
      screen.getByRole('button', { name: 'Expand all keys' }).querySelector('[data-icon="unfold"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Collapse all keys' }).querySelector('[data-icon="fold"]'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^meta/ }));
    const row = screen.getByRole('button', { name: 'Expand all in meta' });
    expect(row.querySelector('[data-icon="unfold"]')).toBeTruthy();
    expect(within(keys.container).queryByText('Collapse all')).toBeNull();
    keys.unmount();

    render(<StructuredValue value={{ answer: 'x', meta: { a: 1 } }} />);
    const toggle = screen.getByRole('button', { name: 'Collapse all' });
    expect(toggle.querySelector('[data-icon="fold"]')).toBeTruthy();
    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Expand all' }).querySelector('[data-icon="unfold"]'),
    ).toBeTruthy();
  });
});
