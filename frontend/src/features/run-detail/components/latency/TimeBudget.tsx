/**
 * Time budget card (legacy renderBudget): the average trace, the Agent and Eval brackets (or the sub-agents) over
 * one bar of where its time goes by kind, and the kind legend under it.
 */
import { useMemo, useState } from 'react';
import { Card, ChartTooltipHost, Mark, SegmentedControl, Text } from '@/ui';
import {
  budgetBrackets,
  budgetSegments,
  durParts,
  durText,
  FAMILY_LABEL,
  FAMILY_ORDER,
  FAMILY_TONE,
  PHASE_LABEL,
  PHASE_TONE,
  pct,
  type BudgetMode,
  type BudgetSegment,
  type Family,
  type LatencyData,
} from '../../lib/latencyModel';
import { TipBody, cssVars } from './Tip';
import styles from './Traces.module.css';

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

function segmentTip(s: BudgetSegment, total: number, traces: number) {
  const where = s.phase ? (s.agent ?? PHASE_LABEL[s.phase]) : 'Trace';
  const title = s.overhead ? `${where} · overhead` : `${where} · ${FAMILY_LABEL[s.family]}`;
  const rows: Array<[string, string]> = [
    ['Per trace', durText(s.ms)],
    ['Share', `${pct(s.ms, total).toFixed(1)}%`],
  ];
  s.steps
    .slice()
    .sort((a, b) => (b.mean || 0) * b.n - (a.mean || 0) * a.n)
    .slice(0, 6)
    .forEach((g) => rows.push([g.name, durText(traces ? ((g.mean || 0) * g.n) / traces : NaN)]));
  return <TipBody title={title} rows={rows} />;
}

export function TimeBudget({ D }: { D: LatencyData }) {
  const [mode, setMode] = useState<BudgetMode>('phase');
  const hasAgents = D.agents.length > 0;
  const shown: BudgetMode = hasAgents ? mode : 'phase';
  const segs = useMemo(() => budgetSegments(D), [D]);
  const brackets = useMemo(() => budgetBrackets(D, segs, shown), [D, segs, shown]);
  const total = segs.reduce((t, s) => t + s.ms, 0);
  const avg = D.avgTrace ?? total;
  const byFamily = useMemo(() => {
    const m: Partial<Record<Family, number>> = {};
    segs.forEach((s) => (m[s.family] = (m[s.family] ?? 0) + s.ms));
    return m;
  }, [segs]);
  const families = FAMILY_ORDER.filter((f) => byFamily[f]);
  const [avgValue, avgUnit] = durParts(avg);
  return (
    <Card as="section" className={styles.box} aria-label="Time budget">
      <div className={styles.inner}>
        <div className={styles.head}>
          <Text variant="md" weight={600} as="h4" className={styles.title}>
            Time budget
          </Text>
          {hasAgents ? (
            <SegmentedControl
              label="Time budget grouping"
              options={[
                { value: 'phase', label: 'By phase' },
                { value: 'agent', label: 'By agent' },
              ]}
              value={mode}
              onChange={setMode}
            />
          ) : null}
        </div>
        <div className={styles.anatomy}>
          <div className={styles.summary}>
            <span>
              Average trace{' '}
              <b className={styles.total}>
                {avgValue}
                <small>{avgUnit}</small>
              </b>
            </span>
            <span className={styles.sep} aria-hidden="true" />
            <span>
              <b>{fmtInt(D.traces)}</b> trace{D.traces === 1 ? '' : 's'}
            </span>
            {D.failed ? (
              <span className={styles.failPill} title={`${pct(D.failed, D.traces).toFixed(1)}% of traces`}>
                {fmtInt(D.failed)} failed
              </span>
            ) : null}
          </div>
          <div className={styles.brackets}>
            {brackets.map((b) => (
              <div
                key={b.key}
                className={styles.bracket}
                style={cssVars({
                  '--x': b.x,
                  '--w': Math.max(0, b.w - 0.3),
                  '--tone': b.phase === 'eval' ? PHASE_TONE.eval : PHASE_TONE.task,
                })}
                title={`${b.label} ${durText(b.ms)}`}
              >
                <span>
                  {b.label}
                  <b>{durText(b.ms)}</b>
                </span>
              </div>
            ))}
          </div>
          <ChartTooltipHost
            className={styles.bar}
            role="img"
            aria-label={`Time budget of an average trace: ${families
              .map((f) => `${FAMILY_LABEL[f]} ${durText(byFamily[f]!)}`)
              .join(', ')}`}
          >
            {segs.map((s, i) => {
              const w = pct(s.ms, total);
              return (
                <Mark
                  key={i}
                  className={styles.seg}
                  style={cssVars({ '--w': w, '--tone': FAMILY_TONE[s.family] })}
                  tip={segmentTip(s, total, D.traces)}
                  tabIndex={-1}
                >
                  {w > 6 ? <span>{durText(s.ms).replace(' ', '')}</span> : null}
                </Mark>
              );
            })}
          </ChartTooltipHost>
          <ul className={styles.budgetLegend}>
            {families.map((f) => (
              <li key={f}>
                <i style={cssVars({ '--tone': FAMILY_TONE[f] })} aria-hidden="true" />
                {FAMILY_LABEL[f]} <b>{durText(byFamily[f]!)}</b>
                <em>{pct(byFamily[f]!, total).toFixed(0)}%</em>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
