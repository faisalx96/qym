/**
 * Factory → Access: who can open, change and approve in this factory. The dataset Access tab's two cards (Access
 * mode, People with access) with one more level, approve: an approve grant counts in both modes, so the people
 * card shows in project mode too. A save (or new data) remounts the body, so the draft starts from the server.
 */
import { useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  useFactoryAccess,
  useSaveFactoryAccess,
  type AccessPerson,
  type FactoryAccess,
  type FactoryAccessMode,
  type FactoryDetail,
  type FactoryGrant,
  type FactoryGrantLevel,
} from '@/api/factory';
import { formatDay, toDate } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { CardHead } from '@/features/datasets/detail/SettingsTab';
import { SaveFooter } from '@/features/shell/settings/SettingsCard';
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  Flag,
  IconButton,
  InlineNotice,
  RadioGroup,
  Select,
  Skeleton,
  Tag,
  Text,
  UserName,
  useToast,
  type Column,
} from '@/ui';
import styles from '../FactoryDetailPage.module.css';

interface Row {
  person: AccessPerson;
  level: FactoryGrantLevel;
  grantedBy: AccessPerson | null;
  createdAt: string | null;
}

const LEVELS: { value: FactoryGrantLevel; label: string; help: string }[] = [
  { value: 'view', label: 'View', help: 'Reads the rules and the jobs' },
  { value: 'modify', label: 'Modify', help: 'Configures, writes rules, starts jobs' },
  { value: 'approve', label: 'Approve', help: 'Modify, and makes rules official' },
];
const LEVEL_LABEL: Record<string, string> = {
  view: 'View',
  modify: 'Modify',
  approve: 'Approve',
  manage: 'Manage',
};

function toRows(grants: FactoryGrant[]): Row[] {
  return grants.map((g) => ({
    person: g.user,
    level: g.level,
    grantedBy: g.granted_by,
    createdAt: g.created_at,
  }));
}

export function signature(mode: FactoryAccessMode, rows: Pick<Row, 'person' | 'level'>[]): string {
  return `${mode}|${rows
    .map((r) => `${r.person.id}:${r.level}`)
    .sort()
    .join(',')}`;
}

const SENTENCE = 'Choose who in this project can open this factory, change it and approve its rules.';

export function FactoryAccessTab({ factory, readOnly }: { factory: FactoryDetail; readOnly: boolean }) {
  const access = useFactoryAccess(factory.id);
  const showSkeleton = useDelayedPending(access.isPending);
  const head = <CardHead id="factory-access-mode" title="Access mode" description={SENTENCE} />;
  if (access.isError)
    return (
      <Card as="section" aria-labelledby="factory-access-mode" header={head}>
        <ErrorState
          compact
          error={access.error}
          title="Couldn’t load access"
          onRetry={() => void access.refetch()}
        />
      </Card>
    );
  if (!access.data)
    return (
      <Card as="section" aria-labelledby="factory-access-mode" header={head}>
        {showSkeleton ? <Skeleton kind="lines" rows={3} label="Loading access" /> : null}
      </Card>
    );
  return (
    <AccessBody
      key={signature(access.data.access_mode, toRows(access.data.grants))}
      factory={factory}
      data={access.data}
      readOnly={readOnly}
    />
  );
}

