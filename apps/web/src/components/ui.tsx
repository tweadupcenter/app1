import type { LotStatus } from '@immo/core';
import { translator, type Locale } from '@/lib/i18n';

export function StatusBadge({ status, locale = 'fr' }: { status: LotStatus | string; locale?: Locale }) {
  return <span className={`badge st-${status}`} data-status={status}>{translator(locale)(`status.${status}`)}</span>;
}

export function ProvTag({ p }: { p: string }) {
  return <span className={`tag prov-${p}`}>{translator('fr')(`prov.${p}`)}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHead({ title, subtitle, crumbs, children }: { title: string; subtitle?: React.ReactNode; crumbs?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
