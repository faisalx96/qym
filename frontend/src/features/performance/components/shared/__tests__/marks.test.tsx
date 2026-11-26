import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Quantity } from '../marks';

describe('Quantity', () => {
  it('writes a unit in words after a space by default: "30 of 60 users"', () => {
    const { container } = render(<Quantity value={30} unit="of 60 users" />);
    expect(container.textContent).toBe('30 of 60 users');
    expect(container.querySelector('[data-tight]')).toBeNull();
  });

  it('`tight` sets a unit glyph on the number with no gap, in the quiet unit type (C2: "48.0s")', () => {
    const { container } = render(<Quantity value="48.0" unit="s" tight />);
    expect(container.textContent).toBe('48.0s');
    const unit = container.querySelector('[data-tight]');
    expect(unit?.textContent).toBe('s');
  });
});
