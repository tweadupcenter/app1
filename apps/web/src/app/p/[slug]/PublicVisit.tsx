'use client';
import { useState } from 'react';
import { formatM2, formatMAD, whatsappLink, LOT_TYPES } from '@immo/core';
import { SceneViewer } from '@/components/visit/SceneViewer';
import type { SceneData } from '@/lib/scene-types';
import { translator, type Locale } from '@/lib/i18n';
import { InquiryForm } from './InquiryForm';

export function PublicVisit({ data, locale }: { data: SceneData; locale: Locale }) {
  const t = translator(locale);
  const slug = data.project.slug;
  const [formLot, setFormLot] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: 'available', type: '', rooms: '', building: '' });
  const lots = data.lots.filter((l) => (!filters.status || l.status === filters.status) && (!filters.type || l.type === filters.type) && (!filters.rooms || (l.rooms ?? 0) >= Number(filters.rooms)) && (!filters.building || l.building_id === filters.building));
  const wa = data.contact?.whatsapp ? whatsappLink(data.contact.whatsapp, `Bonjour, je suis intéressé(e) par le projet ${data.project.name}${formLot ? ` (lot ${data.lots.find((l) => l.id === formLot)?.reference})` : ''}.`) : null;
  return (
    <>
      <SceneViewer data={data} locale={locale} className="public" statusUrl={`/api/public/${slug}/status`}
        lotHref={(l) => `/p/${slug}/lots/${l.id}`} pdfHref={(l) => `/api/public/${slug}/lots/${l.id}/pdf`}
        onInquire={(l) => { setFormLot(l.id); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }} />
      <section className="pub-section">
        <h2>{t('public.lots')}</h2>
        <div className="row" style={{ marginBottom: 10 }} aria-label={t('public.filters')}>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Statut"><option value="">{t('common.all')}</option>{['available', 'option', 'reserved', 'sold'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} aria-label="Type"><option value="">{t('common.all')}</option>{LOT_TYPES.filter((x) => data.lots.some((l) => l.type === x)).map((s) => <option key={s} value={s}>{t(`type.${s}`)}</option>)}</select>
          <select value={filters.building} onChange={(e) => setFilters({ ...filters, building: e.target.value })} aria-label={t('lot.building')}><option value="">{t('common.all')}</option>{data.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <input type="number" min={0} placeholder={`${t('lot.rooms')} min.`} value={filters.rooms} onChange={(e) => setFilters({ ...filters, rooms: e.target.value })} style={{ width: 110 }} />
          <span className="small muted">{lots.length} / {data.lots.length}</span>
        </div>
        <div className="lot-cards" data-testid="public-lots">
          {lots.map((l) => (
            <div key={l.id} className="lot-card">
              <div className="row between"><b>{l.reference}</b><span className={`badge st-${l.status}`}>{t(`status.${l.status}`)}</span></div>
              <span className="small">{t(`type.${l.type}`)} · {l.rooms ?? '—'} {t('lot.rooms').toLowerCase()} · {formatM2(l.surface_comm_m2, locale)}</span>
              <span>{l.price_public && l.price != null ? formatMAD(l.price, locale) : t('lot.priceOnRequest')}</span>
              <div className="row"><a className="btn btn-sm" href={`/p/${slug}/lots/${l.id}`}>{t('lot.open')}</a><button className="btn btn-sm" onClick={() => { setFormLot(l.id); document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('public.requestInfo')}</button></div>
            </div>
          ))}
        </div>
      </section>
      <section className="pub-section grid grid-2" id="contact">
        <div className="card">
          <h2>{t('public.requestInfo')} / {t('public.bookVisit')}</h2>
          <InquiryForm slug={slug} lots={data.lots.map((l) => ({ id: l.id, reference: l.reference }))} locale={locale} defaultLot={formLot} />
        </div>
        <div className="card stack">
          <h2>Contact</h2>
          <div>{data.contact?.orgName}</div>
          {data.contact?.phone && <div>{t('public.phone')} : {data.contact.phone}</div>}
          {data.contact?.email && <div>{t('public.email')} : <a href={`mailto:${data.contact.email}`}>{data.contact.email}</a></div>}
          {wa ? <a className="btn btn-accent" href={wa} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">{t('public.whatsapp')}</a>
            : <p className="small muted">Contact WhatsApp non configuré par l’organisation.</p>}
          <p className="small muted">Le lien WhatsApp ouvre un message prérempli que vous pouvez modifier ; rien n’est envoyé automatiquement.</p>
        </div>
      </section>
    </>
  );
}
