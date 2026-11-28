import type { NavigateFunction } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobStatus } from '../types';
import { STATUS } from '../utils';

export function PageHeader({
  title,
  back,
  actions,
}: {
  title: ReactNode;
  back?: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back && (
        <button className="icon-btn" onClick={() => goBack(navigate)} aria-label="Back">
          ←
        </button>
      )}
      <h1>{title}</h1>
      <div className="header-actions">{actions}</div>
    </header>
  );
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return (
    <span className="badge" style={{ background: s.color }}>
      {s.label}
    </span>
  );
}

export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Back if there's a page to go back to (in the app there may not be), otherwise to `fallback`. */
export function goBack(navigate: NavigateFunction, fallback = '/') {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback);
}
