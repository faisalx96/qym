/**
 * Upload of a question file, part 2: which field is what (a first guess from the field names), what each
 * value of the kind field means, and the result in the one shape a run reads: `item_id`, `input`,
 * `metadata.tier`, `metadata.follow_up`, `metadata.must_not_contain`, `metadata.follow_up_must_not_contain`.
 */
import type { PerformanceCheckTone, PerformanceTier } from '@/api/performance';
import { GROUP_FIELD, type UploadData } from './read';

export type UploadRole = 'question' | 'kind' | 'follow_up' | 'avoid' | 'id';
/** The field of each role; '' when the role has none. */
export type UploadMap = Record<UploadRole, string>;
/** What a value of the kind field means. */
export type KindChoice = PerformanceTier | 'leave_out';

export const UPLOAD_ROLES: { key: UploadRole; label: string; hint: string; none: string | null }[] = [
  { key: 'question', label: 'Question', hint: 'Needed', none: null },
  { key: 'kind', label: 'Kind', hint: 'Simple, medium or complex', none: 'Not in the file' },
  {
    key: 'follow_up',
    label: 'Follow-up question',
    hint: 'Asked next in the same conversation',
    none: 'None',
  },
  { key: 'avoid', label: 'Words to avoid', hint: 'A good answer does not contain them', none: 'None' },
  { key: 'id', label: 'Id', hint: 'Shown in the questions table and the log', none: 'Number them' },
];

const KINDS: PerformanceTier[] = ['simple', 'medium', 'complex'];

const KIND_WORDS: [PerformanceTier, RegExp][] = [
  ['simple', /^(simple|easy|low|basic|beginner|1|s|بسيط|بسيطة|سهل)$/i],
  ['medium', /^(medium|normal|moderate|mid|middle|intermediate|2|m|متوسط|متوسطة)$/i],
  ['complex', /^(complex|hard|high|advanced|difficult|3|c|معقد|معقدة|صعب)$/i],
];

const norm = (value: unknown) => String(value ?? '').trim();
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The kind a value names ('easy', 'hard', '2', 'معقد'), or '' when it is not recognised. */
export function kindOfValue(value: unknown): PerformanceTier | '' {
  const word = norm(value);
  return KIND_WORDS.find(([, pattern]) => pattern.test(word))?.[0] ?? '';
}

/** The last part of a dotted field name: 'ask.text' -> 'text', 'followUpQuestions[0].question' -> 'question'. */
const lastPart = (field: string) => field.slice(field.lastIndexOf('.') + 1);
/** A field inside a follow-up ('followUpQuestions[0].question'): never the question, its id, kind or words to avoid. */
const inFollowUp = (field: string) => /follow.?up/i.test(field);

/**
 * A first guess of the field of each role, from the field names and what the fields hold. The rules are tried on
 * the whole name first ('question', 'input.question'), then on the last part of a nested one ('ask.text').
 */
export function guessFields(data: UploadData): UploadMap {
  const isText = (field: string) => data.rows.some((row) => typeof row[field] === 'string');
  const any = () => true;
  const pick = (patterns: RegExp[], ok: (field: string) => boolean, taken: string[]) => {
    const usable = data.fields.filter((name) => name !== GROUP_FIELD && ok(name) && !taken.includes(name));
    for (const nameOf of [(field: string) => field, lastPart])
      for (const pattern of patterns) {
        const field = usable.find((name) => pattern.test(nameOf(name)));
        if (field) return field;
      }
    return '';
  };
  const own = (ok: (field: string) => boolean) => (field: string) => ok(field) && !inFollowUp(field);
  const question = pick(
    [/^(input\.)?(question|prompt|query)$/i, /^(input|text|q|content)$/i, /question|prompt|سؤال/i],
    own(isText),
    [],
  );
  const follow_up = pick(
    [/^(metadata\.)?follow[_ -]?up([_ -]?question)?$/i, /follow.?up.*question$/i, /follow.?up|second|next/i],
    isText,
    [question],
  );
  const avoid = pick([/^(metadata\.)?must[_ -]?not[_ -]?contain$/i, /must.?not/i], own(any), [
    question,
    follow_up,
  ]);
  const id = pick([/^(item_id|id|example_id)$/i, /^(no\.?|#)$|(^|[_. ])id$/i], own(any), [
    question,
    follow_up,
    avoid,
  ]);
  let kind = pick(
    [/^(metadata\.)?(tier|level|difficulty|complexity|kind)$/i, /tier|level|difficult|complex/i],
    own(any),
    [question, follow_up, avoid, id],
  );
  const groups = data.info.groups;
  if (groups && (!kind || groups.every((name) => kindOfValue(name)))) kind = GROUP_FIELD;
  return { question, kind, follow_up, avoid, id };
}

/** The values of the kind field with how many records have each, in the file's order. */
export function kindValues(data: UploadData, map: UploadMap): { value: string; records: number }[] {
  if (!map.kind) return [];
  const counts = new Map<string, number>();
  for (const row of data.rows) {
    const value = norm(row[map.kind]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, records]) => ({ value, records }));
}

