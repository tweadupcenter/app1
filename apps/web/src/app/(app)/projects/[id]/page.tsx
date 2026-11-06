import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AMENITY_KINDS, can, formatDateTime, LOT_STATUSES } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty, StatusBadge } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { addAmenity, addBuilding, addFloor, deleteAmenity, deleteBuilding, publishProject, unpublishProject, updateFloor, updateProject } from '../actions';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const d = await asUser(async (x, s) => {
    const p = (await x.query(`select * from immo.projects where id=$1`, [id])).rows[0];
    if (!p) return null;
    return {
      role: s.role, p,
      buildings: (await x.query(`select * from immo.buildings where project_id=$1 order by sort_order, code`, [id])).rows,
      floors: (await x.query(`select f.*, (select count(*)::int from immo.lots l where l.floor_id=f.id) lots from immo.floors f where project_id=$1 order by level`, [id])).rows,
      amenities: (await x.query(`select * from immo.amenities where project_id=$1 order by kind`, [id])).rows,
      stats: (await x.query(`select status, count(*)::int n from immo.lots where project_id=$1 group by status`, [id])).rows,
      pubs: (await x.query(`select version, published_at, revoked_at, slug, u.full_name from immo.publications pu left join immo.users u on u.id=pu.published_by where project_id=$1 order by version desc limit 5`, [id])).rows,
      models: (await x.query(`select m.id, m.name, m.source, r.version from immo.models m left join immo.model_revisions r on r.id=m.active_revision_id where m.project_id=$1`, [id])).rows,
      plans: (await x.query(`select count(*)::int n from immo.plans where project_id=$1`, [id])).rows[0].n,
    };
  });
  if (!d) notFound();
  const { p } = d;
  const manage = can(d.role, 'manageProject');
  const active = d.pubs.find((x) => !x.revoked_at);
  const stat = Object.fromEntries(d.stats.map((r) => [r.status, r.n]));
  return (
    <>
      <PageHead title={p.name} crumbs={<><Link href="/projects">Projets</Link> / {p.name}</>} subtitle={p.city}>
        <Link className="btn btn-primary" href={`/projects/${id}/visit`}>Visite interactive 3D</Link>
        <Link className="btn" href={`/projects/${id}/plans`}>Plans ({d.plans})</Link>
        <Link className="btn" href={`/projects/${id}/models`}>Maquettes 3D</Link>
        <Link className="btn" href={`/lots?project=${id}`}>Lots</Link>
        {active && <a className="btn" href={`/p/${active.slug}`} target="_blank" rel="noreferrer">Présentation publique ↗</a>}
      </PageHead>
      {p.is_fictional && <div className="alert alert-warning" style={{ marginBottom: 14 }}>Projet fictif de démonstration : aucune donnée réelle.</div>}
      <div className="grid grid-side">
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Disponibilités</h2>
            <div className="row">{LOT_STATUSES.map((s) => <Link key={s} href={`/lots?project=${id}&status=${s}`} className="row" style={{ gap: 4 }}><StatusBadge status={s} /> <b>{stat[s] ?? 0}</b></Link>)}</div>
          </section>
          <section className="card">
            <div className="row between"><h2>Bâtiments et étages</h2></div>
            {d.buildings.length === 0 ? <Empty>Aucun bâtiment.</Empty> : d.buildings.map((b) => (
              <div key={b.id} style={{ marginBottom: 14 }}>
                <div className="row between"><h3 style={{ margin: 0 }}>{b.code} — {b.name}</h3>
                  {manage && <div className="row">
                    <ActionForm action={addFloor} submitLabel="+ Étage" submitClass="btn btn-sm" inline><input type="hidden" name="building_id" value={b.id} /></ActionForm>
                    <ActionForm action={deleteBuilding} submitLabel="Supprimer" submitClass="btn btn-sm btn-danger" confirm="Supprimer ce bâtiment et ses étages ?" inline><input type="hidden" name="id" value={b.id} /></ActionForm>
                  </div>}
                </div>
                <table className="table small"><thead><tr><th>Niveau</th><th>Nom</th><th>Altitude (m)</th><th>Hauteur (m)</th><th>Lots</th>{manage && <th />}</tr></thead><tbody>
                  {d.floors.filter((f) => f.building_id === b.id).map((f) => (
                    <tr key={f.id}>
                      <td>{f.level}</td>
                      {manage ? (
                        <td colSpan={3}>
                          <ActionForm action={updateFloor} inline submitLabel="OK" submitClass="btn btn-sm">
                            <input type="hidden" name="id" value={f.id} />
                            <input name="name" defaultValue={f.name} aria-label="Nom" style={{ width: 140 }} />
                            <input name="elevation_m" defaultValue={f.elevation_m} aria-label="Altitude" style={{ width: 80 }} inputMode="decimal" />
                            <input name="height_m" defaultValue={f.height_m} aria-label="Hauteur" style={{ width: 70 }} inputMode="decimal" />
                          </ActionForm>
                        </td>
                      ) : <><td>{f.name}</td><td>{f.elevation_m}</td><td>{f.height_m}</td></>}
                      <td><Link href={`/lots?project=${id}&floor=${f.id}`}>{f.lots}</Link></td>
                      {manage && <td />}
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ))}
            {manage && (
              <ActionForm action={addBuilding} className="form-grid" submitLabel="Ajouter le bâtiment" resetOnSuccess>
                <input type="hidden" name="project_id" value={id} />
                <label className="field"><span>Code</span><input name="code" required maxLength={10} placeholder="D" /></label>
                <label className="field"><span>Nom</span><input name="name" placeholder="Bâtiment D" /></label>
                <label className="field"><span>Nombre de niveaux</span><input name="levels" type="number" min={1} max={80} defaultValue={3} /></label>
                <label className="field"><span>Hauteur d’étage (m)</span><input name="height" type="number" step="0.01" min={2} max={10} defaultValue={3} /></label>
              </ActionForm>
            )}
          </section>
          <section className="card">
            <h2>Équipements</h2>
            <p className="small muted">Seuls les équipements enregistrés ici apparaissent dans la barre de navigation de la visite.</p>
            {d.amenities.length === 0 ? <Empty>Aucun équipement.</Empty> : (
              <table className="table"><tbody>{d.amenities.map((a) => (
                <tr key={a.id}><td>{t(`amenity.${a.kind}`)}</td><td>{a.name}</td><td className="small muted">{a.footprint ? 'emprise documentée' : 'sans emprise'}</td>
                  <td className="right">{manage && <ActionForm action={deleteAmenity} submitLabel="Supprimer" submitClass="btn btn-sm btn-danger" inline confirm="Supprimer cet équipement ?"><input type="hidden" name="id" value={a.id} /></ActionForm>}</td></tr>
              ))}</tbody></table>
            )}
            {manage && (
              <ActionForm action={addAmenity} className="form-grid" submitLabel="Ajouter" resetOnSuccess>
                <input type="hidden" name="project_id" value={id} />
                <label className="field"><span>Type</span><select name="kind">{AMENITY_KINDS.map((k) => <option key={k} value={k}>{t(`amenity.${k}`)}</option>)}</select></label>
                <label className="field"><span>Nom</span><input name="name" required /></label>
              </ActionForm>
            )}
          </section>
        </div>
        <aside className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Publication</h2>
            <p className="small muted">La présentation publique affiche une version validée figée (instantané). Les statuts de disponibilité restent en direct.</p>
            {active ? <div className="alert alert-success">Version {active.version} publiée le {formatDateTime(active.published_at)} — <a href={`/p/${active.slug}`} target="_blank" rel="noreferrer">/p/{active.slug}</a></div>
              : <div className="alert alert-info">Non publié : aucune donnée n’est accessible publiquement.</div>}
            {manage && <div className="stack" style={{ marginTop: 8 }}>
              <ActionForm action={publishProject} submitLabel={active ? 'Publier une nouvelle version' : 'Publier'} confirm="Publier la version de travail actuelle ?"><input type="hidden" name="project_id" value={id} /></ActionForm>
              {active && <ActionForm action={unpublishProject} submitLabel="Révoquer le lien public" submitClass="btn btn-danger" confirm="Le lien public cessera de fonctionner. Continuer ?"><input type="hidden" name="project_id" value={id} /></ActionForm>}
            </div>}
            {d.pubs.length > 0 && <table className="table small" style={{ marginTop: 8 }}><tbody>{d.pubs.map((x) => <tr key={x.version}><td>v{x.version}</td><td>{formatDateTime(x.published_at)}</td><td>{x.revoked_at ? 'révoquée' : 'active'}</td></tr>)}</tbody></table>}
          </section>
          <section className="card">
            <h2>Maquettes</h2>
            {d.models.length === 0 ? <Empty>Aucune maquette. <Link href={`/projects/${id}/models`}>Importer un GLB</Link> ou générer depuis un plan validé.</Empty> :
              <ul>{d.models.map((m) => <li key={m.id}>{m.name} — {m.source === 'generated' ? 'générée' : 'importée'} {m.version ? `(révision active v${m.version})` : '(aucune révision active)'}</li>)}</ul>}
          </section>
          {manage && <section className="card">
            <h2>Informations</h2>
            <ActionForm action={updateProject} submitLabel="Enregistrer">
              <input type="hidden" name="id" value={id} />
              <label className="field"><span>Nom</span><input name="name" defaultValue={p.name} required /></label>
              <label className="field"><span>Ville</span><input name="city" defaultValue={p.city ?? ''} /></label>
              <label className="field"><span>Adresse</span><input name="address" defaultValue={p.address ?? ''} /></label>
              <label className="field"><span>Description</span><textarea name="description" defaultValue={p.description ?? ''} /></label>
              <label className="check"><input type="checkbox" name="is_fictional" defaultChecked={p.is_fictional} /> <span>Projet fictif</span></label>
            </ActionForm>
          </section>}
        </aside>
      </div>
    </>
  );
}
