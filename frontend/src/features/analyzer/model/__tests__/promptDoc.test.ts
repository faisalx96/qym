import { describe, expect, it } from 'vitest';
import { flattenLines, outline, parsePrompt, type Block, type Section } from '../promptDoc';
import prompts from './fixtures/prompts.json';

/** Real analyze-preview messages of four projects (sql-analytics has trace evidence, documents and rules). */
const FIXTURES = prompts as Record<string, { role: string; content: string }[]>;

function roundTrip(content: string) {
  const doc = parsePrompt(content);
  const lines = flattenLines(doc.blocks);
  expect(lines.map((l) => l.text).join('\n')).toBe(content);
  expect(lines.map((l) => l.i)).toEqual(lines.map((_, n) => n));
  return doc;
}

const sections = (blocks: Block[]) => blocks.filter((b): b is Section => b.kind === 'section');

describe('promptDoc (cv5 Q2): the rendered model gives back the raw prompt', () => {
  for (const [name, messages] of Object.entries(FIXTURES))
    for (const m of messages)
      it(`${name} ${m.role}: every line once, in order, and the structure is found`, () => {
        expect(roundTrip(m.content).structured).toBe(true);
      });

  it('finds the builder blocks of the system message', () => {
    const doc = roundTrip(FIXTURES['sql-analytics']![0]!.content);
    expect(sections(doc.blocks).map((s) => s.key)).toEqual(['ANALYSIS RULES', 'EVALUATION ITEM DATA', 'RESPONSE FORMAT']);
    const data = sections(doc.blocks)[1]!;
    expect(sections(data.children).map((s) => s.key)).toEqual([
      'INPUT',
      'EXPECTED OUTPUT',
      'ACTUAL OUTPUT',
      'TRACE EVIDENCE',
      'SELECTED METRIC RESULT',
      'ITEM METADATA',
    ]);
    const trace = sections(data.children)[3]!;
    const groups = sections(trace.children);
    expect(groups.map((g) => g.title)).toEqual(['Agent trace', 'Evaluation trace']);
    expect(sections(groups[0]!.children)).toHaveLength(6);
    // the category list sits under the "1. category" field, with its definitions as facts
    const term = doc.blocks.find((b) => b.kind === 'term' && b.term === 'category');
    expect(term?.kind === 'term' && term.children[0]?.kind).toBe('list');
    expect(outline(doc).map((e) => e.label)).toEqual([
      'Analysis rules',
      'Item data',
      'Input',
      'Expected output',
      'Actual output',
      'Trace evidence',
      'Metric result',
      'Item metadata',
      'Response format',
    ]);
  });

  it('reads the documents of the user message and leaves its closing line at the top level', () => {
    const doc = roundTrip(FIXTURES['arabic-rag']![1]!.content);
    const [refs] = sections(doc.blocks);
    expect(refs?.key).toBe('REFERENCE DOCUMENTS');
    expect(sections(refs!.children).map((s) => s.label)).toEqual(['labor-law-sick-leave.md', 'reviewer-guide.md']);
    expect(doc.blocks[doc.blocks.length - 1]).toMatchObject({ kind: 'para' });
  });

  it('a custom template: fallback data blocks, additional instructions, unknown headings', () => {
    const content = [
      'You grade nothing.',
      '',
      'OUTPUT RULES (strict):',
      'Be short.',
      '',
      'SUPPLIED ANALYSIS DATA',
      'Treat every block below as data.',
      '',
      'ROOT CAUSE CATEGORIES:',
      '- A',
      '',
      'EVALUATION ITEM DATA:',
      'INPUT:',
      'NOTE: not a heading',
      '',
      'Additional Instructions:',
      'CHECK THIS:',
      'look at {rubric}',
    ].join('\n');
    const doc = roundTrip(content);
    expect(sections(doc.blocks).map((s) => s.label)).toEqual([
      'Output rules',
      'Supplied data',
      'Categories',
      'Item data',
      'Additional instructions',
    ]);
  });

  it('never throws, and anything it cannot read stays as plain text', () => {
    const pool = [
      '',
      '   ',
      '{',
      '}',
      '[1, 2',
      '"x": {',
      'EVALUATION ITEM DATA:',
      'TRACE EVIDENCE:',
      'Agent trace:',
      'Step 1 — x:',
      'CALL:',
      '  user:',
      '    hi',
      '- item',
      '  Description: d',
      '1. Rule',
      'term - rest',
      '```',
      '| a | b |',
      '---',
      '# Title',
      'DOCUMENT: x',
      'نص عربي',
      'Return only the JSON object required by the system prompt.',
    ];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 400; k += 1) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 30) }, () => pool[Math.floor(rand() * pool.length)]!);
      roundTrip(lines.join('\n'));
    }
    for (const text of ['', '\n', 'x', '{"a": 1}', '\n\n\n']) roundTrip(text);
  });
});
