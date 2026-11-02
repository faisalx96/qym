import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keyWithBreaks } from '../keyBreaks';

const html = (key: string) => {
  const { container } = render(<span>{keyWithBreaks(key)}</span>);
  return container.innerHTML.replace(/<\/?span>/g, '');
};

describe('keyWithBreaks', () => {
  it('breaks after _ - . and before a camelCase capital, adding no character', () => {
    expect(html('self_consistency_check')).toBe('self_<wbr>consistency_<wbr>check');
    expect(html('retrievedPolicyDocument')).toBe('retrieved<wbr>Policy<wbr>Document');
    expect(html('a.b-c')).toBe('a.<wbr>b-<wbr>c');
    for (const k of [
      'self_consistency_check',
      'retrievedPolicyDocument',
      'تحليل_أهلية_العميل',
      'confidence',
      'HTTPServer',
    ])
      expect(render(<span>{keyWithBreaks(k)}</span>).container.textContent).toBe(k);
  });

  it('leaves a single word alone', () => {
    expect(html('confidence')).toBe('confidence');
  });
});