/** What a value of the kind field means: the person's choice, else the guess, else left out. */
export function kindChoice(choices: Record<string, KindChoice | undefined>, value: string): KindChoice {
  return choices[value] ?? (kindOfValue(value) || 'leave_out');
}

/**
 * The field that holds the words to avoid of the follow-up: the one beside the follow-up question that is
 * named like the words-to-avoid field ('followUpQuestions[0].mustNotContain'), or the follow-up field's own
 * ('metadata.follow_up_must_not_contain'). '' when the file has none.
 */
export function followUpAvoidField(data: UploadData, map: UploadMap): string {
  if (!map.follow_up) return '';
  const parent = map.follow_up.slice(0, map.follow_up.lastIndexOf('.') + 1);
  const last = map.avoid ? map.avoid.slice(map.avoid.lastIndexOf('.') + 1) : '';
  const candidates = [
    last ? parent + last : '',
    `${parent}mustNotContain`,
    `${parent}must_not_contain`,
    `${map.follow_up}_must_not_contain`,
    `${map.follow_up}MustNotContain`,
  ];
  return (
    candidates.find(
      (field) => field && field !== map.avoid && field !== map.follow_up && data.fields.includes(field),
    ) ?? ''
  );
}

/** Fields no role uses: kept with each question as extra details. */
export function extraFields(data: UploadData, map: UploadMap): string[] {
  const used = new Set([...Object.values(map), followUpAvoidField(data, map), GROUP_FIELD]);
  return data.fields.filter((field) => !used.has(field));
}

/** How much of a long first value is shown as the example of its field. */
export const EXAMPLE_CHARS = 90;

/**
 * The first value a field has in the file, as one short line. A longer value is cut at a word and says so in
 * words ("(first 84 of 412 characters)"): no ellipsis. Field names are never cut: this is only the example value.
 */
export function firstValue(data: UploadData, field: string): string {
  if (!field) return '';
  const row = data.rows.find((item) => item[field] !== null && item[field] !== undefined);
  const value = row ? row[field] : '';
  const line = Array.isArray(value) ? value.join(', ') : String(value);
  if (line.length <= EXAMPLE_CHARS) return line;
  const space = line.lastIndexOf(' ', EXAMPLE_CHARS);
  const cut = line.slice(0, space > EXAMPLE_CHARS / 2 ? space : EXAMPLE_CHARS).trimEnd();
  return `${cut} (first ${cut.length} of ${line.length} characters)`;
}

const words = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : typeof value === 'string'
      ? value
          .split(/[;|؛\n]/)
          .map((word) => word.trim())
          .filter(Boolean)
      : [];

/** One question in the shape a dataset keeps and a run reads. */
export interface UploadItem {
  item_id: string;
  input: string;
  expected_output: null;
  metadata: {
    tier: PerformanceTier;
    follow_up?: string;
    follow_up_must_not_contain?: string[];
    must_not_contain?: string[];
    [detail: string]: unknown;
  };
  labels: string[];
}

export interface UploadResult {
  items: UploadItem[];
  tier_counts: Record<PerformanceTier, number>;
  follow_ups: number;
  with_avoid_words: number;
  /** Records without a question text. */
  no_question: number;
  /** Records whose kind is not matched or was left out, by the value of the kind field. */
  left_out_kinds: Record<string, number>;
  /** Ids that appeared more than once; a number was added to the repeats. */
  repeated_ids: number;
  /** Records of the file that did not become a question. */
  left_out: number;
}

const RESERVED = new Set([
  'tier',
  'follow_up',
  'must_not_contain',
  'follow_up_must_not_contain',
  'labels',
  'expected_output',
]);

/**
 * The questions the dataset will hold. `choices` says what each value of the kind field means; `allKind` is
 * the kind of every question when the file has no kind field.
 */
