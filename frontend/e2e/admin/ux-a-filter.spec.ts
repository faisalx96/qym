/// <reference lib="dom" />
/** UX review (area A): admin Users / Projects tables are filterable once the lists get long. */
import { test, expect } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { createUser } from '../shell/support';

test('admin users: filter by email and name, empty message', async ({ page, request }) => {
  const tag = uniqueSlug('flt');
  for (let i = 0; i < 9; i++) await createUser(request, `${tag}-${i}@e2e.test`, `Filter Person ${i}`);
  await gotoApp(page, '/admin/users');
  const grid = page.getByRole('grid', { name: 'Users' });
  await expect(grid).toBeVisible();
  const filter = page.getByRole('searchbox', { name: 'Filter users' });
  await filter.fill(`${tag}-3@`);
  await expect(grid.getByRole('row')).toHaveCount(2); // header + the match
  await filter.fill(`filter person 4`);
  await expect(grid.getByRole('row').filter({ hasText: `${tag}-4@e2e.test` })).toHaveCount(1);
  await filter.fill('no-such-user-zzz');
  await expect(page.getByText('No users match “no-such-user-zzz”.')).toBeVisible();
  await expect(grid).toHaveCount(0);
  await filter.fill('');
  await expect(grid).toBeVisible();
});

test('admin projects: filter by name or slug', async ({ page, request }) => {
  const tag = uniqueSlug('pflt');
  for (let i = 0; i < 9; i++) await createProject(request, `Filterable ${i}`, `${tag}-${i}`);
  await gotoApp(page, '/admin/projects');
  const filter = page.getByRole('searchbox', { name: 'Filter projects' });
  await filter.fill(`${tag}-5`);
  await expect(page.getByRole('grid').getByRole('row')).toHaveCount(2);
  await filter.fill('zzz-none');
  await expect(page.getByText('No projects match “zzz-none”.')).toBeVisible();
});
