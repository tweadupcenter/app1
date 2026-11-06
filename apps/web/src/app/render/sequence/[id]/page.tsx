import { notFound } from 'next/navigation';
import { verifyRenderToken } from '@immo/core/token';
import { tx } from '@/lib/db';
import { internalSceneData } from '@/lib/scene-data';
import { RenderStage } from './RenderStage';

export const dynamic = 'force-dynamic';

/** Page de rendu utilisée par le worker (jeton signé, courte durée, limité à une séquence). */
export default async function RenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params;
  const { token } = await searchParams;
  const claims = token ? verifyRenderToken(token) : null;
  if (!claims || claims.seq !== id) notFound();
  const d = await tx({ userId: claims.user, orgId: claims.org }, async (x) => {
    const seq = (await x.query(`select * from immo.sequences where id=$1`, [id])).rows[0];
    if (!seq) return null;
    const scene = await internalSceneData(x, seq.project_id);
    return { seq, scene };
  });
  if (!d?.scene) notFound();
  const q = `?token=${encodeURIComponent(token!)}`;
  const scene = { ...d.scene, mode: 'render' as const, model: d.scene.model ? { ...d.scene.model, url: d.scene.model.url.replace('/api/files/', '/api/render/files/') + q } : null };
  const logo = d.seq.overlay?.logo_media_id ? `/api/render/files/${d.seq.overlay.logo_media_id}${q}` : null;
  return <RenderStage scene={scene} shots={d.seq.shots} overlay={{ title: d.seq.overlay?.title ?? '', subtitle: d.seq.overlay?.subtitle ?? '', logo, fictional: scene.project.is_fictional }} />;
}
