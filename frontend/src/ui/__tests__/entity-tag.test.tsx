import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { DatasetTag, ModelTag, TaskTag } from '@/ui';

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
    const ds = screen.getByTitle('spider-dev · version 3 · aliases: golden');
    expect(ds).toHaveAttribute('data-kind', 'dataset');
    expect(ds).toHaveTextContent('v3');
    expect(screen.getByText('golden')).toBeInTheDocument();
    const model = screen.getByTitle('gpt-4o');
    expect(model).toHaveAttribute('data-series', '2');
    expect(model).toHaveTextContent('reasoning');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('does not double the v of a version that already has one', () => {
    render(<DatasetTag name="d" version="v2" />);
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});
