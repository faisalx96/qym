/** Round 5 R3: a long key is cut at its column (ellipsis, title = the key), never painted over the value. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldRow } from './FieldRow';

describe('FieldRow label', () => {
  it('carries the raw key as its title and a truncation class', () => {
    render(
      <FieldRow label="self_consistency_check_result" labelAnchor="start">
        <p>value</p>
      </FieldRow>,
    );
    const label = screen.getByText('self_consistency_check_result');
    expect(label).toHaveAttribute('title', 'self_consistency_check_result');
    expect(label.className).toMatch(/label/);
  });

  it('takes an explicit title and the sentence case marker', () => {
    render(
      <FieldRow
        label="Self consistency check result"
        labelTitle="self_consistency_check_result"
        labelCase="sentence"
      >
        <p>value</p>
      </FieldRow>,
    );
    const label = screen.getByText('Self consistency check result');
    expect(label).toHaveAttribute('title', 'self_consistency_check_result');
    expect(label).toHaveAttribute('data-case', 'sentence');
  });
});
