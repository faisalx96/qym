import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { containerOf, JsonFields, uniformKeys } from '../JsonFields';

/** JSON settings edited as fields: containers, tables with an "All items" row, cards and lists. */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const ROUTES: Json = [
  { name: 'a', weight: 1, enabled: true },
  { name: 'b', weight: 2, enabled: true },
];

let latest: Json = null;
const onRaw = vi.fn();

function Harness({ initial }: { initial: Json }) {
  const [value, setValue] = useState<Json>(initial);
  return (
    <JsonFields
      value={value as never}
      label="SETTING"
      onRaw={onRaw}
      onEdit={(fn) => {
        const next = fn(structuredClone(value) as never) as Json;
        latest = next;
        setValue(next);
      }}
    />
  );
}

const setup = (initial: Json) => {
  onRaw.mockClear();
  latest = initial;
  render(<Harness initial={initial} />);
  return userEvent.setup();
};
const field = (name: string) => screen.getByLabelText(name, { exact: true });

describe('containerOf / uniformKeys', () => {
  it('reads a container from a value or from its JSON text', () => {
    expect(containerOf([1], 'json')).toEqual([1]);
    expect(containerOf('[1, 2]', 'string')).toEqual([1, 2]);
    expect(containerOf(' {"a": 1}', 'string')).toEqual({ a: 1 });
    expect(containerOf('plain', 'string')).toBeNull();
    expect(containerOf('[broken', 'string')).toBeNull();
    expect(containerOf(3, 'json')).toBeNull();
  });

  it('finds the keys objects of a list all share', () => {
    expect(uniformKeys([{ a: 1, b: 2 }, { b: 3, a: 4 }])).toEqual(['a', 'b']);
    expect(uniformKeys([{ a: 1 }, { b: 2 }])).toBeNull();
    expect(uniformKeys([1, 2])).toBeNull();
  });
});

