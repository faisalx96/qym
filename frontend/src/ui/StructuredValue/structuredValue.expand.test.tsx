/** Round 3 P5: key rows are collapsed by default, show previews, and Expand all / Collapse all are recursive. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { allPaths, collapseBelow, expandKey, previewOf } from './keyTree';
import { StructuredValue } from './StructuredValue';

const value = {
  answer: 'forty two',
  count: 3,
  citations: [
    { doc: 'policy', page: 3 },
    { doc: 'guide', page: 4 },
  ],
  meta: { nested: { a: [1, 2, { b: 'deep' }], c: { d: 'e' } }, tags: ['x', 'y'] },
};

const expanded = (c: HTMLElement) => c.querySelectorAll('[aria-expanded="true"]').length;
const collapsed = (c: HTMLElement) =>
  c.querySelectorAll('button[aria-controls][aria-expanded="false"]').length;

describe('keyTree helpers', () => {
  it('previews scalars as text and containers as a type summary', () => {
    expect(previewOf('hello  world')).toBe('hello world');
    expect(previewOf([1, 2])).toBe('array · 2 items');
    expect(previewOf([1])).toBe('array · 1 item');
    expect(previewOf({ a: 1, b: 2 })).toBe('object · 2 keys');
    expect(previewOf(null)).toBe('null');
  });

  it('lists every path at every depth', () => {
    const paths = allPaths(value, 'p');
    expect(paths).toContain('p/meta/nested/a/2/b');
    expect(paths).toContain('p/citations/0/doc');
  });

  it('expandKey opens the key and every descendant; collapseBelow closes only the descendants', () => {
    const open = expandKey(new Set(), value.meta, 'p/meta');
    expect(open.has('p/meta')).toBe(true);
    expect(open.has('p/meta/nested/a/2')).toBe(true);
    const closed = collapseBelow(open, value.meta, 'p/meta');
    expect(closed.has('p/meta')).toBe(true);
    expect(closed.has('p/meta/nested')).toBe(false);
  });
});

describe('StructuredValue variant="keys"', () => {
  it('starts with every key collapsed and a preview on each row', () => {
    const { container } = render(<StructuredValue value={value} variant="keys" label="Output" />);
    expect(expanded(container)).toBe(0);
    expect(collapsed(container)).toBe(4);
    expect(screen.getByText('forty two')).toBeInTheDocument();
    expect(screen.getByText('array · 2 items')).toBeInTheDocument();
    expect(screen.getByText('object · 2 keys')).toBeInTheDocument();
  });

  it('opens a nested key to collapsed first-level children with a type summary and Expand all / Collapse all', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StructuredValue value={value} variant="keys" toolbar={false} label="Output" />,
    );
    await user.click(screen.getByRole('button', { name: /^meta/ }));
    expect(screen.getByRole('button', { name: /^nested/ })).toHaveAttribute('aria-expanded', 'false');
    const group = screen.getByRole('button', { name: 'Expand all in meta' });
    await user.click(group);
    const body = container.querySelector('[data-open]')!;
    expect(
      within(body as HTMLElement)
        .queryAllByRole('button', { expanded: false })
        .filter((b) => b.hasAttribute('aria-controls')),
    ).toHaveLength(0);
    expect(screen.getByText('deep')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse all in meta' }));
    expect(screen.getByRole('button', { name: /^nested/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^meta/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('the global Expand all opens every key at every depth and Collapse all restores the default', async () => {
    const user = userEvent.setup();
    const { container } = render(<StructuredValue value={value} variant="keys" label="Output" />);
    await user.click(screen.getByRole('button', { name: 'Expand all keys' }));
    expect(collapsed(container)).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Collapse all keys' }));
    expect(expanded(container)).toBe(0);
  });

  it('shows the first 20 elements of a long array and "Show N more"', async () => {
    const user = userEvent.setup();
    render(
      <StructuredValue
        value={{ rows: Array.from({ length: 25 }, (_, i) => i) }}
        variant="keys"
        toolbar={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^rows/ }));
    expect(screen.getByRole('button', { name: 'Show 5 more' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getByRole('button', { name: /^\[24\]/ })).toBeInTheDocument();
  });
});
