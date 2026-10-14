import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  Badge,
  Card,
  ChartTooltipHost,
  Chip,
  DeltaCell,
  Icon,
  KeyValueGrid,
  Mark,
  RunStatusBadge,
  ScoreBar,
  ScoreValue,
  SeriesHighlightRoot,
  StatStrip,
  Tag,
  useSeriesHighlight,
} from '@/ui';
import { RateBar } from '@/features/run-detail/components/charts/Charts';

afterEach(() => vi.useRealTimers());

describe('Card', () => {
  it('is passive by default: no role, no interactive attribute, tone sets the rail', () => {
    const { container } = render(
      <Card tone="danger" data-testid="c">
        body
      </Card>,
    );
    const c = screen.getByTestId('c');
    expect(c.tagName).toBe('DIV');
    expect(c).not.toHaveAttribute('role');
    expect(c).not.toHaveAttribute('data-interactive');
    expect(c).toHaveAttribute('data-tone', 'danger');
    expect(c).toHaveAttribute('data-rail');
    expect(container.querySelector('[data-tone="danger"]')).toBe(c);
  });

  it('band and series colour the rail; rail="none" drops it; wash is explicit', () => {
    render(
      <>
        <Card band={2} data-testid="b" />
        <Card series={6} data-testid="s" />
        <Card tone="info" rail="none" data-testid="n" />
        <Card wash="live" data-testid="w" />
      </>,
    );
    expect(screen.getByTestId('b')).toHaveAttribute('data-band', '2');
    expect(screen.getByTestId('s')).toHaveAttribute('data-series', '6');
    expect(screen.getByTestId('n')).not.toHaveAttribute('data-rail');
    expect(screen.getByTestId('w')).toHaveAttribute('data-wash', 'live');
    expect(screen.getByTestId('w')).not.toHaveAttribute('data-rail');
  });

  it('onPress makes it a keyboard-operable button with selected state', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <Card onPress={onPress} isSelected data-testid="c">
        go
      </Card>,
    );
    const c = screen.getByRole('button');
    expect(c).toHaveAttribute('aria-pressed', 'true');
    expect(c).toHaveAttribute('data-selected');
    expect(c).toHaveAttribute('data-interactive');
    await user.click(c);
    c.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it('to and href render links; disabled interactive cards do not act', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <MemoryRouter>
        <Card to="/x">to</Card>
        <Card href="/y">href</Card>
        <Card onPress={onPress} isDisabled>
          off
        </Card>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'to' })).toHaveAttribute('href', '/x');
    expect(screen.getByRole('link', { name: 'href' })).toHaveAttribute('href', '/y');
    await user.click(screen.getByRole('button', { name: 'off' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders header and footer slots and passes axe', async () => {
    const { container } = render(
      <MemoryRouter>
        <Card tone="success" header="Head" footer="Foot" as="section" aria-label="card">
          body
        </Card>
        <Card band={4} onPress={() => undefined}>
          press
        </Card>
      </MemoryRouter>,
    );
    expect(screen.getByText('Head')).toBeInTheDocument();
    expect(screen.getByText('Foot')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('tone primitives', () => {
  it('Badge exposes tone and an aria-hidden glyph; RunStatusBadge marks Approved with a check', () => {
    render(
      <>
        <Badge tone="meta" glyph="✓">
          x
        </Badge>
        <RunStatusBadge status="APPROVED" />
        <RunStatusBadge status="COMPLETED" />
      </>,
    );
    expect(screen.getByText('x').closest('[data-tone]')).toHaveAttribute('data-tone', 'meta');
    expect(document.querySelector('[data-status="APPROVED"] [aria-hidden]')?.textContent).toBe('✓');
    expect(document.querySelector('[data-status="COMPLETED"] [aria-hidden]')).toBeNull();
  });

  it('Tag kinds map to tones (task/version/config are meta) and model draws the series dot', () => {
    render(
      <>
        <Tag kind="task">t</Tag>
        <Tag kind="version">v</Tag>
        <Tag kind="config">c</Tag>
        <Tag kind="dataset">d</Tag>
        <Tag kind="model" series={4}>
          m
        </Tag>
      </>,
    );
    for (const t of ['t', 'v', 'c']) expect(screen.getByText(t)).toHaveAttribute('data-tone', 'meta');
    expect(screen.getByText('d')).not.toHaveAttribute('data-tone');
    expect(screen.getByText('m').querySelector('[data-series="4"]')).not.toBeNull();
  });

  it('Chip takes a tone or a series for its selected colour', () => {
    render(
      <>
        <Chip tone="danger" isSelected>
          a
        </Chip>
        <Chip series={5} isSelected>
          b
        </Chip>
        <Chip>c</Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('data-series', '5');
    expect(screen.getByRole('button', { name: 'c' })).not.toHaveAttribute('data-tone');
  });

  it('ScoreValue pill keeps the band and the title cue', () => {
    render(<ScoreValue value={0.95} direction="higher" variant="pill" />);
    const el = screen.getByTitle('Band 5 of 5');
    expect(el).toHaveAttribute('data-variant', 'pill');
    expect(el).toHaveAttribute('data-band', '5');
  });

  it('DeltaCell pill only outside the noise band and only with a verdict', () => {
    const { container, rerender } = render(<DeltaCell value={0.1} direction="higher" emphasis />);
    expect(container.querySelector('[data-pill]')).not.toBeNull();
    rerender(<DeltaCell value={0.001} direction="higher" noise={0.01} emphasis />);
    expect(container.querySelector('[data-pill]')).toBeNull();
    rerender(<DeltaCell value={0.1} emphasis />);
    expect(container.querySelector('[data-pill]')).toBeNull();
  });

  it('Icon has the trace-kind glyphs', () => {
    const { container } = render(
      <>
        {(['wrench', 'brain', 'bot', 'target'] as const).map((n) => (
          <Icon key={n} name={n} />
        ))}
      </>,
    );
    for (const n of ['wrench', 'brain', 'bot', 'target'])
      expect(container.querySelector(`[data-icon="${n}"] path`)?.getAttribute('d')).toBeTruthy();
  });
});

describe('bars and motion', () => {
  it('ScoreBar entrance runs once: data-enter is set on mount and dropped after the window', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ScoreBar value={0.5} direction="higher" index={3} />);
    const fill = () => container.querySelector('[data-enter]');
    expect(fill()).not.toBeNull();
    expect(fill()).toHaveStyle({ '--i': '3' });
    act(() => void vi.advanceTimersByTime(800));
    expect(fill()).toBeNull();
    rerender(<ScoreBar value={0.9} direction="higher" index={3} />);
    expect(fill()).toBeNull();
  });

  it('ScoreBar stagger is capped at 10 marks', () => {
    const { container } = render(<ScoreBar value={0.5} direction="higher" index={40} />);
    expect(container.querySelector('[data-enter]')).toHaveStyle({ '--i': '10' });
  });

  it('ScoreBar lg puts the value inside the bar; series colours the fill, not a band', () => {
    const { container } = render(
      <>
        <ScoreBar value={0.8} direction="higher" size="lg" />
        <ScoreBar value={0.8} series={3} />
      </>,
    );
    const bars = container.querySelectorAll('[data-size], [data-series]');
    expect(bars[0]).toHaveAttribute('data-size', 'lg');
    expect(bars[0]).toHaveAttribute('data-band', '4');
    expect(bars[1]).toHaveAttribute('data-series', '3');
    expect(bars[1]).not.toHaveAttribute('data-band');
  });

  it('ScoreBar live flashes only when the value changes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ScoreBar value={0.5} direction="higher" live />);
    expect(container.querySelector('[data-changed]')).toBeNull();
    rerender(<ScoreBar value={0.6} direction="higher" live />);
    act(() => void vi.advanceTimersByTime(10));
    expect(container.querySelector('[data-changed]')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(800));
    expect(container.querySelector('[data-changed]')).toBeNull();
  });

  it('RateBar takes its colour from a band (derived from direction) or a series, never the accent', () => {
    const { container } = render(
      <>
        <RateBar value={0.8} label="a" direction="maximize" />
        <RateBar value={0.1} label="b" band={1} />
        <RateBar value={0.5} label="c" series={7} />
        <RateBar value={0.5} label="d" />
      </>,
    );
    const [a, b, c, d] = Array.from(container.querySelectorAll('[role="img"]'));
    expect(a).toHaveAttribute('data-band', '4');
    expect(b).toHaveAttribute('data-band', '1');
    expect(c).toHaveAttribute('data-series', '7');
    expect(d).not.toHaveAttribute('data-band');
    expect(d).not.toHaveAttribute('data-series');
  });
});

describe('StatStrip', () => {
  it('tints the icon tile and value from the tone, shows the trend with arrow and label', () => {
    const { container } = render(
      <StatStrip
        items={[
          {
            label: 'Errors',
            value: '4',
            tone: 'danger',
            icon: <Icon name="warning" />,
            trend: { delta: -2, verdict: 'good', label: '-2' },
          },
        ]}
      />,
    );
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
    expect(container.querySelector('[data-verdict="good"]')?.textContent).toBe('▲-2');
  });

  it('onPress renders a button that reports selection and is operable', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    const { container } = render(
      <StatStrip
        items={[{ label: 'Errors', value: '4', tone: 'danger', onPress, isSelected: true, help: 'why' }]}
      />,
    );
    const b = screen.getByRole('button', { name: 'Errors 4' });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('[data-selected]')).not.toBeNull();
    await user.click(b);
    expect(onPress).toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('KeyValueGrid', () => {
  it('tiles variant, kinds add a suffix and the meta tone', () => {
    const { container } = render(
      <KeyValueGrid
        variant="tiles"
        items={[
          { key: 'a', value: '1', kind: 'config' },
          { key: 'b', value: '2', kind: 'metadata' },
          { key: 'c', value: '3', tone: 'warning' },
          { key: 'd', value: '4' },
        ]}
      />,
    );
    expect(container.querySelector('dl')).toHaveAttribute('data-variant', 'tiles');
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    const items = container.querySelectorAll('dl > div');
    expect(items[0]).toHaveAttribute('data-tone', 'meta');
    expect(items[2]).toHaveAttribute('data-tone', 'warning');
    expect(items[3]).not.toHaveAttribute('data-tone');
  });
});

describe('chart kit', () => {
  it('a mark opens a role=tooltip on hover and focus, and closes on leave', async () => {
    const user = userEvent.setup();
    render(
      <ChartTooltipHost>
        <Mark as="button" tip="12 items" aria-label="bucket" onPick={() => undefined} />
      </ChartTooltipHost>,
    );
    const m = screen.getByRole('button', { name: 'bucket' });
    expect(m).toHaveAttribute('data-mark');
    expect(m).toHaveAttribute('data-interactive');
    await user.hover(m);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('12 items');
    expect(m).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
    await user.unhover(m);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  });

  it('a touch tap pins the tooltip until Escape', async () => {
    render(
      <ChartTooltipHost>
        <Mark as="button" tip="pinned" aria-label="bucket" onPick={() => undefined} />
      </ChartTooltipHost>,
    );
    const m = screen.getByRole('button', { name: 'bucket' });
    fireEvent.click(m, { pointerType: 'touch' });
    // jsdom's MouseEvent has no pointerType; emulate it on the native event the handler reads
    const ev = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    await act(async () => void m.dispatchEvent(ev));
    expect(screen.getByRole('tooltip')).toHaveTextContent('pinned');
    fireEvent.pointerLeave(m);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a selected mark carries data-selected and aria-pressed; a disabled one is inert', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <>
        <Mark as="button" isSelected onPick={onPick} aria-label="on" />
        <Mark as="button" isDisabled onPick={onPick} aria-label="off" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'on' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'on' })).toHaveAttribute('data-selected');
    await user.click(screen.getByRole('button', { name: 'off' }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('an SVG mark with onPick is a keyboard button', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <svg>
        <Mark as="circle" cx={1} cy={1} r={2} onPick={onPick} aria-label="dot" />
      </svg>,
    );
    const dot = screen.getByRole('button', { name: 'dot' });
    dot.focus();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('SeriesHighlightRoot sets data-series-active from a hovered series', async () => {
    const user = userEvent.setup();
    function Swatch() {
      const h = useSeriesHighlight(3);
      return (
        <button type="button" {...h}>
          three
        </button>
      );
    }
    const { container } = render(
      <SeriesHighlightRoot>
        <Swatch />
      </SeriesHighlightRoot>,
    );
    const root = container.firstElementChild!;
    expect(root).not.toHaveAttribute('data-series-active');
    await user.hover(screen.getByRole('button', { name: 'three' }));
    expect(root).toHaveAttribute('data-series-active', '3');
    await user.unhover(screen.getByRole('button', { name: 'three' }));
    expect(root).not.toHaveAttribute('data-series-active');
  });

  it('ScoreBar marker draws a decorative tick at the baseline position; height md thickens the track', async () => {
    const { container } = render(<ScoreBar value={0.8} series={2} marker={0.25} height="md" />);
    const tick = container.querySelector('[data-testid="score-marker"]');
    expect(tick).toHaveAttribute('aria-hidden', 'true');
    expect((tick as HTMLElement).style.insetInlineStart).toBe('25%');
    expect(container.querySelector('[data-size="md"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
