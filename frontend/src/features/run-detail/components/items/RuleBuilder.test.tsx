/**
 * Cutover of the "score rule is written and shown as a percentage" cases of
 * test_run_filter_fields_javascript.py: a stored 0.6 shows as 60 with a % unit, typing 75 stores
 * 0.75, and a count metric shows its own units.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FieldDef, FilterGroup } from '../../lib/filterRules';
import { RuleBuilder } from './RuleBuilder';

const defs: FieldDef[] = [
  {
    id: 'metric:accuracy',
    label: 'accuracy',
    group: 'Metrics',
    kind: 'number',
    percent: true,
    get: () => null,
  },
  { id: 'metric:tokens', label: 'tokens', group: 'Metrics', kind: 'number', percent: false, get: () => null },
];

const rules = (field: string, value: string): FilterGroup => ({
  op: 'and',
  children: [{ field, oper: 'gt', value }],
});

describe('RuleBuilder score values', () => {
  it('shows a stored 0.6 as 60 with a % unit and stores what is typed as a fraction', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RuleBuilder rules={rules('metric:accuracy', '0.6')} defs={defs} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'accuracy value' });
    expect(input).toHaveValue('60');
    expect(screen.getByText('%')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '75');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0] as FilterGroup;
    expect(last.children[0]).toMatchObject({ field: 'metric:accuracy', oper: 'gt', value: '0.75' });
  });

  it('a count keeps its own units', () => {
    render(<RuleBuilder rules={rules('metric:tokens', '12')} defs={defs} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'tokens value' })).toHaveValue('12');
    expect(screen.queryByText('%')).toBeNull();
  });
});
