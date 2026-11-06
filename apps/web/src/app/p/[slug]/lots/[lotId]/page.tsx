import { notFound } from 'next/navigation';
import { formatM2, formatMAD, whatsappLink } from '@immo/core';
import { getLocale } from '@/lib/locale';
import { translator } from '@/lib/i18n';
import { loadPublication } from '../../data';
import { InquiryForm } from '../../InquiryForm';

export default async function PublicLot({ params }: { params: Promise<{ slug: string; lotId: string }> }) {
  const { slug, lotId } = await params;
  const d = await loadPublication(slug);
  const lot = d?.scene.lots.find((l) => l.id === lotId);
  if (!d || !lot) notFound();
  const locale = await getLocale();
  const t = translator(locale);
  const b = d.scene.buildings.find((x) => x.id === lot.building_id);
  const f = d.scene.floors.find((x) => x.id === lot.floor_id);
  const wa = d.scene.contact?.whatsapp ? whatsappLink(d.scene.contact.whatsapp, `Bonjour, je souhaite des informations sur le lot ${lot.reference} du projet ${d.scene.project.name}.`) : null;
  const imgs = [lot.plan_media_id, ...lot.image_media_ids].filter(Boolean) as string[];
  return (
    <div className="pub-section">
      <a href={`/p/${slug}`} className="small">← {d.scene.project.name}</a>
      <div className="row between"><h1 data-testid="public-lot-title">{lot.reference}</h1><span className={`badge st-${lot.status}`} data-status={lot.status}>{t(`status.${lot.status}`)}</span></div>
      <div className="grid grid-side">
        <div className="card">
          <dl className="kv">
            <dt>Type</dt><dd>{t(`type.${lot.type}`)}</dd>
            <dt>{t('lot.building')}</dt><dd>{b?.name ?? '—'}</dd><dt>{t('lot.floor')}</dt><dd>{f?.name ?? '—'}</dd>
            <dt>{t('lot.rooms')}</dt><dd>{lot.rooms ?? '—'}</dd><dt>{t('lot.bedrooms')}</dt><dd>{lot.bedrooms ?? '—'}</dd>
            <dt>{t('lot.surface')}</dt><dd>{formatM2(lot.surface_comm_m2, locale)}</dd>
            {lot.surface_terrace_m2 != null && <><dt>{t('lot.terrace')}</dt><dd>{formatM2(lot.surface_terrace_m2, locale)}</dd></>}
            {lot.surface_garden_m2 != null && <><dt>{t('lot.garden')}</dt><dd>{formatM2(lot.surface_garden_m2, locale)}</dd></>}
            <dt>{t('lot.orientation')}</dt><dd>{lot.orientation ?? '—'}</dd>
            <dt>{t('lot.price')}</dt><dd>{lot.price_public && lot.price != null ? formatMAD(lot.price, locale) : t('lot.priceOnRequest')}</dd>
          </dl>
          {lot.features.length > 0 && <p>{lot.features.join(' · ')}</p>}
          {lot.description && <p className="muted">{lot.description}</p>}
          <div className="row">
            <a className="btn" href={`/api/public/${slug}/lots/${lot.id}/pdf`} target="_blank" rel="noreferrer">{t('lot.pdf')}</a>
            <a className="btn" href={`/p/${slug}`}>Voir dans la visite 3D</a>
            {wa && <a className="btn btn-accent" href={wa} target="_blank" rel="noopener noreferrer">{t('public.whatsapp')}</a>}
          </div>
          {imgs.length > 0 && <div className="thumbs" style={{ marginTop: 12 }}>{imgs.map((id) => <img key={id} src={`/api/public/${slug}/files/${id}`} alt={id === lot.plan_media_id ? 'Plan' : 'Image'} />)}</div>}
        </div>
        <div className="card"><h2>{t('public.requestInfo')}</h2><InquiryForm slug={slug} lots={[{ id: lot.id, reference: lot.reference }]} locale={locale} defaultLot={lot.id} /></div>
      </div>
    </div>
  );
}
