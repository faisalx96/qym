/** Model identity helpers (decision §9.7): series slot from the server's frequency-ordered modelIndex. */
import { parseModelKey, stripProvider } from '@/lib/runs-order';

export function modelKeyOf(row: { model_key?: string; model_name: string }): string {
  return row.model_key ?? `${row.model_name}|||plain`;
}

export function plainModelName(key: string): string {
  return stripProvider(parseModelKey(key).name) || 'No model';
}

/** Series slot 1..8. */
export function modelSlot(key: string, index: Record<string, number>): number {
  return ((index[key] ?? 0) % 8) + 1;
}

/** Marker shape for the wrap-around beyond 8 models. */
export function modelShape(key: string, index: Record<string, number>): 'circle' | 'square' | 'diamond' {
  return (['circle', 'square', 'diamond'] as const)[Math.floor((index[key] ?? 0) / 8) % 3] ?? 'circle';
}

export const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  RUNNING: 'Running',
  FAILED: 'Failed',
  STOPPED: 'Stopped',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
  DRAFT: 'Draft',
  STOPPING: 'Stopping…',
};

/** Smart decimals (percent points) so a score differs from its neighbours. */
export function smartDigits(
  value: number | undefined,
  neighbours: [number | null, number | null] | undefined,
): number {
  if (value === undefined || !neighbours) return 1;
  for (let d = 1; d <= 3; d++) {
    const r = (x: number) => (x * 100).toFixed(d);
    if (neighbours.every((n) => n === null || r(n) !== r(value))) return d;
  }
  return 3;
}
