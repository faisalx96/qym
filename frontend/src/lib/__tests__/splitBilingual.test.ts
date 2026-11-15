import { describe, expect, it } from 'vitest';
import { splitBilingual } from '../text';

const en = 'The answer follows the requested scope and correctly summarizes all the results.';
const ar = 'يلتزم الجواب بالنطاق المطلوب ويلخص جميع النتائج بشكل صحيح وواضح.';
describe('splitBilingual', () => {
  it.each([' / ', '\n', ' | ', ' — ', ' '])('splits the English-first shape with %j', (separator) => {
    expect(splitBilingual(`${en}${separator}${ar}`)).toEqual({ en, ar });
  });
  it('splits inline deviations with no separator and tolerates quoted Arabic and SQL', () => {
    const english = `Deviations: ${en} The phrase "تلتها" correctly describes the ranking.`;
    const arabic = `الانحرافات: ${ar} محور SQL يحتوي على LIMIT 3 وأسماء city وpopulation داخل الاستعلام.`;
    expect(splitBilingual(`${english} ${arabic}`)).toEqual({ en: english, ar: arabic });
  });
  it('splits Arabic first', () => {
    expect(splitBilingual(`${ar} / ${en}`)).toEqual({ en, ar });
  });
  it.each([
    [en, { en, ar: null }],
    [ar, { en: null, ar }],
    ['', { en: null, ar: null }],
    ['  ', { en: null, ar: null }],
    [
      `${ar} تم استخدام SELECT city FROM population LIMIT 3 لتحديد المدن.`,
      { en: null, ar: `${ar} تم استخدام SELECT city FROM population LIMIT 3 لتحديد المدن.` },
    ],
    ['Short English / العربية', { en: 'Short English / العربية', ar: null }],
  ])('keeps unsplittable text intact %#', (text, result) => {
    expect(splitBilingual(text as string)).toEqual(result);
  });
});
