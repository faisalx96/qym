import { useId, type ReactNode } from 'react';
import { Card as UiCard, Text } from '@/ui';
import s from './blocks.module.css';

interface CardProps {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}

/** Section card: --font-xl section title, muted description, optional header aside. */
export function Card({ title, description, aside, children, className, id }: CardProps) {
  const uid = useId();
  const head = (
    <header className={s.cardHead}>
      <div className={s.cardTitles}>
        <Text variant="xl" id={`${uid}-t`} as="h3">
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
  );
  return (
    <UiCard as="section" className={className} aria-labelledby={`${uid}-t`} id={id}>
      {head}
      {children ? <div className={s.cardBody}>{children}</div> : null}
    </UiCard>
  );
}
