import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings';
import { sectionNotes, type SectionNote } from '../contents';
import { locationOf, messageOutline, stateText } from '../outline';
import { flattenLines, parsePrompt } from '../promptDoc';
import prompts from './fixtures/prompts.json';

const FIXTURES = prompts as Record<string, { role: string; content: string }[]>;
const settings = (patch = {}) => ({
  ...defaultSettings({ metrics: ['accuracy'], maxIssues: 3, timeoutSeconds: 120 }),
  ...patch,
});
const notesOf = (message: 0 | 1, patch = {}): SectionNote[] =>
  sectionNotes(settings(patch)).filter((n) => n.message === message);

const SYSTEM = [
  'You are an analyst.',
  '',
  'ANALYSIS RULES (diagnostic guidance):',
  '1. Renamed columns',
  '',
  'EVALUATION ITEM DATA:',
  'INPUT:',
  'q',
  '',
  'ACTUAL OUTPUT:',
  'a',
  '',
  'SELECTED METRIC RESULT:',
  'score 0.2',
  '',
  'Respond ONLY with valid JSON in this exact format:',
  '{}',
].join('\n');

describe('prompt outline (cv5 N): one tree, message → section → part of the item data', () => {
  it('the system message: Instructions, the sections, the item data parts indented under Item data', () => {
    const doc = parsePrompt(FIXTURES['sql-analytics']![0]!.content);
    const { group, notes } = messageOutline(doc, 0, 'system', notesOf(0));
    expect(group.name).toBe('System');
    expect(group.rows.map((r) => `${r.depth}:${r.label}`)).toEqual([
      '0:Instructions',
      '0:Analysis rules',
      '0:Item data',
      '1:Input',
      '1:Expected output',
      '1:Actual output',
      '1:Trace evidence',
      '1:Metric result',
      '1:Item metadata',
      // on, but this target has none: kept in its place, said "none"
      '1:Metric metadata',
      '0:Response format',
    ]);
    const meta = group.rows.find((r) => r.label === 'Metric metadata')!;
    expect(meta).toMatchObject({ note: true, state: 'empty', depth: 1 });
    expect(notes).toHaveLength(1);
    // a part opens its item data on a jump; its parent is the item data row
    const input = group.rows.find((r) => r.label === 'Input')!;
    const data = group.rows.find((r) => r.label === 'Item data')!;
    expect(input.path).toEqual([data.id, input.id]);
    expect(input.parent).toBe(data.id);
    expect(locationOf(group, input)).toEqual(['System', 'Item data', 'Input']);
    expect(locationOf(group, data)).toEqual(['System', 'Item data']);
  });

  it('a switched-off part keeps its place in the builder order, inside the item data, with a note line', () => {
    const doc = parsePrompt(SYSTEM);
    const { group, notes } = messageOutline(
      doc,
      0,
      'system',
      notesOf(0, { useTrace: false, includeMetadata: false }),
    );
    expect(
      group.rows.map((r) => `${r.depth}:${r.label}${r.state ? ` (${stateText(r.state)})` : ''}`),
    ).toEqual([
      '0:Instructions',
      '0:Analysis rules',
      '0:Item data',
      '1:Input',
      '1:Actual output',
      '1:Trace evidence (not sent)',
      '1:Metric result',
      '1:Item metadata (not sent)',
      '1:Metric metadata (none)',
      '0:Response format',
    ]);
    const data = doc.blocks.find((b) => b.kind === 'section' && b.key === 'EVALUATION ITEM DATA');
    if (data?.kind !== 'section') throw new Error('no item data');
    const trace = notes.find((n) => n.row.key === 'TRACE EVIDENCE')!;
    expect(trace.container).toBe(data.id);
    // before SELECTED METRIC RESULT in the item data's blocks
    const result = data.children.findIndex((b) => b.kind === 'section' && b.key === 'SELECTED METRIC RESULT');
    expect(trace.index).toBe(result);
    // after the last part: at the end of the item data
    expect(notes.find((n) => n.row.key === 'ITEM METADATA')!.index).toBe(data.children.length);
    // a note row opens the item data on a jump
    expect(trace.row.path).toEqual([data.id]);
  });

  it('a switched-off top-level section sits between its neighbours; the note lines are not prompt text', () => {
    const content = SYSTEM.replace('ANALYSIS RULES (diagnostic guidance):\n1. Renamed columns\n\n', '');
    const doc = parsePrompt(content);
    const { group, notes } = messageOutline(doc, 0, 'system', notesOf(0, { useRules: false }));
    expect(group.rows.slice(0, 3).map((r) => r.label)).toEqual([
      'Instructions',
      'Analysis rules',
      'Item data',
    ]);
    const rules = notes.find((n) => n.row.key === 'ANALYSIS RULES')!;
    expect(rules.container).toBeNull();
    expect(doc.blocks[rules.index]).toMatchObject({ kind: 'section', key: 'EVALUATION ITEM DATA' });
    // the parsed document is untouched: the raw text round-trips
    expect(
      flattenLines(doc.blocks)
        .map((l) => l.text)
        .join('\n'),
    ).toBe(content);
  });

  it('the user message without documents: the note goes before the closing line', () => {
    const doc = parsePrompt(FIXTURES['contract-summarizer']![1]!.content);
    const off = messageOutline(doc, 1, 'user', notesOf(1, { useDocuments: false }));
    expect(off.group.name).toBe('User');
    expect(off.group.rows.map((r) => [r.label, r.state])).toEqual([['Reference documents', 'off']]);
    expect(off.notes[0]!.index).toBe(0);
    const none = messageOutline(doc, 1, 'user', notesOf(1));
    expect(none.group.rows[0]).toMatchObject({ state: 'empty', note: true });
  });

  it('a section that is in the prompt while its switch is off says "not sent" (the rules guidance stays)', () => {
    const doc = parsePrompt(SYSTEM);
    const { group, notes } = messageOutline(doc, 0, 'system', notesOf(0, { useRules: false }));
    expect(group.rows.find((r) => r.key === 'ANALYSIS RULES')).toMatchObject({ state: 'off', note: false });
    expect(notes.some((n) => n.row.key === 'ANALYSIS RULES')).toBe(false);
  });

  it('marks the rows whose section holds a line of the last change; the item data row only for its own lines', () => {
    const doc = parsePrompt(SYSTEM);
    const lines = SYSTEM.split('\n');
    const added = new Set([lines.indexOf('a'), lines.indexOf('You are an analyst.')]);
    const { group } = messageOutline(doc, 0, 'system', notesOf(0), added);
    expect(group.rows.filter((r) => r.changed).map((r) => r.label)).toEqual([
      'Instructions',
      'Actual output',
    ]);
    const heading = new Set([lines.indexOf('EVALUATION ITEM DATA:')]);
    const own = messageOutline(doc, 0, 'system', notesOf(0), heading).group;
    expect(own.rows.filter((r) => r.changed).map((r) => r.label)).toEqual(['Item data']);
  });
});
