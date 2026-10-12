import { describe, expect, it } from 'vitest';
import {
  connectionKeysBodyValue,
  connectionKeysView,
  KEYS_HELP,
  KEYS_HELP_MOVED,
  normalizeEnvironmentUrl,
  urlMoved,
} from '../environmentUrl';

describe('normalizeEnvironmentUrl', () => {
  it('ignores case, default ports, trailing slashes and /evals', () => {
    const a = normalizeEnvironmentUrl('HTTPS://Evals.Example.com:443/api/evals/');
    expect(a).toBe('https://evals.example.com/api');
    expect(urlMoved('https://evals.example.com/api', 'HTTPS://EVALS.example.com:443/api/evals')).toBe(false);
  });
  it('detects a different host, port or path', () => {
    expect(urlMoved('https://other.example.com/api', 'https://evals.example.com/api')).toBe(true);
    expect(urlMoved('http://127.0.0.1:8905/x', 'http://127.0.0.1:8904/x')).toBe(true);
    expect(urlMoved('https://evals.example.com/v2', 'https://evals.example.com/api')).toBe(true);
  });
});

describe('connection keys rule for a moved URL', () => {
  const base = { storedUrl: 'https://a.example.com/api', storedAllow: true };
  it('shows the stored value while the URL is unchanged', () => {
    const v = connectionKeysView({
      ...base,
      draftUrl: 'https://a.example.com/api/',
      touched: false,
      draftChecked: false,
    });
    expect(v).toMatchObject({ checked: true, help: KEYS_HELP, moved: false });
  });
  it('shows it off with the explanation once the URL moved', () => {
    const v = connectionKeysView({
      ...base,
      draftUrl: 'https://b.example.com/api',
      touched: false,
      draftChecked: true,
    });
    expect(v).toMatchObject({ checked: false, help: KEYS_HELP_MOVED, moved: true });
  });
  it('keeps the explicit choice after the manager touched the box', () => {
    const v = connectionKeysView({
      ...base,
      draftUrl: 'https://b.example.com/api',
      touched: true,
      draftChecked: true,
    });
    expect(v.checked).toBe(true);
  });
  it('omits the flag from the PUT body for a moved URL without re-opt-in', () => {
    expect(
      connectionKeysBodyValue({
        storedUrl: base.storedUrl,
        draftUrl: 'https://b.example.com/api',
        touched: false,
        draftChecked: false,
      }),
    ).toBeUndefined();
    expect(
      connectionKeysBodyValue({
        storedUrl: base.storedUrl,
        draftUrl: 'https://b.example.com/api',
        touched: true,
        draftChecked: true,
      }),
    ).toBe(true);
    expect(
      connectionKeysBodyValue({
        storedUrl: base.storedUrl,
        draftUrl: base.storedUrl,
        touched: false,
        draftChecked: false,
      }),
    ).toBe(false);
  });
});
