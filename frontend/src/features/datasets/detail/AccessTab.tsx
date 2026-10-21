/**
 * Dataset → Access tab (E4, QA5-17 to QA5-78): who can open and change this dataset. Two cards (Access mode, People with
 * access), a sticky save bar, read-only summary for everyone who cannot manage access.
 */
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
import { useDelayedPending } from '@/lib/pending';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Icon,
  IconButton,
  RadioGroup,
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
import { CardHead } from './SettingsTab';
import styles from './AccessTab.module.css';

interface Row {
  person: AccessPerson;
  level: GrantLevel;
  grantedBy: AccessPerson | null;
  /** ISO date the grant was created; null for a row added in this session and not saved yet */
  createdAt: string | null;
}

const LEVEL_OPTIONS = [
  { value: 'view' as const, label: 'View' },
  { value: 'modify' as const, label: 'Modify' },
];

function toRows(grants: AccessGrant[]): Row[] {
  return grants.map((g) => ({
    person: g.user,
    level: g.level,
    grantedBy: g.granted_by,
    createdAt: g.created_at,
  }));
}

function asUser(person: AccessPerson) {
  return { id: person.id, email: person.email, display_name: person.name };
}

/** `Oct 14, 2026`, in the reader's time zone but always English month names (QA5-41). */
export function grantDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The signature of mode and `{user_id: level}`; equal signatures mean no unsaved change (QA5-47). */
export function accessSignature(mode: DatasetAccessMode, rows: Pick<Row, 'person' | 'level'>[]): string {
  return `${mode}|${[...rows]
    .map((r) => `${r.person.id}:${r.level}`)
    .sort()
    .join(',')}`;
}

const SENTENCE_MANAGE = 'Choose who in this project can open and change this dataset.';

