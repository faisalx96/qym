/** The one sticky element of the page: a links-only jump nav, 36 px (owner decision H5). The controls live in their sections. */
import { ReportNav } from './ReportSections';
import styles from './CompareBar.module.css';

export function CompareBar() {
  return (
    <div className={styles.bar} data-compare-sticky="" data-part="section-nav">
      <ReportNav />
    </div>
  );
}
