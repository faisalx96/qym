/**
 * Run `load` once and hand every caller the same promise. Needed for dynamic imports that are started early (prefetch)
 * and again by `React.lazy`: Vite's preload helper skips a stylesheet whose `<link>` already exists without waiting for
 * it, so a second `import()` of the same chunk can resolve before its CSS has loaded and render the page unstyled.
 */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= load());
}
