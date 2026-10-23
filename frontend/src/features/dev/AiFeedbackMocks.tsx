/**
 * AI-assisted feedback mocks (WP-E design stage): static visual contracts for
 * docs/internal/feature-rounds/2026-10-ai-feedback/spec-e.md. Gallery anchor `/__ui#ai-feedback`.
 * Real primitives and tokens; nothing here reads the API. CSS in AiFeedbackMocks.module.css marked "recipe" is
 * what the implementer moves into the feature's CSS Modules.
 *
 * Composed pages first (the whole page in the app shell, default state, realistic data, real size):
 *   ae-page-list          /feedback: drafts strip, filters, table with a duplicate pair grouped and a conflict
 *   ae-page-new           /feedback/new: the subject step
 *   ae-page-chat          /feedback/:id as a draft: the assistant asks, the user is typing
 *   ae-page-proposal      the same conversation after the assistant proposed: proposal card, duplicate warning
 *   ae-page-request       /feedback/:id of a submitted request: confirmed card, related panel
 *   ae-page-conversation  the same request, Conversation tab (transcript)
 *   ae-page-triage        the request as a platform admin: triage panel open with a pending change
 *   ae-page-admin         /admin/feedback: the Feedback agent connection page
 *   ae-page-unconfigured  /feedback/new while no connection is set (member view)
 * then the state sheets (appendix): ae-s-list, ae-s-chat, ae-s-proposal, ae-s-request, ae-s-admin, ae-s-nav.
 */
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Eyebrow,
  Icon,
  Kbd,
  MultiSelect,
  NumberField,
  PageHeader,
  RadioGroup,
  SearchField,
  Select,
  SegmentedControl,
  Skeleton,
  StatStrip,
  TabPanel,
  Tabs,
  Tag,
  Text,
  TextBlock,
  TextField,
  Textarea,
  type Column,
} from '@/ui';
import { Callout } from '@/features/experiments/launch/components/Callout';
import styles from './AiFeedbackMocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── data ───────────────────────────── */

export type Status = 'draft' | 'new' | 'accepted' | 'planned' | 'done' | 'declined';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type Complexity = 'S' | 'M' | 'L' | 'XL';

export interface Req {
  id: string;
  title: string;
  summary: string;
  subject: 'platform' | 'product';
  project?: string;
  target?: string;
  priority: Priority;
  complexity: Complexity;
  status: Status;
  by: string;
  date: string;
  /** Canonical request this one was marked a duplicate of. */
  dupOf?: string;
}

export const REQS: Req[] = [
  {
    id: 'FB-0044',
    title: 'Show cost per run in the runs list',
    summary: 'A Cost column next to Latency so a lead can sort a project by spend.',
    subject: 'platform',
    priority: 'medium',
    complexity: 'M',
    status: 'new',
    by: 'Dev User',
    date: 'Oct 22',
  },
  {
    id: 'FB-0041',
    title: 'Flag runs that regress on refund-cases',
    summary: 'Mark a nightly run red when refund-cases drops 3 points under the last good run.',
    subject: 'product',
    project: 'Support agent',
    target: 'experiment · nightly baseline',
    priority: 'high',
    complexity: 'M',
    status: 'accepted',
    by: 'Sara Alharbi',
    date: 'Oct 21',
  },
  {
    id: 'FB-0038',
    title: 'PDF export of the compare page',
    summary: 'Send the compare view of two runs to a manager as one PDF file.',
    subject: 'platform',
    priority: 'medium',
    complexity: 'M',
    status: 'new',
    by: 'Omar Khalid',
    date: 'Oct 19',
    dupOf: 'FB-0031',
  },
  {
    id: 'FB-0035',
    title: 'Notes on each dataset version',
    summary: 'Let a dataset owner write why a version exists, shown next to its number.',
    subject: 'product',
    project: 'Support agent',
    target: 'dataset · support-tickets',
    priority: 'low',
    complexity: 'S',
    status: 'planned',
    by: 'Noura Alsaif',
    date: 'Oct 17',
  },
  {
    id: 'FB-0031',
    title: 'Export run comparison to PDF',
    summary: 'Weekly review pack for the VP of support, today built from screenshots.',
    subject: 'platform',
    priority: 'high',
    complexity: 'M',
    status: 'accepted',
    by: 'Sara Alharbi',
    date: 'Oct 14',
  },
  {
    id: 'FB-0029',
    title: 'Restricted datasets must not be exportable',
    summary: 'Nothing derived from a restricted dataset leaves the platform as a file.',
    subject: 'platform',
    priority: 'critical',
    complexity: 'L',
    status: 'planned',
    by: 'Noura Alsaif',
    date: 'Oct 9',
  },
  {
    id: 'FB-0022',
    title: 'Right-to-left output in the playground',
    summary: 'Arabic model output should render right-to-left in the playground answer box.',
    subject: 'product',
    project: 'Support agent',
    target: 'run · rag-qa-gpt-4o-005',
    priority: 'medium',
    complexity: 'S',
    status: 'done',
    by: 'Omar Khalid',
    date: 'Oct 3',
  },
  {
    id: 'FB-0018',
    title: 'Light theme',
    summary: 'A light colour scheme for presentations in bright rooms.',
    subject: 'platform',
    priority: 'low',
    complexity: 'XL',
    status: 'declined',
    by: 'Dev User',
    date: 'Sep 28',
  },
];

const byId = (id: string) => REQS.find((r) => r.id === id)!;

export const STATUS_TONE: Record<Status, 'warning' | 'neutral' | 'info' | 'accent' | 'success' | 'danger'> = {
  draft: 'warning',
  new: 'neutral',
  accepted: 'info',
  planned: 'accent',
  done: 'success',
  declined: 'danger',
};
const PRIORITY_TONE: Record<Priority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-status={status}>
      {cap(status)}
    </Badge>
  );
}
export function PriorityBadge({ value }: { value: Priority }) {
  return (
    <Badge tone={PRIORITY_TONE[value]} data-priority={value}>
      {cap(value)}
    </Badge>
  );
}
export function ComplexityTag({ value }: { value: Complexity }) {
  return (
    <Tag kind="data" data-complexity={value}>
      {value}
    </Tag>
  );
}

const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'critical', label: 'Critical' },
];
const COMPLEXITIES = [
  { key: 'S', label: 'S · a day or two' },
  { key: 'M', label: 'M · about a week' },
  { key: 'L', label: 'L · several weeks' },
  { key: 'XL', label: 'XL · a project of its own' },
];
const STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'planned', label: 'Planned' },
  { key: 'done', label: 'Done' },
  { key: 'declined', label: 'Declined' },
];

/* ───────────────────────────── shell ───────────────────────────── */

/** Recipe: the new `feedback` glyph the implementer adds to ui/Icon (a speech bubble with a plus). */
function FeedbackGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="feedback"
    >
      <path d="M4 4h16v12H8l-4 4zM12 8v5M9.500 10.500h5" />
    </svg>
  );
}

