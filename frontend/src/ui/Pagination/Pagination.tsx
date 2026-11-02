import { useState, type RefObject } from 'react';
import { IconButton } from '../IconButton';
import styles from './Pagination.module.css';

export interface PaginationProps {
  total: number;
  /** 1-based */
  page: number;
  pageSize: number;
  pageCount?: number;
  noun?: string;
  showSummary?: boolean;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Scrolled to top before every page change. */
  scrollTarget?: RefObject<HTMLElement | null>;
  className?: string;
}

/** Icon buttons + direct page entry + "of N" (DESIGN_LANGUAGE §3 "Pagination"). */
export function Pagination({
  total,
  page,
  pageSize,
  pageCount,
  noun = 'items',
  showSummary = true,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  scrollTarget,
  className,
}: PaginationProps) {
  const pages = Math.max(1, pageCount ?? Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);
  const [draft, setDraft] = useState(String(current));
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    // Adjust state during render (React docs pattern): the page changed from outside.
    setSeen(current);
    setDraft(String(current));
  }
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(total, current * pageSize);
  const digits = String(pages).length;

  function go(next: number) {
    const clamped = Math.min(Math.max(1, Math.round(next)), pages);
    if (clamped === current) {
      setDraft(String(current));
      return;
    }
    scrollTarget?.current?.scrollTo({ top: 0 });
    onPageChange(clamped);
  }
  function commit() {
    const n = Number(draft);
    if (!Number.isFinite(n)) return setDraft(String(current));
    go(n);
  }

  return (
    <nav
      className={[styles.pagination, className].filter(Boolean).join(' ')}
      aria-label={`${noun} pagination`}
    >
      {showSummary ? (
        <span className={styles.summary} aria-live="polite">
          {start}–{end} of {total} {noun}
        </span>
      ) : null}
      <span className={styles.controls}>
        <IconButton label="First page" icon="first" isDisabled={current <= 1} onPress={() => go(1)} />
        <IconButton
          label="Previous page"
          icon="prev"
          isDisabled={current <= 1}
          onPress={() => go(current - 1)}
        />
        <input
          className={styles.input}
          type="number"
          min={1}
          max={pages}
          value={draft}
          aria-label="Page"
          style={{ '--qym-page-digits': digits } as React.CSSProperties}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <span className={styles.total}>of {pages}</span>
        <IconButton
          label="Next page"
          icon="next"
          isDisabled={current >= pages}
          onPress={() => go(current + 1)}
        />
        <IconButton label="Last page" icon="last" isDisabled={current >= pages} onPress={() => go(pages)} />
      </span>
      {pageSizeOptions && onPageSizeChange ? (
        <select
          className={styles.size}
          aria-label={`${noun} per page`}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
      ) : null}
    </nav>
  );
}
