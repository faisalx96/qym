import { readFileSync } from 'node:fs';
import os from 'node:os';

/** Free memory in GiB: MemAvailable on Linux, os.freemem() elsewhere. */
export function memAvailableGb(): number {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
    if (m) return Number(m[1]) / 1048576;
  } catch {
    /* not Linux */
  }
  return os.freemem() / 2 ** 30;
}

/**
 * Worker count sized from free memory: keep a reserve (2 GiB or 20% of RAM) for the
 * host, then one worker per `gbPerWorker`, clamped to [1, max]. An explicit value
 * (env var, usually set by scripts/heavy.sh) wins.
 */
export function workersFromMemory(explicit: string | undefined, gbPerWorker: number, max: number): number {
  if (explicit !== undefined && explicit !== '' && Number.isFinite(Number(explicit))) {
    return Math.max(1, Math.floor(Number(explicit)));
  }
  const totalGb = os.totalmem() / 2 ** 30;
  const reserveGb = Math.max(2, totalGb * 0.2);
  const budget = memAvailableGb() - reserveGb;
  return Math.max(1, Math.min(max, Math.floor(budget / gbPerWorker)));
}
