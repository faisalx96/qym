import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it } from 'vitest';
import { FieldRow, StructuredValue } from '@/ui';
import {
  classifySection,
  entriesOf,
  isUniformObjectArray,
  parseStructured,
  sectionSummary,
  startsOpen,
} from '../StructuredValue/structured';

const OUTPUT = {
  answer: 'عاصمة المملكة العربية السعودية هي الرياض.',
  reasoning: 'Looked up the capital.',
  citations: [
    { doc: 'policy-2026', page: 3, score: 0.91 },
    { doc: 'products-guide', page: 4, score: 0.62 },
  ],
  confidence: 0.75,
  tags: ['a', 'b'],
  meta: { source: 'kb', nested: { deep: true } },
};

beforeEach(() => window.localStorage.clear());

describe('structured classification', () => {
  it('parses objects, arrays and JSON strings; plain strings stay text', () => {
    expect(parseStructured({ a: 1 }).structured).toBe(true);
    expect(parseStructured('[1,2]').structured).toBe(true);
    expect(parseStructured('{"a":1}').structured).toBe(true);
    expect(parseStructured('hello')).toEqual({ structured: false, text: 'hello' });
    expect(parseStructured('42')).toEqual({ structured: false, text: '42' });
    expect(parseStructured(null)).toEqual({ structured: false, text: '' });
  });
  it('indexes a top-level array', () => {
    expect(entriesOf([5, 6]).map((e) => e.key)).toEqual(['[0]', '[1]']);
  });
  it('classifies sections', () => {
    expect(classifySection('x')).toBe('string');
    expect(classifySection(0.5)).toBe('scalar');
    expect(classifySection(['a', 'b'])).toBe('scalars');
    expect(classifySection([{ a: 1 }, { a: 2, b: 3 }])).toBe('table');
    expect(isUniformObjectArray([{ a: { b: 1 } }])).toBe(false);
    expect(classifySection({ a: 1 })).toBe('object');
    expect(sectionSummary({ a: 1, b: 2 })).toBe('object, 2 keys');
    expect(sectionSummary([{ a: 1 }])).toBe('array of 1 object');
  });
  it('opens the first 6 keys and short strings under auto', () => {
    expect(startsOpen(0, 'x', 'auto')).toBe(true);
    expect(startsOpen(6, 'x', 'auto')).toBe(false);
    expect(startsOpen(0, 'x'.repeat(601), 'auto')).toBe(false);
    expect(startsOpen(9, 'x', 'all')).toBe(true);
    expect(startsOpen(0, 'x', 'none')).toBe(false);
  });
});

describe('StructuredValue', () => {
  it('renders one section per key with typed bodies and no axe violations', async () => {
    const { container } = render(<StructuredValue value={OUTPUT} label="Output" />);
    const group = screen.getByRole('group', { name: 'Output' });
    for (const k of ['answer', 'reasoning', 'citations', 'confidence', 'tags', 'meta'])
      expect(within(group).getByRole('group', { name: k })).toBeInTheDocument();
    expect(screen.getByText('policy-2026')).toBeInTheDocument(); // table
    expect(screen.getByText('0.75')).toBeInTheDocument(); // scalar inline
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps keys LTR and lets Arabic values pick their own direction', () => {
    render(<StructuredValue value={OUTPUT} />);
    expect(within(screen.getByRole('group', { name: 'answer' })).getByText('answer')).toHaveAttribute(
      'dir',
      'ltr',
    );
    expect(screen.getByText(/عاصمة المملكة/).closest('[dir]')).toHaveAttribute('dir', 'rtl');
  });

  it('collapses and expands a section, copy per section exists', async () => {
    const user = userEvent.setup();
    render(<StructuredValue value={OUTPUT} />);
    const toggle = screen.getByRole('button', { name: /^answer/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
  });

  it('shows the key index above 4 keys and switches to Raw', async () => {
    const user = userEvent.setup();
    render(<StructuredValue value={OUTPUT} />);
    expect(screen.getByRole('navigation', { name: 'Keys' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Raw' }));
    expect(screen.queryByRole('navigation', { name: 'Keys' })).toBeNull();
    expect(screen.getByText(/"confidence": 0.75/)).toBeInTheDocument();
    expect(window.localStorage.getItem('qym:json-view')).toBe('raw');
  });

  it('falls back to text for plain strings and parses JSON strings', () => {
    const { rerender } = render(<StructuredValue value="just words" />);
    expect(screen.getByText('just words')).toBeInTheDocument();
    rerender(<StructuredValue value={'{"k":"v"}'} />);
    expect(screen.getByRole('group', { name: 'k' })).toBeInTheDocument();
  });
});

describe('FieldRow', () => {
  it('mirrors the row for Arabic content and keeps label and body in one group', async () => {
    const { container } = render(
      <FieldRow
        label="Input"
        text="ما هي شروط الحصول على تمويل عقاري؟"
        actions={<button type="button">Copy</button>}
      >
        <p>ما هي شروط الحصول على تمويل عقاري؟</p>
      </FieldRow>,
    );
    const row = screen.getByRole('group', { name: 'Input' });
    expect(row).toHaveAttribute('dir', 'rtl');
    expect(await axe(container)).toHaveNoViolations();
  });
  it('is left to right for English and honours an explicit dir', () => {
    const { rerender } = render(
      <FieldRow label="Expected" text="Clause 1">
        <p>Clause 1</p>
      </FieldRow>,
    );
    expect(screen.getByRole('group', { name: 'Expected' })).toHaveAttribute('dir', 'auto');
    rerender(
      <FieldRow label="Expected" dir="ltr">
        <p>x</p>
      </FieldRow>,
    );
    expect(screen.getByRole('group', { name: 'Expected' })).toHaveAttribute('dir', 'ltr');
  });
});
