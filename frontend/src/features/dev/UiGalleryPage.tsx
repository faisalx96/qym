import { useRef, useState, type ReactNode } from 'react';
import { DataTableGallery } from './DataTableGallery';
import { VisualLanguageGallery } from './VisualLanguageGallery';
import type { Key } from 'react-aria-components';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Dialog,
  Disclosure,
  Drawer,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Eyebrow,
  FormDialog,
  HelpMarker,
  Icon,
  IconButton,
  Identicon,
  JsonPreview,
  JsonTree,
  Kbd,
  KeyValueGrid,
  LinkButton,
  MultiSelect,
  NumberField,
  PageHeader,
  Pagination,
  QuickFilterGroup,
  ReportLayout,
  ReportSection,
  ScopeBar,
  Popover,
  RunStatusBadge,
  ScoreValue,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Stepper,
  Collapse,
  Select,
  Skeleton,
  Slider,
  StaleBanner,
  Stack,
  StatStrip,
  Switch,
  TabPanel,
  Tabs,
  Tag,
  Text,
  TextBlock,
  TextField,
  Textarea,
  Tooltip,
  useToast,
  type Column,
} from '@/ui';
import { ApiError } from '@/lib/http';
import styles from './UiGalleryPage.module.css';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.section} id={id} data-gallery-section={id}>
      <SectionHeader title={title} />
      <div className={styles.grid}>{children}</div>
    </section>
  );
}

function Case({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={styles.case} data-case={label} data-wide={wide ? '' : undefined}>
      <Eyebrow>{label}</Eyebrow>
      <div className={styles.caseBody}>{children}</div>
    </div>
  );
}

interface Row {
  id: string;
  name: string;
  model: string;
  score: number | null;
  status: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'nightly-2026-10-10', model: 'gpt-4.1', score: 0.93, status: 'COMPLETED' },
  { id: 'r2', name: 'ar-eval/pass-2', model: 'claude-sonnet', score: 0.71, status: 'RUNNING' },
  { id: 'r3', name: 'baseline', model: 'llama-3', score: 0.38, status: 'FAILED' },
];

const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Run', sort: 'name', flex: true, minWidth: 120 },
  { id: 'model', header: 'Model', sort: 'model', width: 140 },
  {
    id: 'score',
    header: 'Accuracy',
    sort: 'score',
    width: 110,
    align: 'end',
    mono: true,
    cell: (r) => <ScoreValue value={r.score} direction="higher" />,
  },
  { id: 'status', header: 'Status', width: 120, cell: (r) => <RunStatusBadge status={r.status} /> },
];

const ITEMS = Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: `model-${i}`, count: i * 3 }));