export function AccessTab({
  slug,
  dataset,
  archived,
  onDirtyChange,
}: {
  slug: string;
  dataset: Dataset;
  archived: boolean;
  /** the page keeps the unsaved flag to guard the tab strip (QA5-62) */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const access = useDatasetAccess(slug, dataset.slug);
  const showSkeleton = useDelayedPending(access.isPending);
  const idPrefix = 'ds-access';
  return (
    <div className={styles.accessTab} data-testid="access-tab">
      {access.isError ? (
        <Card
          as="section"
          aria-labelledby={`${idPrefix}-mode`}
          data-testid="access-mode-card"
          header={<CardHead id={`${idPrefix}-mode`} title="Access mode" description={SENTENCE_MANAGE} />}
        >
          <ErrorState
            compact
            error={access.error}
            title="Couldn’t load access"
            onRetry={() => void access.refetch()}
          />
        </Card>
      ) : !access.data ? (
        <Card
          as="section"
          aria-labelledby={`${idPrefix}-mode`}
          data-testid="access-mode-card"
          header={<CardHead id={`${idPrefix}-mode`} title="Access mode" description={SENTENCE_MANAGE} />}
        >
          <div className={styles.skeletonFrame}>
            {showSkeleton ? <Skeleton kind="lines" rows={3} label="Loading access" /> : null}
          </div>
        </Card>
      ) : (
        // A save (or a refetch with new data) remounts the body, so the draft starts from the server's state.
        <AccessBody
          key={accessSignature(access.data.access_mode, toRows(access.data.grants))}
          slug={slug}
          dataset={dataset}
          data={access.data}
          archived={archived}
          onDirtyChange={onDirtyChange}
        />
      )}
    </div>
  );
}

function AccessBody({
  slug,
  dataset,
  data,
  archived,
  onDirtyChange,
}: {
  slug: string;
  dataset: Dataset;
  data: DatasetAccess;
  archived: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const save = useSaveDatasetAccess(slug, dataset.slug);
  const toast = useToast();
  const editable = data.can_manage_access && !archived;
  const savedRows = useMemo(() => toRows(data.grants), [data.grants]);
  const [mode, setMode] = useState<DatasetAccessMode>(data.access_mode);
  const [rows, setRows] = useState<Row[]>(savedRows);
  const [who, setWho] = useState<Key | null>(null);
  const [newLevel, setNewLevel] = useState<GrantLevel>('view');
  const [failed, setFailed] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const dirty = accessSignature(mode, rows) !== accessSignature(data.access_mode, savedRows);
  const restricted = mode === 'restricted';

  // The page guards the tab strip while there are unsaved edits (QA5-62).
  useEffect(() => {
    onDirtyChange?.(editable && dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, editable, onDirtyChange]);

  const pool = useMemo(() => {
    const byId = new Map<string, AccessPerson>();
    for (const p of data.candidates) byId.set(p.id, p);
    for (const g of data.grants) byId.set(g.user.id, g.user);
    const taken = new Set(rows.map((r) => r.person.id));
    return [...byId.values()].filter((p) => !taken.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.candidates, data.grants, rows]);

  async function onSave() {
    setFailed(false);
    try {
      await save.mutateAsync({
        access_mode: mode,
        grants: rows.map((r) => ({ user_id: r.person.id, level: r.level })),
      });
      toast.show('Access saved', { tone: 'success' });
    } catch (e) {
      setFailed(true);
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Couldn’t save access', { tone: 'error' });
    }
  }

  function discard() {
    setMode(data.access_mode);
    setRows(savedRows);
    setWho(null);
    setFailed(false);
  }

  function addPerson() {
    const person = pool.find((p) => p.id === who);
    if (!person) return;
    // a person removed in this session and added back is the same saved grant again
    const saved = savedRows.find((r) => r.person.id === person.id);
    setRows([
      ...rows,
      saved ? { ...saved, level: newLevel } : { person, level: newLevel, grantedBy: null, createdAt: null },
    ]);
    setWho(null);
    setFailed(false);
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
    setFailed(false);
  }

  const sentence = archived
    ? 'This project is archived.'
    : editable
      ? SENTENCE_MANAGE
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
            onChange={(level) => {
              setRows(rows.map((x) => (x.person.id === r.person.id ? { ...x, level } : x)));
              setFailed(false);
            }}
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
      width: 180,
      priority: 2,
      // a saved grant whose granter was deleted reads Unknown user; a row not saved yet was added by you (QA5-40)
      cell: (r) =>
        r.grantedBy ? (
          <UserPill user={asUser(r.grantedBy)} />
        ) : (
          <span className={styles.personEmail}>{r.createdAt ? 'Unknown user' : 'You'}</span>
        ),
    },
    {
      id: 'at',
      header: 'Added',
      width: 130,
      priority: 2,
      cell: (r) =>
        r.createdAt ? (
          <span className={styles.when} data-testid="grant-added-at">
            {grantDate(r.createdAt)}
          </span>
        ) : (
          <Tag tone="warning">Not saved</Tag>
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

  const savedCount = savedRows.length;
  const savedNote =
    mode === 'project' && savedCount
      ? savedCount === 1
        ? ' 1 saved grant is kept and applies again if you switch back.'
        : ` ${savedCount} saved grants are kept and apply again if you switch back.`
      : '';
  const peopleCount = rows.length === 1 ? '1 person' : `${rows.length} people`;
  const shownRestricted = editable ? restricted : data.access_mode === 'restricted';

  return (
    <>
      <Card
        as="section"
        aria-labelledby="ds-access-mode"
        data-testid="access-mode-card"
        header={
          <CardHead
            id="ds-access-mode"
            title="Access mode"
            description={sentence}
            aside={
              editable ? null : (
                <Badge
                  tone={shownRestricted ? 'neutral' : 'success'}
                  glyph={shownRestricted ? <Icon name="lock" size={12} /> : undefined}
                >
                  {shownRestricted ? 'Restricted' : 'Project-wide'}
                </Badge>
              )
            }
          />
        }
      >
        <div className={styles.modeBody}>
          {editable ? (
            <RadioGroup<DatasetAccessMode>
              label="Who can access this dataset"
              testId="access-mode"
              className={styles.modeGrid}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setFailed(false);
              }}
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
                  help: `Everyone else in the project cannot open this dataset. Its runs stay listed with item contents hidden.${savedNote}`,
                  testId: 'access-mode-restricted',
                },
              ]}
            />
          ) : (
            <dl className={styles.summary} data-testid="access-summary">
              <dt>Who has access</dt>
              <dd>{shownRestricted ? 'Only people listed below' : 'Everyone in the project'}</dd>
              <dt>Your access</dt>
              <dd>{data.your_level === 'view' ? 'View' : 'Modify'}</dd>
            </dl>
          )}
          <p className={styles.always} data-testid="access-always">
            <Icon name="lock" size={12} />
            <span>Project managers, admins and the creator always have full access.</span>
          </p>
        </div>
      </Card>

      {shownRestricted ? (
        <Card
          as="section"
          aria-labelledby="ds-access-people"
          data-testid="access-people"
          header={
            <CardHead
              id="ds-access-people"
              title="People with access"
              aside={
                <Text variant="sm" tone="muted" as="span" data-testid="access-count">
                  {peopleCount}
                </Text>
              }
            />
          }
        >
          <div className={styles.peopleBody}>
            {editable ? (
              pool.length ? (
                <div className={styles.addPerson} data-testid="access-add" ref={addRef}>
                  <div className={styles.addSelect}>
                    <Select
                      label="Add person"
                      items={pool.map((p) => ({ key: p.id, label: p.name, description: p.email }))}
                      value={who}
                      onChange={setWho}
                      placeholder="Choose a project member"
                      width="100%"
                    />
                  </div>
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
              )
            ) : null}
            {rows.length ? (
              table
            ) : (
              <Note tone="warning" title="No one is listed" data-testid="access-empty-note">
                <span>Only project managers, admins and the creator can open this dataset.</span>
              </Note>
            )}
          </div>
        </Card>
      ) : null}

      {editable ? (
        <div
          className={styles.saveBar}
          data-testid="access-save-bar"
          data-state={save.isPending ? 'saving' : failed ? 'failed' : dirty ? 'dirty' : 'clean'}
        >
          <span
            className={styles.saveStatus}
            data-part="status"
            aria-live="polite"
            data-tone={failed ? 'error' : undefined}
          >
            {save.isPending ? 'Saving' : failed ? 'Couldn’t save access' : dirty ? 'Unsaved changes' : 'No changes'}
          </span>
          <div className={styles.saveActions}>
            <Button variant="neutral" isDisabled={!dirty || save.isPending} onPress={discard}>
              Discard
            </Button>
            <Button variant="primary" isDisabled={!dirty} loading={save.isPending} onPress={() => void onSave()}>
              Save access
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
