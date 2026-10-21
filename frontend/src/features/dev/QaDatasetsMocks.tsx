/**
 * QA round WP-A mocks (design stage): list-valued metadata filter, dataset Settings layout, the new Access tab, link cards
 * without a hover underline. Static visual contracts for docs/internal/feature-rounds/2026-10-qa-feedback/spec-a.md.
 * Primitives and tokens only; nothing reads the API. Every case carries data-case="qa-...":
 * qa-filter-popover, qa-filter-chips, qa-tabs, qa-settings, qa-access, qa-access-readonly, qa-access-states, qa-leave-dialog, qa-link-cards.
 */
import { useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  DataTable,
  ErrorState,
  FieldRow,
  Icon,
  IconButton,
  LinkButton,
  RadioGroup,
  SegmentedControl,
  Select,
  Skeleton,
  Tabs,
  Tag,
  Text,
  TextField,
  Textarea,
  type Column,
} from '@/ui';
import { Note } from '@/features/datasets/components/Note';
import { UserPill } from '@/features/datasets/components/UserPill';
import { QaPageMocks } from './QaPageMocks';
import styles from './QaDatasetsMocks.module.css';

const noop = () => undefined;

/* ───────────────────────────── fixtures ───────────────────────────── */

interface Person {
  id: string;
  email: string;
  display_name: string;
}
const PEOPLE: Person[] = [
  'Sami Otaibi',
  'Lina Harbi',
  'Omar Zahrani',
  'Reem Ghamdi',
  'Faisal Dossari',
  'Noura Shehri',
  'Khalid Mutairi',
  'Huda Subaie',
  'Yazan Amri',
  'Dana Rashed',
  'Tariq Anazi',
  'Salma Hijazi',
].map((name, i) => ({
  id: `u${i + 3}`,
  display_name: name,
  email: `${(name.split(' ')[0] ?? 'user').toLowerCase()}.${i + 3}@example.com`,
}));
const DEV: Person = { id: 'u1', email: 'dev@local', display_name: 'Dev User' };
const MONA: Person = { id: 'u2', email: 'mona.2@example.com', display_name: 'Mona Qahtani' };

interface Grant {
  user: Person;
  level: 'view' | 'modify';
  by: Person | null;
  at: string;
  pending?: boolean;
}
const DATES = [
  'Oct 14, 2026',
  'Oct 14, 2026',
  'Oct 15, 2026',
  'Oct 16, 2026',
  'Oct 16, 2026',
  'Oct 17, 2026',
];
function grants(n: number): Grant[] {
  return PEOPLE.slice(0, n).map((user, i) => ({
    user,
    level: i % 3 === 0 ? 'modify' : 'view',
    by: i % 4 === 3 ? MONA : DEV,
    at: DATES[i % DATES.length] ?? '',
  }));
}

/* ───────────────────────────── shared pieces ───────────────────────────── */

function Lbl({ children, spec }: { children: ReactNode; spec?: boolean }) {
  return (
    <p className={styles.label} data-kind={spec ? 'spec' : undefined}>
      {children}
    </p>
  );
}

function CardHead({
  id,
  title,
  description,
  aside,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className={styles.cardHead} data-testid="card-head">
      <div className={styles.cardHeadText}>
        <Text variant="lg" weight={600} as="h2" id={id}>
          {title}
        </Text>
        {description ? (
          <Text variant="sm" tone="muted" as="p">
            {description}
          </Text>
        ) : null}
      </div>
      {aside ? <div className={styles.cardHeadAside}>{aside}</div> : null}
    </div>
  );
}

/* ───────────────────────────── QA1: list-valued metadata filter ───────────────────────────── */

type PopState = 'none' | 'partial' | 'full' | 'mixed' | 'limit' | 'truncated' | 'scalar';

