import './globals.css';
import type { Metadata, Viewport } from 'next';
import { getLocale } from '@/lib/locale';
import { dir } from '@/lib/i18n';

export const metadata: Metadata = {
  title: { default: 'Tweadup Immo 360', template: '%s · Tweadup Immo 360' },
  description: 'Présentation 3D, gestion des lots et CRM pour promoteurs immobiliers.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === 'ar' ? 'ar-MA' : 'fr-MA'} dir={dir(locale)}>
      <body>{children}</body>
    </html>
  );
}
