/** C076: a deferred section body mounts once the page is past its first paint, or when it nears the viewport. */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deferred } from './Deferred';

afterEach(() => vi.unstubAllGlobals());

describe('Deferred', () => {
  it('holds its place until ready, then mounts its children', () => {
    // an observer that never reports: the section is far below the fold
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const { rerender } = render(
      <Deferred ready={false}>
        <p>breakdown</p>
      </Deferred>,
    );
    expect(screen.queryByText('breakdown')).toBeNull();
    rerender(
      <Deferred ready>
        <p>breakdown</p>
      </Deferred>,
    );
    expect(screen.getByText('breakdown')).toBeTruthy();
  });

  it('mounts at once where there is no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(
      <Deferred ready={false}>
        <p>breakdown</p>
      </Deferred>,
    );
    expect(screen.getByText('breakdown')).toBeTruthy();
  });
});
