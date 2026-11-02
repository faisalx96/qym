/**
 * QA round WP-A composed page mocks: the whole page as the user sees it (app shell, page header, the real tab bar), default state,
 * realistic data. Cases: qa-page-access, qa-page-settings, qa-page-filter-popover, qa-page-filter-chips, qa-page-catalog.
 * The shell is drawn at the real size (1440 wide: sidebar 192, content column 1193) and collapses to the 56 px rail at 390 (column 279).
 */
import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Chip,
  DataTable,
  Icon,
  IconButton,
  Identicon,
  PageHeader,
  Tabs,
  Tag,
  Text,
  type Column,
  type IconName,
  TabPanel,
} from '@/ui';
import { UserPill } from '@/features/datasets/components/UserPill';
import { AccessTabMock, FacetPopover, SettingsMock } from './QaDatasetsMocks';
import styles from './QaPageMocks.module.css';

const noop = () => undefined;

const NAV: [IconName, string, boolean?][] = [
  ['home', 'Dashboard'],
  ['chart', 'Charts'],
  ['list', 'Runs'],
  ['folder', 'Models'],
  ['flask', 'Experiments'],
  ['sparkles', 'Auto-analysis'],
  ['review', 'Reviews'],
  ['database', 'Datasets', true],
  ['settings', 'Project settings'],
];