function Shell({
  crumbs,
  admin,
  children,
  active = 'Feedback',
  user = ['SA', 'Sara Alharbi', 'sara@example.com'],
}: {
  crumbs: string[];
  admin?: boolean;
  children: ReactNode;
  active?: string;
  user?: [string, string, string];
}) {
  const item = (icon: ReactNode, label: string, extra?: ReactNode) => (
    <span key={label} className={styles.navItem} data-active={active === label ? '' : undefined} data-nav={label.toLowerCase()}>
      {icon}
      <span>{label}</span>
      {extra}
    </span>
  );
  return (
    <div className={styles.shell} data-testid="page-shell">
      <aside className={styles.sidebar} aria-label="Navigation">
        <div className={styles.brand}>qym</div>
        <nav className={styles.nav} aria-label="Global">
          {item(<Icon name="folder" size={14} />, 'Projects')}
          {item(<Icon name="book" size={14} />, 'Docs')}
          {item(<FeedbackGlyph />, 'Feedback')}
          {admin ? (
            <>
              <p className={styles.navGroup}>Platform</p>
              {item(<Icon name="shield" size={14} />, 'Admin', <Tag kind="accent">Admin</Tag>)}
              {item(<Icon name="trash" size={14} />, 'Deleted runs')}
            </>
          ) : null}
        </nav>
        <div className={styles.user}>
          <span className={styles.avatar}>{user[0]}</span>
          <span className={styles.userText}>
            <strong>{user[1]}</strong>
            <span>{user[2]}</span>
          </span>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topbar}>
          <Icon name="sidebar" size={14} />
          <span className={styles.crumbs}>
            {crumbs.map((c, i) => (
              <span key={c} className={styles.crumbs}>
                {i > 0 ? <Icon name="chevron-right" size={12} /> : null} {c}
              </span>
            ))}
          </span>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

const Id = ({ id }: { id: string }) => (
  <span className={styles.idLink} data-request-link={id}>
    {id}
  </span>
);

const NewButton = () => (
  <Button variant="accent" size="md" icon={<Icon name="plus" size={14} />}>
    New feedback
  </Button>
);

/* ───────────────────────────── list ───────────────────────────── */

function AboutCell({ r }: { r: Req }) {
  return (
    <span className={styles.about}>
      <span>{r.subject === 'platform' ? 'qym itself' : 'A product'}</span>
      <span className={styles.aboutSub}>{r.subject === 'platform' ? 'Platform' : r.project}</span>
    </span>
  );
}

function SubmitterCell({ r }: { r: Req }) {
  return (
    <span className={styles.about}>
      <span>{r.by}</span>
      <span className={styles.aboutSub}>{r.date}</span>
    </span>
  );
}

function listColumns(): Column<Req>[] {
  return [
    {
      id: 'title',
      header: 'Request',
      flex: true,
      minWidth: 200,
      pin: 'start',
      hideable: false,
      priority: 1,
      cardTitle: true,
      cell: (r) => (
        <span className={styles.titleCell} data-dup-of={r.dupOf}>
          <span className={styles.titleLine}>
            <Id id={r.id} />
            <span className={styles.titleText}>{r.title}</span>
          </span>
          {r.dupOf ? (
            <span className={styles.dupNote} data-testid="dup-note">
              <Badge tone="warning">Duplicate</Badge> of <Id id={r.dupOf} />
            </span>
          ) : null}
        </span>
      ),
    },
    { id: 'about', header: 'About', width: 130, priority: 2, cell: (r) => <AboutCell r={r} /> },
    { id: 'priority', header: 'Priority', width: 84, priority: 2, cell: (r) => <PriorityBadge value={r.priority} /> },
    { id: 'complexity', header: 'Complexity', width: 118, priority: 2, cell: (r) => <ComplexityTag value={r.complexity} /> },
    { id: 'status', header: 'Status', type: 'status', width: 96, priority: 1, cell: (r) => <StatusBadge status={r.status} /> },
    { id: 'by', header: 'Submitted', width: 130, priority: 2, cell: (r) => <SubmitterCell r={r} /> },
  ];
}

function FilterRow({ compact }: { compact?: boolean }) {
  const none = new Set<never>();
  return (
    <div className={styles.filterRow} data-testid="filter-row">
      <span className={styles.facets}>
        <MultiSelect
          label="Status"
          triggerVariant="bar"
          items={STATUSES.map((s) => ({ key: s.key, label: s.label }))}
          value={none}
          onChange={noop}
        />
        <MultiSelect
          label="About"
          triggerVariant="bar"
          items={[
            { key: 'platform', label: 'qym itself' },
            { key: 'product', label: 'A product' },
          ]}
          value={none}
          onChange={noop}
        />
        <MultiSelect
          label="Project"
          triggerVariant="bar"
          items={[{ key: 'support-agent', label: 'Support agent' }]}
          value={none}
          onChange={noop}
        />
        <MultiSelect label="Priority" triggerVariant="bar" items={PRIORITIES} value={none} onChange={noop} />
        <MultiSelect
          label="Complexity"
          triggerVariant="bar"
          items={COMPLEXITIES.map((c) => ({ key: c.key, label: c.key }))}
          value={none}
          onChange={noop}
        />
      </span>
      <SegmentedControl
        label="Whose requests"
        value="all"
        onChange={noop}
        options={[
          { value: 'all', label: 'Everyone' },
          { value: 'mine', label: 'Mine' },
        ]}
      />
      {compact ? null : null}
    </div>
  );
}

export function RequestsTable({ rows, loading }: { rows: Req[]; loading?: boolean }) {
  const canonical = new Set(rows.filter((r) => r.dupOf).map((r) => r.dupOf!));
  const top = rows.filter((r) => !r.dupOf || !rows.some((x) => x.id === r.dupOf));
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set(['FB-0031']));
  return (
    <DataTable<Req>
      aria-label="Feedback requests"
      density="comfortable"
      densityLocked
      columns={listColumns()}
      rows={top}
      rowKey={(r) => r.id}
      loading={loading}
      expanded={expanded}
      onExpandedChange={(k) => setExpanded(new Set(k))}
      canExpand={(r) => canonical.has(r.id)}
      childRows={(r) => {
        const kids = rows.filter((x) => x.dupOf === r.id);
        return kids.length ? { rows: kids, detail: false } : undefined;
      }}
      childLabel={(r, p) => `${r.id}, duplicate of ${p.id}`}
      childGroupLabel={(r) => `Duplicates of ${r.id}`}
      renderExpanded={() => null}
      empty="No requests match."
      storageKey="ai-feedback-mock"
    >
      <DataTable.Toolbar
        search={<SearchField label="Search requests" placeholder="Search requests" width="100%" />}
        rows={<FilterRow />}
        count={`${rows.length} requests`}
        columnsMenu={false}
        densityMenu={false}
      />
    </DataTable>
  );
}

function DraftsStrip() {
  return (
    <Callout tone="info" title="2 drafts only you can see">
      <ul className={styles.drafts} data-testid="drafts-strip">
        <li>
          <span className={styles.draftTitle}>Bulk re-run failed items</span>
          <span className={styles.draftMeta}>Platform · 3 messages · 2 days ago · deleted in 28 days</span>
          <span className={styles.draftActions}>
            <Button size="sm" variant="neutral">
              Resume
            </Button>
            <Button size="sm" variant="ghost">
              Discard
            </Button>
          </span>
        </li>
        <li>
          <span className={styles.draftTitle}>Slack alert for failed nightly runs</span>
          <span className={styles.draftMeta}>Support agent · 1 message · 9 days ago · deleted in 21 days</span>
          <span className={styles.draftActions}>
            <Button size="sm" variant="neutral">
              Resume
            </Button>
            <Button size="sm" variant="ghost">
              Discard
            </Button>
          </span>
        </li>
      </ul>
    </Callout>
  );
}

