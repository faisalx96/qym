import { PerformanceDownload } from '../PerformanceDownload';
/** Performance run page, Questions tab: every asked question, newest first, with filters and paging. */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  isPerformanceRunActive,
  performanceQuestionsCsvUrl,
  usePerformanceQuestions,
  type PerformanceQuestionFilters,
  type PerformanceQuestionRow,
  type PerformanceRunRead,
  type PerformanceTier,
} from '@/api/performance';
import { textDirAttrs } from '@/lib/text';
import { useSearchParamsState } from '@/lib/url-state';
import {
  ClearFiltersButton,
  DataTable,
  EmptyState,
  Icon,
  InlineNotice,
  KeyValueGrid,
  MultiSelect,
  SearchField,
  StateTag,
  Text,
  TextBlock,
  type Column,
  type StateTagTone,
} from '@/ui';
import { KINDS, KIND_NAME, clock, count, plus, secs } from '../../lib/format';
import { KindTag } from '../shared';
import { useSettled } from './hooks';
import styles from './run.module.css';

export const QUESTIONS_PAGE_SIZE = 50;

type QuestionStatus = PerformanceQuestionRow['status'];
const RESULTS: { key: QuestionStatus; label: string }[] = [
  { key: 'ok', label: 'OK' },
  { key: 'error', label: 'Failed' },
  { key: 'interrupted', label: 'Cut off' },
];

/** How one answer ended, in the words of the Result column. */
export function questionResult(row: PerformanceQuestionRow, limitMs: number): [StateTagTone, string] {
  if (row.status === 'interrupted') return ['neutral', 'Cut off'];
  if (row.status === 'error')
    return row.error_kind === 'auth'
      ? ['warning', 'Sign-in error']
      : row.error_kind === 'network'
        ? ['danger', 'Timeout']
        : row.error_kind === 'rate_limit'
          ? ['danger', 'Rate limit']
          : ['danger', 'Server error'];
  if (row.duration_ms >= limitMs) return ['warning', 'Slow'];
  return row.no_data ? ['neutral', 'No data'] : ['success', 'OK'];
}

const answeredAt = (row: PerformanceQuestionRow) => clock(plus(row.asked_at, row.duration_ms / 1000));

function questionColumns(limitMs: number): Column<PerformanceQuestionRow>[] {
  return [
    { id: 'seq', header: 'No.', type: 'number', width: 64, cell: (r) => `#${r.seq}` },
    {
      id: 'answered',
      header: 'Answered',
      hint: 'When the answer finished.',
      width: 92,
      cell: (r) => <span className={styles.figures}>{answeredAt(r)}</span>,
    },
    { id: 'level', header: 'Level', width: 64, align: 'center', mono: true, cell: (r) => r.level ?? '–' },
    {
      id: 'kind',
      header: 'Kind',
      width: 168,
      cell: (r) => (
        <span className={styles.row}>
          <KindTag kind={r.tier} />
          {r.is_followup ? <span className={styles.muted}>follow-up</span> : null}
        </span>
      ),
    },
    {
      id: 'question',
      header: 'Question',
      minWidth: 320,
      flex: true,
      wrap: true,
      primary: true,
      cell: (r) => <span {...textDirAttrs(r.question)}>{r.question}</span>,
    },
    {
      id: 'duration',
      header: 'Duration',
      width: 88,
      align: 'center',
      mono: true,
      cell: (r) => secs(r.duration_ms),
    },
    {
      id: 'first-byte',
      header: 'First byte',
      hint: 'Time until the first part of the answer arrived.',
      width: 92,
      align: 'center',
      mono: true,
      cell: (r) => secs(r.ttfb_ms),
    },
    {
      id: 'quality',
      header: 'Quality',
      width: 76,
      align: 'center',
      mono: true,
      cell: (r) => r.quality ?? '–',
    },
    {
      id: 'result',
      header: 'Result',
      width: 124,
      cell: (r) => {
        const [tone, word] = questionResult(r, limitMs);
        return <StateTag tone={tone}>{word}</StateTag>;
      },
    },
  ];
}

