import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@immo/core';
import { unrealConfigFromEnv } from '@immo/core/unreal';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { internalSceneData } from '@/lib/scene-data';
import { InternalVisit } from './InternalVisit';
import { ViewpointsAdmin } from './ViewpointsAdmin';
import { UnrealPanel } from '@/components/visit/UnrealPanel';

export const metadata = { title: 'Visite interactive' };

export default async function Visit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lot?: string; mode?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { locale } = await getT();
  const d = await asUser(async (x, s) => ({ role: s.role, data: await internalSceneData(x, id) }));
  if (!d.data) notFound();
  const unreal = unrealConfigFromEnv(process.env);
  const mode = sp.mode === 'unreal' ? 'unreal' : 'web';
  return (
    <>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div><div className="crumbs"><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.data.project.name}</Link> / Visite</div>
          <h1>Visite interactive <span className="tag">version de travail</span></h1></div>
        <div className="row">
          <Link className={`btn btn-sm ${mode === 'web' ? 'on' : ''}`} href={`?mode=web`}>Mode Web (three.js)</Link>
          <Link className={`btn btn-sm ${mode === 'unreal' ? 'on' : ''}`} href={`?mode=unreal`}>Mode Unreal</Link>
        </div>
      </div>
      {mode === 'web' ? <InternalVisit data={d.data} locale={locale} canManage={can(d.role, 'manageProject')} canSell={can(d.role, 'sell')} initialLotId={sp.lot ?? null} />
        : <UnrealPanel config={{ signallingUrl: unreal.signallingUrl ?? null, missing: unreal.missing }} projectId={id} />}
      {mode === 'web' && can(d.role, 'manageProject') && <ViewpointsAdmin data={d.data} />}
    </>
  );
}
