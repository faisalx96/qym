import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, EmptyState, MultiSelect, Pagination, Switch } from '@/ui';

describe("Pagination (the shared bundle's direct entry and page size)", () => {
  it('ignores a fractional page entry and reports a page-size change', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        total={300}
        page={3}
        pageSize={20}
        noun="runs"
        onPageChange={onPageChange}
        pageSizeOptions={[20, 50, 100]}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'Page' });
    await user.clear(input);
    await user.type(input, '3.7{Enter}');
    await user.tab();
    expect(onPageChange.mock.calls.every(([p]) => Number.isInteger(p))).toBe(true);
    expect(onPageChange).not.toHaveBeenCalledWith(3.7);
    await user.selectOptions(screen.getByRole('combobox', { name: /per page|page size|rows/i }), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe('form and feedback recipes are semantic', () => {
  it('Checkbox and Switch expose their roles and toggle', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      const [box, setBox] = useState(false);
      return (
        <>
          <Switch isSelected={on} onChange={setOn}>
            Auto refresh
          </Switch>
          <Checkbox isSelected={box} onChange={setBox}>
            Include errors
          </Checkbox>
        </>
      );
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Auto refresh' });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    expect(sw).toBeChecked();
    const box = screen.getByRole('checkbox', { name: 'Include errors' });
    await user.click(box);
    expect(box).toBeChecked();
  });

  it('EmptyState names itself', () => {
    render(<EmptyState title="No saved views" body="Save a filter to see it here." />);
    expect(screen.getByText('No saved views')).toBeInTheDocument();
  });
});

describe('MultiSelect (the dropdown with search and actions)', () => {
  it('filters its options by the search text, keeps ticks, and Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<Set<string>>(new Set());
      return (
        <MultiSelect
          label="Metrics"
          searchable
          items={[
            { key: 'accuracy', label: 'accuracy' },
            { key: 'latency', label: 'latency' },
            { key: 'cost', label: 'cost' },
          ]}
          value={value}
          onChange={(keys) => setValue(new Set([...keys].map(String)))}
        />
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Metrics/ });
    await user.click(trigger);
    const search = await screen.findByLabelText('Search Metrics');
    expect(search).toHaveFocus();
    await user.type(search, 'latency');
    expect(screen.queryByText('accuracy')).not.toBeInTheDocument();
    expect(screen.getByText('latency')).toBeInTheDocument();
    await user.clear(search);
    await user.click(screen.getByText('latency'));
    expect(screen.getByRole('checkbox', { name: 'latency' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'accuracy' })).not.toBeChecked();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
