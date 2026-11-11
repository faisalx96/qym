import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@/api/types';
import { Breadcrumbs } from '../Breadcrumbs';
import type { RouteContext } from '../nav';

vi.mock('../ProjectSwitcher', () => ({ ProjectSwitcher: () => <span>Project</span> }));

const project = { slug: 'p', name: 'P' } as Project;

function crumbs(page: string, url: string) {
  const route: RouteContext = { page, projectSlug: 'p', runId: null, label: page };
  render(
    <MemoryRouter initialEntries={[url]}>
      <Breadcrumbs route={route} project={project} />
    </MemoryRouter>,
  );
  return within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
    .getAllByRole('listitem')
    .slice(1);
}

describe('Breadcrumbs', () => {
  it('E-04: the Environments list reads Experiments › Environments', () => {
    const [experiments, environments] = crumbs('environments', '/projects/p/environments');
    expect(within(experiments!).getByRole('link', { name: 'Experiments' })).toBeInTheDocument();
    expect(environments).toHaveTextContent('Environments');
    expect(within(environments!).getByText('Environments')).toHaveAttribute('aria-current', 'page');
  });

  it('E-05: a dataset item page ends with the item crumb after a dataset link', () => {
    const items = crumbs('datasets', '/projects/p/datasets/d?item=tkt-0001');
    const last = items[items.length - 1]!;
    const before = items[items.length - 2]!;
    const label = within(last).getByText('tkt-0001');
    expect(label).toHaveAttribute('aria-current', 'page');
    expect(label).not.toHaveAttribute('data-mono');
    expect(within(before).getByRole('link')).toHaveAttribute('href', '/projects/p/datasets/d');
  });
});
