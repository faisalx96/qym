import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LiveOverview } from '@/api/live';
import { formatLatency, formatPercentValue } from '@/lib/format';
import { metricBand } from '@/lib/metrics';
import { Icon, StatStrip, type CardBand, type StatTone } from '@/ui';
import { diagnosisSpec } from '../lib/mix';
import styles from '../live.module.css';

type DayNumber = {
  key: string;
  label: string;
  value: ReactNode;
  meaning: string;
  icon: ReactNode;
  tone?: StatTone;
  band?: CardBand;
  sub?: ReactNode;
};

export function DayNumbers({
  overview,
  linkTo,
}: {
  overview: LiveOverview;
  linkTo: (filters?: Record<string, string>) => string;
}) {
  const { day, specs, primary_metric: primaryName } = overview;
  const primary = specs.find((spec) => spec.metric_name === primaryName);
  const mean = day.metric_means.find((metric) => metric.metric_name === primaryName)?.mean ?? null;
  const problems = (diagnosisSpec(specs)?.values ?? [])
    .filter(
      (label) => typeof label.value === 'string' && (label.tone === 'danger' || label.tone === 'warning'),
    )
    .sort((a, b) => (day.label_mix[String(b.value)] ?? 0) - (day.label_mix[String(a.value)] ?? 0))
    .slice(0, 2);
  const turns = day.row?.turns_seen ?? day.in_qym;
  const evaluated = day.row?.evaluated;
  const problemTiles: DayNumber[] = problems.map((label) => {
    const key = String(label.value);
    const name = typeof label.label === 'string' ? label.label : key;
    const count = day.label_mix[key] ?? 0;
    return {
      key,
      label: name,
      value: (
        <Link to={linkTo({ label: key })}>{count}</Link>
      ),
      icon: <Icon name={label.tone === 'danger' ? 'close' : 'warning'} />,
      tone: count > 0 ? (label.tone === 'danger' ? 'danger' : 'warning') : undefined,
      meaning: `Turns diagnosed as ${name} on this day.`,
    };
  });
  const fallbacks = [
    { key: 'failed', label: 'Failed', count: day.row?.failed, status: 'failed' },
    { key: 'incomplete', label: 'Incomplete', count: day.row?.incomplete, status: 'incomplete_ingest' },
  ];
  for (const fallback of fallbacks) {
    if (problemTiles.length === 2) break;
    problemTiles.push({
      key: fallback.key,
      label: fallback.label,
      value: <Link to={linkTo({ status: fallback.status })}>{fallback.count ?? '—'}</Link>,
      icon: <Icon name={fallback.key === 'failed' ? 'close' : 'warning'} />,
      tone: (fallback.count ?? 0) > 0 ? (fallback.key === 'failed' ? 'danger' : 'warning') : undefined,
      meaning: `${fallback.label} evaluations reported by the worker for this day.`,
    });
  }
  const items: DayNumber[] = [
    {
      key: 'turns',
      label: 'Turns',
      value: <Link to={linkTo()}>{turns}</Link>,
      icon: <Icon name="feedback" />,
      sub: `${day.in_qym} received in qym`,
      meaning: `${turns} real user turns seen by the worker; ${day.in_qym} received in qym.`,
    },
    {
      key: 'evaluated',
      label: 'Evaluated',
      value: <Link to={linkTo({ status: 'completed' })}>{evaluated ?? '—'}</Link>,
      icon: <Icon name="eye" />,
      sub: `${day.row?.incomplete ?? 0} with incomplete evidence`,
      meaning: `${evaluated ?? 'Unknown number of'} turns evaluated; ${day.row?.incomplete ?? 0} still have incomplete evidence.`,
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
      icon: <Icon name="shield" />,
      band: metricBand(mean, primary?.score_type, primary?.direction ?? null) ?? undefined,
      meaning: primary?.description ?? 'Mean primary metric score for this day. Skipped scores are excluded.',
    },
    ...problemTiles,
    {
      key: 'latency',
      label: 'Median latency',
      value: <Link to={linkTo({ sort: '-latency_ms' })}>{formatLatency(day.latency.median_ms)}</Link>,
      icon: <Icon name="clock" />,
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
          icon: item.icon,
          tone: item.tone,
          sub: item.sub,
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
