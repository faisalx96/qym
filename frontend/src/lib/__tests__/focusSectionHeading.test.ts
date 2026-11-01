/** C091: a section link moves keyboard focus to the section heading, without a second scroll. */
import { describe, expect, it, vi } from 'vitest';
import { focusSectionHeading } from '../scrollToElement';

describe('focusSectionHeading', () => {
  it('makes the heading focusable by script and focuses it without scrolling', () => {
    document.body.innerHTML =
      '<section id="s"><div><h2 id="s-title">Errors</h2></div><button>x</button></section>';
    const heading = document.getElementById('s-title')!;
    const spy = vi.spyOn(heading, 'focus');
    focusSectionHeading(document.getElementById('s')!);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does nothing for a section with no heading', () => {
    document.body.innerHTML = '<section id="s"><p>no heading</p></section>';
    const before = document.activeElement;
    focusSectionHeading(document.getElementById('s')!);
    expect(document.activeElement).toBe(before);
  });
});
