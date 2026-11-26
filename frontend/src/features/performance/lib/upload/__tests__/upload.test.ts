/** Upload of a question file: the structure finder, the field guess, the kind values, the problems, the result. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GROUP_FIELD,
  buildUpload,
  datasetNameFromFile,
  decodeUploadBytes,
  describeStructure,
  extraFields,
  firstValue,
  followUpAvoidField,
  guessFields,
  isUploadError,
  kindChoice,
  kindOfValue,
  kindValues,
  readQuestionFile,
  uploadFileText,
  uploadProblems,
  type UploadData,
} from '..';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', '..');
/** The suite's own question file. It lives beside this repository, not in it: the test reads it where it is. */
const SUITE_FILE =
  process.env.QYM_PERFORMANCE_SUITE_QUESTIONS ??
  join(ROOT, '..', '..', '..', 'EA_performance_testing', 'data', 'questions.json');

function read(name: string, content: string): UploadData {
  const data = readQuestionFile(name, content);
  if (isUploadError(data)) throw new Error(data.error);
  return data;
}
const errorOf = (name: string, content: string) => {
  const data = readQuestionFile(name, content);
  return isUploadError(data) ? data.error : null;
};

const AVOID = ['لا توجد بيانات', 'عذراً'];
const record = (id: string, question: string, followUp?: string) => ({
  id,
  question,
  description: 'From the question bank',
  expectedResponsePattern: null,
  expectedResponseContains: [],
  mustNotContain: AVOID,
  followUpQuestions: followUp ? [{ question: followUp, description: 'Next', mustNotContain: ['عذراً'] }] : [],
});
const NAMED_LISTS = JSON.stringify({
  _instructions: { howToUse: 'Edit the three lists below.' },
  simple: [record('s1', 'كم عدد الصفوف؟', 'وكم عدد الأعمدة؟'), record('s2', 'How many rows?')],
  medium: [record('m1', 'Top three regions?', 'And the fourth?')],
  complex: [record('c1', 'Average salary by wealth level?', 'And the difference?')],
});

describe('the suite’s own question file', () => {
  it.skipIf(!existsSync(SUITE_FILE))('comes out as 139 questions, 30 / 38 / 71, with 133 follow-ups', () => {
    const data = read('questions.json', readFileSync(SUITE_FILE, 'utf-8'));
    expect(data.info).toMatchObject({ format: 'JSON', groups: ['simple', 'medium', 'complex'], skipped: 0 });
    expect(describeStructure(data)).toBe('139 records in 3 named lists (simple, medium, complex)');
    const map = guessFields(data);
    expect(map).toEqual({
      question: 'question',
      kind: GROUP_FIELD,
      follow_up: 'followUpQuestions[0].question',
      avoid: 'mustNotContain',
      id: 'id',
    });
    const result = buildUpload(data, map);
    expect(result.items).toHaveLength(139);
    expect(result.tier_counts).toEqual({ simple: 30, medium: 38, complex: 71 });
    expect(result.follow_ups).toBe(133);
    expect(result.left_out).toBe(0);
    expect(new Set(result.items.map((item) => item.item_id)).size).toBe(139);
    expect(uploadProblems(data, map, result)).toEqual([
      { tone: 'ok', label: 'OK', message: 'Every record in the file becomes a question.' },
    ]);
    const first = result.items[0]!;
    expect(Object.keys(first)).toEqual(['item_id', 'input', 'expected_output', 'metadata', 'labels']);
    expect(first.item_id).toBe('simple_demographics_1');
    expect(first.metadata.tier).toBe('simple');
    expect(typeof first.metadata.follow_up).toBe('string');
    expect(Array.isArray(first.metadata.must_not_contain)).toBe(true);
    expect(Array.isArray(first.metadata.follow_up_must_not_contain)).toBe(true);
    expect(first.labels).toEqual(['simple']);
    // What is saved is one record per line, and reading it back gives the same questions.
    const again = read('saved.jsonl', uploadFileText(result.items));
    const back = buildUpload(again, guessFields(again));
    expect(back.items).toHaveLength(139);
    expect(back.tier_counts).toEqual({ simple: 30, medium: 38, complex: 71 });
    expect(back.follow_ups).toBe(133);
  });
});

