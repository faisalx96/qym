/**
 * WP-A mocks (design stage): dataset access, disabled items, batch edits by metadata. Static visual contracts for
 * docs/internal/feature-rounds/2026-10-dataset-access/spec-a.md. Primitives and tokens only; nothing reads the API.
 * Cases (every one carries data-case="da-..."): da-catalog, da-access, da-viewer, da-run-redaction, da-toolbar, da-meta-popover,
 * da-rows, da-item-state, da-disable-dialog, da-batch-dialog, da-version-meta, da-history-compare.
 */
import { useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import {
  Badge,
  Button,
  Card,
  Chip,
  DataTable,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Identicon,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Tag,
  Text,
  TextField,
  Textarea,
  HelpMarker,
  type Column,
} from '@/ui';
import { UserPill } from '@/features/datasets/components/UserPill';
import styles from './DatasetAccessMocks.module.css';

/* ───────────────────────────── fixtures ───────────────────────────── */

const DEV = { id: 'u1', email: 'dev@local', display_name: 'Dev User' };
const NOURA = { id: 'u2', email: 'noura@example.com', display_name: 'Noura Alharbi' };
const KHALID = { id: 'u3', email: 'khalid@example.com', display_name: 'Khalid Almutairi' };
const SARA = { id: 'u4', email: 'sara@example.com', display_name: 'Sara Alqahtani' };

interface Grant {
  user: typeof DEV;
  level: 'view' | 'modify';
  by: typeof DEV;
}
const GRANTS: Grant[] = [
  { user: NOURA, level: 'modify', by: DEV },
  { user: KHALID, level: 'view', by: DEV },
  { user: SARA, level: 'view', by: NOURA },
];

interface ItemRow {
  index: number;
  id: string;
  input: string;
  expected: string;
  domain: string;
  runs: number;
  disabled?: boolean;
}
const ROWS: ItemRow[] = [
  {
    index: 0,
    id: 'faq-001',
    input: 'What is the refund policy for order #1?',
    expected: 'Refunds within 30 days.',
    domain: 'finance',
    runs: 3,
  },
  {
    index: 1,
    id: 'faq-002',
    input: 'What is the refund policy for order #2?',
    expected: 'Refunds within 30 days for order #2.',
    domain: 'finance',
    runs: 3,
  },
  {
    index: 2,
    id: 'faq-003',
    input: 'What is the refund policy for order #3?',
    expected: 'Refunds within 30 days for order #3.',
    domain: 'finance',
    runs: 2,
    disabled: true,
  },
  {
    index: 3,
    id: 'faq-004',
    input: 'What is the refund policy for order #4?',
    expected: 'Refunds within 30 days for order #4.',
    domain: 'finance',
    runs: 3,
  },
  {
    index: 4,
    id: 'faq-005',
    input: 'ما هي سياسة الاسترجاع للطلب رقم 5؟',
    expected: 'يمكنك إرجاع المنتج خلال 30 يوماً',
    domain: 'health',
    runs: 3,
  },
  {
    index: 5,
    id: 'faq-006',
    input: 'What is the refund policy for order #6?',
    expected: 'Refunds within 30 days for order #6.',
    domain: 'retail',
    runs: 1,
    disabled: true,
  },
];

/* ───────────────────────────── shared bits ───────────────────────────── */

function Lbl({ children, spec }: { children: ReactNode; spec?: boolean }) {
  return (
    <p className={styles.label} data-kind={spec ? 'spec' : undefined}>
      {children}
    </p>
  );
}

function Note({
  tone,
  icon,
  title,
  children,
  ...rest
}: {
  tone: 'warning' | 'info' | 'danger';
  icon?: 'info' | 'warning' | 'lock';
  title?: ReactNode;
  children?: ReactNode;
} & Record<string, unknown>) {
  return (
    <div className={styles.callout} data-tone={tone} role="note" {...rest}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warning')} size={14} />
      <div className={styles.calloutBody}>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

function ModalFrame({
  title,
  size,
  label,
  children,
  foot,
}: {
  title: string;
  size?: 'lg';
  label: string;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <div className={styles.modal} role="dialog" aria-label={label} data-size={size} data-testid="da-modal">
      <div className={styles.modalHead}>
        <h3 className={styles.modalTitle}>{title}</h3>
      </div>
      <div className={styles.modalBody}>{children}</div>
      <div className={styles.modalFoot}>{foot}</div>
    </div>
  );
}

const noop = () => undefined;

/* ───────────────────────────── A1: catalog ───────────────────────────── */

function RestrictedBadge() {
  return (
    <Badge tone="neutral" glyph={<Icon name="lock" size={12} />} data-testid="restricted-badge">
      Restricted
    </Badge>
  );
}

function CatalogCard({
  name,
  state,
  desc,
  items,
  runs,
  restricted,
  priv,
  viewOnly,
}: {
  name: string;
  state: string;
  desc: string;
  items: number;
  runs: number;
  restricted?: boolean;
  priv?: boolean;
  viewOnly?: boolean;
}) {
  return (
    <li>
      <Card data-dataset-card={name}>
        <div className={styles.cardWrap}>
          <div className={styles.cardHead} data-testid="da-card-head">
            <span className={styles.cardIcon}>
              <Identicon seed={name} chip />
            </span>
            <div className={styles.cardTitle}>
              <span className={styles.cardName} data-testid="da-card-name">
                {name}
              </span>
              <span className={styles.cardState}>{state}</span>
            </div>
            {restricted || priv ? (
              <div className={styles.badges} data-testid="da-card-badges">
                {priv ? <Badge tone="warning">Private test set</Badge> : null}
                {restricted ? <RestrictedBadge /> : null}
                {restricted && viewOnly ? <Badge tone="neutral">View only</Badge> : null}
              </div>
            ) : null}
          </div>
        </div>
        <p className={styles.cardDesc}>{desc}</p>
        <div className={styles.cardStats}>
          <span>
            <strong>{items}</strong> items
          </span>
          <span>
            <strong>1</strong> version
          </span>
          <span>
            <strong>{runs}</strong> {runs === 1 ? 'run' : 'runs'}
          </span>
        </div>
      </Card>
    </li>
  );
}

function CatalogMock() {
  return (
    <ul className={styles.catalogGrid} aria-label="Datasets" data-testid="da-catalog">
      <CatalogCard
        name="support-faq"
        state="v1 prod · v2 draft"
        desc="Customer support questions in Arabic and English."
        items={130}
        runs={1}
      />
      <CatalogCard
        name="legal-clauses"
        state="v1 prod · current"
        desc="Clause extraction cases reviewed by counsel."
        items={40}
        runs={1}
        restricted
        viewOnly
      />
      <CatalogCard
        name="pricing-golden"
        state="v1 prod · current"
        desc="Held-out pricing questions."
        items={24}
        runs={0}
        restricted
        priv
      />
    </ul>
  );
}

/* ───────────────────────────── A1: access section ───────────────────────────── */

type AccessState =
  | 'project'
  | 'restricted'
  | 'empty'
  | 'dirty'
  | 'saving'
  | 'readonly-project'
  | 'readonly-restricted'
  | 'loading'
  | 'error';

function GrantsTable({ grants, readOnly }: { grants: Grant[]; readOnly?: boolean }) {
  const [levels, setLevels] = useState<Record<string, 'view' | 'modify'>>(() =>
    Object.fromEntries(grants.map((g) => [g.user.id, g.level])),
  );
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
        readOnly ? (
          <Tag tone={levels[g.user.id] === 'modify' ? 'accent' : undefined}>
            {levels[g.user.id] === 'modify' ? 'Modify' : 'View'}
          </Tag>
        ) : (
          <SegmentedControl
            label={`Level for ${g.user.display_name}`}
            options={[
              { value: 'view', label: 'View' },
              { value: 'modify', label: 'Modify' },
            ]}
            value={levels[g.user.id] ?? 'view'}
            onChange={(v) => setLevels({ ...levels, [g.user.id]: v })}
          />
        ),
    },
    { id: 'by', header: 'Added by', width: 150, priority: 2, cell: (g) => <UserPill user={g.by} /> },
    ...(readOnly
      ? []
      : [
          {
            id: 'remove',
            header: 'Remove',
            hideLabel: true,
            width: 48,
            priority: 2,
            cell: (g: Grant) => (
              <IconButton label={`Remove ${g.user.display_name}`} icon="close" onPress={noop} />
            ),
          } satisfies Column<Grant>,
        ]),
  ];
  return (
    <DataTable<Grant>
      aria-label="People with access"
      variant="embedded"
      density="regular"
      densityLocked
      zebra={false}
      rows={grants}
      rowKey={(g) => g.user.id}
      columns={columns}
      data-testid="access-grants-table"
    />
  );
}

function AccessMock({ state }: { state: AccessState }) {
  const [mode, setMode] = useState<'project' | 'restricted'>(
    state === 'project' || state === 'readonly-project' ? 'project' : 'restricted',
  );
  const readOnly = state.startsWith('readonly');
  const restricted = readOnly ? state === 'readonly-restricted' : mode === 'restricted';
  const grants = state === 'empty' ? [] : GRANTS;
  const dirty = state === 'dirty' || state === 'saving';
  const [who, setWho] = useState<Key | null>(null);
  return (
    <Card
      as="section"
      aria-labelledby={`ds-access-${state}`}
      data-testid="access-section"
      data-access-state={state}
    >
      <div className={styles.stack}>
        <SectionHeader id={`ds-access-${state}`} title="Access" />
        <Text variant="base" tone="muted" as="p">
          {readOnly
            ? 'Only project managers and admins can change who has access.'
            : 'Choose who in this project can open and change this dataset.'}
        </Text>
        {state === 'loading' ? (
          <Skeleton kind="lines" rows={5} label="Loading access" />
        ) : state === 'error' ? (
          <ErrorState compact error={{ status: 500 }} title="Couldn’t load access" onRetry={noop} />
        ) : readOnly ? (
          <>
            <dl className={styles.summary} data-testid="access-summary">
              <dt>Who has access</dt>
              <dd>{restricted ? 'Only people listed below' : 'Everyone in the project'}</dd>
              <dt>Your access</dt>
              <dd>{restricted ? 'View' : 'Modify'}</dd>
            </dl>
            {restricted ? <GrantsTable grants={GRANTS} readOnly /> : null}
          </>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Who can access this dataset"
              className={styles.options}
              data-testid="access-mode"
            >
              {(
                [
                  [
                    'project',
                    'Everyone in the project',
                    'Every member can view and modify this dataset. This is the default.',
                  ],
                  [
                    'restricted',
                    'Only people listed below',
                    'Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.',
                  ],
                ] as const
              ).map(([value, title, help]) => (
                <div
                  key={value}
                  role="radio"
                  aria-checked={mode === value}
                  tabIndex={mode === value ? 0 : -1}
                  className={styles.option}
                  data-selected={mode === value ? '' : undefined}
                  onClick={() => setMode(value)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setMode(value);
                    }
                  }}
                  data-testid={`access-mode-${value}`}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>{title}</span>
                    <span className={styles.optionHelp}>
                      {help}
                      {value === 'restricted' && mode === 'project' && grants.length
                        ? ` ${grants.length} saved grants are kept and apply again if you switch back.`
                        : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <Text variant="sm" tone="muted" as="p">
              Project managers, admins and the creator always have full access.
            </Text>
            {restricted ? (
              <div className={styles.people} data-testid="access-people">
                <div className={styles.peopleHead}>
                  <Text variant="md" weight={600} as="h3">
                    People with access
                  </Text>
                  <Text variant="sm" tone="muted" as="span">
                    {grants.length === 1 ? '1 person' : `${grants.length} people`}
                  </Text>
                </div>
                {grants.length ? (
                  <GrantsTable grants={grants} />
                ) : (
                  <Note tone="warning" title="No one is listed" data-testid="access-empty-note">
                    <span>Only project managers, admins and the creator can open this dataset.</span>
                  </Note>
                )}
                <div className={styles.addPerson} data-testid="access-add">
                  <Select
                    label="Add person"
                    items={[
                      { key: 'u5', label: 'Omar Alharbi', description: 'omar@example.com' },
                      { key: 'u6', label: 'Layla Alotaibi', description: 'layla@example.com' },
                    ]}
                    value={who}
                    onChange={setWho}
                    placeholder="Choose a project member"
                    width={240}
                  />
                  <SegmentedControl
                    label="Level for the new person"
                    options={[
                      { value: 'view', label: 'View' },
                      { value: 'modify', label: 'Modify' },
                    ]}
                    value="view"
                    onChange={noop}
                  />
                  <Button variant="neutral" isDisabled={who === null}>
                    Add person
                  </Button>
                </div>
              </div>
            ) : null}
            <div className={styles.saveBar} data-testid="access-save-bar">
              <Button variant="primary" isDisabled={!dirty} loading={state === 'saving'}>
                Save access
              </Button>
              <Button variant="neutral" isDisabled={!dirty || state === 'saving'}>
                Discard
              </Button>
              <span data-part="status" aria-live="polite">
                {state === 'saving' ? 'Saving' : dirty ? 'Unsaved changes' : 'No changes'}
              </span>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────────── A1: viewer header, 403, run redaction ───────────────────────────── */

function ViewerHeader() {
  return (
    <div className={styles.hero} data-testid="da-viewer-hero">
      <div>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>legal-clauses</h1>
          <Badge tone="neutral" glyph={<Icon name="eye" size={12} />} data-testid="view-only-badge">
            View only
          </Badge>
          <HelpMarker label="About view only access">
            You can open this dataset but not change it. Ask a project manager for modify access.
          </HelpMarker>
        </div>
        <p className={styles.heroMeta}>1 version · 1 run · 40 items · source: derived · updated 2m ago</p>
      </div>
      <div className={styles.heroActions} data-testid="da-viewer-actions">
        <Button variant="neutral" icon={<Icon name="chevron-down" size={12} />}>
          v1 · Production
        </Button>
        <IconButton label="More actions" icon="more" onPress={noop} />
      </div>
    </div>
  );
}

function ForbiddenMock() {
  return (
    <div data-testid="da-403">
      <ErrorState
        error={{ status: 403 }}
        title="You don’t have access to this dataset"
        message="Ask a project manager to add you. Its runs stay listed with item contents hidden."
        action={
          <Button variant="neutral" onPress={noop}>
            Back to datasets
          </Button>
        }
      />
    </div>
  );
}

function RunRedactionMock() {
  return (
    <div className={styles.stack} data-testid="da-run-redaction">
      <div
        className={styles.callout}
        data-tone="warning"
        role="status"
        data-testid="restricted-dataset-banner"
      >
        <Icon name="lock" size={14} />
        <div className={styles.calloutBody}>
          <strong>Restricted dataset</strong>
          <span>
            This run was evaluated on a dataset you don’t have access to. Scores and latencies are shown, but
            item inputs, expected outputs, outputs, traces, and analysis are hidden.
          </span>
        </div>
      </div>
      <div className={styles.runItem} data-testid="run-item-redacted">
        <div className={styles.runItemBar}>
          <Text as="span" variant="md" weight={650} mono>
            #12
          </Text>
          <Badge tone="danger">Fail</Badge>
          <Text as="span" variant="base" tone="muted">
            exact_match 0.00
          </Text>
        </div>
        <p className={styles.redacted}>Hidden: you don’t have access to this dataset’s items.</p>
      </div>
    </div>
  );
}

/* ───────────────────────────── A2/A3: items toolbar + rows ───────────────────────────── */

const MENU_ITEMS = (
  counts: { active: number; disabled: number; all: number },
  published: boolean,
): ReactNode =>
  published ? (
    <div className={styles.menuPanel} data-testid="batch-menu-published">
      <div className={styles.menuItem}>Create a draft to edit items</div>
    </div>
  ) : (
    <div className={styles.menuPanel} data-testid="batch-menu">
      <div className={styles.menuItem} data-disabled={counts.active ? undefined : ''}>
        Disable all {counts.active} matching…
      </div>
      <div className={styles.menuItem} data-disabled={counts.disabled ? undefined : ''}>
        Enable all {counts.disabled} matching…
      </div>
      <div className={styles.menuSep} />
      <div className={styles.menuItem} data-danger="">
        Delete all {counts.all} matching…
      </div>
    </div>
  );

function StateControl({
  value,
  counts,
}: {
  value: 'active' | 'disabled' | 'all';
  counts: { active: number; disabled: number; all: number };
}) {
  const [v, setV] = useState(value);
  const opt = (k: 'active' | 'disabled' | 'all', label: string) => ({
    value: k,
    label: (
      <>
        {label}
        <span className={styles.countLabel}>{counts[k]}</span>
      </>
    ),
  });
  return (
    <span data-testid="items-state">
      <SegmentedControl
        label="Item state"
        options={[opt('active', 'Active'), opt('disabled', 'Disabled'), opt('all', 'All')]}
        value={v}
        onChange={setV}
      />
    </span>
  );
}

type ToolbarVariant =
  'default' | 'filtered' | 'selected' | 'published' | 'viewer' | 'loading' | 'empty' | 'zero-disabled';

function ToolbarMock({ variant }: { variant: ToolbarVariant }) {
  const draft = variant !== 'published' && variant !== 'viewer';
  const filtered = variant === 'filtered' || variant === 'selected' || variant === 'published';
  const counts = filtered ? { active: 40, disabled: 2, all: 42 } : { active: 124, disabled: 6, all: 130 };
  const [selected, setSelected] = useState<Set<Key>>(
    new Set(variant === 'selected' ? ['faq-001', 'faq-002'] : []),
  );
  const [q, setQ] = useState('');
  const columns: Column<ItemRow>[] = [
    {
      id: 'index',
      header: '#',
      type: 'number',
      width: 64,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (r) => r.index,
    },
    {
      id: 'id',
      header: 'ID',
      type: 'id',
      width: 180,
      priority: 2,
      cell: (r) => (
        <span className={styles.idCell}>
          <span dir="ltr">{r.id}</span>
          {r.disabled ? <Badge tone="neutral">Disabled</Badge> : null}
        </span>
      ),
    },
    {
      id: 'input',
      header: 'Input',
      flex: true,
      minWidth: 220,
      wrap: 2,
      priority: 1,
      cell: (r) => <span dir="auto">{r.input}</span>,
    },
    {
      id: 'expected',
      header: 'Expected',
      flex: true,
      minWidth: 180,
      wrap: 2,
      priority: 2,
      cell: (r) => <span dir="auto">{r.expected}</span>,
    },
    { id: 'meta', header: 'Metadata', width: 180, priority: 3, cell: (r) => `domain: ${r.domain}` },
    { id: 'runs', header: 'Runs', type: 'number', width: 70, priority: 3, cell: (r) => r.runs },
  ];
  const rows = variant === 'loading' || variant === 'empty' ? [] : ROWS;
  return (
    <DataTable<ItemRow>
      aria-label="Items in v2"
      storageKey={`da-mock-${variant}`}
      density="compact"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      className={styles.table}
      rowProps={(r) => ({ 'data-state': r.disabled ? 'disabled' : undefined })}
      selection={draft ? { selected, onChange: setSelected } : undefined}
      loading={variant === 'loading'}
      empty={
        variant === 'empty' ? (
          <EmptyState
            compact
            title="No items match these filters"
            action={<Button variant="neutral">Clear filters</Button>}
          />
        ) : undefined
      }
      bulkActions={
        <>
          <Button variant="neutral" size="sm" data-testid="bulk-disable-selected">
            Disable {selected.size}…
          </Button>
          <Button variant="neutral" size="sm" data-testid="bulk-enable-selected">
            Enable {selected.size}
          </Button>
          <Button variant="danger" size="sm" data-testid="bulk-delete-items">
            Delete {selected.size}
          </Button>
        </>
      }
    >
      <DataTable.Toolbar
        search={
          <SearchField
            label="Search items"
            hideLabel
            placeholder="Search items…"
            value={q}
            onChange={setQ}
            width={260}
            data-testid="items-search"
          />
        }
        filters={
          <>
            <Button
              variant="neutral"
              size="sm"
              icon={<Icon name="plus" size={12} />}
              data-testid="metadata-filter"
            >
              Metadata
            </Button>
            <StateControl value="active" counts={counts} />
          </>
        }
        chips={
          filtered ? (
            <div className={styles.chipRow} data-testid="filter-chips">
              <Chip isSelected onRemove={noop} removeLabel="Clear label filter">
                label: edge
              </Chip>
              <Chip
                isSelected
                onRemove={noop}
                removeLabel="Remove filter domain: finance"
                data-testid="meta-chip"
              >
                domain: finance
              </Chip>
              <Chip isSelected onRemove={noop} removeLabel="Remove filter source.region.code: sa">
                source.region.code: sa
              </Chip>
            </div>
          ) : null
        }
        count={
          variant === 'loading' ? null : <span aria-live="polite">{filtered ? '40 items' : '124 items'}</span>
        }
        trailing={
          variant === 'viewer' ? null : (
            <>
              {filtered ? (
                variant === 'published' ? (
                  <Button variant="neutral" size="sm" data-testid="batch-published-entry">
                    Create a draft to edit items
                  </Button>
                ) : (
                  <DropdownMenu
                    label="Actions on all matching items"
                    trigger={
                      <Button
                        variant="neutral"
                        size="sm"
                        iconEnd={<Icon name="chevron-down" size={12} />}
                        data-testid="all-matching"
                      >
                        All matching
                      </Button>
                    }
                    items={[
                      { id: 'disable', label: `Disable all ${counts.active} matching…` },
                      { id: 'enable', label: `Enable all ${counts.disabled} matching…` },
                      { id: 'delete', label: `Delete all ${counts.all} matching…`, separatorBefore: true },
                    ]}
                    onAction={noop}
                  />
                )
              ) : null}
              {draft ? (
                <Button variant="neutral" size="sm" icon={<Icon name="plus" size={12} />}>
                  Add item
                </Button>
              ) : null}
            </>
          )
        }
      />
    </DataTable>
  );
}

/* metadata facets popover */
type FacetState = 'loaded' | 'loading' | 'empty' | 'error' | 'truncated';

function MetaPopover({ state }: { state: FacetState }) {
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
      {state === 'loading' ? (
        <Skeleton kind="lines" rows={4} label="Loading metadata keys" />
      ) : state === 'error' ? (
        <ErrorState compact error={{ status: 500 }} title="Couldn’t load metadata keys" onRetry={noop} />
      ) : state === 'empty' ? (
        <EmptyState
          compact
          title="No metadata keys"
          body="Items in this version have no metadata fields to filter on."
        />
      ) : (
        <>
          <Select
            label="Key"
            items={[
              { key: 'domain', label: 'domain', description: '4 values' },
              { key: 'difficulty', label: 'difficulty', description: '3 values' },
              { key: 'source.channel', label: 'source.channel', description: '2 values' },
              { key: 'source.region.code', label: 'source.region.code', description: '4 values' },
            ]}
            value="domain"
            onChange={noop}
            width="100%"
          />
          <div>
            <Text variant="sm" weight={650} tone="muted" as="p">
              Value
            </Text>
            <ul className={styles.facetList} aria-label="Values of domain" data-testid="facet-values">
              {[
                ['finance', 42],
                ['health', 33],
                ['retail', 30],
                ['legal', 25],
              ].map(([v, n]) => (
                <li key={v} className={styles.facet} data-selected={v === 'finance' ? '' : undefined}>
                  <span>{v}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
          {state === 'truncated' ? (
            <Text variant="sm" tone="muted" as="p" data-testid="facet-truncated">
              Showing the 200 most common values of 340. Type to search.
            </Text>
          ) : null}
          <div className={styles.popoverFoot}>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button variant="primary" size="sm">
              Add filter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── A2: pane, item page, dialogs ───────────────────────────── */

type PaneState = 'active-draft' | 'active-published' | 'disabled-draft' | 'disabled-published' | 'viewer';

function DisabledBanner({ published }: { published: boolean }) {
  return (
    <Note
      tone="warning"
      icon="warning"
      data-testid="disabled-banner"
      title="Disabled by Noura Alharbi on Oct 20, 2026"
    >
      <span>Reason: duplicate of faq-014</span>
      {published ? <span>Runs on this version skip it. Create a draft to change that.</span> : null}
    </Note>
  );
}

function PaneMock({ state }: { state: PaneState }) {
  const disabled = state.startsWith('disabled');
  const published = state.endsWith('published');
  const viewer = state === 'viewer';
  return (
    <aside className={styles.pane} aria-label="Item faq-003" data-testid="da-pane" data-pane-state={state}>
      <header className={styles.paneHead}>
        <div className={styles.row}>
          <span className={styles.paneId}>faq-003</span>
          <Text as="span" variant="sm" tone="muted">
            3 / 50
          </Text>
          {disabled ? <Badge tone="neutral">Disabled</Badge> : null}
        </div>
        <div className={styles.row}>
          <IconButton label="Previous item" icon="chevron-up" onPress={noop} />
          <IconButton label="Next item" icon="chevron-down" onPress={noop} />
          <IconButton label="Close editor" icon="close" onPress={noop} />
        </div>
      </header>
      <div className={styles.paneBody}>
        {disabled ? (
          <div>
            <DisabledBanner published={published} />
            {!published && !viewer ? (
              <div className={styles.rowAfter}>
                <Button variant="neutral" size="sm" data-testid="enable-item">
                  Enable
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={styles.fieldBox} data-muted={disabled ? '' : undefined}>
          <Text as="span" variant="sm" weight={650} tone="muted">
            INPUT
          </Text>
          What is the refund policy for order #3?
        </div>
        <div className={styles.fieldBox} data-muted={disabled ? '' : undefined}>
          <Text as="span" variant="sm" weight={650} tone="muted">
            EXPECTED OUTPUT
          </Text>
          Refunds within 30 days for order #3.
        </div>
      </div>
      {viewer ? null : (
        <footer className={styles.paneFoot} data-testid="pane-foot">
          {published ? (
            <Button variant="neutral" size="sm" data-testid="item-state-action">
              {disabled ? 'Create a draft to enable' : 'Create a draft to disable'}
            </Button>
          ) : disabled ? null : (
            <Button variant="neutral" size="sm" data-testid="item-state-action">
              Disable item…
            </Button>
          )}
          {!published ? (
            <>
              <span data-part="status">No changes</span>
              <Button variant="primary" isDisabled>
                Save changes
              </Button>
            </>
          ) : null}
        </footer>
      )}
    </aside>
  );
}

function ItemPageHeader({
  state,
}: {
  state: 'draft' | 'published' | 'disabled-draft' | 'disabled-published';
}) {
  const published = state.endsWith('published');
  const disabled = state.startsWith('disabled');
  return (
    <div className={styles.stack} data-testid="da-item-page" data-item-page-state={state}>
      <div className={styles.hero}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>faq-003</h1>
            {disabled ? <Badge tone="neutral">Disabled</Badge> : null}
          </div>
          <p className={styles.heroMeta}>
            index 2 · updated 2m ago · v{published ? '1 published' : '2 draft'} · 3 of 130 in this view
          </p>
        </div>
        <div className={styles.heroActions} data-testid="item-actions">
          {published ? (
            <>
              <Button variant="accent" size="md">
                Create draft to edit
              </Button>
              <Button variant="neutral" size="md" data-testid="item-state-action">
                {disabled ? 'Create a draft to enable' : 'Create a draft to disable'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="neutral" size="md" data-testid="item-state-action" isDisabled={disabled}>
                Disable item…
              </Button>
              <Button variant="danger" size="md">
                Delete
              </Button>
            </>
          )}
          <Button variant="neutral" size="md">
            Previous
          </Button>
          <Button variant="neutral" size="md">
            Next
          </Button>
        </div>
      </div>
      {disabled ? (
        <div>
          <DisabledBanner published={published} />
          {!published ? (
            <div className={styles.rowAfter}>
              <Button variant="neutral" size="md" data-testid="enable-item">
                Enable
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DisableDialog({ error, busy, count }: { error?: boolean; busy?: boolean; count?: number }) {
  const [reason, setReason] = useState(count ? '' : 'duplicate of faq-014');
  return (
    <ModalFrame
      label="Disable item"
      title={count ? `Disable ${count} items?` : 'Disable item faq-003?'}
      foot={
        <>
          <Button variant="neutral" size="md" isDisabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="md" loading={busy}>
            {count ? `Disable ${count}` : 'Disable item'}
          </Button>
        </>
      }
    >
      <p>
        {count
          ? 'They stay in this draft and are left out of runs once it is published. You can enable them again in any draft.'
          : 'The item stays in this draft but is left out of runs once the draft is published. You can enable it again in any draft.'}
      </p>
      <div>
        <Textarea label="Reason (optional)" value={reason} onChange={setReason} rows={3} />
        <span className={styles.counter} data-testid="reason-counter">
          {reason.length} / 500
        </span>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          Create a draft to change item state
        </p>
      ) : null}
    </ModalFrame>
  );
}

type BatchState = 'loading' | 'disable' | 'enable' | 'delete-small' | 'delete-large' | 'changed' | 'error';

function BatchDialog({ state }: { state: BatchState }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const kind = state === 'enable' ? 'enable' : state.startsWith('delete') ? 'delete' : 'disable';
  const large = state === 'delete-large';
  const affected = state === 'enable' ? 2 : state === 'delete-small' ? 42 : large ? 120 : 40;
  const total = 130;
  const where = 'domain: finance, source.region.code: sa';
  const title =
    state === 'loading'
      ? 'Checking matching items…'
      : kind === 'disable'
        ? `Disable ${affected} items?`
        : kind === 'enable'
          ? `Enable ${affected} items?`
          : `Delete ${affected} items?`;
  const confirm =
    kind === 'disable'
      ? `Disable ${affected}`
      : kind === 'enable'
        ? `Enable ${affected}`
        : `Delete ${affected}`;
  const ids = ['faq-001', 'faq-002', 'faq-004', 'faq-007', 'faq-009'].slice(0, Math.min(5, affected));
  return (
    <ModalFrame
      size="lg"
      label={title}
      title={title}
      foot={
        <>
          <Button variant="neutral" size="md">
            Cancel
          </Button>
          <Button
            variant={kind === 'delete' ? 'danger' : 'primary'}
            size="md"
            isDisabled={
              state === 'loading' ||
              state === 'error' ||
              state === 'changed' ||
              (large && typed.trim() !== String(affected))
            }
            data-testid="batch-confirm"
          >
            {state === 'changed' ? 'Review again' : confirm}
          </Button>
        </>
      }
    >
      {state === 'loading' ? (
        <Skeleton kind="lines" rows={4} label="Checking matching items" />
      ) : state === 'error' ? (
        <>
          <p className={styles.error} role="alert">
            Couldn’t check the matching items. Try again.
          </p>
          <div>
            <Button variant="accent" size="md">
              Retry
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.bigNumber} data-testid="batch-numbers">
            <strong>{affected}</strong>
            <span>
              of {total} items match {where}
              {kind === 'disable' ? ' and are active' : kind === 'enable' ? ' and are disabled' : ''}.
            </span>
          </div>
          <div>
            <Text variant="sm" weight={650} tone="muted" as="p">
              First items
            </Text>
            <ul className={styles.idList} data-testid="batch-ids">
              {ids.map((id) => (
                <li key={id}>
                  <Tag kind="data">{id}</Tag>
                </li>
              ))}
              {affected > ids.length ? (
                <li>
                  <Text as="span" variant="sm" tone="muted">
                    and {affected - ids.length} more
                  </Text>
                </li>
              ) : null}
            </ul>
          </div>
          {kind === 'disable' ? (
            <div>
              <Textarea label="Reason (optional)" value={reason} onChange={setReason} rows={2} />
              <span className={styles.counter}>{reason.length} / 500</span>
            </div>
          ) : null}
          {kind === 'disable' ? (
            <p>The items stay in this draft and are left out of runs once it is published.</p>
          ) : null}
          {kind === 'enable' ? (
            <p>The items are included in runs again once this draft is published.</p>
          ) : null}
          {kind === 'delete' ? (
            <Note tone="danger" icon="warning" title="This removes the items from this draft">
              <span>Published versions keep their copy.</span>
            </Note>
          ) : null}
          {large ? (
            <TextField
              label={`Type ${affected} to confirm`}
              value={typed}
              onChange={setTyped}
              placeholder={String(affected)}
              mono
              data-testid="batch-typed"
            />
          ) : null}
          {state === 'changed' ? (
            <p className={styles.error} role="alert" data-testid="batch-changed">
              The matching items changed. Review the new count and try again.
            </p>
          ) : null}
        </>
      )}
    </ModalFrame>
  );
}

/* ───────────────────────────── A2: version meta, history, compare ───────────────────────────── */

function VersionMeta() {
  return (
    <div className={styles.stack} data-testid="da-version-meta">
      <p className={styles.metaLine} data-testid="meta-line">
        <span>2 versions</span>
        <span>·</span>
        <span>1 run</span>
        <span>·</span>
        <span data-testid="meta-items">
          130 items <span data-part="disabled">(6 disabled)</span>
        </span>
        <span>·</span>
        <span>forked from v1</span>
      </p>
      <div className={styles.versionRow} data-testid="version-row">
        <div className={styles.versionRowMain}>
          <strong>v2</strong>
          <Badge tone="warning">Draft</Badge>
        </div>
        <span className={styles.versionRowMeta}>130 items (6 disabled) · 0 runs · 2 min ago</span>
      </div>
      <div className={styles.menuPanel} data-testid="download-menu">
        <div className={styles.menuItem}>↓ Download JSONL</div>
        <div className={styles.menuItem}>↓ Download JSONL with disabled items</div>
      </div>
      <ModalFrame
        label="Publish v2"
        title="Publish v2?"
        foot={
          <>
            <Button variant="neutral" size="md">
              Cancel
            </Button>
            <Button variant="primary" size="md">
              Publish
            </Button>
          </>
        }
      >
        <p>Publishing makes v2 read-only. Later edits need a new draft.</p>
        <Note tone="info" icon="info" data-testid="publish-disabled-note">
          <span>6 items are disabled. Runs on v2 skip them.</span>
        </Note>
      </ModalFrame>
    </div>
  );
}

function HistoryCompare() {
  return (
    <div className={styles.stack} data-testid="da-history">
      <div className={styles.revision} data-revision="4" data-testid="rev-disabled">
        <div className={styles.revHead}>
          <Badge tone="warning">disabled</Badge>
          <Tag kind="count">#4</Tag>
          <UserPill user={NOURA} label="Edited By:" />
          <span>Oct 20, 2026, 4:12 PM</span>
        </div>
        <p className={styles.revText}>Reason: duplicate of faq-014</p>
      </div>
      <div className={styles.revision} data-revision="5" data-testid="rev-enabled">
        <div className={styles.revHead}>
          <Badge tone="success">enabled</Badge>
          <Tag kind="count">#5</Tag>
          <UserPill user={DEV} label="Edited By:" />
          <span>Oct 20, 2026, 4:30 PM</span>
        </div>
        <p className={styles.revText}>No reason given</p>
      </div>
      <div className={styles.summaryStrip} data-testid="compare-summary">
        {[
          ['Added', 4],
          ['Removed', 1],
          ['Changed', 2],
          ['Disabled', 6],
          ['Enabled', 1],
          ['Unchanged', 117],
        ].map(([k, v]) => (
          <div key={k} className={styles.summaryTile}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className={styles.compareRow} data-testid="compare-state-row">
        <Tag tone="warning">changed</Tag>
        <Text as="span" variant="base" mono>
          faq-003
        </Text>
        <span className={styles.stateDiff} data-testid="state-diff">
          <Text as="span" variant="sm" weight={650} tone="muted">
            state
          </Text>
          <Badge tone="success">Active</Badge>
          <Icon name="next" size={12} />
          <Badge tone="neutral">Disabled</Badge>
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────── the section ───────────────────────────── */

export function DatasetAccessMocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="dataset-access" title="Dataset access, disabled items and batch edits (WP-A design contract)">
      <Case
        wide
        label="da-catalog (A1: Restricted badge next to Private test set; the name wraps and the cluster drops under it on narrow cards)"
      >
        <div className={styles.frame}>
          <CatalogMock />
        </div>
      </Case>

      <Case
        wide
        label="da-access (A1: Settings, Access section, manager: project mode, restricted with people, no one listed, unsaved, saving)"
      >
        <div className={styles.frame}>
          <div className={styles.settings}>
            <Lbl>Project mode (default)</Lbl>
            <AccessMock state="project" />
            <Lbl spec>Restricted with three people</Lbl>
            <AccessMock state="restricted" />
            <Lbl>Restricted, no one listed</Lbl>
            <AccessMock state="empty" />
            <Lbl>Unsaved changes</Lbl>
            <AccessMock state="dirty" />
            <Lbl>Saving</Lbl>
            <AccessMock state="saving" />
          </div>
        </div>
      </Case>

      <Case
        wide
        label="da-access-readonly (A1: Settings, Access section for a person who cannot manage access; loading; error)"
      >
        <div className={styles.frame}>
          <div className={styles.settings}>
            <Lbl>Read-only, project mode</Lbl>
            <AccessMock state="readonly-project" />
            <Lbl>Read-only, restricted</Lbl>
            <AccessMock state="readonly-restricted" />
            <Lbl>Loading</Lbl>
            <AccessMock state="loading" />
            <Lbl>Error</Lbl>
            <AccessMock state="error" />
          </div>
        </div>
      </Case>

      <Case
        wide
        label="da-viewer (A1: dataset page for a person with view access; 403 for a person with none)"
      >
        <div className={styles.frame}>
          <Lbl>View only: no rename, add, import, publish, create draft or upload</Lbl>
          <ViewerHeader />
          <Lbl>No access (403)</Lbl>
          <ForbiddenMock />
        </div>
      </Case>

      <Case wide label="da-run-redaction (A1: a run on a dataset the reader cannot open)">
        <div className={styles.frame}>
          <RunRedactionMock />
        </div>
      </Case>

      <Case
        wide
        label="da-toolbar (A2/A3: items toolbar: default, filtered with All matching, selection, published, view only, loading, empty)"
      >
        <div className={styles.frame}>
          <Lbl>Draft, no filter: Active 124 · Disabled 6 · All 130</Lbl>
          <ToolbarMock variant="default" />
          <Lbl spec>Draft, three filters: counts follow the filter; All matching menu</Lbl>
          <ToolbarMock variant="filtered" />
          <Lbl>Draft, two rows selected</Lbl>
          <ToolbarMock variant="selected" />
          <Lbl>Published version, filtered: one entry</Lbl>
          <ToolbarMock variant="published" />
          <Lbl>View only: no Add item, no menus, no checkboxes</Lbl>
          <ToolbarMock variant="viewer" />
          <Lbl>Loading</Lbl>
          <ToolbarMock variant="loading" />
          <Lbl>Empty result</Lbl>
          <ToolbarMock variant="empty" />
        </div>
      </Case>

      <Case
        wide
        label="da-menus (A3: the All matching menu, enabled and with a zero count; published replacement)"
      >
        <div className={styles.frame}>
          <div className={styles.row}>
            {MENU_ITEMS({ active: 40, disabled: 2, all: 42 }, false)}
            {MENU_ITEMS({ active: 40, disabled: 0, all: 40 }, false)}
            {MENU_ITEMS({ active: 40, disabled: 2, all: 42 }, true)}
          </div>
        </div>
      </Case>

      <Case
        wide
        label="da-meta-popover (A3: Metadata filter popover: loaded, loading, empty, error, truncated)"
      >
        <div className={styles.frame}>
          <div className={styles.row}>
            <MetaPopover state="loaded" />
            <MetaPopover state="truncated" />
            <MetaPopover state="loading" />
            <MetaPopover state="empty" />
            <MetaPopover state="error" />
          </div>
        </div>
      </Case>

      <Case
        wide
        label="da-item-state (A2: item pane and item page: active and disabled, draft and published, view only)"
      >
        <div className={styles.frame}>
          <div className={styles.row} data-testid="da-panes">
            <PaneMock state="active-draft" />
            <PaneMock state="disabled-draft" />
            <PaneMock state="active-published" />
            <PaneMock state="disabled-published" />
            <PaneMock state="viewer" />
          </div>
          <Lbl>Item page, draft</Lbl>
          <ItemPageHeader state="draft" />
          <Lbl>Item page, published, disabled</Lbl>
          <ItemPageHeader state="disabled-published" />
          <Lbl>Item page, draft, disabled</Lbl>
          <ItemPageHeader state="disabled-draft" />
        </div>
      </Case>

      <Case wide label="da-disable-dialog (A2: Disable item dialog: default, saving, error)">
        <div className={styles.frame}>
          <div className={styles.row}>
            <DisableDialog />
            <DisableDialog busy />
            <DisableDialog error />
          </div>
        </div>
      </Case>

      <Case
        wide
        label="da-batch-dialog (A3: dry-run confirm: checking, disable, enable, delete up to 50, delete over 50, count changed, error)"
      >
        <div className={styles.frame}>
          <div className={styles.row}>
            <BatchDialog state="loading" />
            <BatchDialog state="disable" />
            <BatchDialog state="enable" />
            <BatchDialog state="delete-small" />
            <BatchDialog state="delete-large" />
            <BatchDialog state="changed" />
            <BatchDialog state="error" />
          </div>
          <Lbl>Selected rows: the same Disable dialog with a count</Lbl>
          <DisableDialog count={2} />
        </div>
      </Case>

      <Case
        wide
        label="da-version-meta (A2: version header count, version list row, download menu, publish dialog note)"
      >
        <div className={styles.frame}>
          <VersionMeta />
        </div>
      </Case>

      <Case
        wide
        label="da-history-compare (A2: item history entries, compare summary and a state change row)"
      >
        <div className={styles.frame}>
          <HistoryCompare />
        </div>
      </Case>
    </Sec>
  );
}