export default function UiGalleryPage() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState(false);
  const [form, setForm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [seg, setSeg] = useState<'all' | 'official' | 'local'>('all');
  const [tab, setTab] = useState('general');
  const [page, setPage] = useState(3);
  const [selectValue, setSelectValue] = useState<Key | null>('b');
  const [multi, setMulti] = useState<Set<Key>>(new Set(['m1']));
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'name',
    direction: 'asc',
  });
  const [chip, setChip] = useState(true);
  const [num, setNum] = useState(10);
  const [slider, setSlider] = useState(60);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [staleSince] = useState(() => new Date(Date.now() - 90_000));
  const sorted = [...ROWS].sort((a, b) => {
    if (!sort) return 0;
    const av = a[sort.key as keyof Row] ?? '';
    const bv = b[sort.key as keyof Row] ?? '';
    return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.direction === 'asc' ? 1 : -1);
  });

  return (
    <div className={styles.page} data-ui-gallery>
      <PageHeader
        title="UI primitives"
        description="Every primitive in every state. Dev-only reference for area agents and UX tests."
        meta={['frontend/src/ui', 'docs/DESIGN_LANGUAGE.md']}
        actions={
          <Button variant="primary" onPress={() => toast.show('Saved changes', { tone: 'success' })}>
            Show toast
          </Button>
        }
      />

      <Section id="text" title="Text & layout">
        <Case label="Text roles">
          <Stack gap="xs">
            <Text variant="title">Page title (22)</Text>
            <Text variant="stat">98.4%</Text>
            <Text variant="xl">Modal / empty title (18)</Text>
            <Text variant="lg">Section header (15)</Text>
            <Text variant="md">Card title (13)</Text>
            <Text variant="base">Body / table cell (12)</Text>
            <Text variant="sm">Meta / caption / label (11)</Text>
            <Text variant="base" mono>
              run_2026-10-11T08:00:00Z
            </Text>
          </Stack>
        </Case>
        <Case label="Eyebrow + Kbd">
          <Stack gap="sm">
            <Eyebrow>Uppercase label</Eyebrow>
            <Eyebrow tone="danger">Danger zone</Eyebrow>
            <span>
              Press <Kbd>j</Kbd> / <Kbd>k</Kbd> to move, <Kbd>Enter</Kbd> to open
            </span>
          </Stack>
        </Case>
        <Case label="TextBlock (auto direction, code detection)">
          <Stack gap="sm">
            <TextBlock text="The quick brown fox jumps over the lazy dog." />
            <TextBlock text="النص العربي يظهر من اليمين إلى اليسار مع تباعد أسطر أعلى." />
            <TextBlock text={'SELECT id, name\nFROM users\nWHERE active = 1;'} />
            <TextBlock text={'# Heading\nSome **bold** and `code` and https://example.com'} mode="rendered" />
          </Stack>
        </Case>
        <Case label="KeyValueGrid">
          <KeyValueGrid
            columns={2}
            items={[
              { key: 'prompt_version', value: 'v12', mono: true },
              { key: 'model', value: 'gpt-4.1' },
              { key: 'dataset', value: 'arabic-qa@3', mono: true },
              { key: 'owner', value: 'Meshari' },
            ]}
          />
        </Case>
      </Section>

      <Section id="actions" title="Actions">
        <Case label="Button variants (sm)">
          <Stack direction="row" gap="sm" wrap>
            <Button variant="neutral">Neutral</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="danger">Delete run</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="neutral" isDisabled>
              Disabled
            </Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button variant="accent" icon={<Icon name="plus" size={12} />}>
              With icon
            </Button>
          </Stack>
        </Case>
        <Case label="Button md">
          <Stack direction="row" gap="sm" wrap>
            <Button variant="neutral" size="md">
              Cancel
            </Button>
            <Button variant="primary" size="md">
              Create project
            </Button>
            <Button variant="danger" size="md">
              Archive
            </Button>
          </Stack>
        </Case>
        <Case label="IconButton / CopyButton / LinkButton">
          <Stack direction="row" gap="sm" align="center" wrap>
            <IconButton label="Edit" icon="edit" />
            <IconButton label="Delete" icon="trash" tone="danger" />
            <IconButton label="Approve" icon="check" tone="approve" />
            <IconButton label="Reject" icon="close" tone="reject" />
            <IconButton label="Disabled" icon="more" isDisabled />
            <CopyButton text="copied text" />
            <LinkButton to="/" variant="accent">
              Router link
            </LinkButton>
            <LinkButton
              href="https://example.com"
              target="_blank"
              rel="noreferrer"
              icon={<Icon name="external" size={12} />}
            >
              External
            </LinkButton>
            <Tooltip content="Open in a new tab">
              <IconButton label="Open" icon="external" />
            </Tooltip>
          </Stack>
        </Case>
        <Case label="Chip">
          <Stack direction="row" gap="sm" wrap>
            <Chip isSelected={chip} onChange={setChip} count={12}>
              status: completed
            </Chip>
            <Chip onRemove={() => toast.show('Removed')}>model: gpt-4.1</Chip>
            <Chip isDisabled>disabled</Chip>
          </Stack>
        </Case>
      </Section>

      <Section id="inputs" title="Inputs (24px density)">
        <Case label="TextField">
          <Stack gap="sm">
            <TextField label="Project name" placeholder="My project" />
            <TextField label="Slug" mono value="my-project" help="Lowercase letters, digits and dashes." />
            <TextField label="Email" errorMessage="A valid email address is required" value="nope" />
            <TextField label="Disabled" isDisabled value="read only" />
            <TextField
              label="With icon"
              prefixIcon={<Icon name="user" size={12} />}
              placeholder="Search members"
            />
            <TextField label="Auth size (42px)" size="auth" placeholder="you@example.com" />
          </Stack>
        </Case>
        <Case label="SearchField / NumberField / Textarea">
          <Stack gap="sm">
            <SearchField label="Search runs" hint="/" />
            <NumberField label="Timeout (s)" value={num} onChange={setNum} minValue={0} width={120} />
            <Textarea label="Instructions" placeholder="Additional instructions…" rows={3} />
          </Stack>
        </Case>
        <Case label="Checkbox / Switch / Slider">
          <Stack gap="sm">
            <Checkbox defaultSelected>Require different reviewer</Checkbox>
            <Checkbox isIndeterminate>Some selected</Checkbox>
            <Checkbox isDisabled>Disabled</Checkbox>
            <Switch defaultSelected>Available for experiments</Switch>
            <Switch isDisabled>Disabled switch</Switch>
            <Slider
              label="Max score"
              value={slider}
              onChange={(v) => setSlider(Array.isArray(v) ? (v[0] ?? 0) : v)}
              unit="%"
              width={220}
            />
          </Stack>
        </Case>
        <Case label="Select (searchable when > 8)">
          <Stack gap="sm">
            <Select
              label="Role"
              items={[
                { key: 'a', label: 'Member' },
                { key: 'b', label: 'Manager', description: 'Can add members' },
                { key: 'c', label: 'Disabled', disabled: true },
              ]}
              value={selectValue}
              onChange={setSelectValue}
              width={200}
            />
            <Select
              label="Model"
              items={ITEMS}
              value={null}
              onChange={() => {}}
              placeholder="Pick a model"
              width={200}
            />
          </Stack>
        </Case>
        <Case label="MultiSelect (search → Select all/None → Only)">
          <MultiSelect
            label="Models"
            items={ITEMS}
            value={multi}
            onChange={setMulti}
            emptyOption={{ key: '__none__', label: '(no model)' }}
          />
        </Case>
        <Case label="MultiSelect triggerVariant=bar (filter bar: label, then · value; accent tint when active)">
          <Stack direction="row" gap="sm">
            <MultiSelect
              triggerVariant="bar"
              label="Model"
              items={ITEMS}
              value={new Set()}
              onChange={() => {}}
            />
            <MultiSelect
              triggerVariant="bar"
              label="Status"
              items={ITEMS}
              value={new Set([ITEMS[0]!.key])}
              onChange={() => {}}
            />
          </Stack>
        </Case>
        <Case label="Stepper (always-clickable rail; compact below 760px)">
          <GalleryStepper />
        </Case>
        <Case label="Collapse (grid-rows disclosure, inert when closed)">
          <GalleryCollapse />
        </Case>
        <Case label="SegmentedControl (one tab stop, arrows)">
          <SegmentedControl
            label="Origin"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'all', label: 'All' },
              { value: 'official', label: 'Official' },
              { value: 'local', label: 'Local', disabled: false },
            ]}
          />
        </Case>
      </Section>

      <Section id="navigation" title="Navigation">
        <Case label="Tabs (underline)">
          <Tabs
            label="Settings sections"
            selected={tab}
            onSelect={setTab}
            items={[
              { id: 'general', label: 'General' },
              { id: 'members', label: 'Members', count: 4 },
              { id: 'keys', label: 'API keys', count: 2, tone: 'danger' },
              { id: 'danger', label: 'Danger zone', disabled: true },
            ]}
          >
            <TabPanel id="general">General panel</TabPanel>
            <TabPanel id="members">Members panel</TabPanel>
            <TabPanel id="keys">Keys panel</TabPanel>
            <TabPanel id="danger">Danger</TabPanel>
          </Tabs>
        </Case>
        <Case label="Disclosure">
          <Disclosure title="Input mapping" summary="Default fields">
            <Text variant="base" tone="secondary">
              Collapsed by default; the summary stays on the trigger row.
            </Text>
          </Disclosure>
        </Case>
        <Case label="Tabs (dense)">
          <Tabs
            label="Datasets"
            variant="dense"
            selected={tab === 'members' ? 'b' : 'a'}
            onSelect={() => {}}
            items={[
              { id: 'a', label: 'arabic-qa', count: 120 },
              { id: 'b', label: 'english-qa', count: 48 },
            ]}
          >
            <TabPanel id="a">arabic-qa items</TabPanel>
            <TabPanel id="b">english-qa items</TabPanel>
          </Tabs>
        </Case>
        <Case label="Pagination">
          <div ref={scrollRef}>
            <Pagination
              total={1234}
              page={page}
              pageSize={50}
              noun="runs"
              onPageChange={setPage}
              pageSizeOptions={[25, 50, 100]}
              onPageSizeChange={() => {}}
              scrollTarget={scrollRef}
            />
          </div>
        </Case>
        <Case label="DropdownMenu / Popover">
          <Stack direction="row" gap="sm">
            <DropdownMenu
              label="Row actions"
              trigger={<IconButton label="More actions" icon="more" />}
              items={[
                { id: 'open', label: 'Open', icon: <Icon name="external" size={12} /> },
                { id: 'copy', label: 'Copy id', icon: <Icon name="copy" size={12} /> },
                { id: 'delete', label: 'Delete', tone: 'danger', separatorBefore: true },
              ]}
              onAction={(id) => toast.show(`Action: ${id}`)}
            />
            <Popover label="Filters" trigger={<Button variant="neutral">Open popover</Button>}>
              <div style={{ padding: 'var(--space-md)' }}>
                <Text variant="md">Popover content</Text>
                <Text variant="sm">Closes on Escape or outside click.</Text>
              </div>
            </Popover>
          </Stack>
        </Case>
      </Section>

      <Section id="status" title="Status & data">
        <Case label="Badge">
          <Stack direction="row" gap="sm" wrap>
            <Badge tone="success">completed</Badge>
            <Badge tone="info" dot>
              running
            </Badge>
            <Badge tone="danger">failed</Badge>
            <Badge tone="warning">stopped</Badge>
            <Badge tone="neutral">submitted</Badge>
          </Stack>
        </Case>
        <Case label="RunStatusBadge">
          <Stack direction="row" gap="sm" wrap>
            {[
              'PENDING',
              'SUBMITTED',
              'RUNNING',
              'COMPLETED',
              'FAILED',
              'STOPPED',
              'APPROVED',
              'REJECTED',
            ].map((s) => (
              <RunStatusBadge key={s} status={s} />
            ))}
          </Stack>
        </Case>
        <Case label="Tag">
          <Stack direction="row" gap="sm" wrap>
            <Tag kind="role">admin</Tag>
            <Tag kind="accent">official</Tag>
            <Tag kind="count">42</Tag>
            <Tag kind="data">gpt-4.1</Tag>
            <Tag kind="version">v3</Tag>
            <Tag tone="success">improved</Tag>
            <Tag tone="info">info</Tag>
            <Tag tone="warning">draft</Tag>
            <Tag tone="danger">regressed</Tag>
            <Tag>plain</Tag>
          </Stack>
        </Case>
        <Case label="ScoreValue (bands + non-colour cue)">
          <Stack direction="row" gap="md" wrap>
            <ScoreValue value={0.95} direction="higher" />
            <ScoreValue value={0.8} direction="higher" />
            <ScoreValue value={0.65} direction="higher" />
            <ScoreValue value={0.5} direction="higher" />
            <ScoreValue value={0.2} direction="higher" />
            <ScoreValue value={0.2} direction="lower" ci={[0.15, 0.25]} />
            <ScoreValue value={0.5} direction="none" />
            <ScoreValue value={null} error="task" />
            <ScoreValue value={null} error="metric" />
            <ScoreValue value={0.9} direction="higher" retries={2} />
          </Stack>
        </Case>
        <Case label="StatStrip">
          <StatStrip
            items={[
              { label: 'Runs', value: '1,284', help: 'Runs in the selected range.' },
              { label: 'Pass rate', value: '91.2%', tone: 'success', sub: '+2.1 vs last week' },
              { label: 'Failed', value: '12', tone: 'danger' },
              { label: 'Pending reviews', value: '7', icon: <Icon name="review" size={14} /> },
            ]}
          />
        </Case>
        <Case label="StatStrip compact with bars (passes panel)">
          <StatStrip
            variant="compact"
            items={[
              { label: 'Pass@3', value: '100.0%', bar: 1, barBand: 5 },
              { label: 'Pass^3', value: '37.5%', bar: 0.375, barBand: 2 },
              { label: 'Avg@3', value: '82.8%', bar: 0.828, barBand: 4 },
            ]}
          />
        </Case>
        <Case label="StatStrip compact-header">
          <StatStrip
            variant="compact-header"
            items={[
              { label: 'Items', value: '320' },
              { label: 'Errors', value: '4', tone: 'danger' },
            ]}
          />
        </Case>
        <Case label="Identicon">
          <Stack direction="row" gap="sm">
            <Identicon seed="project-a" />
            <Identicon seed="project-b" chip />
            <Identicon seed="arabic-qa" cell={6} gap={2} chip />
          </Stack>
        </Case>
        <Case label="HelpMarker">
          <Stack direction="row" gap="sm" align="center">
            <span>Confidence</span>
            <HelpMarker label="confidence">
              Wilson interval at 95% over the items scored in this pass.
            </HelpMarker>
          </Stack>
        </Case>
        <Case label="JsonPreview / JsonTree">
          <Stack gap="sm">
            <JsonPreview
              value={{ model: 'gpt-4.1', temperature: 0.2, tags: ['a', 'b'], nested: { ok: true, n: null } }}
              title="config"
            />
            <JsonPreview value='{"a":1}' title="inline" compact />
            <JsonTree
              data={{ model: 'gpt-4.1', temperature: 0.2, tags: ['a', 'b'], nested: { ok: true, n: null } }}
              expandDepth={1}
            />
          </Stack>
        </Case>
      </Section>

      <VisualLanguageGallery />

      <Section id="table" title="DataTable">
        <Case label="Sortable, resizable, persisted widths (storageKey=gallery)">
          <DataTable
            aria-label="Runs"
            columns={COLUMNS}
            rows={sorted}
            rowKey={(r) => r.id}
            storageKey="gallery"
            sort={sort}
            onSortChange={setSort}
          />
        </Case>
        <Case
          wide
          label="v2: toolbar, footer, selection + bulk bar, row actions, expansion, bands, pins, states (resize below 640px for cards)"
        >
          <DataTableGallery />
        </Case>
        <Case label="Empty">
          <DataTable
            aria-label="Empty"
            columns={COLUMNS}
            rows={[]}
            rowKey={(r) => r.id}
            empty="No runs match these filters."
          />
        </Case>
        <Case label="Dimmed (stale)">
          <Stack gap="sm">
            <StaleBanner since={staleSince} filtersApplied={false} onRetry={() => toast.show('Retrying')} />
            <DataTable aria-label="Stale" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} refreshing />
          </Stack>
        </Case>
      </Section>

      <Section id="feedback" title="Loading, empty, error">
        <Case label="Skeleton kinds">
          <Stack gap="md">
            <span>
              Value: <Skeleton kind="value" />
            </span>
            <Skeleton kind="lines" rows={3} />
            <Skeleton kind="table" rows={3} />
            <Skeleton kind="cards" count={3} />
            <Skeleton kind="chart" height={80} />
          </Stack>
        </Case>
        <Case label="EmptyState">
          <EmptyState
            icon={<Icon name="folder" />}
            title="No projects yet"
            body="Create a project to start collecting runs."
            action={<Button variant="primary">New project</Button>}
          />
        </Case>
        <Case label="ErrorState by kind">
          <Stack gap="md">
            <ErrorState error={new ApiError(401, 'Not authenticated')} compact />
            <ErrorState error={new ApiError(403, 'Manager only')} compact />
            <ErrorState
              error={new ApiError(404, 'Run not found')}
              compact
              notFoundMessage="This run was deleted."
            />
            <ErrorState
              error={new ApiError(500, 'Internal error')}
              compact
              onRetry={() => toast.show('Retry')}
            />
            <ErrorState error={new TypeError('Failed to fetch')} compact onRetry={() => {}} />
          </Stack>
        </Case>
      </Section>

      <Section id="overlays" title="Overlays">
        <Case label="Dialog / ConfirmDialog / FormDialog / Drawer">
          <Stack direction="row" gap="sm" wrap>
            <Button onPress={() => setDialog(true)}>Dialog</Button>
            <Button onPress={() => setConfirm(true)}>Confirm</Button>
            <Button variant="danger" onPress={() => setDangerConfirm(true)}>
              Danger confirm (typed)
            </Button>
            <Button onPress={() => setForm(true)}>Form dialog</Button>
            <Button onPress={() => setDrawer(true)}>Drawer</Button>
            <Button onPress={() => toast.show('Could not save', { tone: 'error' })}>Error toast</Button>
            <Button
              onPress={() =>
                toast.show('Run deleted', {
                  tone: 'info',
                  action: { label: 'Undo', onClick: () => toast.show('Restored', { tone: 'success' }) },
                })
              }
            >
              Toast with action
            </Button>
          </Stack>
          <Dialog
            open={dialog}
            onOpenChange={setDialog}
            title="Plain dialog"
            description="Focus is trapped; Escape closes; focus returns."
            footer={
              <Button variant="primary" size="md" onPress={() => setDialog(false)}>
                Done
              </Button>
            }
          >
            <TextField label="Something" autoFocus />
          </Dialog>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Submit 3 runs for review?"
            description={['They will appear in the reviews queue.', 'Reviewers are notified.']}
            confirmLabel="Submit"
            onConfirm={() => {
              toast.show('Submitted', { tone: 'success' });
            }}
          />
          <ConfirmDialog
            open={dangerConfirm}
            onOpenChange={setDangerConfirm}
            title="Delete project “demo”?"
            tone="danger"
            description="This cannot be undone."
            warning={{
              lead: 'This will also delete',
              items: [{ title: '3 datasets', meta: '120 items' }, { title: '2 API keys' }],
              itemsLabel: 'Affected',
            }}
            requireText="demo"
            confirmLabel="Delete project"
            altLabel="Archive instead"
            onAlternative={() => {
              toast.show('Archived');
            }}
            onConfirm={() => {
              toast.show('Deleted', { tone: 'error' });
            }}
          />
          <FormDialog
            open={form}
            onOpenChange={setForm}
            title="Create project"
            fields={[
              { name: 'name', label: 'Name', required: true, autoFocus: true },
              { name: 'slug', label: 'Slug', mono: true, help: 'Derived from the name until edited.' },
              {
                name: 'role',
                label: 'Default role',
                type: 'select',
                options: [
                  { value: 'MEMBER', label: 'Member' },
                  { value: 'MANAGER', label: 'Manager' },
                ],
                value: 'MEMBER',
              },
              { name: 'notes', label: 'Notes', type: 'textarea' },
              { name: 'private', label: 'Private', type: 'checkbox' },
            ]}
            onChange={(values, changed) =>
              changed === 'name'
                ? {
                    ...values,
                    slug: String(values.name)
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-'),
                  }
                : undefined
            }
            onSubmit={async (values) => {
              if (values.slug === 'taken') throw new Error('A project with this slug already exists');
              toast.show(`Created ${values.name}`, { tone: 'success' });
            }}
          />
          <Drawer
            open={drawer}
            onOpenChange={setDrawer}
            title="Run details"
            subtitle="nightly-2026-10-10"
            actions={<CopyButton text="nightly" />}
            footer={
              <Button size="md" onPress={() => setDrawer(false)}>
                Close
              </Button>
            }
          >
            <Stack gap="md">
              <Text variant="base">Drawer body. Tab stays inside; Escape closes.</Text>
              <JsonPreview value={{ a: 1, b: [1, 2] }} title="nested" />
            </Stack>
          </Drawer>
        </Case>
      </Section>
      <Section id="report" title="Report page">
        <Case label="ReportSection + ScopeBar + QuickFilterGroup">
          <ReportGalleryDemo />
        </Case>
      </Section>
    </div>
  );
}