export function buildUpload(
  data: UploadData,
  map: UploadMap,
  choices: Record<string, KindChoice | undefined> = {},
  allKind: PerformanceTier = 'medium',
): UploadResult {
  const items: UploadItem[] = [];
  const seen: Record<string, number> = {};
  const left_out_kinds: Record<string, number> = {};
  const followAvoid = followUpAvoidField(data, map);
  const extras = extraFields(data, map);
  let no_question = 0;
  let repeated_ids = 0;
  let with_avoid_words = 0;
  data.rows.forEach((row, index) => {
    const input = map.question ? text(row[map.question]) : '';
    if (!input) {
      no_question += 1;
      return;
    }
    const raw = norm(row[map.kind]);
    const choice = map.kind ? kindChoice(choices, raw) : allKind;
    if (choice === 'leave_out') {
      left_out_kinds[raw] = (left_out_kinds[raw] ?? 0) + 1;
      return;
    }
    let item_id = map.id ? text(row[map.id]) : '';
    if (!item_id) item_id = `q-${index + 1}`;
    const times = seen[item_id];
    if (times) {
      repeated_ids += 1;
      seen[item_id] = times + 1;
      item_id += `-${times + 1}`;
    } else seen[item_id] = 1;
    const metadata: UploadItem['metadata'] = { tier: choice };
    const follow_up = map.follow_up ? text(row[map.follow_up]) : '';
    if (follow_up) {
      metadata.follow_up = follow_up;
      const followWords = followAvoid ? words(row[followAvoid]) : [];
      if (followWords.length) metadata.follow_up_must_not_contain = followWords;
    }
    const avoid = map.avoid ? words(row[map.avoid]) : [];
    if (avoid.length) {
      metadata.must_not_contain = avoid;
      with_avoid_words += 1;
    }
    for (const field of extras) {
      const value = row[field];
      const name = field.startsWith('metadata.') ? field.slice('metadata.'.length) : field;
      if (value === null || value === undefined || RESERVED.has(name) || name in metadata) continue;
      metadata[name] = value;
    }
    items.push({ item_id, input, expected_output: null, metadata, labels: [choice] });
  });
  const tier_counts: Record<PerformanceTier, number> = { simple: 0, medium: 0, complex: 0 };
  for (const item of items) tier_counts[item.metadata.tier] += 1;
  return {
    items,
    tier_counts,
    follow_ups: items.filter((item) => item.metadata.follow_up).length,
    with_avoid_words,
    no_question,
    left_out_kinds,
    repeated_ids,
    left_out: data.rows.length - items.length,
  };
}

export interface UploadProblem {
  tone: PerformanceCheckTone;
  /** The word of the tag: Problem, Left out, Changed, OK. */
  label: string;
  message: string;
}

/** What a person should know before saving: what is left out, what was changed, or that all is well. */
export function uploadProblems(
  data: UploadData,
  map: UploadMap,
  result: UploadResult,
  choices: Record<string, KindChoice | undefined> = {},
): UploadProblem[] {
  const problems: UploadProblem[] = [];
  const left = (message: string) => problems.push({ tone: 'warn', label: 'Left out', message });
  if (!map.question)
    problems.push({ tone: 'bad', label: 'Problem', message: 'No field is chosen for the question yet.' });
  else if (result.no_question)
    left(`${plural(result.no_question, 'record has', 'records have')} no question text.`);
  for (const [value, n] of Object.entries(result.left_out_kinds)) {
    const shown = value || '(empty)';
    if (choices[value] === 'leave_out')
      left(
        `${plural(n, 'record', 'records')} of the kind “${shown}” ${n === 1 ? 'is' : 'are'} left out, as chosen.`,
      );
    else
      left(
        `${plural(n, 'record has', 'records have')} the kind “${shown}”, which is not matched. Say what it means on the left to keep ${n === 1 ? 'it' : 'them'}.`,
      );
  }
  if (data.info.skipped)
    left(`${plural(data.info.skipped, 'entry is', 'entries are')} not a record or a text.`);
  if (result.repeated_ids)
    problems.push({
      tone: 'warn',
      label: 'Changed',
      message: `${plural(result.repeated_ids, 'id appears', 'ids appear')} more than once. A number is added to the repeats.`,
    });
  if (map.question && !result.items.length)
    problems.push({
      tone: 'bad',
      label: 'Problem',
      message: 'No record of the file would become a question.',
    });
  if (map.question && !problems.length)
    problems.push({ tone: 'ok', label: 'OK', message: 'Every record in the file becomes a question.' });
  return problems;
}

/** The questions as a dataset file: one record per line. */
export function uploadFileText(items: UploadItem[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

/** 'insightor-load_questions.json' -> 'Insightor load questions'. */
export function datasetNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

/** '30 simple, 38 medium, 71 complex'. */
export function kindCountWords(counts: Record<PerformanceTier, number>): string {
  return KINDS.map((kind) => `${counts[kind]} ${kind}`).join(', ');
}
