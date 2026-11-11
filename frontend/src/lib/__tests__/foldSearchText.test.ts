/** C066: run and compare search fold Arabic letter forms, marks and digits like dataset search. */
import { describe, expect, it } from 'vitest';
import { foldSearchText } from '../text';

describe('foldSearchText', () => {
  it('reads alef with or without hamza, alef maqsura and diacritics the same', () => {
    expect(foldSearchText('أَحْمَد إلى آخر')).toBe(foldSearchText('احمد الي اخر'));
  });

  it('drops tatweel and keeps ta marbuta distinct from ha', () => {
    expect(foldSearchText('مـدرسة')).toBe('مدرسة');
    expect(foldSearchText('مدرسة')).not.toBe(foldSearchText('مدرسه'));
  });

  it("folds Arabic-Indic and Persian digits, so '30' finds '٣٠'", () => {
    expect(foldSearchText('٣٠ و ۲۵')).toBe('30 و 25');
  });

  it('ignores case and width (NFKC)', () => {
    expect(foldSearchText('ＡＢＣ Refund')).toBe('abc refund');
  });
});
