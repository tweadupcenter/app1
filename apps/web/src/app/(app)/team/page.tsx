import { ROLES, can, formatDateTime } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { AddMember } from './AddMember';
import { changeOwnPassword, removeMember, setRole } from './actions';

export const metadata = { title: 'Équipe' };

const RIGHTS: [string, string][] = [
  ['admin', 'Tout : utilisateurs, droits, identité visuelle, projets, publication, commercial'],
  ['project_manager', 'Projets, plans, maquettes, lots, publication, commercial (sauf gestion des utilisateurs)'],
  ['sales', 'Prospects, rendez-vous, tâches, options et réservations, médias ; pas de modification des fiches lots'],
  ['viewer', 'Lecture seule interne (sans notes privées des prospects)'],
];

export default async function Team() {
  const { t } = await getT();
  const d = await asUser(async (x, s) => ({
    role: s.role, me: s.userId,
    members: (await x.query(`select u.id, u.email, u.full_name, m.role, m.created_at from immo.memberships m join immo.users u on u.id=m.user_id where m.org_id=$1 order by m.role, u.full_name`, [s.orgId])).rows,
  }));
  const admin = can(d.role, 'manageOrg');
  return (
    <>
      <PageHead title={t('nav.team')} subtitle="Membres de l’organisation et droits" />
      <div className="grid grid-side">
        <section className="card">
          <table className="table" data-testid="members"><thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Depuis</th><th /></tr></thead><tbody>
            {d.members.map((m) => <tr key={m.id}><td>{m.full_name}{m.id === d.me && ' (vous)'}</td><td>{m.email}</td>
              <td>{admin ? <ActionForm action={setRole} inline><input type="hidden" name="user_id" value={m.id} /><select name="role" defaultValue={m.role} aria-label="Rôle">{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select><button className="btn btn-sm">OK</button></ActionForm> : t(`role.${m.role}`)}</td>
              <td className="small">{formatDateTime(m.created_at)}</td>
              <td>{admin && m.id !== d.me && <ActionForm action={removeMember} inline confirm={`Retirer ${m.full_name} de l’organisation ?`}><input type="hidden" name="user_id" value={m.id} /><button className="btn btn-sm btn-danger">Retirer</button></ActionForm>}</td></tr>)}
          </tbody></table>
          <h3 style={{ marginTop: 14 }}>Rôles</h3>
          <table className="table small"><tbody>{RIGHTS.map(([r, txt]) => <tr key={r}><td>{t(`role.${r}`)}</td><td>{txt}</td></tr>)}<tr><td>Visiteur public</td><td>Uniquement la version publiée (instantané), sans compte</td></tr></tbody></table>
          <p className="small muted">Les droits sont appliqués côté serveur et par les politiques RLS de la base de données.</p>
        </section>
        <aside className="stack" style={{ gap: 14 }}>
          {admin && <section className="card"><h2>Ajouter un membre</h2><AddMember /></section>}
          <section className="card"><h2>Mon mot de passe</h2>
            <ActionForm action={changeOwnPassword} submitLabel="Modifier" resetOnSuccess>
              <label className="field"><span>Nouveau mot de passe (10 caractères min.)</span><input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
              <label className="field"><span>Confirmation</span><input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}
