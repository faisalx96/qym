import { useNavigate } from 'react-router-dom';
import { parseLiveFilters, useLiveSources, useLiveTurns, type LiveTurnDetail } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { Card, IconButton, PageHeader, Tag } from '@/ui';
import { DiagnosisLabel } from './Evidence';
import { labelFor, traceHref, turnHref, utcTime } from './presentation';
import styles from '../../turn.module.css';

function ListNavigation({
  slug,
  source,
  turnId,
  list,
}: {
  slug: string;
  source: string;
  turnId: string;
  list: string;
}) {
  const navigate = useNavigate();
  const filters = parseLiveFilters(new URLSearchParams(list));
  const query = useLiveTurns(slug, { ...filters, page_size: filters.page_size ?? 50 }, source);
  const rows = query.isPlaceholderData || query.isError ? [] : (query.data?.rows ?? []);
  const index = rows.findIndex((row) => row.turn_id === turnId);
  const previous = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 ? rows[index + 1] : undefined;
  return (
    <span className={styles.inline} data-live-block="turn-navigation">
      <IconButton
        label="Previous turn"
        icon="prev"
        isDisabled={!previous}
        onPress={() => {
          if (previous) void navigate(turnHref(slug, source, previous.turn_id, list));
        }}
      />
      <IconButton
        label="Next turn"
        icon="next"
        isDisabled={!next}
        onPress={() => {
          if (next) void navigate(turnHref(slug, source, next.turn_id, list));
        }}
      />
    </span>
  );
}

export function TurnHeader({ data, slug, source }: { data: LiveTurnDetail; slug: string; source: string }) {
  const { turn, conversation, specs } = data;
  const { get } = useSearchParamsState();
  const list = get('list');
  const sources = useLiveSources(slug);
  const environment = sources.data?.sources.find(
    (item) => item.key === source || item.id === source || item.id === turn.source_id,
  )?.environment;
  const productTrace = traceHref(turn.trace_url);
  const evaluationTrace = traceHref(turn.eval_trace_url);
  const siblings = [...conversation].sort((a, b) => a.turn_at.localeCompare(b.turn_at));
  const current = siblings.findIndex((item) => item.current || item.turn_id === turn.turn_id);
  const user = turn.user_ref;
  const provenance = data.summary.provenance;
  const backfilled =
    provenance &&
    typeof provenance === 'object' &&
    'backfill_job_id' in provenance &&
    typeof provenance.backfill_job_id === 'string' &&
    provenance.backfill_job_id.trim().length > 0;
  return (
    <div data-live-block="turn-header">
      <PageHeader
        title={
          <span className={styles.turnTitle} dir="auto" data-live-question>
            {turn.question}
          </span>
        }
        meta={[
          ...(backfilled
            ? [
                <Tag key="backfilled" kind="version" dir="auto">
                  Backfilled
                </Tag>,
              ]
            : []),
          <span key="time" className={styles.number}>
            {utcTime(turn.turn_at)}
          </span>,
          <span
            key="user"
            className={`${styles.number} ${styles.userRef}`}
            dir="auto"
            title={user ?? undefined}
          >
            {user ?? '—'}
          </span>,
          ...(turn.conversation_id
            ? [
                <span key="conversation" title={turn.conversation_id}>
                  conversation{' '}
                  <span className={styles.number} dir="auto">
                    {turn.conversation_id.slice(-3)}
                  </span>{' '}
                  · turn{' '}
                  <span className={styles.number}>
                    {current >= 0 ? current + 1 : '—'} of {conversation.length}
                  </span>
                </span>,
              ]
            : []),
          ...(turn.mode
            ? [
                <Tag key="mode" kind="data" dir="auto">
                  {turn.mode}
                </Tag>,
              ]
            : []),
          ...(environment
            ? [
                <Tag key="environment" kind="data" dir="auto">
                  {environment}
                </Tag>,
              ]
            : []),
          ...(productTrace
            ? [
                <a key="product-trace" href={productTrace} target="_blank" rel="noopener noreferrer">
                  Product trace ↗
                </a>,
              ]
            : []),
          ...(evaluationTrace
            ? [
                <a key="evaluation-trace" href={evaluationTrace} target="_blank" rel="noopener noreferrer">
                  Evaluation trace ↗
                </a>,
              ]
            : []),
        ]}
        actions={
          list ? <ListNavigation slug={slug} source={source} turnId={turn.turn_id} list={list} /> : undefined
        }
      />
      <Card compact tone={labelFor(turn.label, specs).tone} data-live-block="diagnosis-label">
        <div className={styles.inline}>
          <DiagnosisLabel value={turn.label} specs={specs} />
          <span dir="auto">{turn.label_reason ?? '—'}</span>
        </div>
      </Card>
    </div>
  );
}
