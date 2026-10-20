/** Dataset → Settings → Access (spec A1-5 to A1-24): who can open and change this dataset. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  useDatasetAccess,
  useSaveDatasetAccess,
  type AccessGrant,
  type AccessPerson,
  type Dataset,
  type DatasetAccess,
  type DatasetAccessMode,
  type GrantLevel,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  IconButton,
  RadioGroup,
  SectionHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Tag,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { Note } from '../components/Note';
import { UserPill } from '../components/UserPill';
import styles from './AccessSection.module.css';

interface Row {
  person: AccessPerson;
  level: GrantLevel;
  grantedBy: AccessPerson | null;
}

const LEVEL_OPTIONS = [
  { value: 'view' as const, label: 'View' },
  { value: 'modify' as const, label: 'Modify' },
];

function toRows(grants: AccessGrant[]): Row[] {
  return grants.map((g) => ({ person: g.user, level: g.level, grantedBy: g.granted_by }));
}

function asUser(person: AccessPerson | null) {
  return person ? { id: person.id, email: person.email, display_name: person.name } : null;
}

function signature(mode: DatasetAccessMode, rows: Row[]): string {
  return `${mode}|${[...rows]
    .map((r) => `${r.person.id}:${r.level}`)
    .sort()
    .join(',')}`;
}

export function AccessSection({
  slug,
  dataset,
  archived,
}: {
  slug: string;
  dataset: Dataset;
  archived: boolean;
}) {
  const access = useDatasetAccess(slug, dataset.slug);
  return (
    <Card as="section" aria-labelledby="ds-access" data-testid="access-section">
      <div className={styles.stack}>
        <SectionHeader id="ds-access" title="Access" />
        {access.isError ? (
          <ErrorState
            compact
            error={access.error}
            title="Couldn’t load access"
            onRetry={() => void access.refetch()}
          />
        ) : !access.data ? (
          <>
            <Text variant="base" tone="muted" as="p">
              Choose who in this project can open and change this dataset.
            </Text>
            <div className={styles.skeletonFrame}>
              <Skeleton kind="lines" rows={5} label="Loading access" />
            </div>
          </>
        ) : (
          // A save (or a refetch with new data) remounts the body, so the draft starts from the server's state.
          <AccessBody
            key={signature(access.data.access_mode, toRows(access.data.grants))}
            slug={slug}
            dataset={dataset}
            data={access.data}
            archived={archived}
          />
        )}
      </div>
    </Card>
  );
}

function AccessBody({
  slug,
  dataset,
  data,
  archived,
}: {
  slug: string;
  dataset: Dataset;
  data: DatasetAccess;
  archived: boolean;
}) {
  const save = useSaveDatasetAccess(slug, dataset.slug);
  const toast = useToast();
  const editable = data.can_manage_access && !archived;
  const savedRows = useMemo(() => toRows(data.grants), [data.grants]);
  const [mode, setMode] = useState<DatasetAccessMode>(data.access_mode);
  const [rows, setRows] = useState<Row[]>(savedRows);
  const [who, setWho] = useState<Key | null>(null);
  const [newLevel, setNewLevel] = useState<GrantLevel>('view');
  const addRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const dirty = signature(mode, rows) !== signature(data.access_mode, savedRows);
  const restricted = mode === 'restricted';
  const pool = useMemo(() => {
    const byId = new Map<string, AccessPerson>();
    for (const p of data.candidates) byId.set(p.id, p);
    for (const g of data.grants) byId.set(g.user.id, g.user);
    const taken = new Set(rows.map((r) => r.person.id));
    return [...byId.values()].filter((p) => !taken.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.candidates, data.grants, rows]);

  async function onSave() {
    try {
      await save.mutateAsync({
        access_mode: mode,
        grants: rows.map((r) => ({ user_id: r.person.id, level: r.level })),
      });
      toast.show('Access saved', { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Couldn’t save access', { tone: 'error' });
    }
  }

  function discard() {
    setMode(data.access_mode);
    setRows(savedRows);
    setWho(null);
  }

  function addPerson() {
    const person = pool.find((p) => p.id === who);
    if (!person) return;
    setRows([...rows, { person, level: newLevel, grantedBy: null }]);
    setWho(null);
  }

  // After a removal focus moves to the next row's Remove, or to the Add person select when none remains.
  const focusAfterRemove = useRef<number | null>(null);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const frame = requestAnimationFrame(() => {
      const buttons = tableRef.current?.querySelectorAll<HTMLElement>('button[aria-label^="Remove "]');
      const next = buttons?.[index];
      if (next) next.focus();
      else addRef.current?.querySelector<HTMLElement>('button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  function removeRow(index: number) {
    focusAfterRemove.current = index;
    setRows(rows.filter((_, i) => i !== index));
  }

  const sentence = archived
    ? 'This project is archived.'
    : editable
      ? 'Choose who in this project can open and change this dataset.'
      : 'Only project managers and admins can change who has access.';

  const columns: Column<Row>[] = [
    {
      id: 'person',
      header: 'Person',
      flex: true,
      minWidth: 200,
      priority: 1,
      cardTitle: true,
      cell: (r) => (
        <span className={styles.personCell}>
          <span className={styles.personName} dir="auto">
            {r.person.name}
          </span>
          <span className={styles.personEmail}>{r.person.email}</span>
        </span>
      ),
    },
    {
      id: 'level',
      header: 'Level',
      width: 160,
      priority: 1,
      cell: (r) =>
        editable ? (
          <SegmentedControl
            label={`Level for ${r.person.name}`}
            options={LEVEL_OPTIONS}
            value={r.level}
            onChange={(level) =>
              setRows(rows.map((x) => (x.person.id === r.person.id ? { ...x, level } : x)))
            }
          />
        ) : (
          <Tag tone={r.level === 'modify' ? 'accent' : undefined}>
            {r.level === 'modify' ? 'Modify' : 'View'}
          </Tag>
        ),
    },
    {
      id: 'by',
      header: 'Added by',
      width: 150,
      priority: 2,
      cell: (r) =>
        r.grantedBy ? (
          <UserPill user={asUser(r.grantedBy)} />
        ) : (
          <span className={styles.personEmail}>You</span>
        ),
    },
    ...(editable
      ? [
          {
            id: 'remove',
            header: 'Remove',
            hideLabel: true,
            width: 48,
            priority: 2,
            cell: (r: Row) => (
              <IconButton
                label={`Remove ${r.person.name}`}
                icon="close"
                onPress={() => removeRow(rows.findIndex((x) => x.person.id === r.person.id))}
              />
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ];

  const table = (
    <div ref={tableRef} data-testid="access-grants-table">
      <DataTable<Row>
        aria-label="People with access"
        variant="embedded"
        density="regular"
        densityLocked
        zebra={false}
        rows={rows}
        rowKey={(r) => r.person.id}
        columns={columns}
      />
    </div>
  );

  if (!editable) {
    const yourAccess = data.your_level === 'view' ? 'View' : 'Modify';
    return (
      <>
        <Text variant="base" tone="muted" as="p">
          {sentence}
        </Text>
        <dl className={styles.summary} data-testid="access-summary">
          <dt>Who has access</dt>
          <dd>
            {data.access_mode === 'restricted' ? 'Only people listed below' : 'Everyone in the project'}
          </dd>
          <dt>Your access</dt>
          <dd>{yourAccess}</dd>
        </dl>
        {data.access_mode === 'restricted' && rows.length ? table : null}
      </>
    );
  }

  const savedCount = savedRows.length;
  const restrictedHelp =
    'Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.' +
    (mode === 'project' && savedCount
      ? savedCount === 1
        ? ' 1 saved grant is kept and applies again if you switch back.'
        : ` ${savedCount} saved grants are kept and apply again if you switch back.`
      : '');

  return (
    <>
      <Text variant="base" tone="muted" as="p">
        {sentence}
      </Text>
      <RadioGroup<DatasetAccessMode>
        label="Who can access this dataset"
        testId="access-mode"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: 'project',
            title: 'Everyone in the project',
            help: 'Every member can view and modify this dataset. This is the default.',
            testId: 'access-mode-project',
          },
          {
            value: 'restricted',
            title: 'Only people listed below',
            help: restrictedHelp,
            testId: 'access-mode-restricted',
          },
        ]}
      />
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
              {rows.length === 1 ? '1 person' : `${rows.length} people`}
            </Text>
          </div>
          {rows.length ? (
            table
          ) : (
            <Note tone="warning" title="No one is listed" data-testid="access-empty-note">
              <span>Only project managers, admins and the creator can open this dataset.</span>
            </Note>
          )}
          {pool.length ? (
            <div className={styles.addPerson} data-testid="access-add" ref={addRef}>
              <Select
                label="Add person"
                items={pool.map((p) => ({ key: p.id, label: p.name, description: p.email }))}
                value={who}
                onChange={setWho}
                placeholder="Choose a project member"
                width={240}
              />
              <SegmentedControl
                label="Level for the new person"
                options={LEVEL_OPTIONS}
                value={newLevel}
                onChange={setNewLevel}
              />
              <Button variant="neutral" isDisabled={who === null} onPress={addPerson}>
                Add person
              </Button>
            </div>
          ) : (
            <Text variant="sm" tone="muted" as="p" data-testid="access-add">
              Everyone in the project already has access.
            </Text>
          )}
        </div>
      ) : null}
      <div className={styles.saveBar} data-testid="access-save-bar">
        <Button variant="primary" isDisabled={!dirty} loading={save.isPending} onPress={() => void onSave()}>
          Save access
        </Button>
        <Button variant="neutral" isDisabled={!dirty || save.isPending} onPress={discard}>
          Discard
        </Button>
        <span data-part="status" aria-live="polite">
          {save.isPending ? 'Saving' : dirty ? 'Unsaved changes' : 'No changes'}
        </span>
      </div>
    </>
  );
}
