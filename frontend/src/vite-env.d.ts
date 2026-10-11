/// <reference types="vite/client" />

// Build-time docs content (frontend/plugins/docs-content.ts).
declare module 'virtual:qym-docs/pages' {
  export const loaders: Record<string, () => Promise<{ default: import('@/features/docs/content').DocsPagePayload | null }>>;
}
declare module 'virtual:qym-docs/search' {
  const records: import('@/features/docs/content').SearchRecord[];
  export default records;
}
