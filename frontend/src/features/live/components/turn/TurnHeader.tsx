import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseLiveFilters, useLiveSources, useLiveTurns, type LiveTurnDetail } from '@/api/live';
import { textDirAttrs } from '@/lib/text';
import { useSearchParamsState } from '@/lib/url-state';
import { Button, Icon, PageHeader, SegmentedControl, Tag, Text } from '@/ui';
import { EnvironmentTag } from '../EnvironmentTag';
import { useExplanationLanguage } from '../../ExplanationLanguage';
import { liveTime, traceHref, turnHref } from './presentation';
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
      <Button
        variant="neutral"
        aria-label="Previous turn"
        icon={<Icon name="prev" size={12} />}
        isDisabled={!previous}
        onPress={() => {
          if (previous) void navigate(turnHref(slug, source, previous.turn_id, list));
        }}
      >
        Previous
      </Button>
      <Button
        variant="neutral"
        aria-label="Next turn"
        iconEnd={<Icon name="next" size={12} />}
        isDisabled={!next}
        onPress={() => {
          if (next) void navigate(turnHref(slug, source, next.turn_id, list));
        }}
      >
        Next
      </Button>
    </span>
  );
}

export function TurnHeader({
  data,
  slug,
  source,
  actions,
}: {
  data: LiveTurnDetail;
  slug: string;
  source: string;
  zone?: string;
  /** The turn's own actions (Re-evaluate), at the end of the title row. */
  actions?: ReactNode;
}) {
  const { turn, conversation } = data;
  const { get } = useSearchParamsState();
  const { language, setLanguage } = useExplanationLanguage();
  const list = get('list');
  const sources = useLiveSources(slug);
  const sourceInfo = sources.data?.sources.find(
    (item) => item.key === source || item.id === source || item.id === turn.source_id,
  );
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
    <div className={styles.header} data-live-block="turn-header">
      <PageHeader
        title={
          <span className={styles.question} data-live-question {...textDirAttrs(turn.question)}>
            {turn.question}
          </span>
        }
        actions={
          <div className={styles.headerTools}>
            <div className={styles.inline}>
              <Text as="span" variant="sm" tone="muted">
                Explanations in:
              </Text>
              <SegmentedControl
                label="Explanation language"
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'en', label: 'English' },
                  {
                    value: 'ar',
                    label: (
                      <span lang="ar" dir="rtl">
                        العربية
                      </span>
                    ),
                  },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </div>
            {list ? <ListNavigation slug={slug} source={source} turnId={turn.turn_id} list={list} /> : null}
            {actions}
          </div>
        }
      />
      <div className={styles.headerMeta}>
        <span className={styles.time}>{liveTime(turn.turn_at)}</span>
        <span className={styles.metaFact}>
          <span>User</span>
          <span className={styles.userRef} dir="auto">
            {user ?? '—'}
          </span>
        </span>
        {turn.conversation_id ? (
          <span className={styles.metaFact}>
            <span>Conversation</span>
            <span className={styles.number} dir="auto">
              {turn.conversation_id}
            </span>
          </span>
        ) : null}
        {current >= 0 ? (
          <span className={styles.time}>
            Turn {current + 1} of {conversation.length}
          </span>
        ) : null}
        {turn.mode ? (
          <Tag kind="data" dir="auto">
            {turn.mode}
          </Tag>
        ) : null}
        {sourceInfo ? (
          <Tag kind="origin" dir="auto">
            {sourceInfo.name}
          </Tag>
        ) : null}
        {sourceInfo?.environment ? <EnvironmentTag environment={sourceInfo.environment} /> : null}
        {backfilled ? (
          <Tag kind="version" dir="auto">
            Backfilled
          </Tag>
        ) : null}
        {productTrace ? (
          <a href={productTrace} target="_blank" rel="noopener noreferrer" className={styles.traceLink}>
            Product trace <Icon name="external" size={12} />
          </a>
        ) : null}
        {evaluationTrace ? (
          <a href={evaluationTrace} target="_blank" rel="noopener noreferrer" className={styles.traceLink}>
            Evaluation trace <Icon name="external" size={12} />
          </a>
        ) : null}
      </div>
    </div>
  );
}
