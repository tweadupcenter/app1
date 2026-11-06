import { notFound } from 'next/navigation';
import { getLocale } from '@/lib/locale';
import { loadPublication } from './data';
import { PublicVisit } from './PublicVisit';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const d = await loadPublication((await params).slug);
  return { title: d?.scene.project.name ?? 'Présentation', robots: { index: !d?.scene.project.is_fictional, follow: true } };
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await loadPublication(slug);
  if (!d) notFound();
  return <PublicVisit data={d.scene} locale={await getLocale()} />;
}