describe('structure finder', () => {
  it('reads a few named lists, takes the list name as the kind and nested fields as dotted names', () => {
    const data = read('questions.json', NAMED_LISTS);
    expect(data.rows).toHaveLength(4);
    expect(data.fields).toEqual([
      'id',
      'question',
      'description',
      'mustNotContain',
      'followUpQuestions[0].question',
      'followUpQuestions[0].description',
      'followUpQuestions[0].mustNotContain',
      GROUP_FIELD,
    ]);
    expect(describeStructure(data)).toBe('4 records in 3 named lists (simple, medium, complex)');
    const map = guessFields(data);
    expect(map.kind).toBe(GROUP_FIELD);
    expect(followUpAvoidField(data, map)).toBe('followUpQuestions[0].mustNotContain');
    expect(extraFields(data, map)).toEqual(['description', 'followUpQuestions[0].description']);
    const result = buildUpload(data, map);
    expect(result.tier_counts).toEqual({ simple: 2, medium: 1, complex: 1 });
    expect(result.follow_ups).toBe(3);
    expect(result.with_avoid_words).toBe(4);
    expect(result.items[0]).toEqual({
      item_id: 's1',
      input: 'كم عدد الصفوف؟',
      expected_output: null,
      metadata: {
        tier: 'simple',
        follow_up: 'وكم عدد الأعمدة؟',
        follow_up_must_not_contain: ['عذراً'],
        must_not_contain: AVOID,
        description: 'From the question bank',
        'followUpQuestions[0].description': 'Next',
      },
      labels: ['simple'],
    });
    expect(result.items[1]!.metadata.follow_up).toBeUndefined();
  });

  it('reads one list inside a document and says where it sits', () => {
    const data = read(
      'bank.json',
      JSON.stringify({ version: 2, questions: [{ prompt: 'A?', level: 'hard' }] }),
    );
    expect(data.info.under).toBe('questions');
    expect(describeStructure(data)).toBe('1 record in the list “questions”');
    expect(guessFields(data)).toMatchObject({ question: 'prompt', kind: 'level' });
  });

  it('finds a list up to three levels down, and several there as named lists', () => {
    const deep = read(
      'suite.json',
      JSON.stringify({
        _about: 'Exported test suite',
        suite: {
          name: 'QA - Suite',
          cases: [{ ask: { text: 'How many rows?' } }, { ask: { text: 'Top three?' } }],
        },
      }),
    );
    expect(deep.info.under).toBe('suite.cases');
    expect(describeStructure(deep)).toBe('2 records in the list “suite.cases”');
    const named = read(
      'levels.json',
      JSON.stringify({
        export: {
          questions: { easy: [{ question: 'How many rows?' }], hard: [{ question: 'Average by level?' }] },
        },
      }),
    );
    expect(named.info.groups).toEqual(['easy', 'hard']);
    const map = guessFields(named);
    expect(map.kind).toBe(GROUP_FIELD);
    expect(buildUpload(named, map).tier_counts).toEqual({ simple: 1, medium: 0, complex: 1 });
    // Four levels down is too deep; the nearest lists win over deeper ones.
    expect(errorOf('deeper.json', JSON.stringify({ a: { b: { c: { d: ['Q?'] } } } }))).toMatch(
      /^No list of questions was found\./,
    );
    expect(read('near.json', JSON.stringify({ cases: ['Q?'], meta: { tags: ['x'] } })).info.under).toBe(
      'cases',
    );
  });

  it('guesses a question one level down by the same name rules, never a follow-up’s', () => {
    const fields = (records: unknown[]) => guessFields(read('nested.json', JSON.stringify(records)));
    expect(fields([{ ask: { text: 'How many rows?' }, then: 'And columns?' }]).question).toBe('ask.text');
    expect(fields([{ input: { question: 'How many rows?' } }]).question).toBe('input.question');
    expect(fields([{ prompt: { content: 'How many rows?' } }]).question).toBe('prompt.content');
    // A field of the record itself wins over a nested one, and a follow-up's question is never the question.
    expect(fields([{ meta: { text: 'note' }, question: 'How many rows?' }]).question).toBe('question');
    expect(
      fields([{ ask: { text: 'How many rows?' }, followUpQuestions: [{ question: 'And columns?' }] }]),
    ).toMatchObject({ question: 'ask.text', follow_up: 'followUpQuestions[0].question' });
    const data = read('nested.json', JSON.stringify([{ ask: { text: 'How many rows?' } }]));
    expect(buildUpload(data, guessFields(data)).items).toHaveLength(1);
  });

  it('reads a list of records with nested records two levels deep', () => {
    const data = read(
      'items.json',
      JSON.stringify([{ input: { question: 'A?' }, meta: { difficulty: 'easy', owner: { team: 'QA' } } }]),
    );
    expect(data.fields).toEqual(['input.question', 'meta.difficulty', 'meta.owner.team']);
    expect(describeStructure(data)).toBe('1 record in one list');
    expect(guessFields(data)).toMatchObject({ question: 'input.question', kind: 'meta.difficulty' });
  });

  it('reads a list of texts: no kinds, no follow-ups, numbered ids', () => {
    const data = read('prompts.json', JSON.stringify(['First?', 'Second?', 'Third?']));
    expect(describeStructure(data)).toBe('A list of 3 texts');
    const map = guessFields(data);
    expect(map).toEqual({ question: 'text', kind: '', follow_up: '', avoid: '', id: '' });
    const result = buildUpload(data, map);
    expect(result.items.map((item) => item.item_id)).toEqual(['q-1', 'q-2', 'q-3']);
    expect(result.tier_counts).toEqual({ simple: 0, medium: 3, complex: 0 });
    expect(buildUpload(data, map, {}, 'complex').tier_counts).toEqual({ simple: 0, medium: 0, complex: 3 });
    expect(result.follow_ups).toBe(0);
  });

  it('reads one record per line in the shape a dataset keeps, and gives the same shape back', () => {
    const lines = [
      {
        item_id: 'a',
        input: 'A?',
        expected_output: null,
        metadata: {
          tier: 'simple',
          follow_up: 'And then?',
          follow_up_must_not_contain: ['no data'],
          must_not_contain: ['sorry'],
          description: 'Kept',
        },
        labels: ['simple'],
      },
      {
        item_id: 'b',
        input: 'B?',
        expected_output: null,
        metadata: { tier: 'complex' },
        labels: ['complex'],
      },
    ];
    const data = read('set.jsonl', lines.map((line) => JSON.stringify(line)).join('\n'));
    expect(data.info.format).toBe('JSON Lines');
    expect(describeStructure(data)).toBe('2 records, one per line');
    const map = guessFields(data);
    expect(map).toEqual({
      question: 'input',
      kind: 'metadata.tier',
      follow_up: 'metadata.follow_up',
      avoid: 'metadata.must_not_contain',
      id: 'item_id',
    });
    expect(buildUpload(data, map).items).toEqual(lines);
  });

  it('reads a table with other column names, and leaves out what it cannot use', () => {
    const csv = [
      'No,Question,Level,Second question,Topic',
      '1,"How many, in total?",easy,And per region?,General',
      '2,Top ports?,normal,,Customs',
      '3,Largest importers?,hard,How many declarations?,Customs',
      '4,Something else?,expert,,General',
      '5,,easy,,General',
      '',
    ].join('\n');
    const data = read('questions-from-a-sheet.csv', csv);
    expect(describeStructure(data)).toBe('A table with 5 rows and 5 columns');
    const map = guessFields(data);
    expect(map).toEqual({
      question: 'Question',
      kind: 'Level',
      follow_up: 'Second question',
      avoid: '',
      id: 'No',
    });
    expect(kindValues(data, map)).toEqual([
      { value: 'easy', records: 2 },
      { value: 'normal', records: 1 },
      { value: 'hard', records: 1 },
      { value: 'expert', records: 1 },
    ]);
    const result = buildUpload(data, map);
    expect(result.items.map((item) => [item.item_id, item.metadata.tier])).toEqual([
      ['1', 'simple'],
      ['2', 'medium'],
      ['3', 'complex'],
    ]);
    expect(result.items[0]!.input).toBe('How many, in total?');
    expect(result.items[0]!.metadata.Topic).toBe('General');
    expect(result.follow_ups).toBe(2);
    expect(result.left_out).toBe(2);
    expect(uploadProblems(data, map, result)).toEqual([
      { tone: 'warn', label: 'Left out', message: '1 record has no question text.' },
      {
        tone: 'warn',
        label: 'Left out',
        message:
          '1 record has the kind “expert”, which is not matched. Say what it means on the left to keep it.',
      },
    ]);
    // Saying what "expert" means keeps the record; leaving a kind out on purpose says so.
    const kept = buildUpload(data, map, { expert: 'complex' });
    expect(kept.tier_counts).toEqual({ simple: 1, medium: 1, complex: 2 });
    const choices = { expert: 'complex' as const, normal: 'leave_out' as const };
    const fewer = buildUpload(data, map, choices);
    expect(fewer.tier_counts).toEqual({ simple: 1, medium: 0, complex: 2 });
    expect(uploadProblems(data, map, fewer, choices)[1]!.message).toBe(
      '1 record of the kind “normal” is left out, as chosen.',
    );
  });

  it('reads a tab-separated table and plain lines of text', () => {
    const tsv = read('q.tsv', 'question\ttier\nA?\tsimple\nB?\tcomplex\n');
    expect(tsv.info).toMatchObject({ format: 'TSV', columns: 2 });
    expect(buildUpload(tsv, guessFields(tsv)).tier_counts).toEqual({ simple: 1, medium: 0, complex: 1 });
    const lines = read('q.txt', 'First?\n\n  Second?  \n');
    expect(describeStructure(lines)).toBe('2 lines of text, one question per line');
    expect(buildUpload(lines, guessFields(lines)).items.map((item) => item.input)).toEqual([
      'First?',
      'Second?',
    ]);
  });

  it('counts entries that are neither a record nor a text', () => {
    const data = read('mixed.json', JSON.stringify([{ question: 'A?' }, 7, null, ['x']]));
    expect(data.info.skipped).toBe(3);
    const map = guessFields(data);
    expect(uploadProblems(data, map, buildUpload(data, map))).toEqual([
      { tone: 'warn', label: 'Left out', message: '3 entries are not a record or a text.' },
    ]);
  });

  it('says in words why a file cannot be read', () => {
    expect(errorOf('empty.json', '  \n')).toBe('The file is empty.');
    expect(errorOf('broken.json', '[{"question": "A?"},\n {"question": }]')).toMatch(
      /^Not valid JSON( at line \d+, character \d+)?\.$/,
    );
    expect(errorOf('lines.jsonl', '{"question":"A?"}\n{oops\n{"question":"C?"}\nnope')).toBe(
      'Line 2 is not valid JSON, and 1 more line like it.',
    );
    expect(errorOf('settings.json', '{"name": "x", "size": 3}')).toMatch(/^No list of questions was found\./);
    expect(errorOf('numbers.json', '[1, 2, 3]')).toBe('There are no records in this file.');
    expect(errorOf('head-only.csv', 'Question,Level\n')).toBe(
      'The table needs a first row with column names and at least one row under it.',
    );
  });
});

