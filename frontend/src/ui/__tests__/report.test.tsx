import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickFilterGroup, ReportLayout, ReportSection, ScopeBar } from '@/ui';

type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
const observers: IoCallback[] = [];
function installObserver() {
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IoCallback) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('ReportSection', () => {
  it('renders an xl header, labelled region, scope note and aside', async () => {
    const { container } = render(
      <ReportSection id="overview" title="Overview" description="Scores" scopeNote="over 3 of 9 items">
        <p>body</p>
      </ReportSection>,
    );
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveAttribute('id', 'overview');
    expect(screen.getByText('over 3 of 9 items')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mounts a lazy body once it is seen and keeps it mounted afterwards', () => {
    installObserver();
    render(
      <ReportSection id="latency" title="Latency" lazy minHeight={200}>
        <p>chart</p>
      </ReportSection>,
    );
    expect(screen.queryByText('chart')).toBeNull();
    act(() => observers[0]!([{ isIntersecting: true }]));
    expect(screen.getByText('chart')).toBeInTheDocument();
    act(() => observers[0]!([{ isIntersecting: false }]));
    expect(screen.getByText('chart')).toBeInTheDocument();
  });

  it('renders nothing when hidden', () => {
    const { container } = render(
      <ReportSection id="root-cause" title="Root cause" hidden>
        x
      </ReportSection>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ReportLayout', () => {
  it('shows the inline sidebar only when wide and open', () => {
    const { rerender } = render(
      <ReportLayout sidebar={<p>filters</p>} sidebarOpen={false} wide>
        <p>report</p>
      </ReportLayout>,
    );
    expect(screen.queryByText('filters')).toBeNull();
    rerender(
      <ReportLayout sidebar={<p>filters</p>} sidebarOpen wide>
        <p>report</p>
      </ReportLayout>,
    );
    expect(screen.getByRole('complementary', { name: 'Quick filters' })).toBeInTheDocument();
  });

  it('falls back to a drawer when narrow', () => {
    const { rerender } = render(
      <ReportLayout sidebar={<p>filters</p>} sidebarOpen wide={false} drawerOpen={false}>
        <p>report</p>
      </ReportLayout>,
    );
    expect(screen.queryByText('filters')).toBeNull();
    rerender(
      <ReportLayout
        sidebar={<p>filters</p>}
        sidebarOpen
        wide={false}
        drawerOpen
        onDrawerOpenChange={() => {}}
      >
        <p>report</p>
      </ReportLayout>,
    );
    expect(screen.getByRole('dialog', { name: 'Quick filters' })).toBeInTheDocument();
  });
});

describe('ScopeBar', () => {
  it('reports the scope, removes chips and clears', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onClearAll = vi.fn();
    const onJump = vi.fn();
    const { container } = render(
      <ScopeBar
        shown={12}
        total={40}
        chips={[{ key: 'a', label: 'Failing', onClear }]}
        onClearAll={onClearAll}
        onJumpToItems={onJump}
        sidebarOpen
        onToggleSidebar={() => {}}
      />,
    );
    expect(screen.getByText('Scope: 12 of 40 items')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Failing from scope' }));
    expect(onClear).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View 12 items' }));
    expect(onJump).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hide filters' })).toHaveAttribute('aria-expanded', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('folds chips beyond the limit into +N', () => {
    render(
      <ScopeBar
        shown={1}
        total={2}
        chips={['a', 'b', 'c'].map((k) => ({ key: k, label: k, onClear: () => {} }))}
        maxChips={2}
        onClearAll={() => {}}
        onJumpToItems={() => {}}
        sidebarOpen={false}
        narrow
        onToggleSidebar={() => {}}
      />,
    );
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick filters' })).toBeInTheDocument();
  });
});

describe('QuickFilterGroup', () => {
  it('toggles options and offers Only', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onOnly = vi.fn();
    const { container } = render(
      <QuickFilterGroup
        label="Status"
        mode="multi"
        options={[
          { id: 'pass', label: 'Pass', count: 3 },
          { id: 'fail', label: 'Fail', count: 1, tone: 'danger' },
        ]}
        selected={['pass']}
        onToggle={onToggle}
        onOnly={onOnly}
      />,
    );
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Fail/ }));
    expect(onToggle).toHaveBeenCalledWith('fail');
    await user.click(screen.getByRole('button', { name: 'Only Pass' }));
    expect(onOnly).toHaveBeenCalledWith('pass');
    expect(await axe(container)).toHaveNoViolations();
  });
});
