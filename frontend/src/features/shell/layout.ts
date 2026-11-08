import styles from './layout.module.css';

/** The page container, capped at --page-max-w (settings, admin, projects, overview, models). */
export const constrained = styles.constrained;
/** cv3-shim: remove after E-42 (deprecated: the narrow container is removed; Profile uses `constrained`). */
export const narrow = styles.constrained;
/** Full-width data page (runs, charts, datasets, compare). */
export const fullWidth = styles.fullWidth;