describe('JsonFields', () => {
  it('shows same-key objects as a table with an "All items" row that writes every item', async () => {
    const user = setup(ROUTES);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '#',
      'name',
      'weight',
      'enabled',
      'Actions',
    ]);
    const allWeight = field('SETTING · * · weight (all items)');
    expect(allWeight).toHaveValue(''); // 1 and 2 differ
    expect(allWeight).toHaveAttribute('placeholder', 'Mixed');
    await user.type(allWeight, '5{Enter}');
    expect(latest).toEqual([
      { name: 'a', weight: 5, enabled: true },
      { name: 'b', weight: 5, enabled: true },
    ]);
    expect(field('SETTING · 0 · weight')).toHaveValue('5');
    expect(field('SETTING · 1 · weight')).toHaveValue('5');

    await user.selectOptions(field('SETTING · * · enabled (all items)'), 'false');
    expect((latest as Array<{ enabled: boolean }>).map((i) => i.enabled)).toEqual([false, false]);

    await user.clear(field('SETTING · 1 · name'));
    await user.type(field('SETTING · 1 · name'), 'c');
    expect((latest as Array<{ name: string }>).map((i) => i.name)).toEqual(['a', 'c']);
  });

  it('adds rows as copies of the last one and removes rows', async () => {
    const user = setup(ROUTES);
    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    expect(latest).toEqual([...(ROUTES as Json[]), (ROUTES as Json[])[1]]);
    expect(screen.getAllByRole('row')).toHaveLength(5); // header + "All items" + 3
    await user.click(screen.getByRole('button', { name: 'Remove item 1 of SETTING' }));
    expect(latest).toEqual([(ROUTES as Json[])[1], (ROUTES as Json[])[1]]);
  });

  it('rejects text in a number cell without committing it', async () => {
    const user = setup(ROUTES);
    const cell = field('SETTING · 0 · weight');
    await user.clear(cell);
    await user.type(cell, 'abc');
    expect(cell).toHaveAttribute('aria-invalid', 'true');
    expect((latest as Array<{ weight: number }>)[0]!.weight).toBe(1);
    await user.clear(cell);
    await user.type(cell, '7');
    expect(cell).not.toHaveAttribute('aria-invalid');
    expect((latest as Array<{ weight: number }>)[0]!.weight).toBe(7);
  });

  it('turns objects and scalar lists into fields and adds typed keys', async () => {
    const user = setup({ threshold: 0.4, tables: ['a', 'b'], nested: { on: false } });
    await user.clear(field('SETTING · threshold'));
    await user.type(field('SETTING · threshold'), '0.6');
    expect((latest as { threshold: number }).threshold).toBe(0.6);
    await user.clear(field('SETTING · tables · 1'));
    await user.type(field('SETTING · tables · 1'), 'z');
    expect((latest as { tables: string[] }).tables).toEqual(['a', 'z']);
    await user.selectOptions(field('SETTING · nested · on'), 'true');
    expect((latest as { nested: unknown }).nested).toEqual({ on: true });

    // The top-level "+ Add key" comes last (after the nested object's own).
    await user.type(screen.getAllByPlaceholderText('new key').at(-1)!, 'limit');
    await user.click(screen.getAllByRole('button', { name: '+ Add key' }).at(-1)!);
    expect((latest as { limit: unknown }).limit).toBeNull();
    // typed text that parses as JSON is stored as that JSON value (one input event, like a paste)
    fireEvent.change(field('SETTING · limit'), { target: { value: '[1, 2]' } });
    expect((latest as { limit: unknown }).limit).toEqual([1, 2]);
    await user.click(screen.getByRole('button', { name: 'Remove limit from SETTING' }));
    expect(latest).not.toHaveProperty('limit');

    // text that is not JSON is kept as a string
    await user.type(screen.getAllByPlaceholderText('new key').at(-1)!, 'note');
    await user.click(screen.getAllByRole('button', { name: '+ Add key' }).at(-1)!);
    fireEvent.change(field('SETTING · note'), { target: { value: 'hello' } });
    expect((latest as { note: unknown }).note).toBe('hello');
  });

  it('shows mixed lists as cards and offers "Edit as JSON" in one click', async () => {
    const user = setup([{ a: 1 }, { b: { deep: 'x' } }]);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    await user.clear(field('SETTING · 1 · b · deep'));
    await user.type(field('SETTING · 1 · b · deep'), 'y');
    expect(latest).toEqual([{ a: 1 }, { b: { deep: 'y' } }]);
    await user.click(screen.getByRole('button', { name: 'Edit SETTING as JSON' }));
    expect(onRaw).toHaveBeenCalledTimes(1);
  });

  it('never parses a key or value as HTML', () => {
    const payload = '<img src=x onerror="window.pwned=1">';
    setup([{ [payload]: payload }]);
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('gives mixed-key objects an "All items" block over every scalar key', async () => {
    const user = setup([
      { role: 'a', temperature: 0.2 },
      { role: 'b', top_p: 1 },
    ]);
    expect(screen.queryByRole('table')).toBeNull();
    const all = field('SETTING · * · temperature (all items)');
    expect(all).toHaveValue(''); // absent from item 2: mixed
    expect(all).toHaveAttribute('placeholder', 'Mixed');
    await user.type(all, '0.7{Enter}');
    expect(latest).toEqual([
      { role: 'a', temperature: 0.7 },
      { role: 'b', top_p: 1, temperature: 0.7 },
    ]);
    expect(field('SETTING · 1 · temperature')).toHaveValue('0.7');
    expect(field('SETTING · * · temperature (all items)')).toHaveValue('0.7');
  });

  it('gives scalar lists an "All" input only when there is more than one item', async () => {
    const user = setup({ models: ['x', 'y', 'z'] });
    await user.type(field('SETTING · models · * (all items)'), 'gpt{Enter}');
    expect(latest).toEqual({ models: ['gpt', 'gpt', 'gpt'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1 of SETTING · models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1 of SETTING · models' }));
    expect(screen.queryByLabelText('SETTING · models · * (all items)')).toBeNull();
  });
});
