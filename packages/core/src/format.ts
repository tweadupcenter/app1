export const TIMEZONE = 'Africa/Casablanca';

export function formatMAD(v: number | string | null | undefined, locale: 'fr' | 'ar' = 'fr'): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : 'fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 0 }).format(n);
}

export function formatM2(v: number | string | null | undefined, locale: 'fr' | 'ar' = 'fr'): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-MA' : 'fr-FR', { maximumFractionDigits: 2 }).format(n)} m²`;
}

export function formatDateTime(d: Date | string | null | undefined, locale: 'fr' | 'ar' = 'fr'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIMEZONE }).format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined, locale: 'fr' | 'ar' = 'fr'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : 'fr-FR', { dateStyle: 'medium', timeZone: TIMEZONE }).format(new Date(d));
}

/** Convertit une saisie datetime-local (heure de Casablanca) en instant UTC ISO. */
export function casablancaLocalToIso(local: string): string {
  // Approche robuste sans dépendance : on calcule le décalage du fuseau à cet instant.
  const [date, time = '00:00'] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMinutes(new Date(guess), TIMEZONE);
  return new Date(guess - offset * 60000).toISOString();
}

export function isoToCasablancaLocal(iso: string | Date): string {
  const dt = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Lien WhatsApp préremplis (n'envoie rien : ouvre l'application avec le message). */
export function whatsappLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
