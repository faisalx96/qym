import { describe, expect, it } from 'vitest';
import { formatDetail } from '../http';

describe('formatDetail', () => {
  it('passes strings through', () => expect(formatDetail('Nope')).toBe('Nope'));
  it('renders Pydantic detail arrays as field messages', () => {
    expect(
      formatDetail([
        { type: 'string_too_short', loc: ['body', 'value'], msg: 'String should have at least 1 character' },
        { loc: ['query', 'limit'], msg: 'Input should be less than 500' },
      ]),
    ).toBe('value: String should have at least 1 character\nlimit: Input should be less than 500');
  });
  it('drops an empty location', () =>
    expect(formatDetail([{ loc: ['body'], msg: 'Field required' }])).toBe('Field required'));
});
