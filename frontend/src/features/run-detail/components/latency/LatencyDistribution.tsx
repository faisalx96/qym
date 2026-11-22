/**
 * Latency distribution card (legacy renderDistribution): the mean as the hero, the fastest-to-slowest spectrum with
 * the p50, p90 and p95 pins, then the histogram and, under it on the same x scale, the response-time box plot strip
 * (RD8; its diamond is the one mean mark, round 2). Click a bar, or drag across bars, to filter the page by latency; a pin filters to the items at or above it;
 * the strip's box, whiskers and dots filter or open items as every box plot does.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDuration } from '@/lib/format';
import { Card, CardTitle, ChartTooltipHost, Chip, useMarkTip } from '@/ui';
import {
  durParts,
  durText,
  latencyFilterLabel,
  latencyHistogram,
  latencyPins,
  pct,
  pinChips,
  tickLabel,
  type LatencyBin,
  type LatencyItem,
  type LatencyPin,
  type LatencySummary,
} from '../../lib/latencyModel';
import { useRunPage } from '../../RunContext';
import { boxStats } from '../../lib/boxStats';
import { selectedPart } from '../../lib/boxFilters';
import { useBoxFilter } from '../charts/BoxCard';
import { BoxPlot, boxSentence } from '../charts/BoxPlot';
import { useMeasuredWidth } from '../charts/Charts';
import { TipBody, cssVars } from './Tip';
import styles from './Response.module.css';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

function Pin({
  pin,
  items,
  onFocus,
  onPick,
}: {
  pin: LatencyPin;
  items: LatencyItem[];
  onFocus: (level: LatencyPin['level'] | null) => void;
  onPick: () => void;
}) {
  const n = items.filter((it) => it.latency >= pin.ms).length;
  const { handlers, describedBy } = useMarkTip(
    <TipBody
      title={`${pin.word} of items`}
      rows={[
        ['Items', `${n} of ${items.length}`],
        ['At or above', durText(pin.ms)],
      ]}
      hint="Click to filter the page to them"
    />,
  );
  return (
    <button
      type="button"
      className={styles.pin}
      style={cssVars({ '--tone': pin.tone })}
      aria-label={`${pin.key} ${durText(pin.ms)}, filter to the items at or above`}
      aria-describedby={describedBy}
      onPointerEnter={(e) => {
        handlers.onPointerEnter?.(e);
        onFocus(pin.level);
      }}
      onPointerLeave={() => {
        handlers.onPointerLeave?.();
        onFocus(null);
      }}
      onFocus={(e) => {
        handlers.onFocus?.(e);
        onFocus(pin.level);
      }}
      onBlur={() => {
        handlers.onBlur?.();
        onFocus(null);
      }}
      onClick={onPick}
    >
      <em>{pin.key}</em>
      <b>{formatDuration(pin.ms)}</b>
    </button>
  );
}

function Spectrum({
  L,
  items,
  onFocus,
  onPin,
}: {
  L: LatencySummary;
  items: LatencyItem[];
  onFocus: (level: LatencyPin['level'] | null) => void;
  onPin: (ms: number) => void;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(0);
  const pins = useMemo(() => latencyPins(L), [L]);
  const chips = useMemo(() => pinChips(pins, width), [pins, width]);
  return (
    <div
      ref={ref}
      className={styles.spectrum}
      style={cssVars({ '--p50': `${pins[0]!.x}%`, '--p90': `${pins[1]!.x}%`, '--p95': `${pins[2]!.x}%` })}
    >
      <div className={styles.pins} role="group" aria-label="Latency percentiles">
        {chips.map((chip) => {
          const set = chip.pins;
          const multi = set.length > 1;
          return (
            <div
              key={set.map((p) => p.key).join('-')}
              className={styles.pinset}
              data-multi={multi ? '' : undefined}
              style={cssVars({ '--a': set[0]!.x, '--b': set[set.length - 1]!.x, '--c': chip.join })}
            >
              {/* Centred on its pins, kept inside the spectrum and clear of its neighbour; the stems stay put. */}
              <span
                className={styles.pinchip}
                data-placed={chip.left === null ? undefined : ''}
                style={chip.left === null ? undefined : cssVars({ '--left': `${chip.left}px` })}
              >
                {set.map((pin) => (
                  <Pin key={pin.key} pin={pin} items={items} onFocus={onFocus} onPick={() => onPin(pin.ms)} />
                ))}
              </span>
              {multi ? (
                <>
                  <span className={styles.pinUp} aria-hidden="true" />
                  <span className={styles.pinBracket} aria-hidden="true" />
                </>
              ) : null}
              {set.map((pin) => (
                <span
                  key={pin.key}
                  className={styles.stem}
                  style={cssVars({ '--x': pin.x, '--tone': pin.tone })}
                  aria-hidden="true"
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className={styles.track} aria-hidden="true" />
      <div className={styles.ends}>
        <span>
          <b>{durText(L.min)}</b>fastest
        </span>
        <span>
          slowest<b>{durText(L.max)}</b>
        </span>
      </div>
    </div>
  );
}

function Bar({
  bin,
  index,
  total,
  max,
  out,
  focus,
  onKey,
}: {
  bin: LatencyBin;
  index: number;
  total: number;
  max: number;
  out: boolean;
  focus: LatencyPin['level'] | null;
  onKey: (index: number, extend: boolean) => void;
}) {
  const n = bin.items.length;
  const range = `${tickLabel(bin.a)}–${tickLabel(bin.b)}`;
  const { handlers, describedBy } = useMarkTip(
    <TipBody
      title={range}
      rows={[
        ['Items', n ? `${n} (${pct(n, total).toFixed(0)}%)` : '0'],
        ['Task errors', bin.errors ? String(bin.errors) : '—'],
      ]}
      hint={n ? 'Click, or drag across bars, to filter' : undefined}
    />,
  );
  const lit = focus ? bin.counts.slice(focus).reduce((t, c) => t + c, 0) : 0;
  const label = focus ? (lit === n ? String(n) : `${lit} of ${n}`) : String(n);
  return (
    <span
      className={styles.bar}
      role="button"
      tabIndex={n ? 0 : -1}
      aria-label={`${range}: ${n} items${bin.errors ? `, ${bin.errors} task errors` : ''}`}
      aria-describedby={describedBy}
      data-bin={index}
      data-tone={bin.tone ?? 'bulk'}
      data-empty={n ? undefined : ''}
      data-out={out ? '' : undefined}
      data-lit={focus && lit > 0 ? '' : undefined}
      style={cssVars({
        '--h': n ? Math.max(4, (100 * n) / max) : 0,
        '--e': `${n ? (100 * bin.errors) / n : 0}%`,
      })}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onKey(index, e.shiftKey);
      }}
    >
      {/* A pin hover labels only the bars it lights. */}
      {n && (!focus || lit > 0) ? <span className={styles.count}>{label}</span> : null}
    </span>
  );
}

