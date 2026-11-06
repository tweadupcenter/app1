import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, drawingSchema, emptyDrawing } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead } from '@/components/ui';
import { Editor } from './Editor';

export const metadata = { title: 'Éditeur de plan' };

export default async function EditorPage({ params, searchParams }: { params: Promise<{ id: string; pageId: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id, pageId } = await params;
  const sp = await searchParams;
  const d = await asUser(async (x, s) => {
    const page = (await x.query(`select pp.*, p.name plan_name, p.id plan_id, p.project_id, p.source_type from immo.plan_pages pp join immo.plans p on p.id=pp.plan_id where pp.id=$1 and p.project_id=$2`, [pageId, id])).rows[0];
    if (!page) return null;
    const versions = (await x.query(`select d.version, d.note, d.created_at, u.full_name from immo.plan_drawings d left join immo.users u on u.id=d.created_by where plan_page_id=$1 order by version desc`, [pageId])).rows;
    const wanted = sp.version ? Number(sp.version) : versions[0]?.version;
    const drawing = wanted ? (await x.query(`select data from immo.plan_drawings where plan_page_id=$1 and version=$2`, [pageId, wanted])).rows[0]?.data : null;
    const floor = page.floor_id ? (await x.query(`select f.*, b.code from immo.floors f join immo.buildings b on b.id=f.building_id where f.id=$1`, [page.floor_id])).rows[0] : null;
    const lots = (await x.query(`select id, reference, floor_id from immo.lots where project_id=$1 order by (floor_id = $2) desc nulls last, reference`, [id, page.floor_id])).rows;
    const model = (await x.query(`select id from immo.models where project_id=$1 and source='generated' and name=$2 limit 1`, [id, `Reconstruction — ${page.plan_name} p${page.page_index + 1}`])).rows[0];
    return { role: s.role, page, versions, wanted, drawing, floor, lots, modelId: model?.id ?? null, project: (await x.query(`select name from immo.projects where id=$1`, [id])).rows[0] };
  });
  if (!d) notFound();
  const parsed = d.drawing ? drawingSchema.safeParse(d.drawing) : null;
  const latest = d.versions[0]?.version ?? 0;
  return (
    <>
      <PageHead title="Éditeur 2D / 3D" crumbs={<><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.project.name}</Link> / <Link href={`/projects/${id}/plans/${d.page.plan_id}?page=${pageId}`}>{d.page.plan_name} · page {d.page.page_index + 1}</Link> / Éditeur</>}
        subtitle={<>Niveau : {d.floor ? `${d.floor.code} · ${d.floor.name} (altitude ${d.floor.elevation_m} m)` : <b>non associé à un étage</b>} · échelle {d.page.scale_m_per_px ? `${(1 / d.page.scale_m_per_px).toFixed(2)} px/m` : <b>non calibrée (estimée)</b>}</>}>
        <form method="get" className="row">
          <label className="small" htmlFor="ver">Version</label>
          <select id="ver" name="version" defaultValue={d.wanted ?? ''}>{d.versions.length === 0 && <option value="">aucune</option>}{d.versions.map((v) => <option key={v.version} value={v.version}>v{v.version} — {v.note ?? 'sans note'} ({v.full_name ?? '—'})</option>)}</select>
          <button className="btn btn-sm">Ouvrir</button>
        </form>
      </PageHead>
      {parsed && !parsed.success && <div className="alert alert-error">Le tracé enregistré est invalide et n’a pas pu être chargé.</div>}
      {d.wanted && d.wanted !== latest && <div className="alert alert-warning" style={{ marginBottom: 10 }}>Vous consultez la version v{d.wanted}. Enregistrer créera la version v{latest + 1} à partir de celle-ci.</div>}
      <Editor
        projectId={id}
        page={{ id: pageId, imageUrl: d.page.image_media_id ? `/api/files/${d.page.image_media_id}` : null, width: d.page.width_px ?? 0, height: d.page.height_px ?? 0, rotation: d.page.rotation, crop: d.page.crop, scale: d.page.scale_m_per_px, calibrated: !!d.page.scale_m_per_px, label: `${d.page.plan_name} p${d.page.page_index + 1}` }}
        floor={d.floor ? { elevation: Number(d.floor.elevation_m), height: Number(d.floor.height_m), label: `${d.floor.code}_${d.floor.level}` } : null}
        floorHeight={Number(d.page.floor_height_m)}
        initial={parsed?.success ? parsed.data : emptyDrawing()}
        baseVersion={latest}
        lots={d.lots.map((l) => ({ id: l.id, reference: l.reference, onFloor: l.floor_id === d.page.floor_id }))}
        canEdit={can(d.role, 'manageProject')}
        generatedModelId={d.modelId}
      />
    </>
  );
}
