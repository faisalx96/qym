import styles from './layout.module.css';

/** The page container, capped at --page-max-w (settings, admin, projects, overview, models). */
export const constrained = styles.constrained;
/** Text-first pages (profile): capped at --page-narrow-w. */
export const narrow = styles.narrow;
/** Full-width data page (runs, charts, datasets, compare). */
export const fullWidth = styles.fullWidth;
