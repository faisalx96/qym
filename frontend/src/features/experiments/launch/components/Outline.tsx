import { Tag } from '@/ui';
import { SECTION_TITLES, useLaunch, type SectionId } from '../LaunchContext';
import { useGoToSection } from './goToSection';
import styles from '../LaunchPage.module.css';

/** A sticky section index with live change and problem counts (the left outline of the mock, as a row). */
export function Outline({ sections }: { sections: readonly SectionId[] }) {
  const { sectionSummary } = useLaunch();
  const goTo = useGoToSection();
  return (
    <nav aria-label="Sections" className={styles.outline}>
      {sections.map((id) => {
        const { changes, problems } = sectionSummary(id);
        return (
          <button key={id} type="button" className={styles.outlineLink} onClick={() => goTo(id)}>
            {SECTION_TITLES[id]}
            {changes ? (
              <Tag kind="count" tone="info" aria-label={`${changes} changed`}>
                {changes}
              </Tag>
            ) : null}
            {problems.length ? (
              <Tag kind="count" tone="danger" aria-label={`${problems.length} problems`}>
                {problems.length}
              </Tag>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
