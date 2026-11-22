import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DatasetTag, isBareRunId, ModelTag, RunName, TaskTag } from '@/ui';

describe('entity tags', () => {
  it('writes task, dataset (version, aliases) and model the same way everywhere, with a tooltip', async () => {
    const { container } = render(
      <div>
        <TaskTag name="text2sql" />
        <DatasetTag name="spider-dev" version="3" aliases={['golden']} />
        <ModelTag name="gpt-4o" series={2} reasoning />
        <TaskTag name={null} />
      </div>,
    );
    expect(screen.getByTitle('text2sql')).toHaveAttribute('data-kind', 'task');
    // cv5 Y5: the title does not repeat the alias; the alias tag reads `@golden`
    const ds = screen.getByTitle('spider-dev · version 3');
    expect(ds).toHaveAttribute('data-kind', 'dataset');
    expect(ds).toHaveTextContent('v3');
    expect(screen.getByText('@golden')).toBeInTheDocument();
    const model = screen.getByTitle('gpt-4o');
    expect(model).toHaveAttribute('data-series', '2');
    // 17 Nov G2: a reasoning model shows the light bulb (named "Reasoning model"), never the word
    expect(model).not.toHaveTextContent(/reasoning/i);
    expect(within(model).getByRole('img', { name: 'Reasoning model' })).toHaveAttribute('title', 'Reasoning model');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('marks a reasoning model with the light bulb glyph after the name, and a plain model with none (17 Nov G2)', () => {
    render(
      <div>
        <ModelTag name="o3-mini" series={4} reasoning />
        <ModelTag name="gpt-4o" series={1} />
      </div>,
    );
    const bulb = screen.getByRole('img', { name: 'Reasoning model' });
    expect(bulb.querySelector('svg[data-icon="lightbulb"]')).toHaveAttribute('width', '12');
    expect(bulb).toHaveAttribute('data-tone', 'gold');
    const tag = screen.getByTitle('o3-mini');
    expect(tag.lastElementChild).toBe(bulb);
    expect(tag).toHaveTextContent(/^o3-mini$/);
    expect(within(screen.getByTitle('gpt-4o')).queryByRole('img')).toBeNull();
  });

  it('does not double the v of a version that already has one', () => {
    render(<DatasetTag name="d" version="v2" />);
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});

describe('RunName (one run-name recipe)', () => {
  const id = '2584906b-730a-44aa-ac03-e3f06953bba1';
  it('is sans for a name and mono only for a bare id; a link when it has a target', () => {
    render(
      <MemoryRouter>
        <RunName name="summarize-gpt-4o" runId={id} to="/r/1" />
        <RunName name={id} runId={id} />
        <RunName name={null} runId={id} />
      </MemoryRouter>,
    );
    const named = screen.getByRole('link', { name: 'summarize-gpt-4o' });
    expect(named).not.toHaveAttribute('data-id');
    const bare = screen.getByText(id);
    expect(bare).toHaveAttribute('data-id');
    expect(screen.getByText(id.slice(0, 8))).toHaveAttribute('data-id');
  });
  it('knows a bare id', () => {
    expect(isBareRunId('a1b2c3d4e5f60718')).toBe(true);
    expect(isBareRunId('run-7', 'run-7')).toBe(true);
    expect(isBareRunId('baseline-gpt-mini', 'abc')).toBe(false);
  });
});