function ListPage({ state }: { state?: 'default' | 'unconfigured' }) {
  return (
    <div className={styles.col} data-testid="feedback-list-page">
      <PageHeader
        title="Feedback"
        description="Everything people asked for, with the assistant's proposed priority and complexity. Admins triage."
        meta={[`${REQS.length} requests`, '2 new', '1 duplicate pair']}
        actions={<NewButton />}
      />
      {state === 'unconfigured' ? (
        <Callout tone="warning" title="The feedback assistant is not set up">
          You can read every request. New feedback opens once an administrator connects a model.
        </Callout>
      ) : (
        <DraftsStrip />
      )}
      <RequestsTable rows={REQS} />
    </div>
  );
}

/* ───────────────────────────── new feedback: the subject step ───────────────────────────── */

function HowItWorks() {
  return (
    <Card as="aside" aria-label="How it works" header={<Text variant="md">How it works</Text>}>
      <ol className={styles.steps}>
        <li>
          <span className={styles.stepNo}>1</span>
          <span>You describe the need in your own words.</span>
        </li>
        <li>
          <span className={styles.stepNo}>2</span>
          <span>The assistant asks the questions the team will ask later, usually four to eight.</span>
        </li>
        <li>
          <span className={styles.stepNo}>3</span>
          <span>
            You confirm a description, a priority and a complexity. Nothing is submitted before you do.
          </span>
        </li>
      </ol>
      <p className={styles.note}>
        Everyone signed in can read a submitted request. Administrators decide its status.
      </p>
    </Card>
  );
}

