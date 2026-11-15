import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Timeline, ToggleChips } from '..';

function Chips({ min, initial }: { min?: number; initial: string[] }) {
  const [on, setOn] = useState<string[]>(initial);
  return (
    <ToggleChips
      aria-label="Metrics"
      options={[
        { value: 'a', label: 'accuracy' },
        { value: 'b', label: 'latency', count: 3 },
        { value: 'c', label: 'cost' },
      ]}
      value={on}
      onChange={setOn}
      min={min}
    />
  );
}

describe('ToggleChips (cv5 H4)', () => {
  it('each chip is a pressed or unpressed button in a named group; on is not shown by colour alone', async () => {
    const user = userEvent.setup();
    render(<Chips initial={['a']} />);
    expect(screen.getByRole('group', { name: 'Metrics' })).toBeTruthy();
    const latency = screen.getByRole('button', { name: /latency/ });
    expect(latency.getAttribute('aria-pressed')).toBe('false');
    expect(latency.querySelector('svg')).toBeNull();
    await user.click(latency);
    expect(latency.getAttribute('aria-pressed')).toBe('true');
    // the check mark marks the on state
    expect(latency.querySelector('svg')).not.toBeNull();
  });

  it('works from the keyboard and keeps the option order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToggleChips
        aria-label="Metrics"
        options={[
          { value: 'a', label: 'accuracy' },
          { value: 'b', label: 'latency' },
        ]}
        value={['b']}
        onChange={onChange}
      />,
    );
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('min keeps the last option on and says why', async () => {
    const user = userEvent.setup();
    render(<Chips initial={['a']} min={1} />);
    const accuracy = screen.getByRole('button', { name: /accuracy/ });
    expect(accuracy.getAttribute('aria-disabled')).toBe('true');
    // cv5 Y9: the reason is the shared Tooltip (no native title); keyboard focus opens it
    expect(accuracy.getAttribute('title')).toBeNull();
    await user.tab();
    expect(accuracy).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Keep at least one on');
    await user.click(accuracy);
    expect(accuracy.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ToggleChips label (cv5 Z4)', () => {
  it('a visible label names the group through aria-labelledby', () => {
    render(
      <>
        <span id="metrics-label">Metrics</span>
        <ToggleChips
          aria-labelledby="metrics-label"
          options={[{ value: 'a', label: 'accuracy' }]}
          value={['a']}
          onChange={() => {}}
        />
      </>,
    );
    const group = screen.getByRole('group', { name: 'Metrics' });
    expect(group.getAttribute('aria-labelledby')).toBe('metrics-label');
    expect(group.hasAttribute('aria-label')).toBe(false);
  });
});

describe('Timeline (cv5 H5)', () => {
  const items = [
    { key: 'v1', time: 'Sep 4 · 01:51', dateTime: '2026-09-04T01:51:00Z', title: 'v1 created', meta: 'Dev User' },
    { key: 'v2', time: 'Sep 5 · 13:51', icon: 'check' as const, tone: 'accent' as const, title: 'v2 published' },
  ];

  it('is an ordered list of events with their times', () => {
    render(<Timeline aria-label="Change log" items={items} />);
    const list = screen.getByRole('list', { name: 'Change log' });
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(list.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-04T01:51:00Z');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('selectable: each row is a button, the active one is marked current', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Timeline aria-label="Versions" items={items} activeKey="v2" onSelect={onSelect} />);
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    const [first, second] = rows as [HTMLElement, HTMLElement];
    expect(second.getAttribute('aria-current')).toBe('true');
    expect(first.getAttribute('aria-current')).toBeNull();
    await user.click(first);
    expect(onSelect).toHaveBeenCalledWith('v1');
  });

  it('cv5 Z3: revealActions and markAlign are list options (centre by default)', () => {
    const { rerender } = render(<Timeline aria-label="Versions" items={items} />);
    const list = screen.getByRole('list', { name: 'Versions' });
    expect(list.getAttribute('data-mark-align')).toBe('center');
    expect(list.hasAttribute('data-reveal-actions')).toBe(false);
    rerender(<Timeline aria-label="Versions" items={items} revealActions markAlign="start" />);
    expect(list.getAttribute('data-mark-align')).toBe('start');
    expect(list.hasAttribute('data-reveal-actions')).toBe(true);
  });
});
