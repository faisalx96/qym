/**
 * Dev-only mock route registry. An area's design agent registers its variants
 * here; each one is reachable at /app/__mock/<area>/<variant> on the dev
 * server. Entries are tree-shaken out of production builds (import.meta.env.DEV).
 */
import type { ComponentType, LazyExoticComponent } from 'react';

export interface MockRoute {
  area: string;
  variant: string;
  title: string;
  component: LazyExoticComponent<ComponentType> | ComponentType;
}

// `var` + lazy init on purpose: the register files imported at the bottom of this
// module import `registerMock` back from here, so they evaluate BEFORE this body
// runs; a `const` would still be in its temporal dead zone at that point.
// eslint-disable-next-line no-var
export var mockRoutes: MockRoute[];
mockRoutes ??= [];

export function registerMock(route: MockRoute): void {
  (mockRoutes ??= []).push(route);
}
// Area agents append one line per area, e.g.
// import '@/features/runs/__mocks__/register';
