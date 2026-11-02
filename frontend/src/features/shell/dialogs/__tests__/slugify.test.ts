import { describe, expect, it } from 'vitest';
import { slugify } from '../CreateProjectDialog';

describe('slugify (mirrors the server)', () => {
  it('lowercases and dashes', () => expect(slugify('Customer Support Bot!')).toBe('customer-support-bot'));
  it('falls back to "project" when no Latin letters remain', () => expect(slugify('مشروع')).toBe('project'));
  it('is empty for an empty name', () => expect(slugify('  ')).toBe(''));
});
