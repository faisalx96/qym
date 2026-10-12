import { useId, type ReactNode } from 'react';
import { Text } from '@/ui';
import s from './blocks.module.css';

interface CardProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}

/** Section card: --font-md title, muted description, optional header aside. */
export function Card({ title, description, aside, children, className, id }: CardProps) {
  const uid = useId();
  return (
    <section className={[s.card, className].filter(Boolean).join(' ')} aria-labelledby={`${uid}-t`} id={id}>
      <header className={s.cardHead}>
        <div className={s.cardTitles}>
          <Text variant="md" weight={600} id={`${uid}-t`} as="h3">
            {title}
          </Text>
          {description ? (
            <Text variant="sm" tone="muted" as="p">
              {description}
            </Text>
          ) : null}
        </div>
        {aside ? <div className={s.cardAside}>{aside}</div> : null}
      </header>
      {children ? <div className={s.cardBody}>{children}</div> : null}
    </section>
  );
}
