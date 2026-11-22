import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StatusMark } from './StatusMark';

/** 17 Nov R7: the running orbit is animated, CSS only, on the motion tokens, and still under reduced motion. */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'StatusMark.module.css'), 'utf-8');

describe('StatusMark orbit', () => {
  it('gives each ring pixel its clockwise phase; the centre and other shapes get none', () => {
    const { container } = render(<StatusMark tone="info" shape="orbit" label="Running" />);
    const rects = Array.from(container.querySelectorAll('rect'));
    const phase = rects.map((r) => r.style.getPropertyValue('--ring-i'));
    // cells 0..8 row by row; the ring runs 0 1 2 5 8 7 6 3 clockwise
    expect(phase).toEqual(['0', '1', '2', '7', '', '3', '6', '5', '4']);
    const ring = render(<StatusMark tone="neutral" shape="ring" label="Queued" />).container;
    expect(Array.from(ring.querySelectorAll('rect')).every((r) => !r.style.getPropertyValue('--ring-i'))).toBe(
      true,
    );
  });

  it('animates the ring through --motion-step and stops under prefers-reduced-motion', () => {
    expect(css).toMatch(/@keyframes orbit/);
    expect(css).toMatch(
      /\[data-shape='orbit'\] rect\[data-ring\] \{[^}]*animation: orbit calc\(var\(--motion-step\) \* 8\) linear infinite;/,
    );
    expect(css).toMatch(/animation-delay: calc\(var\(--motion-step\) \* \(var\(--ring-i, 0\) - 8\)\)/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.mark\[data-shape='orbit'\] rect\[data-ring\] \{\s*animation: none;/,
    );
    // the still figure stays the fallback: the first ring pixel lit
    expect(css).toMatch(/\[data-shape='orbit'\] rect\[data-ring\]:first-child \{\s*opacity: 1;/);
  });
});
