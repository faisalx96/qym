/** /__ui DataTable v2 showcase: every feature of the primitive on sample runs. */
import { useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  DeltaCell,
  IdCell,
  ProgressCell,
  RelativeTime,
  ScoreBar,
  SearchField,
  StatusCell,
  Stack,
  TagsCell,
  TwoLine,
  UserCell,
  type Column,
  type Key,
} from '@/ui';

interface Run {
  id: string;
  name: string;
  task: string;
  model: string;
  status: string;
  exact: number | null;
  acc: number | null;
  delta: number;
  latency: number;
  tags: string[];
  owner: string;
  at: string;
  done: number;
  total: number;
}

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const RUNS: Run[] = Array.from({ length: 14 }, (_, i) => ({
  id: `run-${String(i).padStart(3, '0')}-9f3a7c21b4e8`,
  name: `text2sql-${['gpt-4o', 'claude', 'llama'][i % 3]}-${i}`,
  task: ['text2sql', 'summarize', 'rag-qa'][i % 3]!,
  model: ['gpt-4o', 'claude-sonnet', 'llama-3'][i % 3]!,
  status: ['COMPLETED', 'RUNNING', 'FAILED'][i % 3 === 1 ? 1 : i % 5 === 0 ? 2 : 0]!,
  exact: i === 4 ? null : 0.35 + ((i * 7) % 10) / 16,
  acc: 0.5 + ((i * 3) % 10) / 20,
  delta: ((i % 5) - 2) / 40,
  latency: 900 + i * 130,
  tags: ['nightly', 'v2', 'ar', 'prod'].slice(0, (i % 4) + 1),
  owner: ['Meshari', 'Sara', 'Omar'][i % 3]!,
  at: new Date(NOW - i * 3_600_000 * 7).toISOString(),
  done: i % 4 === 0 ? 3 : 10,
  total: 10,
}));

const COLUMNS: Column<Run>[] = [
  {
    id: 'name',
    header: 'Run',
    sort: 'name',
    width: 240,
    pin: 'start',
    hideable: false,
    priority: 1,
    secondary: (r) => r.task,
    cell: (r) => r.name,
  },
  {
    id: 'status',
    header: 'Status',
    sort: 'status',
    width: 120,
    priority: 1,
    cell: (r) => <StatusCell status={r.status} />,
  },
  { id: 'id', header: 'Id', type: 'id', width: 150, priority: 3, cell: (r) => <IdCell value={r.id} /> },
  { id: 'model', header: 'Model', sort: 'model', width: 130, priority: 2 },
  {
    id: 'exact',
    header: 'exact_match',
    group: 'Scores',
    type: 'score',
    sort: 'exact',
    accessor: (r) => r.exact,
    width: 150,
    priority: 2,
    cell: (r) => <ScoreBar value={r.exact} direction="higher" />,
    summary: (rows) => `avg ${(rows.reduce((n, r) => n + (r.exact ?? 0), 0) / rows.length).toFixed(2)}`,
  },
  {
    id: 'acc',
    header: 'accuracy',
    group: 'Scores',
    type: 'score',
    sort: 'acc',
    accessor: (r) => r.acc,
    width: 150,
    priority: 2,
    cell: (r) => <ScoreBar value={r.acc} direction="higher" />,
  },
  {
    id: 'delta',
    header: 'Δ vs base',
    group: 'Scores',
    type: 'delta',
    width: 110,
    cell: (r) => <DeltaCell value={r.delta} direction="higher" />,
  },
  {
    id: 'latency',
    header: 'Latency',
    group: 'System',
    type: 'duration',
    sort: 'latency',
    accessor: (r) => r.latency,
    width: 110,
    cell: (r) => (
      <ScoreBar value={r.latency} max={2800} direction="none" text={`${(r.latency / 1000).toFixed(1)} s`} />
    ),
  },
  { id: 'tags', header: 'Tags', width: 160, priority: 3, cell: (r) => <TagsCell tags={r.tags} /> },
  { id: 'owner', header: 'Owner', width: 120, cell: (r) => <UserCell name={r.owner} /> },
  {
    id: 'at',
    header: 'Date',
    type: 'date',
    sort: 'at',
    width: 110,
    priority: 2,
    cell: (r) => <RelativeTime iso={r.at} now={new Date(NOW)} />,
  },
  {
    id: 'progress',
    header: 'Progress',
    width: 150,
    defaultHidden: true,
    cell: (r) => <ProgressCell done={r.done} total={r.total} />,
  },
  {
    id: 'twoline',
    header: 'Experiment',
    width: 170,
    defaultHidden: true,
    cell: (r) => <TwoLine primary={r.task} secondary={`${r.model} · ${r.owner}`} />,
  },
];

