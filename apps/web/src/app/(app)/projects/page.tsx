import Link from 'next/link';
import { can } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead, Empty } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { createProject } from './actions';

export const metadata = { title: 'Projets' };

export default async function Projects() {
  const { rows, role } = await asUser(async (x, s) => ({
    role: s.role,
    rows: (await x.query(`select p.*, (select count(*)::int from immo.lots l where l.project_id=p.id) lots,
      (select count(*)::int from immo.lots l where l.project_id=p.id and l.status='available') available,
      (select count(*)::int from immo.buildings b where b.project_id=p.id) buildings,
      (select max(version) from immo.publications pu where pu.project_id=p.id and pu.revoked_at is null) pub
      from immo.projects p order by p.created_at desc`)).rows,
  }));
  return (
    <>
      <PageHead title="Projets" subtitle="Programmes immobiliers de l’organisation" />
      <div className="grid grid-side">
        <div>
          {rows.length === 0 ? <Empty>Aucun projet. Créez votre premier programme.</Empty> : (
            <div className="grid grid-2">
              {rows.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ color: 'inherit' }}>
                  <div className="row between"><h2 style={{ margin: 0 }}>{p.name}</h2>{p.is_fictional && <span className="tag">Fictif</span>}</div>
                  <p className="muted small">{p.city ?? '—'}</p>
                  <div className="row small"><span>{p.buildings} bâtiment(s)</span>·<span>{p.lots} lots</span>·<span>{p.available} disponibles</span></div>
                  <div className="small" style={{ marginTop: 6 }}>{p.pub ? <span className="badge st-available">Publié v{p.pub}</span> : <span className="badge st-sold">Non publié</span>}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <aside className="card">
          <h2>Nouveau projet</h2>
          {can(role, 'manageProject') ? (
            <ActionForm action={createProject} submitLabel="Créer le projet" redirectTo="/projects/{id}">
              <label className="field"><span>Nom</span><input name="name" required minLength={2} /></label>
              <label className="field"><span>Identifiant URL (optionnel)</span><input name="slug" pattern="[a-z0-9-]*" placeholder="residence-exemple" /></label>
              <label className="field"><span>Ville</span><input name="city" /></label>
              <label className="field"><span>Description</span><textarea name="description" /></label>
              <label className="check"><input type="checkbox" name="is_fictional" /> <span>Projet fictif / démonstration</span></label>
            </ActionForm>
          ) : <p className="muted">Création réservée aux administrateurs et chefs de projet.</p>}
        </aside>
      </div>
    </>
  );
}