function NewForm({ subject, text }: { subject: 'platform' | 'product'; text?: string }) {
  const [sub, setSub] = useState<'platform' | 'product'>(subject);
  const [kind, setKind] = useState<'none' | 'run' | 'experiment' | 'dataset'>(subject === 'product' ? 'experiment' : 'none');
  const [msg, setMsg] = useState(text ?? '');
  return (
    <Card
      as="section"
      aria-label="New feedback"
      data-testid="new-form"
      footer={
        <div className={styles.formFoot}>
          <span className={styles.visibility}>
            <Icon name="eye" size={14} /> Visible to everyone signed in
          </span>
          <span className={styles.footActions}>
            <Button variant="ghost">Cancel</Button>
            <Button variant="accent" isDisabled={!msg.trim()}>
              Start conversation
            </Button>
          </span>
        </div>
      }
    >
      <div className={styles.formBody}>
        <RadioGroup
          label="What is this about?"
          value={sub}
          onChange={setSub}
          options={[
            {
              value: 'platform',
              title: 'qym itself',
              help: 'A need or a change for qym: its pages, API, SDK or CLI. The assistant knows the qym documentation.',
            },
            {
              value: 'product',
              title: 'A product I evaluate with qym',
              help: 'About one of your projects: its runs, experiments or datasets. The assistant knows that project’s setup.',
            },
          ]}
        />
        {sub === 'product' ? (
          <div className={styles.target} data-testid="product-fields">
            <Select
              label="Project"
              isRequired
              items={[
                { key: 'support-agent', label: 'Support agent' },
                { key: 'legal-clauses', label: 'Legal clauses' },
              ]}
              value="support-agent"
              onChange={noop}
            />
            <div className={styles.targetPick}>
              <SegmentedControl
                label="Point at"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'none', label: 'Nothing' },
                  { value: 'run', label: 'Run' },
                  { value: 'experiment', label: 'Experiment' },
                  { value: 'dataset', label: 'Dataset' },
                ]}
              />
              {kind !== 'none' ? (
                <Select
                  label={cap(kind)}
                  items={[
                    { key: 'a', label: kind === 'experiment' ? 'nightly baseline' : kind === 'dataset' ? 'support-tickets' : 'rag-qa-gpt-4o-005' },
                  ]}
                  value="a"
                  onChange={noop}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        <Textarea
          label="What do you need?"
          rows={5}
          value={msg}
          onChange={setMsg}
          placeholder="Describe it in your own words. One or two sentences are enough, the assistant asks the rest."
          help="English and Arabic both work. Do not paste secrets or customer data."
        />
      </div>
    </Card>
  );
}

function NewPage({ subject = 'platform', text }: { subject?: 'platform' | 'product'; text?: string }) {
  return (
    <div className={styles.col} data-testid="feedback-new-page">
      <PageHeader
        title="New feedback"
        description="Tell the assistant what you need. It proposes a request for you to confirm."
      />
      <div className={styles.split}>
        <NewForm subject={subject} text={text} />
        <HowItWorks />
      </div>
    </div>
  );
}

function UnconfiguredPage({ admin }: { admin?: boolean }) {
  return (
    <div className={styles.col} data-testid="feedback-unconfigured-page">
      <PageHeader title="New feedback" description="Tell the assistant what you need. It proposes a request for you to confirm." />
      <Card as="section" aria-label="Not set up">
        <EmptyState
          icon={<FeedbackGlyph size={48} />}
          title="The feedback assistant is not set up yet"
          body={
            admin
              ? 'Connect a model for it under Admin, Feedback agent. Until then people can read every request but not start a new one.'
              : 'An administrator has to connect a model for it first. You can read every request in the meantime.'
          }
          action={
            admin ? (
              <Button variant="accent" size="md">
                Open Feedback agent settings
              </Button>
            ) : (
              <Button variant="neutral" size="md">
                Browse requests
              </Button>
            )
          }
        />
      </Card>
    </div>
  );
}

/* ───────────────────────────── chat ───────────────────────────── */

type ItemState = 'filled' | 'partial' | 'open' | 'declined';
interface CheckItem {
  key: string;
  label: string;
  state: ItemState;
  value?: string;
}
const CHECK_MID: CheckItem[] = [
  { key: 'business_need', label: 'Business need', state: 'filled', value: 'A weekly review pack for the VP of support.' },
  { key: 'affected', label: 'Who is affected, how often', state: 'filled', value: 'Three team leads, every week.' },
  { key: 'workaround', label: 'Current workaround', state: 'filled', value: 'Screenshots pasted into slides, about 40 minutes each week.' },
  { key: 'outcome', label: 'Expected outcome', state: 'partial', value: 'A PDF of the compare view. Which parts of it is still open.' },
  { key: 'urgency', label: 'Deadline or urgency', state: 'open' },
  { key: 'scope', label: 'Scope boundaries', state: 'open' },
];
const CHECK_DONE: CheckItem[] = [
  CHECK_MID[0]!,
  CHECK_MID[1]!,
  CHECK_MID[2]!,
  { key: 'outcome', label: 'Expected outcome', state: 'filled', value: 'One PDF of the compare view: summary tiles and the metric table.' },
  { key: 'urgency', label: 'Deadline or urgency', state: 'filled', value: 'Before the Thursday review, at the latest Oct 31.' },
  { key: 'scope', label: 'Scope boundaries', state: 'filled', value: 'Compare page only. Not the item table, not other pages.' },
];

const STATE_LABEL: Record<ItemState, string> = { filled: 'Known', partial: 'Partly known', open: 'Not asked yet', declined: 'Not known' };

export function ChecklistRail({ items }: { items: CheckItem[] }) {
  const known = items.filter((i) => i.state === 'filled' || i.state === 'declined').length;
  return (
    <Card
      as="aside"
      aria-label="What the assistant has so far"
      data-testid="checklist"
      header={
        <div className={styles.railHead}>
          <Text variant="md">What the assistant has so far</Text>
          <Tag kind="count">
            {known} of {items.length}
          </Tag>
        </div>
      }
    >
      <ul className={styles.checklist} aria-label="Information checklist">
        {items.map((i) => (
          <li key={i.key} className={styles.checkItem} data-state={i.state} data-check={i.key}>
            <span className={styles.checkGlyph} aria-hidden="true">
              {i.state === 'filled' ? <Icon name="check" size={12} /> : i.state === 'declined' ? <Icon name="minus" size={12} /> : null}
            </span>
            <span className={styles.checkText}>
              <span className={styles.checkLabel}>
                {i.label}
                <span className={styles.srOnly}>: {STATE_LABEL[i.state]}</span>
              </span>
              {i.value ? <span className={styles.checkValue}>{i.value}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface Msg {
  role: 'user' | 'assistant' | 'tool';
  text: ReactNode;
  raw?: string;
  time: string;
}
const WHO = 'Sara Alharbi';

const CHAT_START: Msg[] = [
  {
    role: 'user',
    raw: 'We need to export the run comparison as a PDF. I send it to the VP of support before the Thursday review.',
    text: null,
    time: '12:31',
  },
  {
    role: 'tool',
    text: (
      <>
        Read the docs: Compare · Export <span className={styles.toolDim}>and searched requests for “pdf export compare”, 3 results</span>
      </>
    ),
    time: '12:31',
  },
  {
    role: 'assistant',
    raw: 'Thanks. This is about the Compare page. Two questions so the team can judge it: who needs the PDF and how often, and what do you do today instead?',
    text: null,
    time: '12:31',
  },
  {
    role: 'user',
    raw: 'Me and two other leads, every week before the review. Today I screenshot the compare page and paste the pictures into slides. It takes about 40 minutes.',
    text: null,
    time: '12:34',
  },
  {
    role: 'assistant',
    raw: 'That is about two hours of lead time every week. What would a good result look like: the summary tiles and the metric table only, or also the item-level rows? And is there a date after which the Thursday review no longer works for you?',
    text: null,
    time: '12:34',
  },
];
const CHAT_END: Msg[] = [
  {
    role: 'user',
    raw: 'Summary tiles and the metric table, not the items. Before the review on Thursday if possible, at the latest Oct 31. Only the Compare page.',
    text: null,
    time: '12:38',
  },
  {
    role: 'tool',
    text: (
      <>
        Searched requests for “compare pdf export” · <Id id="FB-0031" /> <Id id="FB-0038" /> <Id id="FB-0029" />
      </>
    ),
    time: '12:38',
  },
  {
    role: 'assistant',
    raw: 'That is everything I need. One thing to know first: FB-0031 already asks for a PDF export of the comparison, so this looks like a duplicate. I put a proposal below. Check the description, priority and complexity, change what is wrong, then submit.',
    text: null,
    time: '12:38',
  },
];

function MsgItem({ m }: { m: Msg }) {
  if (m.role === 'tool')
    return (
      <li className={styles.toolLine} data-role="tool">
        <Icon name="search" size={12} />
        <span>{m.text}</span>
      </li>
    );
  return (
    <li className={styles.msg} data-role={m.role}>
      <span className={styles.msgIcon} aria-hidden="true">
        <Icon name={m.role === 'user' ? 'user' : 'bot'} size={14} />
      </span>
      <div className={styles.msgBody}>
        <div className={styles.msgMeta}>
          <span className={styles.msgWho}>{m.role === 'user' ? WHO : 'Assistant'}</span>
          <time>{m.time}</time>
        </div>
        <TextBlock text={m.raw} mode="raw" className={styles.msgText} />
      </div>
    </li>
  );
}

export function Streaming({ text }: { text: string }) {
  return (
    <li className={styles.msg} data-role="assistant" data-streaming="">
      <span className={styles.msgIcon} aria-hidden="true">
        <Icon name="bot" size={14} />
      </span>
      <div className={styles.msgBody}>
        <div className={styles.msgMeta}>
          <span className={styles.msgWho}>Assistant</span>
          <span className={styles.writing}>writing…</span>
        </div>
        <TextBlock text={text} mode="raw" className={styles.msgText} />
      </div>
    </li>
  );
}

export function Chat({
  messages,
  draft,
  extra,
  height,
  placeholder,
  composerNote,
  disabled,
}: {
  messages: Msg[];
  draft?: string;
  extra?: ReactNode;
  height?: number;
  placeholder?: string;
  composerNote?: ReactNode;
  disabled?: boolean;
}) {
  const [text, setText] = useState(draft ?? '');
  return (
    <Card
      as="section"
      flush
      fill
      aria-label="Conversation"
      className={styles.chatCard}
      style={height ? { blockSize: height } : undefined}
      data-testid="chat"
    >
      <div className={styles.chatHead}>
        <Text variant="md">Conversation</Text>
        <span className={styles.chatMeta}>Platform · draft saved 12:34</span>
      </div>
      {/* A scrollable log is a tab stop so the keyboard can scroll it (WCAG 2.1.1, scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.log} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation messages" tabIndex={0}>
        <ol className={styles.msgs}>
          {messages.map((m, i) => (
            <MsgItem key={i} m={m} />
          ))}
          {extra}
        </ol>
      </div>
      <div className={styles.composer}>
        <Textarea
          label="Your reply"
          hideLabel
          rows={3}
          value={text}
          onChange={setText}
          isDisabled={disabled}
          placeholder={placeholder ?? 'Reply to the assistant'}
        />
        <div className={styles.composerFoot}>
          <span className={styles.composerHint}>
            {composerNote ?? (
              <>
                <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> starts a new line
              </>
            )}
          </span>
          <Button variant="accent" isDisabled={disabled || !text.trim()} icon={<Icon name="next" size={14} />}>
            Send
          </Button>
        </div>
      </div>
    </Card>
  );
}

const DRAFT_HEADER = (
  <PageHeader
    title="New feedback"
    description="Answer the assistant’s questions. Nothing is submitted until you confirm a proposal."
    meta={[<Tag key="s">Platform</Tag>, 'Draft, only you can see it', 'Deleted after 30 days without a submit']}
    actions={
      <Button variant="ghost" size="md">
        Discard draft
      </Button>
    }
  />
);

function ChatPage() {
  return (
    <div className={styles.col} data-testid="feedback-chat-page">
      {DRAFT_HEADER}
      <div className={styles.split} data-chat-split>
        <Chat
          messages={CHAT_START}
          draft="Summary tiles and the metric table, not the items. Before Thursday the"
        />
        <ChecklistRail items={CHECK_MID} />
      </div>
    </div>
  );
}

/* ───────────────────────────── proposal card ───────────────────────────── */

export interface Related {
  id: string;
  kind: 'duplicate' | 'conflict' | 'related';
  note: string;
}
const KIND_TONE: Record<Related['kind'], 'warning' | 'danger' | 'neutral'> = {
  duplicate: 'warning',
  conflict: 'danger',
  related: 'neutral',
};
const KIND_LABEL: Record<Related['kind'], string> = { duplicate: 'Duplicate', conflict: 'Conflict', related: 'Related' };

const PROPOSAL_RELATED: Related[] = [
  {
    id: 'FB-0031',
    kind: 'duplicate',
    note: 'Also asks for a PDF export of the run comparison for a weekly management review. Already accepted.',
  },
  {
    id: 'FB-0029',
    kind: 'conflict',
    note: 'Says nothing derived from a restricted dataset may leave the platform as a file. A PDF of a comparison would have to respect that.',
  },
];

export function RelatedList({ items, title, compact }: { items: Related[]; title?: ReactNode; compact?: boolean }) {
  return (
    <div className={styles.related} data-testid="related" data-compact={compact ? '' : undefined}>
      {title}
      <ul className={styles.relatedList} aria-label="Related requests">
        {items.map((r) => {
          const req = byId(r.id);
          return (
            <li key={r.id} className={styles.relatedItem} data-kind={r.kind} data-related={r.id}>
              <span className={styles.relatedHead}>
                <Badge tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>
                <Id id={r.id} />
                <StatusBadge status={req.status} />
              </span>
              <span className={styles.relatedTitle}>{req.title}</span>
              <span className={styles.relatedNote}>{r.note}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Reasoned({ label, value, reasoning, agent, control }: { label: string; value: ReactNode; reasoning: string; agent: string; control: ReactNode }) {
  return (
    <div className={styles.reasoned} data-reasoned={label.toLowerCase()}>
      {control}
      <span className={styles.reasoning}>
        <Eyebrow>Assistant proposed {agent}</Eyebrow>
        <span>{reasoning}</span>
      </span>
      <span className={styles.srOnly}>{value}</span>
    </div>
  );
}

export function ProposalCard({
  duplicate = true,
  edited,
  invalid,
}: {
  duplicate?: boolean;
  edited?: boolean;
  invalid?: boolean;
}) {
  const [title, setTitle] = useState('Export the run comparison as a PDF');
  const [desc, setDesc] = useState(
    invalid
      ? ''
      : 'Add a one-click PDF export to the Compare page. The file holds the summary tiles and the metric table of the compared runs, with run names, dataset versions and the date. It does not include item-level rows. Team leads send it to the VP of support before the weekly review, replacing about 40 minutes of screenshots per lead each week.',
  );
  return (
    <Card
      as="section"
      tone="info"
      aria-labelledby="proposal-title"
      data-testid="proposal"
      header={
        <div className={styles.proposalHead}>
          <Text variant="md" as="h2" id="proposal-title" tabIndex={-1}>
            Proposed request
          </Text>
          <Badge tone="warning">Not submitted yet</Badge>
        </div>
      }
      footer={
        <div className={styles.proposalFoot}>
          <span className={styles.footNote}>Change anything that is wrong. Nothing is submitted until you press the button.</span>
          <span className={styles.footActions}>
            <Button variant="neutral">Keep talking</Button>
            <Button variant="accent" isDisabled={invalid}>
              {duplicate ? 'Submit as a possible duplicate' : 'Submit request'}
            </Button>
          </span>
        </div>
      }
    >
      <div className={styles.proposalBody}>
        {duplicate ? (
          <Callout tone="warning" title="This looks like a duplicate of FB-0031" live>
            FB-0031 “Export run comparison to PDF” asks for the same thing and is already accepted. You can still submit
            yours: it is saved as a possible duplicate and an administrator links the two.
          </Callout>
        ) : null}
        <TextField label="Title" value={title} onChange={setTitle} isRequired help="Up to 80 characters." />
        <Textarea
          label="Description"
          rows={5}
          value={desc}
          onChange={setDesc}
          isRequired
          errorMessage={invalid ? 'The description cannot be empty.' : undefined}
        />
        <div className={styles.facts}>
          <div>
            <Eyebrow>Business need</Eyebrow>
            <p>Team leads must hand the VP of support a comparison of two runs before every weekly review, in a format that can be forwarded.</p>
          </div>
          <div>
            <Eyebrow>Justification</Eyebrow>
            <p>Three leads spend about 40 minutes each per week on screenshots, roughly two hours of lead time. The result is also hard to read on a phone.</p>
          </div>
        </div>
        <div className={styles.pair}>
          <Reasoned
            label="Priority"
            agent="High"
            value="High"
            control={
              <Select
                label="Priority"
                items={PRIORITIES}
                value={edited ? 'medium' : 'high'}
                onChange={noop}
                help={edited ? 'You changed it from High.' : undefined}
              />
            }
            reasoning="A weekly management review depends on it and three leads lose two hours every week. Not critical: a workaround exists."
          />
          <Reasoned
            label="Complexity"
            agent="M · about a week"
            value="M"
            control={<Select label="Complexity" items={COMPLEXITIES} value="M" onChange={noop} />}
            reasoning="The compare view already holds the data. It needs a print layout and a server-side render, and a rule for restricted datasets."
          />
        </div>
        <RelatedList
          items={duplicate ? PROPOSAL_RELATED : PROPOSAL_RELATED.slice(1)}
          title={<Eyebrow>Related requests the assistant found</Eyebrow>}
        />
      </div>
    </Card>
  );
}

function ProposalPage() {
  return (
    <div className={styles.col} data-testid="feedback-proposal-page">
      {DRAFT_HEADER}
      <div className={styles.split} data-chat-split>
        <div className={styles.stackCol}>
          <Chat messages={CHAT_END} height={300} placeholder="Reply to change the proposal" />
          <ProposalCard />
        </div>
        <ChecklistRail items={CHECK_DONE} />
      </div>
    </div>
  );
}

/* ───────────────────────────── request page ───────────────────────────── */

const FB38 = byId('FB-0038');
const FB38_RELATED: Related[] = [
  { id: 'FB-0031', kind: 'duplicate', note: 'Same ask, written earlier and already accepted. An administrator confirmed the link on Oct 20.' },
  { id: 'FB-0029', kind: 'conflict', note: 'Nothing derived from a restricted dataset may leave the platform as a file; a comparison PDF would have to respect that.' },
  { id: 'FB-0044', kind: 'related', note: 'Both add a column or a view to what a lead reads each week.' },
];

const FB38_TRANSCRIPT: Msg[] = [
  { role: 'user', raw: 'Can I get the compare page as a PDF? I want to mail two runs side by side to my manager.', text: null, time: '13:52' },
  { role: 'tool', text: <>Searched requests for “compare pdf” · <Id id="FB-0031" /> <Id id="FB-0029" /></>, time: '13:52' },
  { role: 'assistant', raw: 'There is already a request for a PDF of the comparison, FB-0031. What is missing for you that it does not cover? And how often would you send it?', text: null, time: '13:52' },
  { role: 'user', raw: 'It is the same thing. Once a week. I did not see that one.', text: null, time: '13:55' },
  { role: 'assistant', raw: 'Understood. I will propose it and mark FB-0031 as a possible duplicate, so an administrator can link them.', text: null, time: '13:55' },
  { role: 'user', raw: 'Fine, submit it anyway.', text: null, time: '13:56' },
];

function RequestMain() {
  return (
    <div className={styles.stackCol}>
      <StatStrip
        aria-label="Priority and complexity"
        items={[
          { label: 'Priority', value: 'Medium', sub: 'Confirmed by Omar Khalid. The assistant proposed Medium.' },
          { label: 'Complexity', value: 'M', sub: 'About a week. The assistant proposed M.' },
        ]}
      />
      <Card as="section" aria-label="Request details" data-testid="request-card">
        <div className={styles.sections}>
          <section>
            <Eyebrow>Description</Eyebrow>
            <TextBlock
              mode="raw"
              text="Add a PDF export to the Compare page so two or more runs can be sent to a manager as one file. The file holds the summary tiles and the metric table with run names, dataset versions and the date."
            />
          </section>
          <section>
            <Eyebrow>Business need</Eyebrow>
            <TextBlock mode="raw" text="Managers who do not use qym need to read a comparison of two runs without an account." />
          </section>
          <section>
            <Eyebrow>Justification</Eyebrow>
            <TextBlock mode="raw" text="Done once a week by one lead today with screenshots. The same need as FB-0031 from a different team." />
          </section>
          <div className={styles.pair}>
            <section>
              <Eyebrow>Why Medium</Eyebrow>
              <TextBlock mode="raw" text="One team, weekly, a workaround exists. Already covered by an accepted request." />
            </section>
            <section>
              <Eyebrow>Why M</Eyebrow>
              <TextBlock mode="raw" text="Reuses the compare view; needs a print layout and a rule for restricted datasets." />
            </section>
          </div>
        </div>
      </Card>
      <HistoryCard />
    </div>
  );
}

const EVENTS = [
  { who: 'Dev User', what: 'Marked as a duplicate of FB-0031', when: 'Oct 20, 09:12', note: 'Same ask. Keep FB-0031 as the one to plan.' },
  { who: 'Dev User', what: 'Priority Low to Medium', when: 'Oct 20, 09:11', note: 'Second team asking for it.' },
  { who: 'Omar Khalid', what: 'Submitted', when: 'Oct 19, 14:07', note: '' },
];

export function HistoryCard() {
  return (
    <Card as="section" aria-label="History" header={<Text variant="md">History</Text>} data-testid="history">
      <ol className={styles.events}>
        {EVENTS.map((e) => (
          <li key={e.when} className={styles.event}>
            <span className={styles.eventHead}>
              <strong>{e.who}</strong> <span>{e.what}</span>
              <time>{e.when}</time>
            </span>
            {e.note ? <span className={styles.eventNote}>{e.note}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function RelatedCard() {
  return (
    <Card as="aside" aria-label="Related requests" header={<Text variant="md">Related requests</Text>} data-testid="related-card">
      <RelatedList items={FB38_RELATED} />
    </Card>
  );
}

function TriageCard({ pending = true, declineError }: { pending?: boolean; declineError?: boolean }) {
  const [note, setNote] = useState('');
  return (
    <Card
      as="section"
      aria-label="Triage"
      data-testid="triage"
      header={
        <div className={styles.railHead}>
          <Text variant="md">Triage</Text>
          <Tag kind="accent">Admin</Tag>
        </div>
      }
      footer={
        <div className={styles.footActions}>
          <Button variant="ghost" isDisabled={!pending}>
            Reset
          </Button>
          <Button variant="accent" isDisabled={!pending}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className={styles.triageBody}>
        <Select label="Status" items={STATUSES} value={declineError ? 'declined' : 'new'} onChange={noop} />
        <div className={styles.pair}>
          <Select label="Priority" items={PRIORITIES} value={pending ? 'high' : 'medium'} onChange={noop} />
          <Select label="Complexity" items={COMPLEXITIES} value="M" onChange={noop} />
        </div>
        <Select
          label="Duplicate of"
          items={[{ key: 'none', label: 'Not a duplicate' }, { key: 'FB-0031', label: 'FB-0031 · Export run comparison to PDF' }]}
          value="FB-0031"
          onChange={noop}
        />
        {pending ? (
          <p className={styles.pending} data-testid="pending-changes">
            <Eyebrow>Pending</Eyebrow>
            {declineError ? 'Status New to Declined' : 'Priority Medium to High'}
          </p>
        ) : null}
        <Textarea
          label="Note for the history"
          rows={3}
          value={note}
          onChange={setNote}
          isRequired={pending}
          errorMessage={pending ? (declineError ? 'Say why it is declined. The submitter sees this.' : 'Add a note: it is shown in the history.') : undefined}
        />
      </div>
    </Card>
  );
}

function RequestHeader({ declined }: { declined?: boolean }) {
  return (
    <PageHeader
      title={FB38.title}
      description={FB38.summary}
      meta={[
        <Tag key="id" kind="data">
          {FB38.id}
        </Tag>,
        <StatusBadge key="st" status={declined ? 'declined' : FB38.status} />,
        'qym itself',
        `${FB38.by} · ${FB38.date}, 14:07`,
      ]}
    />
  );
}

function DuplicateBanner() {
  return (
    <Callout tone="warning" title="Marked as a duplicate of FB-0031">
      <span>
        Dev User linked this request to <Id id="FB-0031" /> “Export run comparison to PDF” on Oct 20. Administrators plan
        the canonical request; this one stays as a record.
      </span>
    </Callout>
  );
}

function RequestPage({ tab = 'request', admin }: { tab?: 'request' | 'conversation'; admin?: boolean }) {
  return (
    <div className={styles.col} data-testid="feedback-request-page">
      <RequestHeader />
      <DuplicateBanner />
      <Tabs
        label="Request sections"
        items={[
          { id: 'request', label: 'Request' },
          { id: 'conversation', label: 'Conversation', count: FB38_TRANSCRIPT.length },
        ]}
        selected={tab}
        onSelect={noop}
      >
        <TabPanel id="request">{null}</TabPanel>
        <TabPanel id="conversation">{null}</TabPanel>
      </Tabs>
      {tab === 'request' ? (
        <div className={styles.split} data-request-split>
          <RequestMain />
          <div className={styles.stackCol}>
            {admin ? <TriageCard /> : null}
            <RelatedCard />
          </div>
        </div>
      ) : (
        <Card as="section" aria-label="Conversation transcript" data-testid="transcript">
          <div className={styles.transcriptNote}>
            <Icon name="lock" size={12} /> Read only. The assistant’s proposal is the confirmed request on the Request tab.
          </div>
          <ol className={styles.msgs}>
            {FB38_TRANSCRIPT.map((m, i) => (
              <MsgItem key={i} m={m} />
            ))}
            <li className={styles.toolLine} data-role="tool">
              <Icon name="check" size={12} />
              <span>Omar Khalid submitted the proposal · 14:07</span>
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────────── admin: Feedback agent ───────────────────────────── */

type AdminState = 'ok' | 'empty' | 'noenc' | 'failed';

function ConnectionCard({ state }: { state: AdminState }) {
  const empty = state === 'empty';
  return (
    <Card
      as="section"
      aria-label="Connection"
      data-testid="connection"
      header={
        <div className={styles.railHead}>
          <Text variant="md">Connection</Text>
          {empty ? <Badge tone="warning">Not configured</Badge> : <Badge tone="success">Configured</Badge>}
        </div>
      }
      footer={
        <div className={styles.footActions}>
          <Button variant="neutral" icon={<Icon name="play" size={14} />} isDisabled={empty || state === 'noenc'}>
            Test connection
          </Button>
          <Button variant="accent" isDisabled={state === 'noenc'}>
            Save connection
          </Button>
        </div>
      }
    >
      <div className={styles.triageBody}>
        {state === 'noenc' ? (
          <Callout tone="error" title="Saving is blocked: the platform has no encryption key" live>
            Set QYM_LLM_CONFIG_ENCRYPTION_KEY on the server and restart it. The API key is never stored in clear text.
          </Callout>
        ) : null}
        <div className={styles.connGrid}>
          <TextField label="Base URL" mono isRequired value={empty ? '' : 'https://gateway.example.com/v1'} onChange={noop} placeholder="https://api.openai.com/v1" help="Any OpenAI-compatible endpoint. An https:// URL is required." />
          <TextField label="Model" mono isRequired value={empty ? '' : 'gpt-4.1'} onChange={noop} placeholder="gpt-4.1" help="Must support tool calls." />
          <TextField
            label="API key"
            type="password"
            mono
            value=""
            onChange={noop}
            placeholder={empty ? 'sk-…' : 'Keep current (••••7890)'}
            autoComplete="new-password"
          />
        </div>
        {state === 'ok' ? (
          <Callout tone="success" title="Connected" live>
            gpt-4.1 answered in 640 ms and called a test tool. Tested by Dev User a moment ago.
          </Callout>
        ) : null}
        {state === 'failed' ? (
          <Callout tone="error" title="The connection test failed" live>
            The endpoint answered 401: the key was rejected. Nothing was changed.
          </Callout>
        ) : null}
      </div>
    </Card>
  );
}

function BehaviourCard() {
  return (
    <Card
      as="section"
      aria-label="Behaviour"
      header={<Text variant="md">Behaviour</Text>}
      footer={
        <div className={styles.footActions}>
          <Button variant="neutral">Save behaviour</Button>
        </div>
      }
    >
      <div className={styles.connGrid}>
        <NumberField label="Keep drafts for (days)" value={30} onChange={noop} minValue={1} maxValue={365} help="A draft nobody submitted is deleted after this many days." />
        <NumberField label="Most messages per request" value={30} onChange={noop} minValue={6} maxValue={100} help="After this many of the person’s messages the assistant must propose." />
      </div>
    </Card>
  );
}

function AdminPage({ state = 'ok' }: { state?: AdminState }) {
  return (
    <div className={styles.col} data-testid="admin-feedback-page">
      <PageHeader title="Admin" description="Platform-wide runs, projects, users, maintenance and the feedback assistant." />
      <StatStrip
        aria-label="Feedback totals"
        items={[
          { label: 'Requests', value: state === 'empty' ? 0 : 38, sub: '7 new' },
          { label: 'Open drafts', value: state === 'empty' ? 0 : 5, sub: 'deleted after 30 days' },
          { label: 'Assistant calls, 7 days', value: state === 'empty' ? 0 : 212 },
        ]}
      />
      <Tabs
        label="Admin sections"
        items={[
          { id: 'runs', label: 'Runs' },
          { id: 'projects', label: 'Projects', count: 12 },
          { id: 'users', label: 'Users', count: 24 },
          { id: 'maintenance', label: 'Maintenance' },
          { id: 'feedback', label: 'Feedback agent' },
        ]}
        selected="feedback"
        onSelect={noop}
      >
        <TabPanel id="runs">{null}</TabPanel>
        <TabPanel id="projects">{null}</TabPanel>
        <TabPanel id="users">{null}</TabPanel>
        <TabPanel id="maintenance">{null}</TabPanel>
        <TabPanel id="feedback">{null}</TabPanel>
      </Tabs>
      <div className={styles.stackCol}>
        <ConnectionCard state={state} />
        <BehaviourCard />
      </div>
    </div>
  );
}

/* ───────────────────────────── state sheets (appendix) ───────────────────────────── */

const Lbl = ({ children }: { children: ReactNode }) => <p className={styles.label}>{children}</p>;

function ListStates() {
  return (
    <div className={styles.col} data-testid="sheet-list">
      <Lbl>Empty list (no request exists yet)</Lbl>
      <Card as="section" aria-label="Empty list">
        <EmptyState
          icon={<FeedbackGlyph size={48} />}
          title="No feedback yet"
          body="Tell the assistant what you need and it turns it into a request the team can act on."
          action={<NewButton />}
        />
      </Card>
      <Lbl>Filters match nothing</Lbl>
      <Card as="section" aria-label="No match" flush>
        <RequestsTable rows={[]} />
      </Card>
      <Lbl>Loading frame (the loaded layout with skeleton rows, same height as the loaded table)</Lbl>
      <div data-testid="list-loading">
        <RequestsTable rows={REQS} loading />
      </div>
      <Lbl>The list failed to load (never an empty state)</Lbl>
      <ErrorState error={new Error('Network down')} title="Couldn’t load feedback" onRetry={noop} compact />
    </div>
  );
}

function ChatStates() {
  return (
    <div className={styles.col} data-testid="sheet-chat">
      <Lbl>The assistant is answering (streamed text, the live region announces it when the message ends)</Lbl>
      <Chat
        height={360}
        messages={CHAT_START.slice(0, 4)}
        extra={<Streaming text="That is about two hours of lead time every week. What would a good result look like: the summary tiles and the metric table only, or also" />}
        disabled
        composerNote="The assistant is writing. You can send your next reply when it has finished."
      />
      <Lbl>The assistant is unavailable (the person’s message is kept, Retry resends it)</Lbl>
      <Chat
        height={360}
        messages={CHAT_START.slice(0, 4)}
        extra={
          <li>
            <div className={styles.errorLine} role="alert" data-testid="agent-unavailable">
              <Icon name="warning" size={14} />
              <span className={styles.errorText}>
                The assistant could not answer: the model endpoint is not reachable. Your message is saved.
              </span>
              <Button size="sm" variant="neutral" icon={<Icon name="retry" size={12} />}>
                Retry
              </Button>
            </div>
          </li>
        }
        draft=""
      />
      <Lbl>Coming back to a draft</Lbl>
      <Callout tone="info" title="Welcome back">
        This draft is from 2 days ago. The assistant remembers the conversation. It is deleted in 28 days if you do not submit it.
      </Callout>
      <Lbl>The message limit is reached (the assistant must propose now)</Lbl>
      <Callout tone="warning" title="30 of 30 messages used">
        The assistant will now propose a request from what it knows. You can edit everything before you submit.
      </Callout>
      <Lbl>The server corrected the assistant’s proposal (an unknown request id was removed; shown as an event line)</Lbl>
      <ol className={styles.msgs}>
        <li className={styles.toolLine} data-role="tool">
          <Icon name="info" size={12} />
          <span>The assistant’s proposal named a request that does not exist. It was removed before you saw it.</span>
        </li>
      </ol>
    </div>
  );
}

function ProposalStates() {
  return (
    <div className={styles.col} data-testid="sheet-proposal">
      <Lbl>No duplicate: the button reads Submit request; priority changed by the person shows what the assistant proposed</Lbl>
      <ProposalCard duplicate={false} edited />
      <Lbl>Description emptied: the button is disabled and the field names the problem</Lbl>
      <ProposalCard duplicate={false} invalid />
      <Lbl>After Submit: the request opens and says what happened</Lbl>
      <Callout tone="success" title="Submitted as FB-0045" live>
        Everyone signed in can read it. An administrator will set its status. Your conversation is kept on the request.
      </Callout>
    </div>
  );
}

function RequestStates() {
  return (
    <div className={styles.col} data-testid="sheet-request">
      <Lbl>Declined: the reason sits under the header, the submitter sees it</Lbl>
      <RequestHeader declined />
      <Callout tone="error" title="Declined by Dev User on Oct 22">
        We are moving PDF export to FB-0031 and will not build a second one. Add what is missing to that request instead.
      </Callout>
      <Lbl>Admin declines without a reason: Save is refused with a message</Lbl>
      <TriageCard declineError />
      <Lbl>No access or not found (a failed load is never an empty state)</Lbl>
      <ErrorState error={new Error('Not found')} title="Couldn’t open this request" onRetry={noop} compact />
      <Lbl>Loading frame of the Request tab (same blocks as loaded, skeleton values)</Lbl>
      <Card as="section" aria-label="Loading request">
        <Skeleton kind="rows" rows={5} rowHeight={48} label="Loading request" />
      </Card>
    </div>
  );
}

function AdminStates() {
  return (
    <div className={styles.col} data-testid="sheet-admin">
      <Lbl>Not configured (first visit)</Lbl>
      <ConnectionCard state="empty" />
      <Lbl>The platform has no encryption key (saving is blocked, with the fix)</Lbl>
      <ConnectionCard state="noenc" />
      <Lbl>Test failed</Lbl>
      <ConnectionCard state="failed" />
    </div>
  );
}

function NavSheet() {
  return (
    <div className={styles.navSheet}>
      <Lbl>Member: Feedback is the third entry of the global group, after Projects and Docs</Lbl>
      <Shell crumbs={['Feedback']}>
        <p className={styles.navNote}>32 px entries, 13/500, active entry 13/600 on the active fill.</p>
      </Shell>
      <Lbl>Administrator: the Platform group follows, unchanged</Lbl>
      <Shell crumbs={['Feedback']} admin user={['DU', 'Dev User', 'dev@local']}>
        <p className={styles.navNote}>No count badge: the shell does not call the feedback API.</p>
      </Shell>
    </div>
  );
}

/* ───────────────────────────── gallery section ───────────────────────────── */

export function AiFeedbackMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="ai-feedback" title="AI-assisted feedback (WP-E design contract)">
      <Case wide label="ae-page-list (QE-1: /feedback, a member's view: drafts strip, filters, a duplicate pair grouped, a conflict in the data)">
        <Shell crumbs={['Feedback']}>
          <ListPage />
        </Shell>
      </Case>
      <Case wide label="ae-page-new (QE-2: /feedback/new, the subject step, qym itself chosen)">
        <Shell crumbs={['Feedback', 'New']}>
          <NewPage text="We need to export the run comparison as a PDF. I send it to the VP of support before the Thursday review." />
        </Shell>
      </Case>
      <Case wide label="ae-page-chat (QE-3: the draft mid-conversation, the assistant asked, the person is typing)">
        <Shell crumbs={['Feedback', 'New']}>
          <ChatPage />
        </Shell>
      </Case>
      <Case wide label="ae-page-proposal (QE-4: the assistant proposed; the card with a duplicate warning, confirm and keep talking)">
        <Shell crumbs={['Feedback', 'New']}>
          <ProposalPage />
        </Shell>
      </Case>
      <Case wide label="ae-page-request (QE-5: a submitted request as its submitter sees it: confirmed card, related panel, history)">
        <Shell crumbs={['Feedback', 'FB-0038']} user={['OK', 'Omar Khalid', 'omar@example.com']}>
          <RequestPage />
        </Shell>
      </Case>
      <Case wide label="ae-page-conversation (QE-6: the same request, the Conversation tab: the read-only transcript)">
        <Shell crumbs={['Feedback', 'FB-0038']} user={['OK', 'Omar Khalid', 'omar@example.com']}>
          <RequestPage tab="conversation" />
        </Shell>
      </Case>
      <Case wide label="ae-page-triage (QE-7: the same request as an administrator: the triage panel with one pending change)">
        <Shell crumbs={['Feedback', 'FB-0038']} admin user={['DU', 'Dev User', 'dev@local']}>
          <RequestPage admin />
        </Shell>
      </Case>
      <Case wide label="ae-page-admin (QE-8: Admin, Feedback agent: the connection, test result and behaviour)">
        <Shell crumbs={['Admin', 'Feedback agent']} active="Admin" admin user={['DU', 'Dev User', 'dev@local']}>
          <AdminPage />
        </Shell>
      </Case>
      <Case wide label="ae-page-unconfigured (QE-9: /feedback/new while no connection is set, a member's view)">
        <Shell crumbs={['Feedback', 'New']}>
          <UnconfiguredPage />
        </Shell>
      </Case>

      <Case wide label="ae-s-list (QE-10: empty, no match, loading frame, error)">
        <ListStates />
      </Case>
      <Case wide label="ae-s-chat (QE-11: streaming, agent unavailable, draft resume, message limit, corrected proposal)">
        <ChatStates />
      </Case>
      <Case wide label="ae-s-proposal (QE-12: no duplicate with an edited priority, an invalid description, after submit)">
        <ProposalStates />
      </Case>
      <Case wide label="ae-s-request (QE-13: declined, decline without a reason, not found, loading frame)">
        <RequestStates />
      </Case>
      <Case wide label="ae-s-admin (QE-14: not configured, no encryption key, test failed)">
        <AdminStates />
      </Case>
      <Case wide label="ae-s-new-product (QE-15: the subject step with a product, a project and a target)">
        <div className={styles.col} data-testid="sheet-new-product">
          <NewPage subject="product" text="Mark a nightly run red when refund-cases drops under the last good run." />
        </div>
      </Case>
      <Case wide label="ae-s-unconfigured-admin (QE-16: the not set up page as an administrator sees it)">
        <div className={styles.col}>
          <UnconfiguredPage admin />
        </div>
      </Case>
      <Case wide label="ae-s-nav (QE-17: the navigation entry, member and administrator)">
        <NavSheet />
      </Case>
    </Sec>
  );
}

