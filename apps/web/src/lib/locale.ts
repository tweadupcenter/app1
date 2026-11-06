import 'server-only';
import { cookies } from 'next/headers';
import { translator, type Locale } from './i18n';

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const v = jar.get('lang')?.value;
  return v === 'ar' ? 'ar' : 'fr';
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}
