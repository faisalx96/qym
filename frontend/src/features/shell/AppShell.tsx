import { Outlet } from 'react-router-dom';

/** Placeholder until the shell design is chosen (see __mocks__/UX_DECISION.md). */
export function AppShell() {
  return (
    <div data-app-shell>
      <Outlet />
    </div>
  );
}
