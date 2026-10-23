import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Callout } from '@/features/experiments/launch/components/Callout';
import { useFeedbackMessages, type FeedbackDetail, type FeedbackEvent } from '@/api/feedback';
import { useAuth } from '@/features/shell/AuthContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { useCrumbLabel } from '@/lib/crumb-label';
import { useSearchParamsState } from '@/lib/url-state';
import { Card, Eyebrow, Icon, PageHeader, StatStrip, Tabs, Tag, Text, TextBlock } from '@/ui';
import { StatusBadge, cap } from './badges';
import { MsgItem } from './Chat';
import { clock, dateTime, eventText, shortDate } from './format';
import { RelatedList } from './RelatedList';
import { RequestLink } from './RequestLink';
import { TriagePanel } from './TriagePanel';
import { itemsFromMessages } from './turnState';
import styles from './feedback.module.css';

function Section({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <section>
      <Eyebrow>{label}</Eyebrow>
      <TextBlock mode="raw" text={text} />
    </section>
  );
}

export function HistoryCard({ events }: { events: FeedbackEvent[] }) {
  return (
    <Card as="section" aria-label="History" header={<Text variant="md">History</Text>} data-testid="history">
      <ol className={styles.events}>
        {events.map((e) => (
          <li key={e.id} className={styles.event} data-event={e.kind}>
            <span className={styles.eventHead}>
              <strong>{e.actor || 'System'}</strong> <span>{eventText(e)}</span>
              <time>{dateTime(e.created_at)}</time>
            </span>
            {e.note ? <span className={styles.eventNote}>{e.note}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function targetMeta(d: FeedbackDetail) {
  const r = d.request;
  if (r.subject !== 'product') return 'qym itself';
  const project = r.project;
  if (!project) return 'A product';
  const t = r.target;
  let link: React.ReactNode = null;
  if (t) {
    const label = `${t.kind} ${t.id.slice(0, 8)}`;
    const to =
      t.kind === 'run'
        ? `/projects/${project.slug}/runs/${t.id}`
        : t.kind === 'experiment'
          ? `/projects/${project.slug}/experiments/${t.id}`
          : `/projects/${project.slug}/datasets/${t.id}`;
    link = t.accessible ? (
      <>
        {' · '}
        <Link to={to} className={styles.idLink} data-testid="target-link">
          {label}
        </Link>
      </>
    ) : (
      <> · {label}</>
    );
  }
  return (
    <>
      <Tag kind="data">{project.slug}</Tag>
      {link}
    </>
  );
}

/** /feedback/FB-0038 for a confirmed request: the card, its history and (for administrators) the triage panel. */
export function RequestPage({ detail, routeRef }: { detail: FeedbackDetail; routeRef: string }) {
  const r = detail.request;
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { get, replaceUrlQuery } = useSearchParamsState();
  const tab = get('tab') === 'conversation' ? 'conversation' : 'request';
  useDocumentTitle(`${r.ref} · ${r.title}`);
  useCrumbLabel(r.ref);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIdle(true), 400);
    return () => clearTimeout(t);
  }, []);
  const messages = useFeedbackMessages(r.ref, tab === 'conversation' || idle);
  useEffect(() => {
    if (routeRef !== r.ref) navigate(`/feedback/${r.ref}${window.location.search}`, { replace: true });
  }, [routeRef, r.ref, navigate]);
  const dupOf = r.duplicate_of;
  const declined = r.status === 'declined';
  const declineEvent = detail.events.find((e) => e.kind === 'declined');
  const dupEvent = detail.events.find((e) => e.kind === 'duplicate');
  const priorityEvent = detail.events.find((e) => e.kind === 'priority');
  const complexityEvent = detail.events.find((e) => e.kind === 'complexity');
  const submitted = detail.events.find((e) => e.kind === 'submitted');
  const priority = r.priority ? cap(r.priority) : '—';
  const sentence = (kind: 'priority' | 'complexity') => {
    const ev = kind === 'priority' ? priorityEvent : complexityEvent;
    const agent = kind === 'priority' ? (r.agent.priority ? cap(r.agent.priority) : '') : (r.agent.complexity ?? '');
    if (ev) {
      const was = String((ev.before as Record<string, string>)[kind] ?? '');
      return `Revised by ${ev.actor} on ${shortDate(ev.created_at)} (was ${kind === 'priority' ? cap(was) : was}).`;
    }
    return `Confirmed by ${submitted?.actor || r.submitter.name}.${agent ? ` The assistant proposed ${agent}.` : ''}`;
  };
  const related = detail.related.map((x) => ({
    kind: x.kind,
    ref: x.request.ref,
    title: x.request.title,
    status: x.request.status,
    note: x.direction === 'canonical' ? 'This request was marked as a duplicate of it.' : x.note,
  }));
  const transcript = itemsFromMessages(messages.data?.messages ?? [], clock);
  return (
    <div className={`${constrained} ${styles.page}`} data-testid="feedback-request-page">
      <PageHeader
        title={r.title}
        description={r.summary}
        meta={[
          <Tag key="id" kind="data">
            {r.ref}
          </Tag>,
          <StatusBadge key="st" status={r.status} />,
          targetMeta(detail),
          `${r.submitter.name} · ${dateTime(r.confirmed_at ?? r.created_at)}`,
        ]}
      />
      {declined ? (
        <Callout tone="error" title={`Declined by ${declineEvent?.actor || 'an administrator'} on ${shortDate(declineEvent?.created_at)}`}>
          {r.decline_reason}
        </Callout>
      ) : null}
      {dupOf ? (
        <Callout tone="warning" title={`Marked as a duplicate of ${dupOf}`}>
          <span>
            {dupEvent?.actor || 'An administrator'} linked this request to <RequestLink id={dupOf} /> on{' '}
            {shortDate(dupEvent?.created_at)}. Administrators plan the canonical request; this one stays as a record.
          </span>
        </Callout>
      ) : null}
      <Tabs
        label="Request sections"
        items={[
          { id: 'request', label: 'Request' },
          { id: 'conversation', label: 'Conversation', count: messages.data?.messages.length },
        ]}
        selected={tab}
        onSelect={(id) => replaceUrlQuery({ tab: id === 'conversation' ? 'conversation' : null })}
      />
      {tab === 'request' ? (
        <div className={styles.split} data-request-split>
          <div className={styles.stackCol}>
            <StatStrip
              aria-label="Priority and complexity"
              items={[
                { label: 'Priority', value: priority, sub: sentence('priority') },
                { label: 'Complexity', value: r.complexity ?? '—', sub: sentence('complexity') },
              ]}
            />
            <Card as="section" aria-label="Request details" data-testid="request-card">
              <div className={styles.sections}>
                <Section label="Description" text={r.description} />
                <Section label="Business need" text={r.business_need} />
                <Section label="Justification" text={r.justification} />
                <div className={styles.pair}>
                  <Section label={`Why ${priority}`} text={r.agent.priority_reasoning ?? ''} />
                  <Section label={`Why ${r.complexity ?? ''}`} text={r.agent.complexity_reasoning ?? ''} />
                </div>
              </div>
            </Card>
            <HistoryCard events={detail.events} />
          </div>
          <div className={styles.stackCol}>
            {isAdmin ? <TriagePanel detail={detail} /> : null}
            {related.length ? (
              <Card as="aside" aria-label="Related requests" header={<Text variant="md">Related requests</Text>} data-testid="related-card">
                <RelatedList items={related} />
              </Card>
            ) : null}
          </div>
        </div>
      ) : (
        <Card as="section" aria-label="Conversation transcript" data-testid="transcript">
          <div className={styles.transcriptNote}>
            <Icon name="lock" size={12} /> Read only. The assistant’s proposal is the confirmed request on the Request tab.
          </div>
          <ol className={styles.msgs}>
            {transcript.map((m) => (
              <MsgItem key={m.key} item={m} who={r.submitter.name} />
            ))}
            <li className={styles.toolLine} data-role="tool">
              <Icon name="check" size={12} />
              <span>
                {r.submitter.name} submitted the proposal · {clock(r.confirmed_at)}
              </span>
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
