import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunWorkspace } from '../../workspace/useRunWorkspace';
import { PromptPane } from '../PromptPane';

const KEY = 'sql-002\u0000result_similarity';

function fakeWs(messages: { role: string; content: string }[], pending: boolean) {
  return {
    allKeys: [KEY],
    rowById: new Map([['sql-002', { metric_scores: { result_similarity: 0.66 } }]]),
    focusKey: KEY,
    focus: { itemId: 'sql-002', metric: 'result_similarity' },
    setFocusKey: vi.fn(),
    preview: {
      messages,
      characters: messages.reduce((n, m) => n + m.content.length, 0),
      pending,
      error: null,
      retry: vi.fn(),
      hasTarget: true,
    },
  } as unknown as RunWorkspace;
}

describe('PromptPane (cv5 K3)', () => {
  it('keeps the text in place while it updates, then marks what the change added', () => {
    const first = [
      { role: 'system', content: 'You are an analyst.' },
      { role: 'user', content: 'INPUT:\nquestion' },
    ];
    const { rerender, container } = render(<PromptPane ws={fakeWs(first, false)} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    // cv5 Q1: the target is one quiet line, no control (a row click at the left chooses it)
    expect(screen.getByTestId('prompt-pane-target')).toHaveTextContent('sql-002 · result_similarity · 0.66');
    expect(screen.queryByRole('button', { name: /Previewed target/ })).toBeNull();

    // a setting changed: the old text stays (dimmed) and the head says so
    rerender(<PromptPane ws={fakeWs(first, true)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Updating');
    expect(screen.getByText(/You are an analyst/)).toBeInTheDocument();
    expect(container.querySelector('[role="region"]')).toHaveAttribute('data-pending');

    // the new prompt arrives: one line added, marked in the text
    const next = [first[0]!, { role: 'user', content: 'INPUT:\nquestion\nRULES:' }];
    rerender(<PromptPane ws={fakeWs(next, false)} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 line added');
    expect(container.querySelectorAll('[data-added]')).toHaveLength(1);
    expect(container.querySelector('[data-added]')).toHaveTextContent('RULES:');
    expect(screen.getByRole('button', { name: 'Show change' })).toBeInTheDocument();
  });
});
