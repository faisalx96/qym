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

export const mockRoutes: MockRoute[] = [];

export function registerMock(route: MockRoute): void {
  mockRoutes.push(route);
}