describe('fields, kinds and problems', () => {
  it('recognises the usual words for a kind, in English and Arabic', () => {
    expect(['easy', 'Simple', '1', 'سهل'].map(kindOfValue)).toEqual(['simple', 'simple', 'simple', 'simple']);
    expect(['normal', 'MEDIUM', '2', 'متوسط'].map(kindOfValue)).toEqual([
      'medium',
      'medium',
      'medium',
      'medium',
    ]);
    expect(['hard', 'complex', '3', 'معقد'].map(kindOfValue)).toEqual([
      'complex',
      'complex',
      'complex',
      'complex',
    ]);
    expect(kindOfValue('expert')).toBe('');
    expect(kindChoice({}, 'expert')).toBe('leave_out');
    expect(kindChoice({ expert: 'complex' }, 'expert')).toBe('complex');
    expect(kindChoice({}, 'hard')).toBe('complex');
  });

  it('adds a number to an id that appears again and says so', () => {
    const data = read(
      'ids.json',
      JSON.stringify([
        { id: 'a', q: 'A?' },
        { id: 'a', q: 'B?' },
        { id: 'a', q: 'C?' },
      ]),
    );
    const map = guessFields(data);
    const result = buildUpload(data, map);
    expect(result.items.map((item) => item.item_id)).toEqual(['a', 'a-2', 'a-3']);
    expect(uploadProblems(data, map, result)).toEqual([
      {
        tone: 'warn',
        label: 'Changed',
        message: '2 ids appear more than once. A number is added to the repeats.',
      },
    ]);
  });

  it('asks for the question field when none could be guessed, and never reports an empty result as fine', () => {
    const data = read('odd.json', JSON.stringify([{ body: 'A?', weight: 3 }]));
    const map = guessFields(data);
    expect(map.question).toBe('');
    const none = buildUpload(data, map);
    expect(none.items).toEqual([]);
    expect(uploadProblems(data, map, none)).toEqual([
      { tone: 'bad', label: 'Problem', message: 'No field is chosen for the question yet.' },
    ]);
    const chosen = { ...map, question: 'body', kind: 'weight' };
    const left = buildUpload(data, chosen, { '3': 'leave_out' });
    expect(left.items).toEqual([]);
    expect(uploadProblems(data, chosen, left, { '3': 'leave_out' }).at(-1)).toEqual({
      tone: 'bad',
      label: 'Problem',
      message: 'No record of the file would become a question.',
    });
  });

  it('splits words to avoid that a table keeps in one cell', () => {
    const data = read('w.csv', 'question,must not contain\nA?,sorry; no data|unknown\n');
    const map = guessFields(data);
    expect(map.avoid).toBe('must not contain');
    expect(buildUpload(data, map).items[0]!.metadata.must_not_contain).toEqual([
      'sorry',
      'no data',
      'unknown',
    ]);
  });

  it('shows the first value of a field as one short line', () => {
    const data = read('questions.json', NAMED_LISTS);
    expect(firstValue(data, 'mustNotContain')).toBe(AVOID.join(', '));
    expect(firstValue(data, 'question')).toBe('كم عدد الصفوف؟');
    expect(firstValue(data, '')).toBe('');
    // A long value is cut and says so in words: no ellipsis character (DESIGN_LANGUAGE §3.1, §7).
    const long = read('long.json', JSON.stringify([{ question: 'x'.repeat(200) }]));
    expect(firstValue(long, 'question')).toBe(`${'x'.repeat(90)} (first 90 of 200 characters)`);
    const words = read('words.json', JSON.stringify([{ question: 'word '.repeat(40).trim() }]));
    expect(firstValue(words, 'question')).toBe(`${'word '.repeat(18).trim()} (first 89 of 199 characters)`);
    expect(firstValue(words, 'question')).not.toContain('…');
  });

  it('names a dataset after its file and decodes a file that starts with a byte-order mark', () => {
    expect(datasetNameFromFile('insightor-load_questions.json')).toBe('Insightor load questions');
    const bytes = new TextEncoder().encode('﻿["A?"]');
    expect(read('bom.json', decodeUploadBytes(bytes)).rows).toEqual([{ text: 'A?' }]);
  });
});
