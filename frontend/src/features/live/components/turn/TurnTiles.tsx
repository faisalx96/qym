import type { LiveTurnDetail } from '@/api/live';
import { formatDurationMs } from '@/lib/format';
import { StatStrip, type StatStripItem } from '@/ui';
import { chartsOf, judgeOf } from '../../lib/summary';
import { MetricValue } from './Evidence';

export function TurnTiles({ data }: { data: LiveTurnDetail }) {
  const metric = (key: string, label: string, override?: number | null): StatStripItem => {
    const score = data.scores.find((item) => item.metric_name === key);
    const spec = data.specs.find((item) => item.metric_name === key) ?? score?.spec;
    return {
      key,
      label,
      value: (
        <MetricValue
          value={override ?? (score?.skipped ? null : (score?.score_numeric ?? null))}
          spec={spec}
        />
      ),
      help: `This turn's ${label.toLowerCase()}; unavailable or skipped values show a dash.`,
    };
  };
  return (
    <div data-live-block="turn-tiles">
      <StatStrip
        variant="compact"
        aria-label="Turn numbers"
        items={[
          metric('agent_success', 'Agent success'),
          metric('compliance_a', 'Compliance A', judgeOf(data.summary, 'a')?.compliance.overall),
          metric('compliance_b', 'Compliance B', judgeOf(data.summary, 'b')?.compliance.overall),
          {
            key: 'latency',
            label: 'Latency',
            value: data.turn.latency_ms === 0 ? '0ms' : formatDurationMs(data.turn.latency_ms),
            help: 'Elapsed response time for this turn.',
          },
          {
            key: 'rows',
            label: 'Result rows',
            value: data.turn.result_rows ?? '—',
            help: 'Rows returned by the agent SQL.',
          },
          {
            key: 'charts',
            label: 'Charts',
            value: chartsOf(data.summary).length,
            help: 'Charts included in the evaluation evidence.',
          },
        ].map((item) => ({
          ...item,
          value: <span data-live-stat={item.key}>{item.value}</span>,
          data: { 'data-tile': item.key ?? '' },
        }))}
      />
    </div>
  );
}
