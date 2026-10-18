/**
 * The rows of the runs table once passes are rows too: a run, or one of its child rows (a pass, the waiting
 * passes, a placeholder while they load, a load error). Pure; the table and the specs share these shapes.
 */
import type { RunPass, RunPasses, RunRow } from '@/api/dashboardTypes';
import { passRef } from '../selection';
import { passRowsView, type QueuedView } from './model';

export type TableRow =
  | { kind: 'run'; key: string; row: RunRow }
  | { kind: 'pass'; key: string; run: RunRow; pass: RunPass; status: string }
  | { kind: 'queued'; key: string; run: RunRow; queued: QueuedView }
  | { kind: 'loading'; key: string; run: RunRow; n: number }
  | { kind: 'error'; key: string; run: RunRow; error: unknown; retry: () => void };

export type ChildOf = Exclude<TableRow, { kind: 'run' }>;

/** The run a row belongs to. */
export const runOf = (r: TableRow): RunRow => (r.kind === 'run' ? r.row : r.run);

export const runKeyOf = (key: string): string => key.split('::')[0]!;

export const QUEUED_SUFFIX = '::queued';

/** A state of the passes query as the DataTable's child rows. */
export interface PassesState {
  data?: RunPasses;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** The loading placeholders: as many as the run has passes (1..10), so the table does not change height. */
export function loadingCount(samples: number): number {
  return Math.max(1, Math.min(10, samples));
}

export function childRowsOf(
  run: RunRow,
  q: PassesState | undefined,
): { rows: ChildOf[]; detail: boolean; setsize?: number } {
  if (!q || (q.isPending && !q.data))
    return {
      rows: Array.from({ length: loadingCount(run.samples) }, (_, i) => ({
        kind: 'loading' as const,
        key: `${run.run_id}::loading${i + 1}`,
        run,
        n: i + 1,
      })),
      // the strip's frame is reserved while the passes load: the group does not change height when they arrive
      detail: true,
    };
  if (q.isError && !q.data)
    return {
      rows: [
        {
          kind: 'error',
          key: `${run.run_id}::error`,
          run,
          error: q.error,
          retry: () => void q.refetch(),
        },
      ],
      detail: false,
    };
  const data = q.data!;
  const view = passRowsView(data.passes, data.samples || run.samples, run.status);
  const rows: ChildOf[] = view.rows.map((v) =>
    v.kind === 'pass'
      ? { kind: 'pass', key: passRef(run.run_id, v.pass.pass_number), run, pass: v.pass, status: v.status }
      : { kind: 'queued', key: `${run.run_id}${QUEUED_SUFFIX}`, run, queued: v },
  );
  // the posinset/setsize of a pass is its place among the run's passes, queued ones included
  return { rows, detail: true, setsize: data.samples || run.samples };
}

/** The metric the strip (and the card lines) show: the remembered one if this run has it, else the run's default. */
export function resolveMetric(
  remembered: string | null,
  scoreMetrics: string[],
  fallback: string | null,
): string | null {
  return remembered && scoreMetrics.includes(remembered) ? remembered : (fallback ?? scoreMetrics[0] ?? null);
}