/**
 * RD8: the response-time box plot as a 40px strip under the histogram, on the histogram's own x scale (`lo`..`hi`, no
 * side padding), so a bar and the box above the same time line up. Clicking the box or a whisker filters the page by
 * latency; a dot opens its item.
 */
export function LatencyStrip({ items, lo, hi }: { items: LatencyItem[]; lo: number; hi: number }) {
  const { active, onRange, openItem } = useBoxFilter('latency');
  const stats = useMemo(() => boxStats(items.map((i) => i.latency)), [items]);
  const byValue = useMemo(() => {
    const m = new Map<number, string>();
    items.forEach((i) => m.has(i.latency) || m.set(i.latency, i.itemId));
    return m;
  }, [items]);
  const axis = useMemo(
    () => ({ domain: [lo, hi] as [number, number], ticks: [], clipped: false, beyond: 0 }),
    [lo, hi],
  );
  if (stats.n < 2) return null;
  return (
    <div className={styles.strip} data-testid="latency-strip">
      <BoxPlot
        variant="strip"
        stats={stats}
        axis={axis}
        format={(v) => durText(v)}
        tailTone
        name={boxSentence('Response time', stats, (v) => durText(v))}
        selected={selectedPart(active, stats)}
        onRange={onRange}
        onItem={(v) => {
          const id = byValue.get(v);
          if (id) openItem(id);
        }}
        itemLabel={(v) => byValue.get(v)}
      />
    </div>
  );
}

