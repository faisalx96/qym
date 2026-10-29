import { describe, expect, it } from 'vitest';
import { keyHostChanged } from '../keyHost';

describe('keyHostChanged (C004)', () => {
  const stored = 'https://api.example.com/v1';

  it('keeps the key for a new path on the same scheme, host and port', () => {
    expect(keyHostChanged(stored, 'https://API.example.com:443/v2/')).toBe(false);
    expect(keyHostChanged('http://localhost/v1', 'http://localhost:80/x')).toBe(false);
  });

  it('needs the key again for another host, scheme or port', () => {
    expect(keyHostChanged(stored, 'https://other.example.com/v1')).toBe(true);
    expect(keyHostChanged(stored, 'https://api.example.com.evil.test/v1')).toBe(true);
    expect(keyHostChanged(stored, 'http://api.example.com/v1')).toBe(true);
    expect(keyHostChanged(stored, 'https://api.example.com:8443/v1')).toBe(true);
  });

  it('compares the raw text when a URL does not parse', () => {
    expect(keyHostChanged(stored, 'not a url')).toBe(true);
    expect(keyHostChanged('', '')).toBe(false);
  });
});
