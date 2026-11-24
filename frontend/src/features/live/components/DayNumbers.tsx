import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LiveOverview } from '@/api/live';
import { formatLatency, formatPercentValue } from '@/lib/format';
import { metricBand } from '@/lib/metrics';
import { StatStrip, type CardBand } from '@/ui';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../live.module.css';

type DayNumber = {
  key: string;
  label: string;
  value: ReactNode;
  meaning: string;
  band?: CardBand;
};

export function DayNumbers({
  overview,
  linkTo,
  period = 'today',
}: {
  overview: LiveOverview;
  linkTo: (filters?: Record<string, string>) => string;
  period?: string;
}) {
  const { day, specs, primary_metric: primaryName } = overview;
  const primary = specs.find((spec) => spec.metric_name === primaryName);
  const mean = day.metric_means.find((metric) => metric.metric_name === primaryName)?.mean ?? null;
  const turns = day.row?.turns_seen ?? day.in_qym;
  const evaluated = day.row?.evaluated;
  const waiting = evaluated == null ? null : Math.max(0, day.in_qym - evaluated);
  const notOk = mixSegments(day.label_mix, diagnosisSpec(specs))
    .filter((segment) => segment.specTone !== 'success' && segment.specTone !== 'accent')
    .reduce((sum, segment) => sum + segment.n, 0);
  const items: DayNumber[] = [
    {
      key: 'turns',
      label: `Turns ${period}`,
      value: <Link to={linkTo()}>{turns}</Link>,
      meaning: `${turns} real user turns seen by the worker; ${day.in_qym} received in qym.`,
    },
    {
      key: 'evaluated',
      label: 'Evaluated',
      value: <Link to={linkTo({ status: 'completed' })}>{evaluated ?? '—'}</Link>,
      meaning: `${evaluated ?? 'Unknown number of'} turns evaluated; ${day.row?.incomplete ?? 0} still have incomplete evidence.`,
    },
    {
      key: 'waiting',
      label: 'Waiting for evaluation',
      value: waiting ?? '—',
      meaning: 'Turns received in qym but not evaluated yet.',
    },
    {
      key: 'primary',
      label: primary?.label ?? 'Primary metric',
      value: (
        <Link
          to={linkTo(
            primary?.pass_threshold != null && primary.direction
              ? {
                  metric: primary.metric_name,
                  [primary.direction === 'minimize' ? 'max' : 'min']: String(primary.pass_threshold),
                }
              : {},
          )}
        >
          {formatPercentValue(mean, 1)}
        </Link>
      ),
      band: metricBand(mean, primary?.score_type, primary?.direction ?? null) ?? undefined,
      meaning: primary?.description ?? 'Mean primary metric score for this day. Skipped scores are excluded.',
    },
    {
      key: 'not-ok',
      label: 'Not OK',
      value: notOk,
      meaning:
        'Turns without an OK diagnosis, including Inconclusive, Needs review, Not verified and Not judged. This is not a count of confirmed problems.',
    },
    {
      key: 'latency',
      label: 'Median latency',
      value: <Link to={linkTo({ sort: '-latency_ms' })}>{formatLatency(day.latency.median_ms)}</Link>,
      meaning: `Median response latency. p90: ${formatLatency(day.latency.p90_ms)}; ${day.latency.over_5min} turns took more than 5 minutes.`,
    },
  ];
  return (
    <div className={styles.tiles} data-live-block="tiles">
      <StatStrip
        aria-label="Day numbers"
        items={items.map((item) => ({
          key: item.key,
          label: item.label,
          help: item.meaning,
          value: (
            <span dir="auto" data-live-stat={item.key} data-band={item.band}>
              {item.value}
            </span>
          ),
        }))}
      />
    </div>
  );
}
