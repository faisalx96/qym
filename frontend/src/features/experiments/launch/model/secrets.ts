/**
 * Temporary-model API keys live ONLY here: a Map behind a private field, held by the
 * form in a ref. They are never part of the LaunchDocument, never serialised
 * (`JSON.stringify(store)` is `{}`), never put in the URL, storage or the DOM, and
 * are cleared on unmount / after launch.
 */
export class SecretStore {
  readonly #keys = new Map<string, string>();

  /** A fresh opaque reference for `{"$secret": ref}`. */
  newRef(): string {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
      crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return 'tmp-' + Date.now().toString(36) + '-' + rand;
  }

  /** Stores a key under a ref (new when omitted) and returns the ref. */
  put(key: string, ref?: string): string {
    const r = ref ?? this.newRef();
    this.#keys.set(r, key);
    return r;
  }

  get(ref: string): string | undefined {
    return this.#keys.get(ref);
  }

  has(ref: string): boolean {
    return this.#keys.has(ref);
  }

  delete(ref: string): void {
    this.#keys.delete(ref);
  }

  get size(): number {
    return this.#keys.size;
  }

  /** Forgets every key whose ref is not in `inUse`. */
  retainOnly(inUse: Iterable<string>): void {
    const keep = new Set(inUse);
    for (const ref of Array.from(this.#keys.keys())) if (!keep.has(ref)) this.#keys.delete(ref);
  }

  /** `{ref: key}` for the refs the request uses (the `secrets` body field). */
  pick(refs: Iterable<string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const key = this.#keys.get(ref);
      if (key !== undefined) out[ref] = key;
    }
    return out;
  }

  clear(): void {
    this.#keys.clear();
  }

  toJSON(): Record<string, never> {
    return {};
  }

  toString(): string {
    return '[SecretStore]';
  }
}
