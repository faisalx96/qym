import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../model/settings';
import { sectionNotes } from '../../model/contents';
import type { LineChange } from '../../model/promptDiff';
import prompts from '../../model/__tests__/fixtures/prompts.json';
import { PromptMessages } from '../PromptMessages';

const FIXTURES = prompts as Record<string, { role: string; content: string }[]>;
const MESSAGES = FIXTURES['sql-analytics']!;
const notes = (patch = {}) =>
  sectionNotes({
    ...defaultSettings({ metrics: ['accuracy'], maxIssues: 3, timeoutSeconds: 120 }),
    ...patch,
  });
const squeeze = (text: string) => text.replace(/\s+/g, '');

describe('PromptMessages outline (cv5 N): a rail in a wide pane, a location menu in a narrow pane and the drawer', () => {
  it('rail: message group labels, the sections as buttons, the parts indented, one section in view', () => {
    render(<PromptMessages messages={MESSAGES} view="rendered" change={null} notes={notes()} form="rail" />);
    const nav = screen.getByRole('navigation', { name: 'Prompt sections' });
    const lists = within(nav).getAllByRole('list');
    expect(
      lists.map(
        (l) =>
          l.getAttribute('aria-labelledby') &&
          document.getElementById(l.getAttribute('aria-labelledby')!)?.textContent,
      ),
    ).toEqual(['System', 'User']);
    // the group labels are labels, not buttons
    expect(within(nav).queryByRole('button', { name: 'System' })).toBeNull();
    const system = within(lists[0]!).getAllByRole('button');
    expect(system.map((b) => b.textContent)).toEqual([
      'Instructions',
      'Analysis rules',
      'Item data',
      'Input',
      'Expected output',
      'Actual output',
      'Trace evidence',
      'Metric result',
      'Item metadata',
      'Metric metadatanone',
      'Response format',
    ]);
    expect(system[3]).toHaveAttribute('data-depth', '1');
    expect(system[2]).toHaveAttribute('data-depth', '0');
    expect(nav.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
  });

  it('rail: Up / Down / Home / End move the focus between the rows', async () => {
    render(<PromptMessages messages={MESSAGES} view="rendered" change={null} notes={notes()} form="rail" />);
    const buttons = within(screen.getByRole('navigation', { name: 'Prompt sections' })).getAllByRole('button');
    buttons[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(buttons[1]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(buttons[buttons.length - 1]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(buttons[0]).toHaveFocus();
  });

  it('a switched-off section keeps its row ("not sent") and one quiet line in the document, outside the prompt text', () => {
    const { container } = render(
      <PromptMessages
        messages={MESSAGES}
        view="rendered"
        change={null}
        notes={notes({ useDocuments: false, includeMetadata: true })}
        form="rail"
      />,
    );
    const user = within(screen.getByRole('navigation', { name: 'Prompt sections' })).getAllByRole('list')[1]!;
    // the fixture has the documents; a switch that is off while they are in the text says so on the row
    expect(within(user).getByRole('button', { name: /Reference documents/ })).toHaveTextContent('not sent');
    const line = container.querySelector('[data-ui-note]');
    expect(line).toHaveTextContent('Metric metadata: none for this target');
    // every character of the raw messages is on the page, and nothing else once the note lines are left out
    const articles = container.querySelectorAll('article');
    articles.forEach((article, i) => {
      const clone = article.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-ui-note], header').forEach((n) => n.remove());
      expect(squeeze(clone.textContent ?? '')).toBe(squeeze(MESSAGES[i]!.content));
    });
  });

  it('a section that is not in the prompt: the row jumps to its note line', async () => {
    const messages = [
      MESSAGES[0]!,
      { role: 'user', content: 'Return only the JSON object required by the system prompt.' },
    ];
    const { container } = render(
      <PromptMessages
        messages={messages}
        view="rendered"
        change={null}
        notes={notes({ useDocuments: false })}
        form="rail"
      />,
    );
    const row = screen.getByRole('button', { name: /Reference documents/ });
    expect(row).toHaveAttribute('data-state', 'off');
    const line = [...container.querySelectorAll('[data-ui-note]')].find((n) =>
      /Reference documents/.test(n.textContent ?? ''),
    )!;
    expect(line).toHaveTextContent('Reference documents: not sent');
    expect(line.id).toMatch(/note-reference-documents$/);
    await userEvent.click(row);
  });

  it('hover of a Prompt contents switch marks its rail row and its section; a change marks its row with a dot', () => {
    const lines = MESSAGES[0]!.content.split('\n');
    const at = lines.findIndex((l) => l.startsWith('INPUT:')) + 1;
    const change: LineChange = { added: [new Set([at]), new Set()], addedCount: 1, removedCount: 0 };
    const { container } = render(
      <PromptMessages
        messages={MESSAGES}
        view="rendered"
        change={change}
        notes={notes()}
        peek={['TRACE EVIDENCE']}
        form="rail"
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Prompt sections' });
    expect(within(nav).getByRole('button', { name: 'Trace evidence' })).toHaveAttribute('data-peek');
    expect(container.querySelector('section[data-key="TRACE EVIDENCE"]')).toHaveAttribute('data-peek');
    const input = within(nav).getByRole('button', { name: /^Input/ });
    expect(within(input).getByRole('img', { name: 'changed' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('img', { name: 'changed' })).toHaveLength(1);
  });

  it('menu: one location line in the dropdown trigger look; the menu holds the same tree, the current row checked', async () => {
    const { container } = render(
      <PromptMessages
        messages={MESSAGES}
        view="rendered"
        change={null}
        notes={notes({ includeMetadata: false })}
        form="menu"
      />,
    );
    expect(container.querySelector('nav ul')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Prompt sections' });
    const trigger = within(nav).getByRole('button');
    expect(trigger).toHaveAttribute('data-variant', 'bar');
    // one location: the message, then the section (no scroller in jsdom: the first row is the current one)
    expect(trigger.textContent).toBe('System·Instructions');
    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(12);
    expect(items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent)).toEqual([
      'Instructions',
    ]);
    expect(within(menu).getByText('System')).toBeInTheDocument();
    expect(items.find((i) => /Item metadata/.test(i.textContent ?? ''))).toHaveTextContent('not sent');
    expect(items.find((i) => /^Input/.test(i.textContent ?? ''))).toHaveAttribute('data-level', '1');
  });

  it('Raw view: no outline and no note lines (the exact text only)', () => {
    const { container } = render(
      <PromptMessages
        messages={MESSAGES}
        view="raw"
        change={null}
        notes={notes({ useDocuments: false })}
        form="rail"
      />,
    );
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('[data-ui-note]')).toBeNull();
    expect(container.querySelector('[data-form]')).toBeNull();
  });
});