function ReportGalleryDemo() {
  const [status, setStatus] = useState<string[]>(['fail']);
  const [open, setOpen] = useState(true);
  return (
    <ReportLayout
      wide
      sidebarOpen={open}
      sidebar={
        <QuickFilterGroup
          label="Status"
          mode="single"
          options={[
            { id: 'pass', label: 'Pass', count: 18 },
            { id: 'fail', label: 'Fail', count: 6, tone: 'danger' },
          ]}
          selected={status}
          onToggle={(id) => setStatus((s) => (s.includes(id) ? [] : [id]))}
          onOnly={(id) => setStatus([id])}
        />
      }
    >
      {status.length ? (
        <ScopeBar
          shown={6}
          total={24}
          chips={status.map((s) => ({ key: s, label: `Status: ${s}`, onClear: () => setStatus([]) }))}
          onClearAll={() => setStatus([])}
          onJumpToItems={() => {}}
          sidebarOpen={open}
          onToggleSidebar={() => setOpen((o) => !o)}
        />
      ) : null}
      <ReportSection
        id="gallery-overview"
        title="Overview"
        description="Score distributions per metric."
        scopeNote={status.length ? 'over 6 of 24 items' : undefined}
      >
        <Text variant="base">Section body.</Text>
      </ReportSection>
    </ReportLayout>
  );
}

const GALLERY_STEPS = [
  { id: 'where', label: 'Where it runs' },
  { id: 'models', label: 'Models', changes: 2 },
  { id: 'review', label: 'Review and launch', problems: 1 },
];

function GalleryStepper() {
  const [current, setCurrent] = useState('models');
  return <Stepper aria-label="Gallery steps" steps={GALLERY_STEPS} current={current} onSelect={setCurrent} />;
}

function GalleryCollapse() {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="sm">
      <Button variant="neutral" onPress={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Open'}
      </Button>
      <Collapse open={open}>
        <Text variant="base">Content that animates open and closed.</Text>
      </Collapse>
    </Stack>
  );
}
