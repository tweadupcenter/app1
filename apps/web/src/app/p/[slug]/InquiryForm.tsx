'use client';
import { useEffect, useState } from 'react';
import { translator, type Locale } from '@/lib/i18n';

export function InquiryForm({ slug, lots, locale, defaultLot, defaultKind = 'info', onDone }: { slug: string; lots: { id: string; reference: string }[]; locale: Locale; defaultLot?: string | null; defaultKind?: 'info' | 'appointment'; onDone?: () => void }) {
  const t = translator(locale);
  const [kind, setKind] = useState<'info' | 'appointment'>(defaultKind);
  const [lot, setLot] = useState(defaultLot ?? '');
  const [key, setKey] = useState('');
  const [state, setState] = useState<{ ok?: boolean; text?: string; busy?: boolean }>({});
  useEffect(() => { setKey(crypto.randomUUID()); }, []);
  useEffect(() => { setLot(defaultLot ?? ''); }, [defaultLot]);
  useEffect(() => { setKind(defaultKind); }, [defaultKind]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ busy: true });
    const r = await fetch(`/api/public/${slug}/inquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind, full_name: f.get('full_name'), email: f.get('email'), phone: f.get('phone'), message: f.get('message'), lot_id: lot || null,
      preferred_at: f.get('preferred_at') ?? '', consent: f.get('consent') === 'on', idempotency_key: key, website: f.get('website') ?? '' }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setState({ ok: true, text: t('public.sent') }); (e.target as HTMLFormElement).reset(); setKey(crypto.randomUUID()); onDone?.(); }
    else setState({ ok: false, text: j.error ?? t('common.error') });
  }
  return (
    <form onSubmit={submit} className="stack" data-testid="inquiry-form">
      <div className="row">
        <button type="button" className={`btn btn-sm ${kind === 'info' ? 'on' : ''}`} onClick={() => setKind('info')}>{t('public.requestInfo')}</button>
        <button type="button" className={`btn btn-sm ${kind === 'appointment' ? 'on' : ''}`} onClick={() => setKind('appointment')}>{t('public.bookVisit')}</button>
      </div>
      <label className="field"><span>{t('public.name')}</span><input name="full_name" required minLength={2} autoComplete="name" /></label>
      <div className="grid grid-2">
        <label className="field"><span>{t('public.email')}</span><input name="email" type="email" autoComplete="email" /></label>
        <label className="field"><span>{t('public.phone')}</span><input name="phone" type="tel" autoComplete="tel" /></label>
      </div>
      <label className="field"><span>Lot</span><select value={lot} onChange={(e) => setLot(e.target.value)} name="lot"><option value="">—</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.reference}</option>)}</select></label>
      {kind === 'appointment' && <label className="field"><span>{t('public.preferredAt')} (heure de Casablanca)</span><input name="preferred_at" type="datetime-local" required /></label>}
      <label className="field"><span>{t('public.message')}</span><textarea name="message" maxLength={4000} /></label>
      <input name="website" tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden="true" />
      <label className="check small"><input type="checkbox" name="consent" required /> <span>{t('public.consent')}</span></label>
      <button className="btn btn-primary" disabled={state.busy || !key}>{state.busy ? '…' : t('public.send')}</button>
      {state.text && <div className={`alert ${state.ok ? 'alert-success' : 'alert-error'}`} role="status">{state.text}</div>}
    </form>
  );
}
