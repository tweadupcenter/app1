import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead } from '@/components/ui';
import { BindingEditor } from './BindingEditor';

export default async function Bindings({ params }: { params: Promise<{ id: string; revId: string }> }) {
  const { id, revId } = await params;
  const d = await asUser(async (x, s) => {
    const rev = (await x.query(`select r.*, m.name model_name, m.active_revision_id from immo.model_revisions r join immo.models m on m.id=r.model_id where r.id=$1 and m.project_id=$2`, [revId, id])).rows[0];
    if (!rev) return null;
    return {
      role: s.role, rev,
      project: (await x.query(`select name from immo.projects where id=$1`, [id])).rows[0],
      bindings: (await x.query(`select node_name, target_type, target_id, carried_from is not null as carried from immo.model_bindings where revision_id=$1 order by node_name`, [revId])).rows,
      targets: {
        building: (await x.query(`select id, code as label from immo.buildings where project_id=$1 order by code`, [id])).rows,
        floor: (await x.query(`select f.id, b.code || ' · ' || f.name as label from immo.floors f join immo.buildings b on b.id=f.building_id where f.project_id=$1 order by b.code, f.level`, [id])).rows,
        lot: (await x.query(`select id, reference as label from immo.lots where project_id=$1 order by reference`, [id])).rows,
        amenity: (await x.query(`select id, name as label from immo.amenities where project_id=$1 order by name`, [id])).rows,
      },
    };
  });
  if (!d) notFound();
  const all = new Set(Object.values(d.targets).flat().map((t: any) => t.id));
  const orphan = d.bindings.filter((b) => !all.has(b.target_id));
  const missingNodes = d.bindings.filter((b) => !d.rev.node_names.includes(b.node_name));
  return (
    <>
      <PageHead title={`Associations — ${d.rev.model_name} v${d.rev.version}`} crumbs={<><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.project.name}</Link> / <Link href={`/projects/${id}/models`}>Maquettes</Link> / v{d.rev.version}</>}
        subtitle={`${d.bindings.length} association(s) · ${d.rev.node_names.length} nœud(s) · ${d.rev.id === d.rev.active_revision_id ? 'révision active' : 'révision non active'}`} />
      {(orphan.length > 0 || missingNodes.length > 0) && <div className="alert alert-error" style={{ marginBottom: 10 }} data-testid="binding-issues">
        {orphan.length > 0 && <div>{orphan.length} association(s) vers une cible supprimée : {orphan.map((b) => b.node_name).join(', ')}</div>}
        {missingNodes.length > 0 && <div>{missingNodes.length} association(s) vers un nœud absent de cette révision.</div>}
      </div>}
      {d.rev.status !== 'ready' ? <div className="alert alert-info">Révision en cours d’inspection ou en erreur : {d.rev.error ?? d.rev.status}</div> :
        <BindingEditor revisionId={revId} url={`/api/files/${d.rev.media_id}`} nodeNames={d.rev.node_names} bindings={d.bindings} targets={d.targets} canEdit={can(d.role, 'manageProject')} />}
    </>
  );
}
