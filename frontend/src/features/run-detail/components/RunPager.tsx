/** Previous / next run in the Runs-list order the reader came from (brief 04 J9). */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { runKeys, fetchNeighbors } from '@/api/runs';
import { runPath } from '@/app/routes';
import { Icon, Kbd } from '@/ui';
import { formatIsoDateTime } from '../lib/heroModel';
import { singleKeyShortcutsEnabled } from '@/features/runs-list/useRunsKeyboard';
import { collation, neighborQuery, normalizeContext, runHref } from '../lib/runsOrder';
import type { NeighborRun } from '../types';
import styles from './RunPager.module.css';

export function useRunNeighbors(runId: string, slug: string, listParam: string | null) {
  const context = useMemo(() => normalizeContext(listParam), [listParam]);
  return useQuery({
    queryKey: runKeys.neighbors(runId, slug, context),
    queryFn: async () => {
      const order = neighborQuery(context);
      const body = { project_slug: slug, run_id: runId, filters: order.filters, sort: order.sort };
      const first = await fetchNeighbors(body);
      if (first.collation_needed) {
        return fetchNeighbors({ ...body, collation: collation(order.sort, first.sort_values) ?? [] });
      }
      return first;
    },
    enabled: !!slug && !!runId,
    staleTime: 60_000,
    retry: false,
  });
}

/** The neighbour at a glance: name, model and start, then the primary metric. */
export function Peek({ target }: { target: NeighborRun }) {
  const score =
    target.primary?.metric && target.primary.value != null
      ? `${target.primary.metric} ${(target.primary.value * 100).toFixed(1)}%`
      : null;
  const meta = [target.model, target.started_at ? formatIsoDateTime(target.started_at) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={styles.peek} data-testid="pager-peek">
      <span className={styles.peekName}>{target.run_name ?? target.run_id}</span>
      {meta ? <span>{meta}</span> : null}
      {score ? <span className={styles.peekScore}>{score}</span> : null}
    </span>
  );
}

/** An arrow link whose neighbour card opens on hover and keyboard focus, closes on leave, blur and Escape. */
function PeekStep({
  noun,
  shortcut,
  href,
  target,
  icon,
}: {
  noun: string;
  shortcut: string;
  href: string;
  target: NeighborRun;
  icon: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={styles.stepWrap}>
      <Link
        className={styles.step}
        to={href}
        aria-label={`${noun}: ${target.run_name ?? target.run_id}`}
        aria-keyshortcuts={shortcut}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {icon}
      </Link>
      {open ? (
        <span id={id} role="tooltip" className={styles.peekCard}>
          <span>
            {noun} <Kbd>{shortcut}</Kbd>
          </span>
          <Peek target={target} />
        </span>
      ) : null}
    </span>
  );
}

export function RunPager({
  runId,
  slug,
  listParam,
}: {
  runId: string;
  slug: string;
  listParam: string | null;
}) {
  const { data, isError } = useRunNeighbors(runId, slug, listParam);
  const navigate = useNavigate();
  const context = normalizeContext(listParam);
  const listContext = data?.context === 'list' ? context : '';
  const hrefFor = (target: NeighborRun | null | undefined) =>
    target ? runHref(runPath(slug, target.run_id), listContext) : null;
  const previous = hrefFor(data?.previous);
  const next = hrefFor(data?.next);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      if (!singleKeyShortcutsEnabled()) return; // WCAG 2.1.4 opt-out (Runs list > Shortcuts)
      const el = event.target as HTMLElement | null;
      if (
        el?.closest?.(
          'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], dialog',
        )
      )
        return;
      if (Array.from(document.querySelectorAll('[aria-modal="true"]')).some((n) => n.getClientRects().length))
        return;
      const target = key === 'j' ? next : previous;
      if (!target) return;
      event.preventDefault();
      void navigate(target);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, next, previous]);

  const step = (which: 'previous' | 'next', href: string | null, target: NeighborRun | null | undefined) => {
    const noun = which === 'previous' ? 'Previous run' : 'Next run';
    const icon = <Icon name={which === 'previous' ? 'chevron-left' : 'chevron-right'} size={12} />;
    if (!href || !target) {
      return (
        <span
          className={styles.step}
          role="link"
          aria-disabled="true"
          aria-label={`No ${noun.toLowerCase()}`}
          title={`No ${noun.toLowerCase()}`}
        >
          {icon}
        </span>
      );
    }
    return (
      <PeekStep
        noun={noun}
        shortcut={which === 'previous' ? 'K' : 'J'}
        href={href}
        target={target}
        icon={icon}
      />
    );
  };

  const total = data?.total ? Number(data.total).toLocaleString('en-US') : '';
  return (
    <nav
      className={styles.pager}
      aria-label="Previous and next run"
      title={
        !data
          ? isError
            ? 'Could not load the Runs list order.'
            : undefined
          : data.context
            ? undefined
            : 'This run is not in the project’s Runs list.'
      }
    >
      {step('previous', previous, data?.previous)}
      <span className={styles.pos}>
        {data?.context && data.position ? (
          <>
            <span className={styles.num}>{Number(data.position).toLocaleString('en-US')}</span> of {total}
          </>
        ) : null}
      </span>
      {step('next', next, data?.next)}
    </nav>
  );
}