const MANY: Run[] = Array.from({ length: 5000 }, (_, i) => ({
  ...RUNS[i % RUNS.length]!,
  id: `many-${i}`,
  name: `run-${String(i).padStart(4, '0')}`,
}));

/** 5,000 rows in a 320px card: only the visible window is mounted. */
function VirtualDemo() {
  return (
    <div style={{ maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
      <DataTable<Run>
        aria-label="Virtualized runs"
        columns={COLUMNS.filter((c) => ['name', 'status', 'acc', 'at'].includes(c.id))}
        rows={MANY}
        rowKey={(r) => r.id}
        virtualize={{ estimateRowHeight: 52 }}
        densityLocked
      />
    </div>
  );
}

export function DataTableGallery() {
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<'ready' | 'loading' | 'error' | 'empty'>('ready');
  const rows = RUNS.filter((r) => r.name.includes(q));
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Stack gap="xs">
          <Button
            onPress={() =>
              setPhase(
                phase === 'ready'
                  ? 'loading'
                  : phase === 'loading'
                    ? 'error'
                    : phase === 'error'
                      ? 'empty'
                      : 'ready',
              )
            }
          >
            State: {phase} (click to cycle)
          </Button>
        </Stack>
        <DataTable<Run>
          aria-label="Feature table"
          storageKey="gallery.v2"
          columns={COLUMNS}
          rows={phase === 'empty' ? [] : rows}
          rowKey={(r) => r.id}
          loading={phase === 'loading'}
          error={phase === 'error' ? new Error('Request failed') : undefined}
          onRetry={() => setPhase('ready')}
          empty="No runs yet"
          isFiltered={q !== ''}
          filteredEmpty={<span>No runs match “{q}”.</span>}
          selection={{
            selected,
            onChange: setSelected,
            selectAllMatching: {
              total: 43,
              onSelectAll: () => setSelected(new Set(RUNS.map((r) => r.id))),
              noun: 'runs',
            },
          }}
          bulkActions={<Button variant="danger">Delete selected</Button>}
          rowActions={(r) => [
            { id: 'open', label: 'Open', icon: 'external', primary: true, onPress: () => undefined },
            { id: 'dup', label: 'Duplicate', onPress: () => undefined },
            { id: 'del', label: `Delete ${r.name}`, danger: true, onPress: () => undefined },
          ]}
          rowState={(r) => (r.status === 'FAILED' ? 'error' : r.status === 'RUNNING' ? 'live' : undefined)}
          renderExpanded={(r) => (
            <Stack gap="xs">
              <Badge tone="neutral">Detail</Badge>
              <span>Expanded content for {r.name}</span>
            </Stack>
          )}
          density="compact"
        >
          <DataTable.Toolbar
            search={<SearchField label="Search runs" value={q} onChange={setQ} placeholder="Search runs" />}
            count={`${rows.length} runs`}
          />
          <DataTable.Footer
            summary={`1-${rows.length} of ${rows.length} runs`}
            trailing="Last updated 16:30:12"
          />
        </DataTable>
      </Stack>
      <DataTable<Run>
        aria-label="Grouped by model"
        columns={COLUMNS.filter((c) => ['name', 'exact', 'acc', 'latency'].includes(c.id))}
        rows={RUNS}
        rowKey={(r) => r.id}
        groupBy={{ key: (r) => r.model, label: (k) => k, collapsible: true }}
        zebra={false}
      />
      <DataTable<Run>
        aria-label="Reorderable columns"
        storageKey="gallery.reorder"
        reorderable
        columns={COLUMNS.map((c) => (c.id === 'name' ? { ...c, pin: 'start' as const } : c))}
        rows={RUNS.slice(0, 4)}
        rowKey={(r) => r.id}
        density="compact"
      >
        <DataTable.Toolbar columnsMenu />
      </DataTable>
      <VirtualDemo />
      <DataTable<Run>
        aria-label="Embedded"
        variant="embedded"
        columns={COLUMNS.filter((c) => ['name', 'status', 'acc'].includes(c.id))}
        rows={RUNS.slice(0, 3)}
        rowKey={(r) => r.id}
      />
    </Stack>
  );
}
