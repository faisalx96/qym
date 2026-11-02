import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/ui';

const ITEMS = [
  { key: 'MEMBER', label: 'Member' },
  { key: 'MANAGER', label: 'Manager' },
];

describe('inline role Select (C186)', () => {
  it('opens at once, saves on pick, and tells its owner when it closes', async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Select
        label="Role of Dev"
        hideLabel
        items={ITEMS}
        value="MEMBER"
        defaultOpen
        autoFocus
        onChange={onChange}
        onOpenChange={onOpenChange}
      />,
    );
    await userEvent.click(await screen.findByRole('option', { name: 'Manager' }));
    expect(onChange).toHaveBeenCalledWith('MANAGER');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape closes it without a change', async () => {
    const onChange = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Select
        label="Role"
        items={ITEMS}
        value="MEMBER"
        defaultOpen
        autoFocus
        onChange={onChange}
        onOpenChange={onOpenChange}
      />,
    );
    await screen.findByRole('option', { name: 'Manager' });
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
