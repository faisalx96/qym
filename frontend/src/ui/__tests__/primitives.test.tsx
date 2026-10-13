import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Pagination,
  SegmentedControl,
  Tabs,
  TabPanel,
  Tag,
  ToastProvider,
  useToast,
  Dialog,
  Disclosure,
  HelpMarker,
  JsonTree,
  LinkButton,
  ScoreValue,
} from '@/ui';
import { ApiError } from '@/lib/http';

describe('Tabs', () => {
  function Harness() {
    const [sel, setSel] = useState('a');
    return (
      <Tabs
        label="Sections"
        selected={sel}
        onSelect={setSel}
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', disabled: true },
          { id: 'c', label: 'C' },
        ]}
      >
        <TabPanel id="a">Panel A</TabPanel>
        <TabPanel id="b">Panel B</TabPanel>
        <TabPanel id="c">Panel C</TabPanel>
      </Tabs>
    );
  }
  it('moves with arrows, wraps, skips disabled, activates automatically', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Panel C')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SegmentedControl', () => {
  function Harness() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return (
      <SegmentedControl
        label="Origin"
        value={v}
        onChange={setV}
        options={[
          { value: 'a', label: 'All' },
          { value: 'b', label: 'Official' },
          { value: 'c', label: 'Local' },
        ]}
      />
    );
  }
  it('is one tab stop with arrow-key selection', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Official' })).toBeChecked();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Official' })).not.toHaveFocus();
  });
});

describe('ConfirmDialog', () => {
  it('focuses Cancel for destructive confirms, requires typed text, returns focus', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onPress={() => setOpen(true)}>Delete</Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Delete demo?"
            tone="danger"
            requireText="demo"
            confirmLabel="Delete"
            onConfirm={onConfirm}
          />
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Type to confirm'), 'demo');
    expect(confirm).toBeEnabled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('Dialog', () => {
  it('traps focus and labels itself by the title', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Hello"
          footer={<Button onPress={() => setOpen(false)}>Done</Button>}
        >
          <Button>Inside</Button>
        </Dialog>
      );
    }
    render(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Hello' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('Pagination', () => {
  it('navigates with the input and clamps out-of-range', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination total={100} page={1} pageSize={10} noun="runs" onPageChange={onPageChange} />);
    expect(screen.getByRole('navigation', { name: 'runs pagination' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    const input = screen.getByRole('spinbutton', { name: 'Page' });
    await user.clear(input);
    await user.type(input, '4{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    await user.clear(input);
    await user.type(input, '99{Enter}');
    expect(onPageChange).toHaveBeenLastCalledWith(10);
  });
});

describe('ErrorState', () => {
  it('renders Sign in for 401, Retry for 500, nothing for 404', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <ErrorState error={new ApiError(401, 'x')} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-error-kind', 'auth');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      expect.stringContaining('/login?next='),
    );
    rerender(
      <MemoryRouter>
        <ErrorState error={new ApiError(500, 'boom')} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <ErrorState error={new ApiError(404, 'gone')} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
  });
});

describe('Toast', () => {
  it('uses role=alert for errors and status otherwise, with an action', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    function Trigger() {
      const toast = useToast();
      return (
        <>
          <Button onPress={() => toast.show('Saved', { tone: 'success' })}>ok</Button>
          <Button
            onPress={() =>
              toast.show('Failed', { tone: 'error', action: { label: 'Undo', onClick: action } })
            }
          >
            err
          </Button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    await user.click(screen.getByRole('button', { name: 'err' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(action).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('HelpMarker', () => {
  it('is described by its text and pins on press', async () => {
    const user = userEvent.setup();
    render(<HelpMarker label="confidence">Wilson interval.</HelpMarker>);
    const marker = screen.getByRole('button', { name: 'Explain confidence' });
    expect(marker).toHaveAccessibleDescription('Wilson interval.');
    await user.click(marker);
    expect(marker).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(marker).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('status primitives', () => {
  it('render silhouettes and bands', async () => {
    const { container } = render(
      <div>
        <Badge tone="success">ok</Badge>
        <Tag kind="role">admin</Tag>
        <ScoreValue value={0.95} direction="higher" />
        <ScoreValue value={null} error="task" />
      </div>,
    );
    expect(container.querySelector('[data-band="5"]')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Task error' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Button and LinkButton states', () => {
  it('a loading Button is disabled and announces Loading', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(within(btn).getByText('Loading')).toHaveTextContent('Loading');
  });

  it('a disabled LinkButton is aria-disabled and is inert', async () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <LinkButton to="/x" isDisabled onClick={onClick}>
          Open
        </LinkButton>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).not.toHaveAttribute('href');
    link.focus();
    expect(link).toHaveFocus();
  });
});

describe('Toast', () => {
  it('stays while hovered and is dismissed after leaving', async () => {
    vi.useFakeTimers();
    try {
      function Fire() {
        const toast = useToast();
        return <button onClick={() => toast.show('Saved', { timeout: 1000 })}>fire</button>;
      }
      render(
        <ToastProvider>
          <Fire />
        </ToastProvider>,
      );
      await act(async () => {
        screen.getByText('fire').click();
      });
      const toast = screen.getByText('Saved').closest('[role=status]') as HTMLElement;
      await act(async () => {
        fireEvent.mouseEnter(toast);
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText('Saved')).toBeInTheDocument();
      await act(async () => {
        fireEvent.mouseLeave(toast);
        vi.advanceTimersByTime(2_500);
      });
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('JsonViewer strings', () => {
  it('carry dir=auto', () => {
    const { container } = render(<JsonTree data={{ q: 'مرحبا' }} />);
    expect(container.querySelector('[dir="auto"]')).toHaveTextContent('مرحبا');
  });
});

describe('Disclosure', () => {
  it('toggles with the keyboard, exposes aria-expanded and has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Disclosure title="Input mapping" summary="Default fields">
        <p>Mapping body</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Input mapping/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Default fields')).toBeInTheDocument();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Mapping body')).toBeVisible();
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('can be controlled and reports changes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Disclosure title="Context" open onOpenChange={onOpenChange}>
        <p>Body</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole('button', { name: /Context/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