const TAG_VALUES: [string, number][] = [
  ['billing', 26],
  ['refund', 26],
  ['account', 25],
  ['arabic', 25],
  ['shipping', 25],
  ['vip', 25],
  ['fraud', 24],
  ['urgent', 24],
];
const MIXED_VALUES: [string, number][] = [
  ['chat', 87],
  ['email', 87],
  ['phone', 22],
];
const SCALAR_VALUES: [string, number][] = [
  ['finance', 42],
  ['health', 30],
  ['legal', 29],
  ['retail', 29],
];

const MATCH_HELP = {
  pick: 'Choose two or more values to pick a match mode.',
  any: 'Items that have at least one of the chosen values.',
  all: 'Items that have every chosen value. An item may have more.',
} as const;

export function FacetPopover({ state }: { state: PopState }) {
  const scalar = state === 'scalar';
  const mixed = state === 'mixed';
  const values = scalar ? SCALAR_VALUES : mixed ? MIXED_VALUES : TAG_VALUES;
  const initial: string[] =
    state === 'partial' || state === 'full'
      ? ['billing', 'refund']
      : state === 'mixed'
        ? ['chat', 'phone']
        : state === 'limit'
          ? values.map(([v]) => v)
          : scalar
            ? ['finance']
            : [];
  const [chosen, setChosen] = useState<string[]>(initial);
  const [mode, setMode] = useState<'any' | 'all'>(state === 'full' ? 'all' : 'any');
  const key = scalar ? 'domain' : mixed ? 'channels' : 'tags';
  const toggle = (v: string) =>
    setChosen(scalar ? [v] : chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  const help = chosen.length < 2 ? MATCH_HELP.pick : MATCH_HELP[mode];
  return (
    <div
      className={styles.popover}
      role="dialog"
      aria-label="Filter by metadata"
      data-testid="meta-popover"
      data-facet-state={state}
    >
      <Text variant="md" weight={600} as="h3">
        Filter by metadata
      </Text>
      <Select
        label="Key"
        items={[
          { key: 'channels', label: 'channels', description: '3 values · list or value' },
          { key: 'domain', label: 'domain', description: '4 values' },
          { key: 'source.labels', label: 'source.labels', description: '5 values · list' },
          { key: 'tags', label: 'tags', description: '8 values · list' },
        ]}
        value={key}
        onChange={noop}
        width="100%"
      />
      <div className={styles.values}>
        <div className={styles.valuesHead}>
          <Text variant="sm" weight={650} tone="muted" as="p">
            Value
          </Text>
          {scalar ? null : (
            <Text variant="sm" tone="muted" as="span" data-testid="facet-selected-count">
              {chosen.length === 0
                ? 'None selected'
                : state === 'limit'
                  ? '20 selected'
                  : `${chosen.length} selected`}
            </Text>
          )}
        </div>
        <ul
          className={styles.facetList}
          role="listbox"
          aria-label={`Values of ${key}`}
          aria-multiselectable={scalar ? undefined : true}
          data-testid="facet-values"
        >
          {values.map(([v, n]) => (
            <li
              key={v}
              role="option"
              aria-selected={chosen.includes(v)}
              tabIndex={0}
              className={styles.facet}
              data-selected={chosen.includes(v) ? '' : undefined}
              data-multi={scalar ? undefined : ''}
              onClick={() => toggle(v)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  toggle(v);
                }
              }}
            >
              {scalar ? null : (
                <span className={styles.tick} aria-hidden="true">
                  {chosen.includes(v) ? <Icon name="check" size={12} /> : null}
                </span>
              )}
              <span className={styles.facetValue}>{v}</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
        {state === 'truncated' ? (
          <Text variant="sm" tone="muted" as="p" data-testid="facet-truncated">
            Showing the 200 most common values of 340. Type to search.
          </Text>
        ) : null}
        {state === 'limit' ? (
          <Text variant="sm" tone="muted" as="p" data-testid="facet-limit">
            You can choose up to 20 values.
          </Text>
        ) : null}
      </div>
      {scalar ? null : (
        <div className={styles.match} data-testid="meta-match">
          <div className={styles.matchRow}>
            <Text variant="sm" weight={650} tone="muted" as="p">
              Match
            </Text>
            <SegmentedControl
              label="Match mode"
              options={[
                { value: 'any', label: 'Partial' },
                { value: 'all', label: 'Full match' },
              ]}
              value={mode}
              onChange={setMode}
              isDisabled={chosen.length < 2}
            />
          </div>
          <Text variant="sm" tone="muted" as="p" className={styles.matchHelp} data-testid="meta-match-help">
            {help}
          </Text>
        </div>
      )}
      <div className={styles.popoverFoot}>
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
        <Button variant="primary" size="sm" isDisabled={chosen.length === 0}>
          Add filter
        </Button>
      </div>
    </div>
  );
}

export function ChipsMock({ many }: { many?: boolean }) {
  const chips = many
    ? [
        'domain: finance',
        'tags: billing, refund (all)',
        'source.labels: gold, silver, reviewed, needs-review, synthetic (all)',
        'channels: chat',
        'source.region.code: sa',
      ]
    : ['domain: finance', 'tags: billing, refund (all)', 'channels: chat, phone (any)'];
  return (
    <div className={styles.toolbarChips}>
      <div className={styles.toolbarRow}>
        <Button
          variant="neutral"
          size="sm"
          icon={<Icon name="plus" size={12} />}
          data-testid="metadata-filter"
        >
          Metadata
        </Button>
        <Text variant="sm" tone="muted" as="span">
          {many ? '5 filters' : '3 filters'}
        </Text>
      </div>
      <div className={styles.chipRow} data-testid="filter-chips">
        {chips.map((c) => (
          <Chip key={c} isSelected onRemove={noop} removeLabel={`Remove filter ${c}`} data-testid="meta-chip">
            {c}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── QA5: Settings layout ───────────────────────────── */

type SettingsVariant = 'editable' | 'readonly' | 'plain';

export function SettingsMock({ variant }: { variant: SettingsVariant }) {
  const readOnly = variant === 'readonly';
  const [name, setName] = useState('support-faq');
  const [description, setDescription] = useState('Customer support questions in Arabic and English.');
  const [tag, setTag] = useState('');
  const [privateTest, setPrivate] = useState(false);
  const tags = ['support', 'bilingual'];
  return (
    <div className={styles.settings} data-testid="settings-layout" data-variant={variant}>
      <div className={styles.settingsGrid}>
        <Card
          as="section"
          aria-labelledby={`g-${variant}`}
          data-testid="settings-general"
          header={<CardHead id={`g-${variant}`} title="General" />}
          footer={
            readOnly ? undefined : (
              <div className={styles.footRow}>
                <Button variant="primary" isDisabled>
                  Save changes
                </Button>
                <Text variant="sm" tone="muted" as="span" aria-live="polite">
                  No changes
                </Text>
              </div>
            )
          }
        >
          <div className={styles.fields}>
            <FieldRow label="Name" measure="full" labelCase="sentence" labelAnchor="start">
              <TextField
                label="Name"
                hideLabel
                value={name}
                onChange={setName}
                isReadOnly={readOnly}
                isRequired
              />
            </FieldRow>
            <FieldRow label="Description" measure="full" labelCase="sentence" labelAnchor="start">
              <Textarea
                label="Description"
                hideLabel
                value={description}
                onChange={setDescription}
                rows={3}
                isReadOnly={readOnly}
              />
            </FieldRow>
            <FieldRow label="Tags" measure="full" labelCase="sentence" labelAnchor="start">
              <div className={styles.tags}>
                {readOnly ? null : (
                  <TextField
                    label="Tags"
                    hideLabel
                    value={tag}
                    onChange={setTag}
                    placeholder="Type a tag and press Enter"
                    help="Press Enter to add a tag."
                  />
                )}
                <div className={styles.chipRow} role="list" aria-label="Tags">
                  {tags.map((t) => (
                    <Chip
                      key={t}
                      isSelected
                      onRemove={readOnly ? undefined : noop}
                      removeLabel={`Remove tag ${t}`}
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>
            </FieldRow>
          </div>
        </Card>
        <div className={styles.side}>
          {variant === 'plain' ? null : (
            <Card
              as="section"
              aria-labelledby={`v-${variant}`}
              data-testid="settings-visibility"
              header={
                <CardHead
                  id={`v-${variant}`}
                  title="Visibility"
                  description="A private test set hides its items from everyone except admins, including the inputs, expected outputs, outputs, and traces of runs evaluated on it. Members still see versions, run history, and scores."
                />
              }
            >
              <Checkbox isSelected={privateTest} isDisabled={readOnly} onChange={setPrivate}>
                Private test set (admins only)
              </Checkbox>
            </Card>
          )}
          <Card
            as="section"
            aria-labelledby={`d-${variant}`}
            tone="danger"
            data-testid="settings-danger"
            header={
              <CardHead
                id={`d-${variant}`}
                title="Danger zone"
                description="Deleting moves the dataset, with all its versions, items and history, to Deleted datasets, where a project manager can restore it. Runs that used it keep their results."
              />
            }
          >
            {readOnly ? (
              <Text variant="sm" tone="muted" as="p">
                Only the dataset creator or a project manager can delete a dataset.
              </Text>
            ) : (
              <div>
                <Button variant="danger">Delete dataset</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── QA5: Access tab ───────────────────────────── */

type AccessState =
  | 'project'
  | 'empty'
  | 'one'
  | 'twelve'
  | 'dirty'
  | 'saving'
  | 'failed'
  | 'readonly-project'
  | 'readonly-restricted'
  | 'archived'
  | 'loading'
  | 'error';

const MODE_OPTIONS = (savedNote: string) => [
  {
    value: 'project' as const,
    title: 'Everyone in the project',
    help: 'Every member can view and modify this dataset. This is the default.',
    testId: 'access-mode-project',
  },
  {
    value: 'restricted' as const,
    title: 'Only people listed below',
    help: `Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.${savedNote}`,
    testId: 'access-mode-restricted',
  },
];

function level(l: 'view' | 'modify') {
  return l === 'modify' ? 'Modify' : 'View';
}

function GrantsTable({
  rows,
  editable,
  setLevel,
}: {
  rows: Grant[];
  editable: boolean;
  setLevel?: (id: string, l: 'view' | 'modify') => void;
}) {
  const columns: Column<Grant>[] = [
    {
      id: 'person',
      header: 'Person',
      flex: true,
      minWidth: 200,
      priority: 1,
      cardTitle: true,
      cell: (g) => (
        <span className={styles.personCell}>
          <span className={styles.personName} dir="auto">
            {g.user.display_name}
          </span>
          <span className={styles.personEmail}>{g.user.email}</span>
        </span>
      ),
    },
    {
      id: 'level',
      header: 'Level',
      width: 160,
      priority: 1,
      cell: (g) =>
        editable ? (
          <SegmentedControl
            label={`Level for ${g.user.display_name}`}
            options={[
              { value: 'view', label: 'View' },
              { value: 'modify', label: 'Modify' },
            ]}
            value={g.level}
            onChange={(v) => setLevel?.(g.user.id, v)}
          />
        ) : (
          <Tag tone={g.level === 'modify' ? 'accent' : undefined}>{level(g.level)}</Tag>
        ),
    },
    {
      id: 'by',
      header: 'Added by',
      width: 180,
      priority: 2,
      cell: (g) => (g.by ? <UserPill user={g.by} /> : <span className={styles.personEmail}>You</span>),
    },
    {
      id: 'at',
      header: 'Added',
      width: 130,
      priority: 2,
      cell: (g) =>
        g.pending ? (
          <Tag tone="warning">Not saved</Tag>
        ) : (
          <span className={styles.when} data-testid="grant-added-at">
            {g.at}
          </span>
        ),
    },
    ...(editable
      ? [
          {
            id: 'remove',
            header: 'Remove',
            hideLabel: true,
            width: 48,
            priority: 1,
            cell: (g: Grant) => (
              <IconButton label={`Remove ${g.user.display_name}`} icon="close" onPress={noop} />
            ),
          } satisfies Column<Grant>,
        ]
      : []),
  ];
  return (
    <div data-testid="access-grants-table">
      <DataTable<Grant>
        aria-label="People with access"
        variant="embedded"
        density="regular"
        densityLocked
        zebra={false}
        rows={rows}
        rowKey={(g) => g.user.id}
        columns={columns}
      />
    </div>
  );
}

export function AccessTabMock({ state }: { state: AccessState }) {
  const readOnly = state.startsWith('readonly') || state === 'archived';
  const startRestricted = !['project', 'readonly-project', 'loading', 'error'].includes(state);
  const [mode, setMode] = useState<'project' | 'restricted'>(startRestricted ? 'restricted' : 'project');
  const base =
    state === 'empty'
      ? []
      : state === 'one'
        ? grants(1)
        : state === 'readonly-restricted' || state === 'archived'
          ? grants(3)
          : grants(12);
  const dirty = state === 'dirty' || state === 'saving' || state === 'failed';
  const [rows, setRows] = useState<Grant[]>(
    dirty
      ? [
          ...base.slice(0, 11).map((g, i) => (i === 1 ? { ...g, level: 'modify' as const } : g)),
          {
            user: { id: 'n1', display_name: 'Rana Jaber', email: 'rana.20@example.com' },
            level: 'view',
            by: null,
            at: '',
            pending: true,
          },
        ]
      : base,
  );
  const [who, setWho] = useState<Key | null>(null);
  const restricted = readOnly ? state !== 'readonly-project' : mode === 'restricted';
  const savedCount = grants(12).length;
  const saved =
    !dirty && state === 'project'
      ? ` ${savedCount === 1 ? '1 saved grant is kept and applies again if you switch back.' : `${savedCount} saved grants are kept and apply again if you switch back.`}`
      : '';
  const sentence =
    state === 'archived'
      ? 'This project is archived.'
      : readOnly
        ? 'Only project managers and admins can change who has access.'
        : 'Choose who in this project can open and change this dataset.';
  const pool = [
    { key: 'p1', label: 'Rana Jaber', description: 'rana.20@example.com' },
    { key: 'p2', label: 'Bader Fahad', description: 'bader.21@example.com' },
    { key: 'p3', label: 'نورة العتيبي', description: 'noura.ar.15@example.com' },
  ];
  const [newLevel, setNewLevel] = useState<'view' | 'modify'>('view');

  if (state === 'loading' || state === 'error') {
    return (
      <div className={styles.accessTab} data-testid="access-tab" data-access-state={state}>
        <Card
          as="section"
          aria-label="Access mode"
          data-testid="access-mode-card"
          header={
            <CardHead
              id={`am-${state}`}
              title="Access mode"
              description="Choose who in this project can open and change this dataset."
            />
          }
        >
          {state === 'loading' ? (
            <div className={styles.skeletonFrame}>
              <Skeleton kind="lines" rows={3} label="Loading access" />
            </div>
          ) : (
            <ErrorState compact error={{ status: 500 }} title="Couldn’t load access" onRetry={noop} />
          )}
        </Card>
      </div>
    );
  }

  const count = rows.length === 1 ? '1 person' : `${rows.length} people`;
  return (
    <div className={styles.accessTab} data-testid="access-tab" data-access-state={state}>
      <Card
        as="section"
        aria-labelledby={`am-${state}`}
        data-testid="access-mode-card"
        header={
          <CardHead
            id={`am-${state}`}
            title="Access mode"
            description={sentence}
            aside={
              readOnly ? (
                <Badge
                  tone={restricted ? 'neutral' : 'success'}
                  glyph={restricted ? <Icon name="lock" size={12} /> : undefined}
                >
                  {restricted ? 'Restricted' : 'Project-wide'}
                </Badge>
              ) : null
            }
          />
        }
      >
        <div className={styles.modeBody}>
          {readOnly ? (
            <dl className={styles.summary} data-testid="access-summary">
              <dt>Who has access</dt>
              <dd>{restricted ? 'Only people listed below' : 'Everyone in the project'}</dd>
              <dt>Your access</dt>
              <dd>{restricted ? 'View' : 'Modify'}</dd>
            </dl>
          ) : (
            <RadioGroup<'project' | 'restricted'>
              label="Who can access this dataset"
              testId="access-mode"
              className={styles.modeGrid}
              value={mode}
              onChange={setMode}
              options={MODE_OPTIONS(saved)}
            />
          )}
          <p className={styles.always} data-testid="access-always">
            <Icon name="lock" size={12} />
            <span>Project managers, admins and the creator always have full access.</span>
          </p>
        </div>
      </Card>

      {restricted ? (
        <Card
          as="section"
          aria-labelledby={`pp-${state}`}
          data-testid="access-people"
          header={
            <CardHead
              id={`pp-${state}`}
              title="People with access"
              aside={
                <Text variant="sm" tone="muted" as="span" data-testid="access-count">
                  {count}
                </Text>
              }
            />
          }
        >
          <div className={styles.peopleBody}>
            {readOnly ? null : (
              <div className={styles.addPerson} data-testid="access-add">
                <div className={styles.addSelect}>
                  <Select
                    label="Add person"
                    items={pool}
                    value={who}
                    onChange={setWho}
                    placeholder="Choose a project member"
                    width="100%"
                  />
                </div>
                <SegmentedControl
                  label="Level for the new person"
                  options={[
                    { value: 'view', label: 'View' },
                    { value: 'modify', label: 'Modify' },
                  ]}
                  value={newLevel}
                  onChange={setNewLevel}
                />
                <Button variant="neutral" isDisabled={who === null}>
                  Add person
                </Button>
              </div>
            )}
            {rows.length ? (
              <GrantsTable
                rows={rows}
                editable={!readOnly}
                setLevel={(id, l) => setRows(rows.map((g) => (g.user.id === id ? { ...g, level: l } : g)))}
              />
            ) : (
              <Note tone="warning" title="No one is listed" data-testid="access-empty-note">
                <span>Only project managers, admins and the creator can open this dataset.</span>
              </Note>
            )}
          </div>
        </Card>
      ) : null}

      {readOnly ? null : (
        <div
          className={styles.saveBar}
          data-testid="access-save-bar"
          data-state={state === 'saving' ? 'saving' : dirty ? 'dirty' : 'clean'}
        >
          <span
            className={styles.saveStatus}
            data-part="status"
            aria-live="polite"
            data-tone={state === 'failed' ? 'error' : undefined}
          >
            {state === 'saving'
              ? 'Saving'
              : state === 'failed'
                ? 'Couldn’t save access'
                : dirty
                  ? 'Unsaved changes'
                  : 'No changes'}
          </span>
          <div className={styles.saveActions}>
            <Button variant="neutral" isDisabled={!dirty || state === 'saving'}>
              Discard
            </Button>
            <Button variant="primary" isDisabled={!dirty} loading={state === 'saving'}>
              Save access
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LeaveDialog() {
  return (
    <div
      className={styles.modal}
      role="dialog"
      aria-label="Discard access changes?"
      data-testid="access-leave-dialog"
    >
      <div className={styles.modalHead}>
        <h3 className={styles.modalTitle}>Discard access changes?</h3>
      </div>
      <div className={styles.modalBody}>
        <p>You have unsaved changes to who can access this dataset. They are lost if you leave this tab.</p>
      </div>
      <div className={styles.modalFoot}>
        <Button variant="neutral" size="md">
          Keep editing
        </Button>
        <Button variant="danger" size="md">
          Discard changes
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── QG1: link cards without a hover underline ───────────────────────────── */

function LinkCards() {
  return (
    <div className={styles.linkDemo} data-testid="link-cards">
      <Lbl>
        Card link (projects page, datasets catalog): hover raises the border and the fill, the text never
        underlines
      </Lbl>
      <ul className={styles.cardGrid}>
        <li>
          <Card to="/__ui#qa-datasets" className={styles.fillCard} data-testid="demo-card-link">
            <div className={styles.cardInner}>
              <Text variant="md" weight={600} as="span">
                refund-cases
              </Text>
              <Text variant="sm" tone="muted" as="span">
                v1 prod · current
              </Text>
              <Text variant="base" tone="secondary" as="span">
                Edge cases for refunds.
              </Text>
              <Text variant="sm" tone="muted" as="span">
                20 items · 0 runs
              </Text>
            </div>
          </Card>
        </li>
        <li>
          <Card to="/__ui#qa-datasets" className={styles.fillCard}>
            <div className={styles.cardInner}>
              <Text variant="md" weight={600} as="span">
                support-faq
              </Text>
              <Text variant="sm" tone="muted" as="span">
                v2 draft
              </Text>
              <Text variant="base" tone="secondary" as="span">
                Customer support questions in Arabic and English.
              </Text>
              <Text variant="sm" tone="muted" as="span">
                130 items · 2 runs
              </Text>
            </div>
          </Card>
        </li>
      </ul>
      <Lbl>Boxed link with two texts (docs previous and next)</Lbl>
      <div className={styles.pager}>
        <LinkButton
          to="/__ui#qa-datasets"
          variant="neutral"
          size="md"
          className={styles.pagerLink}
          data-testid="demo-pager-link"
        >
          <span className={styles.pagerLabel}>Previous</span>
          <span>Your first run</span>
        </LinkButton>
        <LinkButton to="/__ui#qa-datasets" variant="neutral" size="md" className={styles.pagerLink}>
          <span className={styles.pagerLabel}>Next</span>
          <span>Install &amp; requirements</span>
        </LinkButton>
      </div>
      <Lbl>Link with a badge or several texts (run page dataset link)</Lbl>
      <p className={styles.metaLine}>
        <Link to="/__ui#qa-datasets" className={styles.metaLink} data-testid="demo-meta-link">
          <span>support-faq</span>
          <Tag>v1</Tag>
          <Tag tone="accent">production</Tag>
        </Link>
      </p>
      <Lbl spec>Plain text link keeps the underline on hover (inline running text)</Lbl>
      <p className={styles.metaLine}>
        Open the{' '}
        <Link to="/__ui#qa-datasets" data-testid="demo-plain-link">
          run legal-baseline
        </Link>{' '}
        to see the items.
      </p>
    </div>
  );
}

/* ───────────────────────────── gallery wiring ───────────────────────────── */

export function QaDatasetsMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec
      id="qa-datasets"
      title="QA round: list metadata filter, Settings, Access tab, link cards (WP QA-A design contract)"
    >
      <QaPageMocks Case={Case} />
      <Case
        wide
        label="qa-filter-popover (QA1: list key, none chosen, partial, full match, mixed key, 20 chosen, truncated; the scalar key is unchanged)"
      >
        <div className={styles.frame}>
          <div className={styles.popRow}>
            <div>
              <Lbl spec>List key, nothing chosen</Lbl>
              <FacetPopover state="none" />
            </div>
            <div>
              <Lbl spec>Two chosen, Partial</Lbl>
              <FacetPopover state="partial" />
            </div>
            <div>
              <Lbl spec>Two chosen, Full match</Lbl>
              <FacetPopover state="full" />
            </div>
            <div>
              <Lbl spec>Mixed key (list or single value)</Lbl>
              <FacetPopover state="mixed" />
            </div>
            <div>
              <Lbl>Twenty chosen (the limit)</Lbl>
              <FacetPopover state="limit" />
            </div>
            <div>
              <Lbl>Truncated list key</Lbl>
              <FacetPopover state="truncated" />
            </div>
            <div>
              <Lbl>Scalar key (unchanged)</Lbl>
              <FacetPopover state="scalar" />
            </div>
          </div>
        </div>
      </Case>

      <Case wide label="qa-filter-chips (QA1: applied chips; three, and five with wrapping)">
        <div className={styles.frame}>
          <Lbl spec>Three filters</Lbl>
          <ChipsMock />
          <Lbl spec>Five filters</Lbl>
          <ChipsMock many />
        </div>
      </Case>

      <Case
        wide
        label="qa-tabs (QA5: the Access tab between Lineage and Settings; restricted shows the grant count)"
      >
        <div className={styles.frame}>
          <Lbl spec>Restricted, 12 people</Lbl>
          <Tabs
            label="Dataset sections"
            items={[
              { id: 'items', label: 'Items', count: 130 },
              { id: 'runs', label: 'Runs', count: 2 },
              { id: 'lineage', label: 'Lineage', count: 2 },
              { id: 'access', label: 'Access', count: 12 },
              { id: 'settings', label: 'Settings' },
            ]}
            selected="access"
            onSelect={noop}
          />
          <Lbl>Project-wide (no count)</Lbl>
          <Tabs
            label="Dataset sections"
            items={[
              { id: 'items', label: 'Items', count: 130 },
              { id: 'runs', label: 'Runs', count: 2 },
              { id: 'lineage', label: 'Lineage', count: 2 },
              { id: 'access', label: 'Access' },
              { id: 'settings', label: 'Settings' },
            ]}
            selected="access"
            onSelect={noop}
          />
        </div>
      </Case>

      <Case
        wide
        label="qa-settings (QA5: Settings after the move; manager, reader, dataset without the Visibility card)"
      >
        <div className={styles.frame}>
          <Lbl spec>Manager or modifier, Visibility available</Lbl>
          <SettingsMock variant="editable" />
          <Lbl>Reader (read only)</Lbl>
          <SettingsMock variant="readonly" />
          <Lbl>Without the Visibility card (not allowed to set it)</Lbl>
          <SettingsMock variant="plain" />
        </div>
      </Case>

      <Case
        wide
        label="qa-access (QA5: Access tab, manager: project-wide, restricted with no one, one person, twelve people)"
      >
        <div className={styles.frame}>
          <Lbl spec>Project-wide (default)</Lbl>
          <AccessTabMock state="project" />
          <Lbl>Restricted, no one listed</Lbl>
          <AccessTabMock state="empty" />
          <Lbl>Restricted, one person</Lbl>
          <AccessTabMock state="one" />
          <Lbl spec>Restricted, twelve people</Lbl>
          <AccessTabMock state="twelve" />
        </div>
      </Case>

      <Case wide label="qa-access-edit (QA5: Access tab, manager: unsaved changes, saving, save failed)">
        <div className={styles.frame}>
          <Lbl spec>Unsaved changes (one added, one level changed)</Lbl>
          <AccessTabMock state="dirty" />
          <Lbl>Saving</Lbl>
          <AccessTabMock state="saving" />
          <Lbl>Save failed (the toast carries the server detail)</Lbl>
          <AccessTabMock state="failed" />
        </div>
      </Case>

      <Case
        wide
        label="qa-access-readonly (QA5: Access tab for a person who cannot manage access: project-wide, restricted, archived project)"
      >
        <div className={styles.frame}>
          <Lbl spec>Project-wide, read only</Lbl>
          <AccessTabMock state="readonly-project" />
          <Lbl spec>Restricted, read only</Lbl>
          <AccessTabMock state="readonly-restricted" />
          <Lbl>Archived project</Lbl>
          <AccessTabMock state="archived" />
        </div>
      </Case>

      <Case wide label="qa-access-states (QA5: loading and error)">
        <div className={styles.frame}>
          <Lbl>Loading</Lbl>
          <AccessTabMock state="loading" />
          <Lbl>Error</Lbl>
          <AccessTabMock state="error" />
        </div>
      </Case>

      <Case wide label="qa-leave-dialog (QA5: leaving the Access tab with unsaved changes)">
        <div className={styles.frame}>
          <LeaveDialog />
        </div>
      </Case>

      <Case wide label="qa-link-cards (QG1: link cards never underline on hover; plain text links keep it)">
        <div className={styles.frame}>
          <LinkCards />
        </div>
      </Case>
    </Sec>
  );
}
