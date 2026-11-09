import { useParams } from 'react-router-dom';
import { useLiveSources } from '@/api/live';
import { useProjectContext } from '@/features/shell/ProjectContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { ErrorState, PageHeader, Skeleton, Text } from '@/ui';
import { LiveEmptyState } from './LiveEmptyState';
import { LiveOverviewPage } from './LiveOverviewPage';
import { LiveTurnPage } from './LiveTurnPage';
import { LiveWorkerPage } from './LiveWorkerPage';
import { LiveTurnsPage } from './LiveTurnsPage';
import { zoneToday } from './lib/zone';
import styles from './live.module.css';

function LiveRoute({ title }: { title: string }) {
  const { slug, project } = useProjectContext();
  useDocumentTitle(`${project.name} · ${title}`);
  const query = useLiveSources(slug);
  const showSkeleton = useDelayedPending(query.isPending);

  return (
    <div className={`${fullWidth} ${styles.page}`}>
      <PageHeader title={title} />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Couldn’t load live sources"
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending || showSkeleton ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={3} label="Loading live sources" />
        ) : null
      ) : query.data.sources.length === 0 ? (
        <LiveEmptyState />
      ) : (
        <Text tone="muted">Coming in the next task</Text>
      )}
    </div>
  );
}

export function LiveOverviewRoute() {
  const { slug } = useProjectContext();
  const query = useLiveSources(slug);
  const { get } = useSearchParamsState();
  const source = get('source') || query.data?.default_source || query.data?.sources[0]?.key;
  const sourceInfo = query.data?.sources.find((item) => item.key === source || item.id === source);
  if (query.data?.sources.length && source) {
    return (
      <LiveOverviewPage
        slug={slug}
        source={source}
        day={get('day') || zoneToday(sourceInfo?.day_key_timezone)}
        zone={sourceInfo?.day_key_timezone}
      />
    );
  }
  return <LiveRoute title="Live evaluation" />;
}

export function LiveTurnsRoute() {
  const { slug } = useProjectContext();
  const query = useLiveSources(slug);
  const { get } = useSearchParamsState();
  const source = get('source') || query.data?.default_source || query.data?.sources[0]?.key;
  if (query.data?.sources.length && source) return <LiveTurnsPage slug={slug} source={source} />;
  return <LiveRoute title="Turns" />;
}

export function LiveTurnRoute() {
  const { slug } = useProjectContext();
  const query = useLiveSources(slug);
  const { get } = useSearchParamsState();
  // The turn id is the splat after live/turns/; producers may use ids with slashes.
  const splat = useParams()['*'] ?? '';
  const turnId = splat
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/');
  const source = get('source') || query.data?.default_source || query.data?.sources[0]?.key;
  if (query.data?.sources.length && source && turnId) {
    return <LiveTurnPage slug={slug} source={source} turnId={turnId} />;
  }
  return <LiveRoute title="Turn" />;
}

export function LiveWorkerRoute() {
  const { slug } = useProjectContext();
  const query = useLiveSources(slug);
  const { get } = useSearchParamsState();
  const source = get('source') || query.data?.default_source || query.data?.sources[0]?.key;
  if (query.data?.sources.length && source) return <LiveWorkerPage slug={slug} source={source} />;
  return <LiveRoute title="Worker" />;
}