function AccessBody({
  factory,
  data,
  readOnly,
}: {
  factory: FactoryDetail;
  data: FactoryAccess;
  readOnly: boolean;
}) {
  const save = useSaveFactoryAccess(factory.id);
  const toast = useToast();
  const editable = data.can_manage_access && !readOnly;
  const savedRows = useMemo(() => toRows(data.grants), [data.grants]);
  const [mode, setMode] = useState<FactoryAccessMode>(data.access_mode);
  const [rows, setRows] = useState<Row[]>(savedRows);
  const [who, setWho] = useState<Key | null>(null);
  const [newLevel, setNewLevel] = useState<FactoryGrantLevel>('view');
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const dirty = signature(mode, rows) !== signature(data.access_mode, savedRows);

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
      toast.show(actionErrorMessage('save access', e), { tone: 'error' });
    }
  }

  function addPerson() {
    const person = pool.find((p) => p.id === who);
    if (!person) return;
    const saved = savedRows.find((r) => r.person.id === person.id);
    setRows([
      ...rows,
      saved ? { ...saved, level: newLevel } : { person, level: newLevel, grantedBy: null, createdAt: null },
    ]);
    setWho(null);
  }

  const columns: Column<Row>[] = [
    {
      id: 'person',
      header: 'Person',
      flex: true,
      minWidth: 200,
      priority: 1,
      cardTitle: true,
      cell: (r) => <UserName id={r.person.id} name={r.person.name} email={r.person.email} showEmail />,
    },
    {
      id: 'level',
      header: 'Level',
      width: 170,
      priority: 1,
      cell: (r) =>
        editable && editingLevel === r.person.id ? (
          <Select
            label={`Level for ${r.person.name}`}
            hideLabel
            items={LEVELS.map((o) => ({ key: o.value, label: o.label, description: o.help }))}
            value={r.level}
            defaultOpen
            autoFocus
            width={130}
            searchable={false}
            onOpenChange={(open) => {
              if (!open) setEditingLevel(null);
            }}
            onChange={(k) => {
              if (!k) return;
              setRows(
                rows.map((x) => (x.person.id === r.person.id ? { ...x, level: k as FactoryGrantLevel } : x)),
              );
              setEditingLevel(null);
            }}
          />
        ) : (
          <Tag
            kind="role"
            tone={r.level === 'approve' ? 'success' : r.level === 'modify' ? 'accent' : undefined}
          >
            {LEVEL_LABEL[r.level]}
          </Tag>
        ),
    },
    {
      id: 'by',
      header: 'Added by',
      width: 170,
      priority: 2,
      cell: (r) =>
        r.grantedBy ? (
          <UserName id={r.grantedBy.id} name={r.grantedBy.name} email={r.grantedBy.email} />
        ) : (
          <span className={styles.muted}>{r.createdAt ? 'Unknown user' : 'You'}</span>
        ),
    },
    {
      id: 'at',
      header: 'Added',
      width: 130,
      priority: 2,
      cell: (r) =>
        r.createdAt ? (
          toDate(r.createdAt) ? (
            formatDay(r.createdAt)
          ) : (
            r.createdAt
          )
        ) : (
          <Tag tone="warning">Not saved</Tag>
        ),
    },
    ...(editable
      ? [
          {
            id: 'remove',
            header: 'Actions',
            hideLabel: true,
            width: 72,
            priority: 1,
            cell: (r: Row) => (
              <span className={styles.rowActions}>
                <IconButton
                  tile
                  icon="edit"
                  label={`Change the level of ${r.person.name}`}
                  onPress={() => setEditingLevel(r.person.id)}
                />
                <IconButton
                  tile
                  tone="danger"
                  icon="ban"
                  label={`Remove ${r.person.name}`}
                  onPress={() => setRows(rows.filter((x) => x.person.id !== r.person.id))}
                />
              </span>
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ];

  const sentence =
    readOnly && !data.can_manage_access
      ? 'This project is read-only for you.'
      : editable
        ? SENTENCE
        : 'Only project managers and admins can change who has access.';
  const restricted = editable ? mode === 'restricted' : data.access_mode === 'restricted';
  const saveFooter = editable ? (
    <SaveFooter
      dirty={dirty}
      saving={save.isPending}
      onSave={() => void onSave()}
      secondary={
        <Button
          variant="neutral"
          isDisabled={!dirty || save.isPending}
          disabledReason="No changes to discard"
          onPress={() => {
            setMode(data.access_mode);
            setRows(savedRows);
            setWho(null);
          }}
        >
          Discard
        </Button>
      }
    />
  ) : null;
  const peopleCount = rows.length === 1 ? '1 person' : `${rows.length} people`;

  return (
    <div className={styles.tab} data-testid="factory-access-tab">
      <Card
        as="section"
        aria-labelledby="factory-access-mode"
        header={
          <CardHead
            id="factory-access-mode"
            title="Access mode"
            description={sentence}
            aside={
              editable ? null : (
                <Flag icon={restricted ? 'lock' : undefined}>
                  {restricted ? 'Restricted' : 'Project-wide'}
                </Flag>
              )
            }
          />
        }
      >
        <div className={styles.cardBody}>
          {editable ? (
            <RadioGroup<FactoryAccessMode>
              label="Who can access this factory"
              testId="factory-access-mode"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'project',
                  title: 'Everyone in the project',
                  help: 'Every member reads and modifies the factory. Only the people listed below with Approve (and managers) make rules official.',
                  testId: 'factory-access-project',
                },
                {
                  value: 'restricted',
                  title: 'Only people listed below',
                  help: 'Everyone else in the project cannot open this factory. The person who connected the dataset keeps Modify.',
                  testId: 'factory-access-restricted',
                },
              ]}
            />
          ) : (
            <dl className={styles.summary} data-testid="factory-access-summary">
              <dt>Who has access</dt>
              <dd>{restricted ? 'Only people listed below' : 'Everyone in the project'}</dd>
              <dt>Your access</dt>
              <dd>{LEVEL_LABEL[data.your_level]}</dd>
            </dl>
          )}
          <InlineNotice tone="neutral" icon="lock">
            Project managers and admins always have full access and approve rules.
          </InlineNotice>
        </div>
      </Card>
      <Card
        as="section"
        aria-labelledby="factory-access-people"
        header={
          <CardHead
            id="factory-access-people"
            title={restricted ? 'People with access' : 'People who approve rules'}
            count={<Tag kind="count">{peopleCount}</Tag>}
          />
        }
      >
        <div className={styles.cardBody}>
          {editable ? (
            pool.length ? (
              <div className={styles.addPerson} data-testid="factory-access-add">
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
                <Select
                  label="Level"
                  items={LEVELS.map((o) => ({ key: o.value, label: o.label, description: o.help }))}
                  value={newLevel}
                  onChange={(k) => {
                    if (k) setNewLevel(k as FactoryGrantLevel);
                  }}
                  searchable={false}
                  width={170}
                />
                <Button
                  variant="neutral"
                  isDisabled={who === null}
                  disabledReason="Pick a person first"
                  onPress={addPerson}
                >
                  Add person
                </Button>
              </div>
            ) : (
              <Text variant="sm" tone="muted" as="p">
                Everyone in the project is listed already.
              </Text>
            )
          ) : null}
          {rows.length ? (
            <DataTable<Row>
              aria-label="People with access"
              variant="embedded"
              density="regular"
              densityLocked
              rows={rows}
              rowKey={(r) => r.person.id}
              columns={columns}
            />
          ) : (
            <Text variant="sm" tone="muted" as="p" data-testid="factory-access-empty">
              {restricted
                ? 'No one is listed: only managers, admins and the person who connected the dataset can open this factory.'
                : 'No one is listed: only managers and admins make rules official.'}
            </Text>
          )}
          {saveFooter}
        </div>
      </Card>
    </div>
  );
}
