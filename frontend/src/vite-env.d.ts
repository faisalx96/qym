/// <reference types="vite/client" />

// Build-time docs content (frontend/plugins/docs-content.ts); typed in features/docs/content.ts.
declare module 'virtual:qym-docs/pages' {
  export const loaders: Record<string, () => Promise<{ default: unknown }>>;
}
declare module 'virtual:qym-docs/search' {
  const records: unknown;
  export default records;
}
