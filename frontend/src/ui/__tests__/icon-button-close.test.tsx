/**
 * G3 (owner: "close button X glows green on hover? should be red"): the X that closes a surface carries the close
 * marker, so IconButton.module.css turns it the error red on hover and press. Read docs/DESIGN_LANGUAGE.md "Icon action".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chip, Dialog, Drawer, IconButton } from '@/ui';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../IconButton/IconButton.module.css'),
  'utf-8',
);

describe('IconButton close marker (G3)', () => {
  it('marks the close glyph in the default tone, and nothing else', () => {
    render(
      <>
        <IconButton label="Close item" icon="close" />
        <IconButton label="Copy link" icon="link" />
        <IconButton label="Reject" icon="close" tone="reject" />
        <IconButton label="Remove entry" icon="close" closes={false} />
        <IconButton label="Close details" icon={<span>x</span>} closes />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Close item' })).toHaveAttribute('data-close');
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveAttribute('data-close');
    expect(screen.getByRole('button', { name: 'Copy link' })).not.toHaveAttribute('data-close');
    expect(screen.getByRole('button', { name: 'Reject' })).not.toHaveAttribute('data-close');
    expect(screen.getByRole('button', { name: 'Remove entry' })).not.toHaveAttribute('data-close');
  });

  it('the Drawer close button carries it', () => {
    render(
      <Drawer open onOpenChange={vi.fn()} title="Trace">
        body
      </Drawer>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-close');
  });

  it('the Dialog close button carries it', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} title="Edit">
        body
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-close');
  });

  it('a chip remove keeps the accent hover', () => {
    render(<Chip onRemove={vi.fn()}>status: failed</Chip>);
    expect(screen.getByRole('button', { name: 'Remove filter' })).not.toHaveAttribute('data-close');
  });

  it('the stylesheet turns a close glyph the error red on hover and press', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toMatch(
      /\.iconAction\[data-close\]:is\(\[data-hovered\], \[data-pressed\]\) \{ color: var\(--error\); \}/,
    );
  });
});
