import Link from 'next/link';
import { can, formatDateTime } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead, Empty } from '@/components/ui';
import { Uploader } from '@/components/Uploader';
import { ActionForm } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/AutoRefresh';
import { deletePlan } from './actions';

export default async function Plans({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await asUser(async (x, s) => ({
    role: s.role,
    project: (await x.query(`select id, name from immo.projects where id=$1`, [id])).rows[0],
    buildings: (await x.query(`select id, code from immo.buildings where project_id=$1 order by code`, [id])).rows,
    plans: (await x.query(`select p.*, (select count(*)::int from immo.plan_pages pp where pp.plan_id=p.id) pages,
      (select j.error from immo.jobs j where j.payload->>'plan_id' = p.id::text order by created_at desc limit 1) job_error,
      (select j.progress from immo.jobs j where j.payload->>'plan_id' = p.id::text order by created_at desc limit 1) job_progress,
      (select j.status from immo.jobs j where j.payload->>'plan_id' = p.id::text order by created_at desc limit 1) job_status
      from immo.plans p where project_id=$1 order by created_at desc`, [id])).rows,
  }));
  const processing = d.plans.some((p) => p.status === 'processing');
  return (
    <>
      <PageHead title="Import de plans" crumbs={<><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.project?.name}</Link> / Plans</>}
        subtitle="PDF multipages, PNG/JPG et DXF (périmètre documenté). Les plans restent privés et ne sont transmis à aucun service externe." />
      {processing && <AutoRefresh seconds={2} />}
      <div className="grid grid-side">
        <section className="card">
          {d.plans.length === 0 ? <Empty>Aucun plan importé.</Empty> : (
            <table className="table" data-testid="plans-table"><thead><tr><th>Nom</th><th>Format</th><th>Pages</th><th>Statut</th><th>Importé le</th><th /></tr></thead><tbody>
              {d.plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.status === 'ready' ? <Link href={`/projects/${id}/plans/${p.id}`}>{p.name}</Link> : p.name}</td>
                  <td>{p.source_type.toUpperCase()}</td><td>{p.pages}</td>
                  <td data-plan-status={p.status}>
                    {p.status === 'processing' && <>Traitement… {p.job_status === 'queued' ? '(en file — le worker doit être lancé)' : `${Math.round(p.job_progress ?? 0)} %`}</>}
                    {p.status === 'ready' && <span className="badge st-available">Prêt</span>}
                    {p.status === 'error' && <span className="badge st-reserved">Erreur</span>}
                    {(p.error || p.job_error) && <div className="small" style={{ color: p.status === 'error' ? 'var(--c-danger)' : 'var(--c-warning)' }}>{p.error ?? p.job_error}</div>}
                  </td>
                  <td className="small">{formatDateTime(p.created_at)}</td>
                  <td>{can(d.role, 'manageProject') && <ActionForm action={deletePlan} submitLabel="Supprimer" submitClass="btn btn-sm btn-danger" confirm="Supprimer ce plan, ses pages et ses tracés ?" inline><input type="hidden" name="id" value={p.id} /></ActionForm>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
        <aside className="card">
          <h2>Importer</h2>
          {can(d.role, 'manageProject') ? <>
            <Uploader purpose="plan" fields={{ project_id: id }} accept=".pdf,.png,.jpg,.jpeg,.dxf,.dwg,.rvt,.skp,.ifc" label="Fichier (PDF, PNG, JPG, DXF — 60 Mo max.)" />
            <div className="alert alert-info small" style={{ marginTop: 10 }}>
              <b>DXF</b> : entités LINE, LWPOLYLINE et POLYLINE de l’espace objet, unités lues dans $INSUNITS ; importées comme murs <i>proposés</i> à valider. Blocs, arcs, cotes et textes sont ignorés (comptés dans le rapport).<br />
              <b>DWG, RVT, SKP, IFC</b> : refusés avec explication — aucun convertisseur n’est installé. Exportez en PDF/DXF (plans) ou GLB (maquettes).
            </div>
          </> : <p className="muted">Import réservé aux administrateurs et chefs de projet.</p>}
        </aside>
      </div>
    </>
  );
}
