/** C209: trimmed URLs land on real pages, and a missing page inside a project links to its runs. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The project switcher needs the signed-in user; these tests read only the crumbs after it.
vi.mock('../chrome/ProjectSwitcher', () => ({ ProjectSwitcher: () => <span>switcher</span> }));
import { Breadcrumbs } from '../chrome/Breadcrumbs';
import { parseRoute } from '../chrome/nav';
import { NotFound } from '../NotFound';
import { RunsIndexRedirect } from '../RunsIndexRedirect';

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

describe('trimmed URLs (C209)', () => {
  it('sends /projects/<slug>/runs to the project, with its query', () => {
    render(
      <MemoryRouter initialEntries={['/projects/demo/runs?q=abc&status=failed']}>
        <Routes>
          <Route path="/projects/:slug/runs" element={<RunsIndexRedirect />} />
          <Route path="/projects/:slug" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/demo?q=abc&status=failed');
  });

  it("links a missing page inside a project to that project's runs", () => {
    render(
      <MemoryRouter initialEntries={['/projects/demo/nope']}>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to runs' })).toHaveAttribute('href', '/projects/demo');
  });

  it('keeps "Back to projects" outside a project', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/');
  });

  it('shows "Projects / <slug>" when no project loads for the slug', () => {
    render(
      <MemoryRouter initialEntries={['/projects/gone']}>
        <Breadcrumbs route={parseRoute('/projects/gone')} project={null} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Projects');
    expect(nav).toHaveTextContent('gone');
  });
});

describe('run breadcrumb (C124)', () => {
  const project = { slug: 'demo', name: 'Demo', is_active: true } as unknown as Parameters<
    typeof Breadcrumbs
  >[0]['project'];

  it('keeps the run id as the last crumb and returns Runs to the filtered list', () => {
    const path = '/projects/demo/runs/run-7';
    const list = new URLSearchParams([['list', 'status=failed&q=refund']]).toString();
    render(
      <MemoryRouter initialEntries={[`${path}?${list}`]}>
        <Breadcrumbs route={parseRoute(path)} project={project} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/projects/demo?status=failed&q=refund',
    );
    expect(screen.getByText('run-7')).toHaveAttribute('aria-current', 'page');
  });

  it('links Runs to the plain list when the run was not opened from a list', () => {
    render(
      <MemoryRouter initialEntries={['/projects/demo/runs/run-7']}>
        <Breadcrumbs route={parseRoute('/projects/demo/runs/run-7')} project={project} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/projects/demo');
  });
});
