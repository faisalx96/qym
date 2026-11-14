import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parsePrompt } from '../../model/promptDoc';
import prompts from '../../model/__tests__/fixtures/prompts.json';
import { PromptDocument } from '../PromptDocument';

const FIXTURES = prompts as Record<string, { role: string; content: string }[]>;
const squeeze = (text: string) => text.replace(/\s+/g, '');

describe('PromptDocument (cv5 Q2): the rendered prompt hides and changes no text', () => {
  for (const [name, messages] of Object.entries(FIXTURES))
    for (const m of messages)
      it(`${name} ${m.role}: every character of the raw message is on the page, in order`, () => {
        const { container } = render(
          <PromptDocument doc={parsePrompt(m.content)} change={null} jump={null} prefix="t-" />,
        );
        // closed sections count: they are hidden, not removed
        expect(squeeze(container.textContent ?? '')).toBe(squeeze(m.content));
      });

  it('marks an added line inside its section and opens a closed section that holds it', () => {
    // a long trace: the section starts closed
    const steps = Array.from({ length: 30 }, (_, n) => `Step ${n + 1} — tool:${n}:\nOUTPUT:\n  value ${n}\n  more ${n}`);
    const content = ['EVALUATION ITEM DATA:', 'INPUT:', 'q', '', 'TRACE EVIDENCE:', 'Agent trace:', ...steps].join('\n');
    const doc = parsePrompt(content);
    const lines = content.split('\n');
    const target = lines.indexOf('  value 17');
    const { container, rerender } = render(<PromptDocument doc={doc} change={null} jump={null} prefix="t-" />);
    const trace = container.querySelector('[data-key="TRACE EVIDENCE"] button[aria-expanded]');
    expect(trace).toHaveAttribute('aria-expanded', 'false');
    expect(trace).toHaveTextContent('lines');

    const change = {};
    rerender(<PromptDocument doc={doc} added={new Set([target])} change={change} jump={null} prefix="t-" />);
    expect(trace).toHaveAttribute('aria-expanded', 'true');
    const marked = container.querySelectorAll('[data-added]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('value 17');
  });

  it('a prompt it cannot read is clean paragraphs', () => {
    const content = 'just some text\nsecond line\n\n{ not closed';
    const doc = parsePrompt(content);
    const { container } = render(<PromptDocument doc={doc} change={null} jump={null} prefix="t-" />);
    expect(container.querySelectorAll('p').length).toBeGreaterThan(0);
    expect(squeeze(container.textContent ?? '')).toBe(squeeze(content));
  });
});
