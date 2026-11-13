import { describe, expect, it } from 'vitest';
import { environmentTone } from '../lib/environment';

describe('environmentTone (cv5 M2)', () => {
  it('gives production the success tone', () => {
    expect(environmentTone('production')).toBe('success');
    expect(environmentTone(' Prod ')).toBe('success');
  });
  it('gives a pre-production environment the info tone', () => {
    for (const name of ['staging', 'preprod', 'UAT', 'dev', 'test']) expect(environmentTone(name)).toBe('info');
  });
  it('keeps an unknown or empty name neutral', () => {
    expect(environmentTone('eu-west-1')).toBe('neutral');
    expect(environmentTone('')).toBe('neutral');
    expect(environmentTone(null)).toBe('neutral');
  });
});
