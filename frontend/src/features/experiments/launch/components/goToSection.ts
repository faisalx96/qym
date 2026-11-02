import { useCallback } from 'react';
import { revealElement } from '../state/useSections';
import { sectionHeadingId, type SectionId } from '../types';
import { useLaunch } from '../LaunchContext';

/** Opens a section and scrolls to / focuses its heading (the "Edit" links and the outline). */
export function useGoToSection() {
  const { openSection } = useLaunch();
  return useCallback(
    (id: SectionId) => {
      openSection(id);
      setTimeout(() => {
        const heading = document.getElementById(sectionHeadingId(id));
        if (heading) revealElement(heading);
      }, 0);
    },
    [openSection],
  );
}
