/** Previous / next run in the Runs-list order the reader came from (brief 04 J9). */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { runKeys, fetchNeighbors } from '@/api/runs';
import { runPath } from '@/app/routes';
import { Icon, Kbd, Tooltip } from '@/ui';
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

function peek(target: NeighborRun): string {
  const parts = [
    target.run_name ?? target.run_id,
    target.model,
    target.primary?.metric && target.primary.value != null
      ? `${target.primary.metric} ${(target.primary.value * 100).toFixed(1)}%`
      : null,
  ];
  return parts.filter(Boolean).join(' · ');
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
      <Tooltip
        content={
          <span>
            {noun} <Kbd>{which === 'previous' ? 'K' : 'J'}</Kbd> · {peek(target)}
          </span>
        }
      >
        <Link
          className={styles.step}
          to={href}
          aria-label={`${noun}: ${target.run_name ?? target.run_id}`}
          aria-keyshortcuts={which === 'previous' ? 'K' : 'J'}
        >
          {icon}
        </Link>
      </Tooltip>
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
