import { Link } from 'react-router-dom';
import styles from './feedback.module.css';

/** `FB-0031` as a link to the request (only in tool lines, related requests and banners: QE-90). */
export function RequestLink({ id, small }: { id: string; small?: boolean }) {
  return (
    <Link to={`/feedback/${id}`} className={styles.idLink} data-link-sm={small ? '' : undefined} data-request-link={id}>
      {id}
    </Link>
  );
}
