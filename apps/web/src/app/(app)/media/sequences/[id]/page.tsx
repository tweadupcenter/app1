import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@immo/core';
import { asUser } from '@/lib/auth';
import { internalSceneData } from '@/lib/scene-data';
import { PageHead } from '@/components/ui';
import { SequenceEditor } from './SequenceEditor';

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await asUser(async (x, s) => {
    const seq = (await x.query(`select * from immo.sequences where id=$1`, [id])).rows[0];
    if (!seq) return null;
    return {
      role: s.role, seq, scene: await internalSceneData(x, seq.project_id),
      images: (await x.query(`select id, original_name from immo.media where (project_id=$1 or kind='logo') and kind in ('image','logo') order by created_at desc limit 100`, [seq.project_id])).rows,
      audio: (await x.query(`select id, original_name from immo.media where project_id=$1 and kind='audio' order by created_at desc`, [seq.project_id])).rows,
      jobs: (await x.query(`select id, status, progress, error, result, created_at from immo.jobs where type='video_export' and payload->>'sequence_id'=$1 order by created_at desc limit 5`, [id])).rows,
    };
  });
  if (!d?.scene) notFound();
  return (
    <>
      <PageHead title={d.seq.name} crumbs={<><Link href={`/media?project=${d.seq.project_id}`}>Médias et exports</Link> / {d.seq.name}</>} subtitle={d.seq.kind === 'tour' ? 'Parcours de visite (lu dans la visite interactive)' : 'Vidéo commerciale'} />
      <SequenceEditor seq={d.seq} scene={d.scene} images={d.images} audio={d.audio} jobs={d.jobs} canEdit={can(d.role, 'sell')} />
    </>
  );
}
