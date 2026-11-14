import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultSlot, pathsToTree } from '../../model/mapping';
import type { RunWorkspace } from '../../workspace/useRunWorkspace';
import { FieldsMapping } from '../FieldsMapping';

function fakeWs(over: { std?: Record<string, unknown>; trees?: Record<string, unknown> } = {}) {
  const update = vi.fn();
  const ws = {
    settings: {
      std: { input: defaultSlot('input'), expected: defaultSlot('expected'), output: defaultSlot('output') },
      custom: {},
      ...over.std,
    },
    update,
    customVars: [],
    trees: {
      std: { input: pathsToTree(['question', 'schema']), expected: [], output: pathsToTree(['sql']) },
      custom: {},
      metadata: [],
      ...over.trees,
    },
  } as unknown as RunWorkspace;
  return { ws, update };
}

const group = (name: RegExp) => screen.getByRole('group', { name });

describe('FieldsMapping (cv5 K2)', () => {
  it('a JSON field shows "Full value" on, then its keys; a single value shows the dropdown only', () => {
    const { ws } = fakeWs();
    render(<FieldsMapping ws={ws} onlyStandard />);
    const input = group(/^Input: keys to send$/);
    const chips = within(input).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Full value', 'question', 'schema']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false');
    // an object with one key still reads as an object
    expect(within(group(/^Actual output: keys to send$/)).getAllByRole('button')).toHaveLength(2);
    // a single value: no key group, no "not JSON" sentence
    expect(screen.queryByRole('group', { name: /^Expected output: keys to send$/ })).toBeNull();
    expect(screen.queryByText(/not JSON/)).toBeNull();
  });

  it('a key on switches "Full value" off; "Full value" on switches the keys off', () => {
    const { ws, update } = fakeWs();
    const { unmount } = render(<FieldsMapping ws={ws} onlyStandard />);
    fireEvent.click(within(group(/^Input: keys to send$/)).getByRole('button', { name: 'question' }));
    expect(update).toHaveBeenLastCalledWith({
      std: expect.objectContaining({ input: { field: 'input', full: false, selected: ['question'] } }),
    });
    unmount();

    const keyed = fakeWs({
      std: {
        std: {
          input: { field: 'input', full: false, selected: ['question'] },
          expected: defaultSlot('expected'),
          output: defaultSlot('output'),
        },
      },
    });
    render(<FieldsMapping ws={keyed.ws} onlyStandard />);
    const input = group(/^Input: keys to send$/);
    expect(within(input).getByRole('button', { name: 'Full value' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(within(input).getByRole('button', { name: 'Full value' }));
    expect(keyed.update).toHaveBeenLastCalledWith({
      std: expect.objectContaining({ input: { field: 'input', full: true, selected: [] } }),
    });
  });

  it('metric metadata with no data in the sample says so in one muted line', () => {
    const { ws } = fakeWs({
      std: {
        std: {
          input: defaultSlot('input'),
          expected: defaultSlot('metric_metadata'),
          output: defaultSlot('output'),
        },
      },
    });
    render(<FieldsMapping ws={ws} onlyStandard />);
    expect(screen.getByText('No metric metadata in the sampled items.')).toBeInTheDocument();
  });
});