function Shell({ crumb, children }: { crumb: string; children: ReactNode }) {
  return (
    <div className={styles.shell} data-testid="page-shell">
      <aside className={styles.sidebar} aria-label="Navigation">
        <div className={styles.brand}>qym</div>
        <nav className={styles.nav}>
          <span className={styles.navItem}>
            <Icon name="folder" size={14} />
            <span>Projects</span>
          </span>
          <span className={styles.navItem}>
            <Icon name="book" size={14} />
            <span>Docs</span>
          </span>
          <p className={styles.navGroup}>Access demo</p>
          {NAV.map(([icon, label, active]) => (
            <span key={label} className={styles.navItem} data-active={active ? '' : undefined}>
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </span>
          ))}
        </nav>
        <div className={styles.user}>
          <span className={styles.avatar}>DU</span>
          <span className={styles.userText}>
            <strong>Dev User</strong>
            <span>dev@local</span>
          </span>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topbar}>
          <Icon name="sidebar" size={14} />
          <span className={styles.crumbs}>
            Access demo <Icon name="chevron-right" size={12} /> Datasets{' '}
            <Icon name="chevron-right" size={12} /> {crumb}
          </span>
          <span className={styles.topStats}>
            <b>2</b> versions · <b>2</b> runs · <b>130</b> items
          </span>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

type Tab = 'items' | 'access' | 'settings';

function DatasetPage({
  tab,
  children,
  restricted = true,
}: {
  tab: Tab;
  children: ReactNode;
  restricted?: boolean;
}) {
  return (
    <>
      <PageHeader
        leading={<Identicon seed="legal-clauses" chip />}
        title={
          <span className={styles.titleRow}>
            <span>{restricted ? 'legal-clauses' : 'support-faq'}</span>
            <IconButton label="Rename dataset" icon="edit" onPress={noop} />
            {restricted ? (
              <Badge tone="neutral" glyph={<Icon name="lock" size={12} />}>
                Restricted
              </Badge>
            ) : null}
          </span>
        }
        description={
          restricted
            ? 'Clause extraction cases reviewed by counsel.'
            : 'Customer support questions in Arabic and English.'
        }
        meta={[
          '2 versions',
          '2 runs',
          restricted ? '40 items' : '130 items',
          'source: api',
          <UserPill
            key="p"
            user={{ id: 'u1', email: 'dev@local', display_name: 'Dev User' }}
            label="Published by:"
          />,
          'updated Oct 21, 2026',
        ]}
        actions={
          <span className={styles.actions}>
            <Button variant="neutral" size="sm">
              v1 · PRODUCTION
            </Button>
            <Button variant="primary" size="sm" icon={<Icon name="plus" size={12} />}>
              Create draft
            </Button>
          </span>
        }
      />
      <Tabs
        label="Dataset sections"
        items={[
          { id: 'items', label: 'Items', count: restricted ? 40 : 130 },
          { id: 'runs', label: 'Runs', count: 2 },
          { id: 'lineage', label: 'Lineage', count: 2 },
          { id: 'access', label: 'Access', count: restricted ? 12 : undefined },
          { id: 'settings', label: 'Settings' },
        ]}
        selected={tab}
        onSelect={noop}
      >
        {/* The selected tab's aria-controls must resolve (axe aria-valid-attr-value): the page body is its panel. */}
        <TabPanel id={tab} className={styles.panel}>
          {children}
        </TabPanel>
      </Tabs>
    </>
  );
}

interface ItemRow {
  index: number;
  id: string;
  input: string;
  expected: string;
  meta: string;
}
const ROWS: ItemRow[] = Array.from({ length: 12 }, (_, i) => ({
  index: i,
  id: `supp-${String(i * 3 + 1).padStart(3, '0')}`,
  input: `What is the refund policy for order #${i * 3 + 1}?`,
  expected: `Refunds within 30 days for order #${i * 3 + 1}.`,
  meta: `{"domain":"${i < 5 ? 'finance' : 'health'}","tags":["${['billing', 'refund', 'account'][i % 3]}"…`,
}));

function ItemsTable() {
  const columns: Column<ItemRow>[] = [
    {
      id: 'index',
      header: '#',
      width: 56,
      priority: 1,
      cell: (r) => <span className={styles.mono}>{r.index}</span>,
    },
    {
      id: 'id',
      header: 'Item',
      width: 120,
      priority: 1,
      cardTitle: true,
      cell: (r) => <span className={styles.mono}>{r.id}</span>,
    },
    { id: 'input', header: 'Input', flex: true, minWidth: 220, priority: 1, cell: (r) => r.input },
    {
      id: 'expected',
      header: 'Expected output',
      flex: true,
      minWidth: 220,
      priority: 2,
      cell: (r) => r.expected,
    },
    {
      id: 'meta',
      header: 'Metadata',
      width: 260,
      priority: 2,
      cell: (r) => <span className={styles.mono}>{r.meta}</span>,
    },
  ];
  return (
    <DataTable<ItemRow>
      aria-label="Items"
      density="regular"
      rows={ROWS}
      rowKey={(r) => r.id}
      columns={columns}
    />
  );
}

function ItemsToolbar({ chips, popover }: { chips?: boolean; popover?: boolean }) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarRow}>
        <span className={styles.search}>
          <Icon name="search" size={12} />
          Search items
        </span>
        <span className={styles.filterAnchor}>
          <Button variant="neutral" size="sm" icon={<Icon name="plus" size={12} />}>
            Metadata
          </Button>
          {popover ? (
            <div className={styles.popoverHost}>
              <FacetPopover state="partial" />
            </div>
          ) : null}
        </span>
        <span className={styles.count} aria-live="polite">
          {chips ? '46 items matching' : '130 items'}
        </span>
      </div>
      {chips ? (
        <div className={styles.chipRow} data-testid="filter-chips">
          <Chip isSelected onRemove={noop} removeLabel="Remove filter tags: billing, refund (any)">
            tags: billing, refund (any)
          </Chip>
          <Chip isSelected onRemove={noop} removeLabel="Remove filter domain: finance">
            domain: finance
          </Chip>
        </div>
      ) : null}
    </div>
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
}: {
  name: string;
  state: string;
  desc: string;
  items: number;
  runs: number;
  restricted?: boolean;
  priv?: boolean;
}) {
  return (
    <li>
      <Card to="/__ui#qa-datasets" className={styles.fillCard} data-dataset-card={name}>
        <div className={styles.cardInner}>
          <div className={styles.cardHead}>
            <Text variant="lg" weight={600} as="span">
              {name}
            </Text>
            <span className={styles.badges}>
              {priv ? <Badge tone="warning">Private test set</Badge> : null}
              {restricted ? (
                <Badge tone="neutral" glyph={<Icon name="lock" size={12} />}>
                  Restricted
                </Badge>
              ) : null}
            </span>
          </div>
          <Text variant="sm" tone="muted" as="span">
            {state}
          </Text>
          <Text variant="base" tone="secondary" as="span">
            {desc}
          </Text>
          <span className={styles.cardMeta}>
            <Tag>{items} items</Tag>
            <Tag>{runs} runs</Tag>
          </span>
        </div>
      </Card>
    </li>
  );
}

