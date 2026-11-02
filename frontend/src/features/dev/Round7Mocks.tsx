/**
 * Round 7 QA mocks (design stage): static visual contracts for docs/internal/ui-migration/redesign7/qa.md.
 * Primitives and tokens only; nothing here reads the API. The "current" frames are the shipped components, the
 * "specified" frames apply the recipe the spec asks for (Round7Mocks.module.css holds it, ready to be moved).
 * Cases: r7-edge-runs (Q1), r7-edge-items (D3), r7-keys-long, r7-keys-rtl (D2), r7-metric-facts (D2).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  CopyButton,
  DataTable,
  Icon,
  IconButton,
  KeyTree,
  ScoreBar,
  Tag,
  allPaths as keyPaths,
  type Column,
} from '@/ui';
import { EXPANDED_ROWS, TableMock } from './Round4Mocks';
import styles from './Round7Mocks.module.css';

/* ───────────────────────────── fixtures ───────────────────────────── */

/** Keys of exactly 10, 40 and 80 characters, snake_case and camelCase (the seed's keys). */
const K10 = 'confidence';
const K40 = 'customer_eligibility_assessment_result_a';
const K80 = 'customer_eligibility_assessment_result_after_policy_review_step_with_exceptionsx';
const C40 = 'retrievedPolicyDocumentIdentifiersUsedTo';
const C80 = 'retrievedPolicyDocumentIdentifiersUsedToGroundTheFinalAnswerTextAfterRerankRetri';
const DEEP = 'tool_call_arguments_serialized_as_json_string';

interface Node {
  key: string;
  /** The scalar's value: its one-line preview while collapsed, the value itself when open. */
  preview?: string;
  /** The type summary of an object or array ("object · 2 keys"). */
  type?: string;
  children?: Node[];
}

const EN_TREE: Node[] = [
  {
    key: 'reasoning',
    preview: 'Looked up the clause then summarised it, citing the threshold and the exception.',
  },
  { key: K10, preview: '0.91' },
  { key: K40, preview: 'eligible' },
  {
    key: C40,
    type: 'array · 2 items',
    children: [
      { key: '[0]', preview: 'policy-handbook.pdf' },
      { key: '[1]', preview: 'faq.md' },
    ],
  },
  {
    key: K80,
    preview: 'The customer is eligible for the fast track because the existing-customer exception applies.',
  },
  {
    key: 'plan',
    type: 'object · 1 key',
    children: [
      {
        key: 'steps',
        type: 'object · 1 key',
        children: [
          {
            key: 'step_one',
            type: 'object · 2 keys',
            children: [
              { key: DEEP, preview: '{"q":"capital"}' },
              {
                key: 'retry_policy_with_exponential_backoff_and_jitter_settings',
                type: 'object · 1 key',
                children: [{ key: 'max', preview: '3' }],
              },
            ],
          },
        ],
      },
    ],
  },
  { key: C80, preview: '{ "source": "wiki", "page": 3 }' },
];

const AR_TREE: Node[] = [
  { key: 'السبب', preview: 'حللت السؤال أولاً ثم استرجعت المستندات المتعلقة بالتمويل العقاري' },
  { key: 'reasoning', preview: 'الاستدلال: الإجابة تذكر الحد الأدنى للموافقة لكنها لا تذكر الاستثناء' },
  { key: 'تحليل_أهلية_العميل_بعد_مراجعة_السياسة_والاستثناءات_المطبقة_على_الشريحة', preview: 'مؤهل' },
  {
    key: 'الخطة',
    type: 'object · 1 key',
    children: [
      {
        key: 'الخطوات',
        type: 'object · 1 key',
        children: [
          {
            key: 'الخطوة_الأولى',
            type: 'object · 1 key',
            children: [{ key: 'المعاملات_الطويلة_جداً_للأداة_المستدعاة_بصيغة_نصية', preview: 'بحث' }],
          },
        ],
      },
    ],
  },
  { key: K40, preview: 'eligible' },
  { key: 'confidence', preview: '0.82' },
];

