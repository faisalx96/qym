/** Round 3 P5: with labelAnchor="start" the row is left to right and only the value carries the Arabic direction. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldRow } from './FieldRow';

const arabic = 'ما هي شروط الحصول على تمويل عقاري؟';

describe('FieldRow labelAnchor', () => {
  it('start: the row is ltr, the value box takes rtl, the label is unchanged', () => {
    render(
      <FieldRow label="Input" text={arabic} labelAnchor="start">
        <p>{arabic}</p>
      </FieldRow>,
    );
    const row = screen.getByRole('group', { name: 'Input' });
    expect(row).toHaveAttribute('dir', 'ltr');
    expect(row.querySelector('[dir=rtl]')).not.toBeNull();
    expect(row.querySelector('[dir=rtl]')!.contains(screen.getByText(arabic))).toBe(true);
  });

  it('auto (default): the row itself mirrors, as before', () => {
    render(
      <FieldRow label="Input" text={arabic}>
        <p>{arabic}</p>
      </FieldRow>,
    );
    expect(screen.getByRole('group', { name: 'Input' })).toHaveAttribute('dir', 'rtl');
  });
});
