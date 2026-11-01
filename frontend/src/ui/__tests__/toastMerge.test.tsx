import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../Toast';

/** Repeated toasts of one kind merge into one (C143). */
function Adder() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.show('Item a added', { merge: { key: 'item-added', text: (n) => `${n} items added` } })
      }
    >
      add
    </button>
  );
}

describe('toast merge', () => {
  it('turns a second toast of the same kind into one counted toast', () => {
    render(
      <ToastProvider>
        <Adder />
      </ToastProvider>,
    );
    act(() => screen.getByRole('button', { name: 'add' }).click());
    expect(screen.getByText('Item a added')).toBeTruthy();
    act(() => screen.getByRole('button', { name: 'add' }).click());
    expect(screen.queryByText('Item a added')).toBeNull();
    expect(screen.getAllByText('2 items added')).toHaveLength(1);
  });
});
