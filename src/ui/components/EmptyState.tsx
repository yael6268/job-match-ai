import type { ReactNode } from 'react';

export function EmptyState(props: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>{props.icon}</div>
      <div className="empty__title">{props.title}</div>
      {props.text && <p className="empty__text">{props.text}</p>}
      {props.children}
    </div>
  );
}