/* ───────────────────────────── D2: the specified key tree ───────────────────────────── */

function isRtlText(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

const dirOf = (s: string) =>
  isRtlText(s) ? ({ dir: 'rtl', lang: 'ar' } as const) : ({ dir: 'auto' } as const);

function KeyRow({ node, depth, openAll }: { node: Node; depth: number; openAll: boolean }) {
  const nested = !!node.children?.length;
  const open = openAll;
  const valueText = nested ? (node.type ?? '') : (node.preview ?? '');
  return (
    <div className={styles.row} data-depth={depth} data-open={open ? '' : undefined}>
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className={styles.chevron} />
          <span className={styles.line}>
            <span className={styles.key} data-part="key" {...dirOf(node.key)}>
              {node.key}
            </span>
            {nested ? (
              <span className={styles.value} data-part="type" dir="ltr">
                {valueText}
              </span>
            ) : !open ? (
              <span className={styles.value} data-part="value" {...dirOf(valueText)}>
                {valueText}
              </span>
            ) : null}
          </span>
        </button>
        {open ? (
          <span className={styles.actions} data-part="actions">
            {nested ? (
              <>
                <Button size="sm" variant="ghost" aria-label={`Expand all in ${node.key}`}>
                  Expand all
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Collapse all in ${node.key}`}>
                  Collapse all
                </Button>
              </>
            ) : null}
            <CopyButton text={node.key} label={`Copy ${node.key}`} />
          </span>
        ) : null}
      </div>
      {open ? (
        <div className={styles.body}>
          {nested ? (
            node.children!.map((c) => <KeyRow key={c.key} node={c} depth={depth + 1} openAll={openAll} />)
          ) : (
            <div className={styles.leaf} {...dirOf(node.preview ?? '')}>
              {node.preview}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SpecTree({ nodes, label, openAll = false }: { nodes: Node[]; label: string; openAll?: boolean }) {
  return (
    <div className={styles.keys} role="group" aria-label={label} data-keytree="">
      {nodes.map((n) => (
        <KeyRow key={n.key} node={n} depth={0} openAll={openAll} />
      ))}
    </div>
  );
}

/** The shipped KeyTree on the same data, for the before / after pair. */
function toValue(nodes: Node[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of nodes) {
    if (n.children) {
      const kids = toValue(n.children);
      out[n.key] = n.type?.startsWith('array') ? Object.values(kids) : kids;
    } else out[n.key] = n.preview ?? '';
  }
  return out;
}

function CurrentTree({ nodes, openAll }: { nodes: Node[]; openAll: boolean }) {
  const prefix = 'cur';
  const value = toValue(nodes);
  // openAll: every key open (the shipped tree's own Expand all); otherwise the default, every key collapsed
  const [open, setOpen] = useState(() => new Set(openAll ? keyPaths(value, prefix) : []));
  return <KeyTree value={value} idPrefix={prefix} open={open} onOpenChange={setOpen} />;
}

function Pair({
  title,
  detail,
  current,
  specified,
}: {
  title: string;
  detail?: string;
  current: ReactNode;
  specified: ReactNode;
}) {
  return (
    <>
      <p className={styles.label}>Current: {title}</p>
      <div className={styles.detail}>{current}</div>
      <p className={styles.label} data-kind="spec">
        Specified: {title}
      </p>
      <div className={styles.detail}>{specified}</div>
      {detail ? <p className={styles.note}>{detail}</p> : null}
    </>
  );
}

/* ───────────────────────────── D2: Expected (sections) and tags ───────────────────────────── */

function Section({ name, summary, rtl }: { name: string; summary?: string; rtl?: boolean }) {
  return (
    <div className={styles.section} role="group" aria-label={name} data-kind="string">
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded="false">
          <Icon name="chevron-right" size={12} className={styles.chevron} />
          <span className={styles.line}>
            <span className={styles.sectionKey} data-part="key" dir={rtl ? 'rtl' : 'auto'}>
              {name}
            </span>
            {summary ? (
              <span className={styles.value} data-part="value" dir="auto">
                {summary}
              </span>
            ) : null}
          </span>
        </button>
        <span className={styles.actions} data-part="actions">
          <CopyButton text={name} label={`Copy ${name}`} />
        </span>
      </div>
    </div>
  );
}

function SpecSections() {
  return (
    <div role="group" aria-label="Expected output (specified)">
      <Section name="reasoning" summary="Eligible under 4.2" />
      <Section name={K40} summary="eligible" />
      <Section name={K80} summary="array, 1 item" />
      <Section name="تحليل_أهلية_العميل_بعد_مراجعة_السياسة_والاستثناءات_المطبقة" summary="مؤهل" rtl />
    </div>
  );
}

function SpecTags() {
  const pairs: Array<[string, string]> = [
    [K40, 'segment-a'],
    [C40, 'region-1'],
    ['تصنيف_العميل_حسب_الشريحة_المعتمدة', 'ذهبي'],
  ];
  return (
    <div className={styles.tags} role="group" aria-label="Tags (specified)">
      {pairs.map(([k, v]) => (
        <Tag key={k} kind="data">
          <span className={styles.tagKey} data-part="key" dir="auto">
            {k}
          </span>
          {': '}
          <span className={styles.tagValue} data-part="value" dir="auto">
            {v}
          </span>
        </Tag>
      ))}
    </div>
  );
}

/* ───────────────────────────── D2: metric facts ───────────────────────────── */

/** Judge keys as written (round 7 decision 2: a data key is never reformatted, uppercased or cut). */
const FACTS: Array<[string, string, boolean?]> = [
  ['confidence', '0.82', true],
  [K40, '0.9', true],
  [K80, 'stable across the three rescored samples'],
  [C40, '4', true],
  ['self_consistency_check_result_across_rescored_samples', 'agree'],
];

const AR_FACTS: Array<[string, string, boolean?]> = [
  ['الثقة', '0.8', true],
  ['تحليل_أهلية_العميل_بعد_مراجعة_السياسة_والاستثناءات', 'مؤهل'],
  ['الشرح', 'درجة جيدة مع نقص في الاستثناءات'],
];

function Facts({ rows, label }: { rows: Array<[string, string, boolean?]>; label: string }) {
  return (
    <dl className={styles.facts} data-part="facts" aria-label={label}>
      {rows.map(([k, v, mono]) => (
        <div key={k} className={styles.fact}>
          <dt data-part="key">
            <span {...dirOf(k)}>{k}</span>
          </dt>
          <dd data-part="value" data-mono={mono ? '' : undefined} {...dirOf(v)}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MetricPanelMock({ rtl }: { rtl?: boolean }) {
  return (
    <div className={styles.panel} data-testid="metric-detail" aria-label="schema_judge details (specified)">
      <div className={styles.metaBody} data-part="detail-body">
        <div className={styles.prose} data-part="prose">
          <div className={styles.eyebrow} data-part="eyebrow">
            {rtl ? 'الاستدلال' : 'Detailed reasoning trace of the self consistency check'}
          </div>
          <div
            className={styles.proseText}
            data-part="prose-text"
            data-primary=""
            {...dirOf(rtl ? 'الاستدلال: الإجابة مكتملة' : 'x')}
          >
            {rtl
              ? 'الاستدلال: الإجابة مكتملة وتذكر الحد الأدنى للموافقة'
              : 'Three of three re-scored samples agree within 0.05, so the judge was stable.'}
          </div>
        </div>
        <Facts rows={rtl ? AR_FACTS : FACTS} label={rtl ? 'Judge metadata (Arabic)' : 'Judge metadata'} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Q1: the runs table ───────────────────────────── */

function RunsEdge({ specified }: { specified?: boolean }) {
  return (
    <div
      className={specified ? styles.specified : undefined}
      data-r7-case={specified ? 'runs-specified' : 'runs-current'}
    >
      <TableMock
        ariaLabel={specified ? 'Runs (specified)' : 'Runs (current)'}
        rows={EXPANDED_ROWS}
        open={new Set(['b'])}
        stripOn="b::pass3"
        scrollTo={560}
      />
    </div>
  );
}

/* ───────────────────────────── D3: the items table with an expanded item ───────────────────────────── */

interface ItemRow {
  id: string;
  n: number;
  status: 'Fail' | 'Pass';
  input: string;
  m: [number, number];
  latency: string;
}

const ITEMS: ItemRow[] = Array.from({ length: 6 }, (_, i) => ({
  id: `i${i + 1}`,
  n: i + 1,
  status: i % 3 === 0 ? 'Fail' : 'Pass',
  input: `Question ${i}: is the customer eligible under clause ${i} of the policy handbook?`,
  m: [0.4 + (i % 4) * 0.15, 0.9 - (i % 3) * 0.2],
  latency: `${(0.7 + i * 0.13).toFixed(1)}s`,
}));

function ItemDetail() {
  return (
    <div className={styles.detail}>
      <div className={styles.itemBar}>
        <span className={styles.itemNum}>#2</span>
        <Tag tone="danger">Fail</Tag>
        <span className={styles.itemPreview}>Question 1: is the customer eligible under clause 1?</span>
        <span className={styles.itemActions}>
          <CopyButton text="link" icon="link" label="Copy link" />
          <Button size="sm" variant="neutral" iconEnd={<Icon name="chevron-up" size={14} />}>
            Collapse
          </Button>
        </span>
      </div>
      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Input</span>
        <span className={styles.fieldValue}>Question 1: is the customer eligible under clause 1?</span>
      </div>
      <div className={styles.regionHead}>
        <span className={styles.regionTitle}>Output</span>
        <span className={`${styles.muted} ${styles.mono}`}>700ms · 3 keys</span>
        <span className={styles.itemActions}>
          <Button size="sm" variant="ghost">
            Expand all
          </Button>
          <Button size="sm" variant="ghost">
            Collapse all
          </Button>
        </span>
      </div>
      <SpecTree nodes={EN_TREE.slice(0, 3)} label="Output (specified)" />
    </div>
  );
}

function ItemsEdge({ specified }: { specified?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const sc = host.current?.querySelector<HTMLElement>('[data-dt-scroller]');
      if (sc) sc.scrollLeft = 260;
    }, 400);
    return () => window.clearTimeout(id);
  }, []);
  const columns: Column<ItemRow>[] = [
    {
      id: 'index',
      header: '#',
      type: 'number',
      width: 64,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (r) => `#${r.n}`,
    },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      priority: 1,
      cell: (r) => <Tag tone={r.status === 'Fail' ? 'danger' : 'success'}>{r.status}</Tag>,
    },
    { id: 'input', header: 'Input', flex: true, minWidth: 260, wrap: 2, priority: 1, cell: (r) => r.input },
    { id: 'reason', header: 'Reason · quality', width: 260, priority: 3, cell: () => 'Covers most points' },
    ...(['quality', 'json_valid', 'schema_judge'] as const).map((m, i): Column<ItemRow> => ({
      id: m,
      header: m,
      group: 'Metrics',
      type: 'score',
      width: 150,
      priority: 2,
      cell: (r) => <ScoreBar value={r.m[i % 2]!} type="percentage" direction="maximize" error={null} />,
    })),
    {
      id: 'latency',
      header: 'Latency',
      group: 'System',
      type: 'duration',
      width: 110,
      priority: 2,
      cell: (r) => r.latency,
    },
    {
      id: 'trace',
      header: 'Trace',
      hideLabel: true,
      width: 48,
      pin: 'end',
      resizable: false,
      hideable: false,
      cell: () => <IconButton label="Open trace" icon="list" />,
    },
  ];
  return (
    <div
      ref={host}
      className={specified ? styles.specified : undefined}
      data-r7-case={specified ? 'items-specified' : 'items-current'}
    >
      <DataTable<ItemRow>
        aria-label={specified ? 'Items (specified)' : 'Items (current)'}
        columns={columns}
        rows={ITEMS}
        rowKey={(r) => r.id}
        density="regular"
        densityLocked
        zebra={false}
        columnMenu={false}
        stickyHeader={false}
        expanded={new Set(['i2'])}
        canExpand={(r) => r.id === 'i2'}
        expandOnRowClick
        renderExpanded={() => <ItemDetail />}
      />
    </div>
  );
}

/* ───────────────────────────── gallery wrapper ───────────────────────────── */

export function Round7Mocks({
  Section: Sec,
  Case,
}: {
  Section: (p: { id: string; title: string; children: ReactNode }) => JSX.Element;
  Case: (p: { label: string; wide?: boolean; children: ReactNode }) => JSX.Element;
}) {
  return (
    <Sec id="round7" title="Round 7 QA mocks: runs and run detail (design contract)">
      <Case
        wide
        label="r7-edge-runs (Q1: the actions boundary no longer crosses the passes strip; a 1px line on the pinned cells)"
      >
        <div className={styles.frameRuns}>
          <p className={styles.label}>Current: shade and line over the strip</p>
          <RunsEdge />
          <p className={styles.label} data-kind="spec">
            Specified: no overlay, no gradient; the line is the pinned cells' own inner edge
          </p>
          <RunsEdge specified />
        </div>
      </Case>
      <Case
        wide
        label="r7-edge-items (D3: the same rule in the items table; the line stops at the expanded item and resumes below it)"
      >
        <div className={styles.frame}>
          <p className={styles.label}>Current</p>
          <ItemsEdge />
          <p className={styles.label} data-kind="spec">
            Specified
          </p>
          <ItemsEdge specified />
        </div>
      </Case>
      <Case
        wide
        label="r7-keys-long (D2: keys of 10, 40 and 80 characters at depth 0 to 4, snake_case and camelCase; never cut)"
      >
        <div className={styles.frame}>
          <Pair
            title="Output key tree, default (every key collapsed, one-line previews)"
            current={<CurrentTree nodes={EN_TREE} openAll={false} />}
            specified={<SpecTree nodes={EN_TREE} label="Output key tree, collapsed (specified)" />}
          />
          <Pair
            title="Output key tree, Expand all (depth 0 to 4)"
            detail="Specified: the key wraps instead of ending in an ellipsis, the preview starts after the key's last line (8px) or on the next line, the Expand all / Collapse all buttons wrap under the name instead of squeezing it."
            current={<CurrentTree nodes={EN_TREE} openAll />}
            specified={<SpecTree nodes={EN_TREE} label="Output key tree, open (specified)" openAll />}
          />
          <p className={styles.label} data-kind="spec">
            Specified: Expected and Tags (decision 2 / D2-15: every key renders exactly as written, case
            included; no uppercase transform on a data key)
          </p>
          <div className={styles.detail}>
            <SpecSections />
            <p className={styles.label}>Tags</p>
            <SpecTags />
          </div>
        </div>
      </Case>
      <Case
        wide
        label="r7-keys-rtl (D2: Arabic keys and values; the key stays at the inline start, key then value in a tag)"
      >
        <div className={styles.frame}>
          <Pair
            title="Output key tree with Arabic keys, default"
            current={<CurrentTree nodes={AR_TREE} openAll={false} />}
            specified={<SpecTree nodes={AR_TREE} label="Arabic key tree, collapsed (specified)" />}
          />
          <Pair
            title="Output key tree with Arabic keys, Expand all"
            current={<CurrentTree nodes={AR_TREE} openAll />}
            specified={<SpecTree nodes={AR_TREE} label="Arabic key tree, open (specified)" openAll />}
          />
        </div>
      </Case>
      <Case wide label="r7-metric-facts (D2: the metric panel's fact labels wrap; prose labels wrap)">
        <div className={styles.frame}>
          <p className={styles.label} data-kind="spec">
            Specified: English
          </p>
          <MetricPanelMock />
          <p className={styles.label} data-kind="spec">
            Specified: Arabic
          </p>
          <MetricPanelMock rtl />
        </div>
      </Case>
    </Sec>
  );
}