function QuestionDetail({ row, storesAnswers }: { row: PerformanceQuestionRow; storesAnswers: boolean }) {
  return (
    <div className={styles.detail} data-performance-block="question-detail">
      <KeyValueGrid
        columns={4}
        dense
        aria-label={`Question ${row.seq}`}
        items={[
          {
            key: 'asked',
            label: 'Asked',
            value: <span className={styles.figures}>{clock(row.asked_at)}</span>,
          },
          {
            key: 'answered',
            label: 'Answered',
            value: <span className={styles.figures}>{answeredAt(row)}</span>,
          },
          { key: 'by', label: 'Asked by', value: <span className={styles.figures}>User {row.user}</span> },
          { key: 'id', label: 'Question id', value: row.question_id, mono: true },
        ]}
      />
      <div className={`${styles.tight} ${styles.detailWide}`}>
        <span className={styles.label}>Question</span>
        <TextBlock text={row.question} />
      </div>
      <div className={`${styles.tight} ${styles.detailWide}`}>
        <span className={styles.label}>Answer</span>
        {row.answer === null ? (
          <p className={`${styles.text} ${styles.muted}`}>
            {storesAnswers ? 'No answer came.' : 'This run does not store answers.'}
          </p>
        ) : (
          <>
            <TextBlock text={row.answer} />
            {row.answer_truncated ? (
              <p className={styles.note}>Answer cut at {count(row.answer.length)} characters.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The filters, the search and the page of the Questions tab live in the address (D7): `?q= &kind= &level= &result= &qpage=`. */
const QUESTION_PARAMS = { q: 'q', kind: 'kind', level: 'level', result: 'result', page: 'qpage' } as const;

export function QuestionsTab({
  slug,
  runId,
  read,
  initialOpen,
}: {
  slug: string;
  runId: string;
  read: PerformanceRunRead;
  /** The `seq` of a row that is open when the tab mounts. */
  initialOpen?: number;
}) {
  const active = isPerformanceRunActive(read.effective_status);
  const { params, replaceUrlQuery } = useSearchParamsState();
  const planLevels = read.config.plan.levels;
  const search = params.get(QUESTION_PARAMS.q) ?? '';
  const page = Math.max(1, Number(params.get(QUESTION_PARAMS.page)) || 1);
  const picked = (key: string, known: readonly string[]) =>
    new Set<Key>(params.getAll(key).filter((value) => known.includes(value)));
  const kinds = picked(QUESTION_PARAMS.kind, KINDS);
  const levels = picked(QUESTION_PARAMS.level, planLevels.map(String));
  const results = picked(
    QUESTION_PARAMS.result,
    RESULTS.map((item) => item.key),
  );
  const [expanded, setExpanded] = useState<Set<Key>>(
    () => new Set(initialOpen === undefined ? [] : [initialOpen]),
  );
  const q = useSettled(search.trim(), 250);
  const narrowing: PerformanceQuestionFilters = {
    tier: KINDS.filter((kind) => kinds.has(kind)),
    level: planLevels.filter((users) => levels.has(String(users))),
    status: RESULTS.map((item) => item.key).filter((key) => results.has(key)),
    q,
  };
  const query = usePerformanceQuestions(
    slug,
    runId,
    { ...narrowing, page, page_size: QUESTIONS_PAGE_SIZE },
    { active },
  );
  const data = query.data;
  const facets = data?.facets;
  const filters = [kinds, levels, results].filter((set) => set.size > 0).length;
  const narrowed = Boolean(q) || filters > 0;
  // Every question of the run, whatever the filters: the facets count the whole run.
  const all = facets ? Object.values(facets.statuses).reduce((sum, value) => sum + value, 0) : null;
  // Why the list holds more questions than the run has answers: some were cut off, some could not be stored.
  const cutOff = facets?.statuses.interrupted ?? 0;
  const dropped = read.counts.questions_dropped;
  const aside = [
    cutOff
      ? `${count(cutOff)} ${cutOff === 1 ? 'question was' : 'questions were'} cut off: no answer had come when the run ended.`
      : '',
    dropped ? `${count(dropped)} more could not be stored.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  // A filter starts again at the first page.
  const pick = (key: string) => (keys: Set<Key>) =>
    replaceUrlQuery({ [key]: [...keys].map(String), [QUESTION_PARAMS.page]: null });
  const clear = () =>
    replaceUrlQuery({
      [QUESTION_PARAMS.q]: null,
      [QUESTION_PARAMS.kind]: null,
      [QUESTION_PARAMS.level]: null,
      [QUESTION_PARAMS.result]: null,
      [QUESTION_PARAMS.page]: null,
    });
  const onlySearch = Boolean(q) && filters === 0;
  return (
    <>
      {aside ? (
        <div data-performance-block="questions-note">
          <InlineNotice tone="info">{aside}</InlineNotice>
        </div>
      ) : null}
      <DataTable
        aria-label="Questions asked"
        columns={questionColumns(read.config.plan.limit_ms)}
        rows={data?.rows ?? []}
        rowKey={(r) => r.seq}
        rowProps={(r) => ({ 'data-performance-question': String(r.seq) })}
        rowState={(r) => (r.status === 'error' ? 'error' : undefined)}
        renderExpanded={(r) => <QuestionDetail row={r} storesAnswers={read.config.options.store_answers} />}
        expanded={expanded}
        onExpandedChange={setExpanded}
        expandLabel={(r, open) => `${open ? 'Hide' : 'Show'} the answer to question ${r.seq}`}
        loading={query.isPending}
        error={query.isError && !data ? query.error : undefined}
        onRetry={() => void query.refetch()}
        errorTitle="Couldn’t load the questions"
        isFiltered={narrowed}
        empty={
          <EmptyState
            compact
            title="No questions yet"
            body={
              active
                ? 'Every question shows here when its answer has finished.'
                : 'This run did not send a question.'
            }
          />
        }
        filteredEmpty={
          <EmptyState
            compact
            title={onlySearch ? `No questions match “${q}”` : 'No questions match these filters'}
          />
        }
        responsive="scroll"
        fit="declared"
        minWidth={1020}
      >
        <DataTable.Toolbar
          search={
            <SearchField
              label="Search questions and answers"
              placeholder="Search questions and answers"
              width="var(--search-width)"
              shortcut="/"
              value={search}
              onChange={(value) =>
                replaceUrlQuery({ [QUESTION_PARAMS.q]: value, [QUESTION_PARAMS.page]: null })
              }
            />
          }
          filters={
            <>
              <MultiSelect
                label="Kind"
                triggerVariant="bar"
                emptyMeansAll
                items={KINDS.map((kind: PerformanceTier) => ({
                  key: kind,
                  label: KIND_NAME[kind],
                  count: facets?.tiers[kind],
                }))}
                value={kinds}
                onChange={pick(QUESTION_PARAMS.kind)}
              />
              <MultiSelect
                label="Level"
                triggerVariant="bar"
                emptyMeansAll
                items={planLevels.map((users) => ({
                  key: String(users),
                  label: `${users} users`,
                  count: facets ? (facets.levels[String(users)] ?? 0) : undefined,
                }))}
                value={levels}
                onChange={pick(QUESTION_PARAMS.level)}
                isDisabled={!planLevels.length}
              />
              <MultiSelect
                label="Result"
                triggerVariant="bar"
                emptyMeansAll
                items={RESULTS.map((item) => ({ ...item, count: facets?.statuses[item.key] }))}
                value={results}
                onChange={pick(QUESTION_PARAMS.result)}
              />
              <ClearFiltersButton
                count={filters + (search.trim() ? 1 : 0)}
                onClear={clear}
                testId="performance-questions-clear"
              />
            </>
          }
          trailing={
            <>
              {active ? (
                <Text variant="sm" tone="muted">
                  Updates automatically
                </Text>
              ) : null}
              <PerformanceDownload
                href={performanceQuestionsCsvUrl(slug, runId, narrowing)}
                download
                variant="accent"
                icon={<Icon name="download" size={12} />}
              >
                Export CSV
              </PerformanceDownload>
            </>
          }
        />
        <DataTable.Footer
          filterNote={narrowed && all !== null ? `Filtered from ${count(all)} questions` : undefined}
          pagination={{
            total: data?.total ?? 0,
            page,
            pageSize: QUESTIONS_PAGE_SIZE,
            noun: 'questions',
            onPageChange: (next) => replaceUrlQuery({ [QUESTION_PARAMS.page]: next > 1 ? next : null }),
          }}
        />
      </DataTable>
    </>
  );
}