export function QaPageMocks({
  Case,
}: {
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <>
      <Case
        wide
        label="qa-page-access (QA5: the dataset page, Access tab, restricted with 12 people, default state)"
      >
        <Shell crumb="legal-clauses">
          <DatasetPage tab="access">
            <AccessTabMock state="twelve" />
          </DatasetPage>
        </Shell>
      </Case>
      <Case wide label="qa-page-settings (QA5: the dataset page, Settings tab after the spacing fix)">
        <Shell crumb="support-faq">
          <DatasetPage tab="settings" restricted={false}>
            <SettingsMock variant="editable" />
          </DatasetPage>
        </Shell>
      </Case>
      <Case
        wide
        label="qa-page-filter-popover (QA1: Items tab, Metadata popover open on the list key tags with billing and refund chosen)"
      >
        <Shell crumb="support-faq">
          <DatasetPage tab="items" restricted={false}>
            <ItemsToolbar popover />
            <ItemsTable />
          </DatasetPage>
        </Shell>
      </Case>
      <Case wide label="qa-page-filter-chips (QA1: Items tab with a list-key chip and a scalar chip applied)">
        <Shell crumb="support-faq">
          <DatasetPage tab="items" restricted={false}>
            <ItemsToolbar chips />
            <ItemsTable />
          </DatasetPage>
        </Shell>
      </Case>
      <Case
        wide
        label="qa-page-catalog (QG1: the datasets catalog, cards are links without a hover underline)"
      >
        <Shell crumb="Catalog">
          <PageHeader
            title="Datasets"
            description="Test sets for evaluations. Versions are immutable once published."
            actions={
              <span className={styles.actions}>
                <Button variant="neutral" size="sm">
                  Deleted datasets
                </Button>
                <Button variant="primary" size="sm" icon={<Icon name="plus" size={12} />}>
                  New dataset
                </Button>
              </span>
            }
          />
          <ul className={styles.cardGrid}>
            <CatalogCard
              name="support-faq"
              state="v2 draft · v1 prod"
              desc="Customer support questions in Arabic and English."
              items={130}
              runs={2}
            />
            <CatalogCard
              name="legal-clauses"
              state="v1 prod · current"
              desc="Clause extraction cases reviewed by counsel."
              items={40}
              runs={1}
              restricted
            />
            <CatalogCard
              name="onboarding-checks"
              state="v1 prod · current"
              desc="Checks run before a new customer goes live."
              items={20}
              runs={0}
              restricted
            />
            <CatalogCard
              name="refund-cases"
              state="v1 prod · current"
              desc="Edge cases for refunds."
              items={20}
              runs={0}
              restricted
            />
            <CatalogCard
              name="pricing-golden"
              state="v1 prod · current"
              desc="Held-out pricing questions."
              items={24}
              runs={0}
              priv
            />
            <CatalogCard
              name="release-notes"
              state="v1 prod · current"
              desc="Release note summaries."
              items={12}
              runs={0}
            />
          </ul>
        </Shell>
      </Case>
    </>
  );
}
