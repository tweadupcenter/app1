import { notFound } from 'next/navigation';
import { getLocale } from '@/lib/locale';
import { translator } from '@/lib/i18n';
import { setLanguage } from '@/lib/actions-common';
import { loadPublication } from './data';

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await loadPublication(slug);
  if (!d) notFound();
  const locale = await getLocale();
  const t = translator(locale);
  const color = d.pub.snapshot.org.branding?.primary_color ?? '#1f4e5f';
  const logo = d.pub.snapshot.org.branding?.logo_media_id;
  return (
    <div style={{ ['--c-primary' as any]: color }}>
      {d.scene.project.is_fictional && <div className="fictional-banner">{t('public.fictional')}</div>}
      <header className="pub-head">
        <div className="row">
          {logo && d.pub.snapshot && <img src={`/api/public/${slug}/files/${logo}`} alt="" style={{ height: 28 }} />}
          <a href={`/p/${slug}`} className="title" style={{ color: 'inherit' }}>{d.scene.project.name}</a>
          <span className="small muted">{d.pub.snapshot.org.name}</span>
        </div>
        <form action={setLanguage} className="row">
          <button name="lang" value="fr" className={`btn btn-sm ${locale === 'fr' ? 'on' : ''}`}>FR</button>
          <button name="lang" value="ar" className={`btn btn-sm ${locale === 'ar' ? 'on' : ''}`}>العربية</button>
          <a className="btn btn-sm btn-primary" href={`/p/${slug}#contact`}>{t('public.bookVisit')}</a>
        </form>
      </header>
      {children}
      <footer className="pub-section small muted">Version publiée v{d.pub.version} · Informations non contractuelles · Propulsé par Tweadup Immo 360</footer>
    </div>
  );
}
