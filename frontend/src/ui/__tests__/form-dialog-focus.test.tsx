/** C231: a failed form check moves focus to the first invalid field, so its error is announced. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FormDialog } from '../FormDialog';

describe('FormDialog validation focus', () => {
  it('focuses the first required field left empty', async () => {
    const onSubmit = vi.fn();
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="New dataset"
        confirmLabel="Create dataset"
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'slug', label: 'Slug', required: true },
        ]}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create dataset' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Name/ })).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