export function LatencyDistribution({ items, L }: { items: LatencyItem[]; L: LatencySummary }) {
  const { api } = useRunPage();
  const filter = api.view.filters.latency;
  const H = useMemo(() => latencyHistogram(items, L), [items, L]);
  const [focus, setFocus] = useState<LatencyPin['level'] | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const apply = (a: number, b: number) => api.setFilters({ latency: { min: a, max: b } });
  const clear = () => api.setFilters({ latency: null });
  const sel: [number, number] | null = filter ? [filter.min, Math.min(filter.max, H.hi)] : null;
  const range: [number, number] | null = drag
    ? [H.bins[Math.min(drag.from, drag.to)]!.a, H.bins[Math.max(drag.from, drag.to)]!.b]
    : sel;
  const pick = (from: number, to: number) => {
    const a = H.bins[Math.min(from, to)]!.a;
    const b = H.bins[Math.max(from, to)]!.b;
    // Clicking the range already selected clears it.
    if (sel && sel[0] === a && sel[1] === b) clear();
    else apply(a, b);
  };
  const binAt = (e: PointerEvent) => {
    const r = plotRef.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(H.bins.length - 1, Math.floor(((e.clientX - r.left) / r.width) * H.bins.length)),
    );
  };
  const brush = range ? { a: Math.max(0, H.xPct(range[0])), b: Math.min(100, H.xPct(range[1])) } : null;
  return (
    <Card as="section" className={styles.box} aria-label="Latency distribution">
      <div className={styles.inner}>
        <CardTitle
          as="h4"
          title="Latency distribution"
          description="Each item’s run time, without evaluation. Click or drag across bars to filter the page."
          aside={
            filter ? (
              <Chip isSelected removeLabel="Clear the latency filter" onRemove={clear}>
                {latencyFilterLabel(filter)}
              </Chip>
            ) : undefined
          }
        />
        <ChartTooltipHost className={styles.lathead}>
          <div className={styles.hero}>
            <span className={styles.eyebrow}>
              <i className={styles.diamond} aria-hidden="true" />
              Mean
            </span>
            <span className={styles.heroValue}>
              {durParts(L.mean)[0]}
              <small>{durParts(L.mean)[1]}</small>
            </span>
            <span className={styles.heroSub}>
              across {fmtInt(items.length)} item{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <Spectrum L={L} items={items} onFocus={setFocus} onPin={(ms) => apply(ms, Infinity)} />
        </ChartTooltipHost>
        <ChartTooltipHost
          className={styles.hist}
          data-focus={focus ?? undefined}
          data-selection={range ? '' : undefined}
        >
          <div className={styles.histGrid} aria-hidden="true">
            <i style={cssVars({ '--y': 50 })} />
            <i style={cssVars({ '--y': 100 })} />
          </div>
          <div
            ref={plotRef}
            className={styles.plot}
            role="group"
            aria-label="Latency histogram: click a bar, or drag across bars, to filter the page"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              // Shift extends the range from the last bar picked, as the keyboard does.
              const at = binAt(e);
              const from = e.shiftKey && anchor !== null ? anchor : at;
              setDrag({ from, to: at });
              if (from === at) setAnchor(at);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* synthetic pointer */
              }
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const to = binAt(e);
              if (to !== drag.to) setDrag({ from: drag.from, to });
            }}
            onPointerUp={() => {
              if (!drag) return;
              setDrag(null);
              pick(drag.from, drag.to);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {H.bins.map((bin, i) => (
              <Bar
                key={i}
                bin={bin}
                index={i}
                total={items.length}
                max={H.max}
                out={!!range && (bin.b <= range[0] || bin.a >= range[1])}
                focus={focus}
                onKey={(index, extend) => {
                  const from = extend && anchor !== null ? anchor : index;
                  setAnchor(extend && anchor !== null ? anchor : index);
                  pick(from, index);
                }}
              />
            ))}
            {brush ? (
              <span
                className={styles.brush}
                style={cssVars({ '--a': brush.a, '--w': Math.max(0, brush.b - brush.a) })}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className={styles.axis} aria-hidden="true">
            {H.ticks.map((t) => (
              <span key={t} style={cssVars({ '--x': H.xPct(t) })}>
                {tickLabel(t)}
              </span>
            ))}
            {/* Round 2 RD8: the mean shows once. With the strip box plot under the axis (2+ items), its diamond is the
                mean on this same x scale, so the axis carries no second diamond. */}
            {items.length < 2 ? (
              <i
                className={`${styles.diamond} ${styles.meanMark}`}
                style={cssVars({ '--x': H.xPct(L.mean) })}
                title={`Mean ${durText(L.mean)}`}
              />
            ) : null}
          </div>
        </ChartTooltipHost>
        <LatencyStrip items={items} lo={H.lo} hi={H.hi} />
      </div>
    </Card>
  );
}
