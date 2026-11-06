import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asUser } from '@/lib/auth';
import { PageHead } from '@/components/ui';
import { PageSetup } from './PageSetup';

export default async function PlanWizard({ params, searchParams }: { params: Promise<{ id: string; planId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id, planId } = await params;
  const sp = await searchParams;
  const d = await asUser(async (x, s) => {
    const plan = (await x.query(`select * from immo.plans where id=$1 and project_id=$2`, [planId, id])).rows[0];
    if (!plan) return null;
    return {
      role: s.role, plan,
      project: (await x.query(`select id, name from immo.projects where id=$1`, [id])).rows[0],
      pages: (await x.query(`select pp.*, (select max(version) from immo.plan_drawings d where d.plan_page_id=pp.id) drawing_version from immo.plan_pages pp where plan_id=$1 order by page_index`, [planId])).rows,
      floors: (await x.query(`select f.id, f.name, f.level, f.height_m, b.code from immo.floors f join immo.buildings b on b.id=f.building_id where f.project_id=$1 order by b.code, f.level`, [id])).rows,
    };
  });
  if (!d) notFound();
  const page = d.pages.find((p) => p.id === sp.page) ?? d.pages.find((p) => p.selected) ?? d.pages[0];
  return (
    <>
      <PageHead title={`Plan : ${d.plan.name}`} crumbs={<><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.project.name}</Link> / <Link href={`/projects/${id}/plans`}>Plans</Link> / {d.plan.name}</>}
        subtitle={`${d.pages.length} page(s) · format ${d.plan.source_type.toUpperCase()}`}>
        {page && <Link className="btn btn-primary" href={`/projects/${id}/editor/${page.id}`}>Ouvrir l’éditeur 2D/3D</Link>}
      </PageHead>
      <section className="card" style={{ marginBottom: 14 }}>
        <h2>1. Sélection de la page</h2>
        <div className="row" style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
          {d.pages.map((p) => (
            <Link key={p.id} href={`?page=${p.id}`} className={`card ${p.id === page?.id ? 'on' : ''}`} style={{ padding: 6, minWidth: 130, borderColor: p.id === page?.id ? 'var(--c-primary)' : undefined }} aria-current={p.id === page?.id}>
              {p.image_media_id ? <img src={`/api/files/${p.image_media_id}`} alt={`Page ${p.page_index + 1}`} style={{ width: 120, height: 90, objectFit: 'contain', background: '#f3f3f3' }} /> : <div className="empty" style={{ padding: 20 }}>DXF</div>}
              <div className="small">Page {p.page_index + 1} {p.scale_m_per_px ? '· calibrée' : '· non calibrée'} {p.drawing_version ? `· tracé v${p.drawing_version}` : ''}</div>
            </Link>
          ))}
        </div>
      </section>
      {page && page.calibration?.source === 'dxf' && <div className="alert alert-info" style={{ marginBottom: 14 }}>Page issue d’un DXF : coordonnées converties en mètres (unités : {String(page.calibration?.report?.units ?? 'inconnues')}). Les murs importés sont proposés et doivent être validés dans l’éditeur.</div>}
      {page && (
        <PageSetup key={page.id} projectId={id} page={{ id: page.id, imageUrl: page.image_media_id ? `/api/files/${page.image_media_id}` : null, width: page.width_px, height: page.height_px, rotation: page.rotation, crop: page.crop, calibration: page.calibration, scale: page.scale_m_per_px, floorId: page.floor_id, levelLabel: page.level_label, floorHeight: Number(page.floor_height_m) }} floors={d.floors} />)}
    </>
  );
}
