/** Cutover of test_compare_baseline_browser.py::test_baseline_from_the_link_and_a_dataset_version_notice (the notice half). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCompareModel } from '../lib/model';
import { makePayload } from '../lib/__tests__/fixtures';

let model: ReturnType<typeof buildCompareModel>;
vi.mock('../CompareContext', () => ({ useCompare: () => ({ model }) }));

import { Notices } from './Notices';

const scores = { i1: { correct: 1, quality: 0.9 } };
const build = (v1: string | undefined, v2: string | undefined) => {
  const payload = makePayload([
    { id: 'run-1', model: 'a', scores },
    { id: 'run-2', model: 'b', scores },
  ]);
  payload.runs[0]!.run.dataset_name = 'golden';
  payload.runs[1]!.run.dataset_name = 'golden';
  (payload.runs[0]!.run as unknown as Record<string, unknown>).dataset_version = v1;
  (payload.runs[1]!.run as unknown as Record<string, unknown>).dataset_version = v2;
  return buildCompareModel(payload, ['run-1', 'run-2']);
};

describe('Compare data notice', () => {
  it('names the dataset and both versions when the runs used different versions of it', () => {
    model = build('v3', 'v4');
    render(<Notices />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('different versions of golden');
    expect(note).toHaveTextContent('v3');
    expect(note).toHaveTextContent('v4');
  });

  it('shows nothing for runs of the same version', () => {
    model = build('v3', 'v3');
    const { container } = render(<Notices />);
    expect(container.querySelector('[data-notice]')).toBeNull();
  });
});
