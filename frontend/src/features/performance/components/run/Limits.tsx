/** Performance run page: one line per limit of the result (what was allowed, what was measured, the result). */
import type { PerformanceThreshold } from '@/api/performance';
import { Card, CardTitle, DataTable, StateTag, type Column } from '@/ui';
import { limitWords } from './limitWords';

const columns: Column<PerformanceThreshold>[] = [
  {
    id: 'limit',
    header: 'Limit',
    minWidth: 220,
    flex: true,
    primary: true,
    priority: 1,
    cardTitle: true,
    cell: (r) => limitWords(r).limit,
  },
  { id: 'scope', header: 'Where', width: 120, priority: 2, cell: (r) => limitWords(r).where },
  {
    id: 'measured',
    header: 'Measured',
    width: 110,
    align: 'center',
    mono: true,
    priority: 2,
    cell: (r) => limitWords(r).measured,
  },
  {
    id: 'result',
    header: 'Result',
    width: 110,
    priority: 1,
    cell: (r) => <StateTag tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'Kept' : 'Broken'}</StateTag>,
  },
];

export function Limits({ thresholds }: { thresholds: PerformanceThreshold[] }) {
  return (
    <Card
      flush
      as="section"
      aria-label="Limits"
      data-performance-block="limits"
      header={
        <CardTitle
          title="Limits"
          description="One line per limit: what was allowed, what was measured, and the result."
        />
      }
    >
      <DataTable
        aria-label="Limits"
        variant="embedded"
        stripe="report"
        density="compact"
        densityLocked
        columns={columns}
        rows={thresholds}
        rowKey={(r) => `${r.scope}-${r.metric}-${r.expression}`}
      />
    </Card>
  );
}
