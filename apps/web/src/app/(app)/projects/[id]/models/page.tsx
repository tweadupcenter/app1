import Link from 'next/link';
import { can, formatDateTime } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead, Empty } from '@/components/ui';
import { Uploader } from '@/components/Uploader';
import { ActionForm } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/AutoRefresh';
import { activateRevision, deleteModel } from './actions';

export default async function Models({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await asUser(async (x, s) => ({
    role: s.role,
    project: (await x.query(`select name from immo.projects where id=$1`, [id])).rows[0],
    models: (await x.query(`select * from immo.models where project_id=$1 order by created_at`, [id])).rows,
    revs: (await x.query(`select r.*, md.size_bytes, md.original_name, (select count(*)::int from immo.model_bindings b where b.revision_id=r.id) bindings,
      (select j.status from immo.jobs j where j.payload->>'revision_id'=r.id::text order by created_at desc limit 1) job_status
      from immo.model_revisions r join immo.models m on m.id=r.model_id join immo.media md on md.id=r.media_id where m.project_id=$1 order by r.version desc`, [id])).rows,
  }));
  const manage = can(d.role, 'manageProject');
  return (
    <>
      <PageHead title="Maquettes 3D" crumbs={<><Link href="/projects">Projets</Link> / <Link href={`/projects/${id}`}>{d.project?.name}</Link> / Maquettes</>}
        subtitle="GLB importés (architecte) ou générés depuis les plans validés. Chaque révision est inspectée et ses associations contrôlées." />
      {d.revs.some((r) => r.status === 'processing') && <AutoRefresh seconds={2} />}
      <div className="grid grid-side">
        <div className="stack" style={{ gap: 14 }}>
          {d.models.length === 0 && <Empty>Aucune maquette.</Empty>}
          {d.models.map((m) => (
            <section key={m.id} className="card" data-testid="model-card">
              <div className="row between"><h2 style={{ margin: 0 }}>{m.name}</h2><span className="tag">{m.source === 'generated' ? 'Générée' : 'Importée'}</span></div>
              <table className="table small" style={{ marginTop: 8 }}><thead><tr><th>Révision</th><th>Fichier</th><th>Statut</th><th>Nœuds</th><th>Associations</th><th>Contrôle</th><th /></tr></thead><tbody>
                {d.revs.filter((r) => r.model_id === m.id).map((r) => (
                  <tr key={r.id}>
                    <td>v{r.version} {m.active_revision_id === r.id && <span className="badge st-available">active</span>}<div className="muted">{formatDateTime(r.created_at)}</div></td>
                    <td>{r.original_name}<div className="muted">{(r.size_bytes / 1048576).toFixed(2)} Mo</div></td>
                    <td data-rev-status={r.status}>{r.status === 'processing' ? (r.job_status === 'queued' ? 'En file (worker requis)' : 'Inspection…') : r.status === 'ready' ? 'Prête' : <span style={{ color: 'var(--c-danger)' }}>Erreur : {r.error}</span>}</td>
                    <td>{r.node_names.length}</td>
                    <td><Link href={`/projects/${id}/models/${r.id}`}>{r.bindings} — gérer</Link></td>
                    <td className="small">
                      {r.report?.previous_revision_id && <>reportées : {r.report.carried ?? 0}{(r.report.missing?.length ?? 0) > 0 && <div style={{ color: 'var(--c-danger)' }} data-testid="missing-bindings">{r.report.missing.length} nœud(s) disparu(s) : {r.report.missing.slice(0, 5).map((x: any) => x.node_name).join(', ')}</div>}</>}
                      {(r.report?.warnings ?? []).map((w: string, i: number) => <div key={i} style={{ color: 'var(--c-warning)' }}>{w}</div>)}
                    </td>
                    <td>{manage && r.status === 'ready' && m.active_revision_id !== r.id && <ActionForm action={activateRevision} submitLabel="Activer" submitClass="btn btn-sm" inline><input type="hidden" name="revision_id" value={r.id} /></ActionForm>}</td>
                  </tr>
                ))}
              </tbody></table>
              {manage && <div className="row" style={{ marginTop: 8 }}>
                <Uploader purpose="model" fields={{ project_id: id, model_id: m.id }} accept=".glb,model/gltf-binary" label="Nouvelle révision (GLB)" />
                <ActionForm action={deleteModel} submitLabel="Supprimer la maquette" submitClass="btn btn-sm btn-danger" confirm="Supprimer cette maquette et toutes ses révisions ?" inline><input type="hidden" name="model_id" value={m.id} /></ActionForm>
              </div>}
            </section>
          ))}
        </div>
        <aside className="card stack">
          <h2>Importer une maquette</h2>
          {manage ? <Uploader purpose="model" fields={{ project_id: id }} accept=".glb,.rvt,.skp,.ifc,model/gltf-binary" label="Fichier GLB (150 Mo max.)" /> : <p className="muted">Réservé aux administrateurs et chefs de projet.</p>}
          <div className="alert alert-info small">
            Format accepté : <b>GLB (glTF 2.0 binaire)</b>. Recommandations : unités en mètres, axe Y vertical, origine au repère du projet, nœuds nommés.<br />
            Convention de nommage permettant l’association automatique : <code>lot_A-1-02</code>, <code>bld_A</code>, <code>floor_A_1</code>, <code>amenity_pool</code>.<br />
            RVT, SKP et IFC ne sont pas convertis (aucun outil installé) : exportez en GLB depuis le logiciel d’origine.
          </div>
          <div className="alert alert-warning small">Le réalisme dépend des modèles, textures et éclairages fournis. Une géométrie simplifiée n’est pas un rendu photoréaliste.</div>
        </aside>
      </div>
    </>
  );
}
