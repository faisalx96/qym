import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Collapse, Stepper } from '@/ui';

const STEPS = [
  { id: 'a', label: 'Where' },
  { id: 'b', label: 'Models', changes: 2 },
  { id: 'c', label: 'Review', problems: 1 },
];

describe('Stepper', () => {
  it('marks done, current and upcoming, shows counts and selects on click', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Stepper aria-label="Steps" steps={STEPS} current="b" onSelect={onSelect} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming']);
    expect(buttons[1]).toHaveAttribute('aria-current', 'step');
    expect(buttons[0]).not.toHaveAttribute('aria-current');
    expect(buttons[1]).toHaveTextContent('2 changed');
    expect(buttons[2]).toHaveTextContent('1 to fix');
    await userEvent.click(buttons[2]!);
    expect(onSelect).toHaveBeenCalledWith('c');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders the compact form below the breakpoint', () => {
    const mql = (matches: boolean) =>
      ({
        matches,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(() => mql(true));
    render(<Stepper aria-label="Steps" steps={STEPS} current="b" onSelect={() => {}} />);
    expect(screen.getByText('Step 2 of 3: Models')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to step/ })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('Collapse', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          toggle
        </button>
        <Collapse open={open} id="body">
          <input aria-label="inside" />
        </Collapse>
      </>
    );
  }

  it('is inert while closed, mounts its content on open and unmounts after closing', async () => {
    const { container } = render(<Harness />);
    const body = container.querySelector('#body')!;
    expect(body).toHaveAttribute('inert');
    expect(screen.queryByLabelText('inside')).toBeNull();
    await userEvent.click(screen.getByText('toggle'));
    expect(body).not.toHaveAttribute('inert');
    expect(body).toHaveAttribute('data-open', 'true');
    expect(screen.getByLabelText('inside')).toBeInTheDocument();
    await userEvent.click(screen.getByText('toggle'));
    expect(body).toHaveAttribute('inert');
    await waitFor(() => expect(screen.queryByLabelText('inside')).toBeNull());
  });

  it('toggles instantly under prefers-reduced-motion', async () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q) =>
        ({
          matches: /reduce/.test(q),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    render(<Harness />);
    await userEvent.click(screen.getByText('toggle'));
    await userEvent.click(screen.getByText('toggle'));
    expect(screen.queryByLabelText('inside')).toBeNull();
    spy.mockRestore();
  });
});
