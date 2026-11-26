/**
 * Performance run page: the end of a run's log, held by the page.
 * The log route gives lines in order after a number. A long log is not walked from its first line: when
 * no filter narrows it, the page skips to the last lines; a filtered log is walked (its lines are few) and
 * only then skipped. Later reads ask only for what came after the lines already held.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERFORMANCE_POLL_ACTIVE_MS,
  fetchPerformanceLog,
  performanceKeys,
  type PerformanceLogFilters,
  type PerformanceLogLevel,
  type PerformanceLogLine,
  type PerformanceLogPage,
  type PerformanceTailOptions,
} from '@/api/performance';

export interface LogTail {
  /** In the log's own order; at most `LOG_KEEP` lines, the newest ones. */
  lines: PerformanceLogLine[];
  /** Everything up to this number has been asked for. */
  cursor: number;
  /** Lines that match the filters in the whole log. */
  total: number;
  /** Lines the runner or qym had to drop. */
  dropped: number;
}

export interface LogTailFilters {
  level: PerformanceLogLevel[];
  q: string;
}

/** Lines asked for in one request (the route's most). */
export const LOG_PAGE = 1000;
/** Lines the page keeps in memory. */
export const LOG_KEEP = 5000;
/** Requests a filtered log is walked for before the page skips to its end. */
const WALK_REQUESTS = 10;
/** No single read asks more often than this. */
const MOST_REQUESTS = 30;

type FetchLog = (filters: PerformanceLogFilters) => Promise<PerformanceLogPage>;

/** The first read of a log (no `held`), or the lines that came after the ones already held. */
export async function loadLogTail(
  fetchPage: FetchLog,
  filters: LogTailFilters,
  held?: LogTail,
): Promise<LogTail> {
  const narrowed = Boolean(filters.q) || filters.level.length > 0;
  let lines = held?.lines ?? [];
  let cursor = held?.cursor ?? 0;
  let total = held?.total ?? 0;
  let dropped = held?.dropped ?? 0;
  for (let requests = 1; requests <= MOST_REQUESTS; requests += 1) {
    const page = await fetchPage({
      after_seq: cursor,
      limit: LOG_PAGE,
      level: filters.level,
      q: filters.q,
    });
    total = page.total;
    dropped = page.dropped;
    lines = lines.concat(page.lines).slice(-LOG_KEEP);
    if (page.next_after_seq === null) {
      cursor = Math.max(cursor, page.last_seq);
      break;
    }
    const end = page.last_seq - LOG_PAGE;
    if ((!narrowed || requests >= WALK_REQUESTS) && end > page.next_after_seq) {
      // Not adjoining any more: what is held would leave a gap, so only the end is kept.
      lines = [];
      cursor = end;
    } else cursor = page.next_after_seq;
  }
  return { lines, cursor, total, dropped };
}

export const logTailKey = (slug: string, runId: string, filters: LogTailFilters) =>
  [
    ...performanceKeys.run(slug, runId),
    'log-tail',
    { level: [...filters.level].sort(), q: filters.q },
  ] as const;

/** The end of the log; every 5 s the new lines while the run is active. Read again when the run ends. */
export function useLogTail(
  slug: string,
  runId: string,
  filters: LogTailFilters,
  { active = false, enabled = true }: PerformanceTailOptions = {},
) {
  const client = useQueryClient();
  const queryKey = logTailKey(slug, runId, filters);
  return useQuery({
    queryKey,
    queryFn: () =>
      loadLogTail(
        (page) => fetchPerformanceLog(slug, runId, page),
        queryKey[6],
        client.getQueryData<LogTail>(queryKey),
      ),
    enabled: enabled && Boolean(runId),
    refetchInterval: active ? PERFORMANCE_POLL_ACTIVE_MS : false,
    refetchIntervalInBackground: false,
  });
}
