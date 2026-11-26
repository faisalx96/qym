/** Performance run page: the log as lines. Only the lines near the visible part are in the page. */
import { useLayoutEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PerformanceLogLine } from '@/api/performance';
import { clock } from '../../lib/format';
import styles from './run.module.css';

/** One line of 12px text at a line height of 1.6. A wrapped line is measured when it is drawn. */
const LINE = 19;
/** The well's own padding at its start and end (the small space token). */
const PAD = 8;

/** The tone of a level word: the StateTag tones (warning needs a look, danger bad); an info line has none. */
const LEVEL_TONE: Record<PerformanceLogLine['level'], 'warning' | 'danger' | undefined> = {
  info: undefined,
  warning: 'warning',
  error: 'danger',
};

export function LogViewer({
  lines,
  follow,
  onFollowChange,
}: {
  lines: PerformanceLogLine[];
  /** Keep the newest line in view as lines arrive. */
  follow: boolean;
  /** Called with false when the person scrolls away from the end. */
  onFollowChange: (follow: boolean) => void;
}) {
  const well = useRef<HTMLDivElement>(null);
  // True once the person moved the view themselves; a scroll made by the page is not a reason to let go.
  const moved = useRef(false);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => well.current,
    estimateSize: () => LINE,
    measureElement: (element) => element.getBoundingClientRect().height || LINE,
    overscan: 12,
    paddingStart: PAD,
    paddingEnd: PAD,
    getItemKey: (index) => lines[index]?.seq ?? index,
  });
  const newest = lines.length ? lines[lines.length - 1]!.seq : 0;

  useLayoutEffect(() => {
    if (!follow || !lines.length) return;
    moved.current = false;
    virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
  }, [follow, newest, lines.length, virtualizer]);

  const onScroll = () => {
    const el = well.current;
    if (!el || !follow || !moved.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 2 * LINE) onFollowChange(false);
  };
  const byPerson = () => {
    moved.current = true;
  };

  return (
    // A scrolling region must take keyboard focus so it can be scrolled with the keys.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={well}
      className={styles.log}
      role="log"
      aria-live="off"
      aria-label="Log lines"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      data-performance-block="log"
      data-performance-log-lines={lines.length}
      onScroll={onScroll}
      onWheel={byPerson}
      onTouchMove={byPerson}
      onKeyDown={byPerson}
      onPointerDown={byPerson}
    >
      <div className={styles.logSpace} style={{ blockSize: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index]!;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={styles.logLine}
              data-level={line.level}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {/* A log row reads as a table row (§3.3): the time sans with tabular figures, the level word in the
                  StateTag tone of its level, the message as the runner wrote it, mono. */}
              <span className={styles.logTime}>{clock(line.at)}</span>
              <span className={styles.logLevel} data-tone={LEVEL_TONE[line.level]}>
                {line.level}
              </span>
              <span className={styles.logMessage}>{line.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
