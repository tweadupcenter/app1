import Link from 'next/link';
import { can, formatDateTime } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { addAppointment, addTask, setAppointmentStatus, toggleTask } from '../prospects/actions';

export const metadata = { title: 'Agenda et tâches' };

export default async function Agenda({ searchParams }: { searchParams: Promise<{ mine?: string; past?: string }> }) {
  const sp = await searchParams;
  const { locale } = await getT();
  const d = await asUser(async (x, s) => ({
    role: s.role, me: s.userId,
    users: (await x.query(`select u.id, u.full_name from immo.users u join immo.memberships m on m.user_id=u.id and m.org_id=$1 where m.role <> 'viewer' order by u.full_name`, [s.orgId])).rows,
    appts: (await x.query(`select a.*, pr.full_name prospect, u.full_name owner from immo.appointments a left join immo.prospects pr on pr.id=a.prospect_id left join immo.users u on u.id=a.user_id
      where ($1::boolean or a.starts_at >= now() - interval '1 day') and ($2::uuid is null or a.user_id=$2) order by a.starts_at limit 200`, [sp.past === '1', sp.mine === '1' ? s.userId : null])).rows,
    tasks: (await x.query(`select t.*, pr.full_name prospect, u.full_name assignee from immo.tasks t left join immo.prospects pr on pr.id=t.prospect_id left join immo.users u on u.id=t.assignee_id
      where t.done_at is null and ($1::uuid is null or t.assignee_id=$1) order by t.due_at nulls last limit 200`, [sp.mine === '1' ? s.userId : null])).rows,
  }));
  const sell = can(d.role, 'sell');
  const byDay = new Map<string, typeof d.appts>();
  for (const a of d.appts) { const k = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Africa/Casablanca' }).format(new Date(a.starts_at)); byDay.set(k, [...(byDay.get(k) ?? []), a]); }
  return (
    <>
      <PageHead title="Agenda et tâches" subtitle="Heures affichées dans le fuseau Africa/Casablanca">
        <Link className={`btn btn-sm ${sp.mine === '1' ? 'on' : ''}`} href={sp.mine === '1' ? '?' : '?mine=1'}>Mes éléments</Link>
        <Link className={`btn btn-sm ${sp.past === '1' ? 'on' : ''}`} href={sp.past === '1' ? '?' : '?past=1'}>Inclure le passé</Link>
      </PageHead>
      <div className="grid grid-side">
        <section className="card">
          <h2>Rendez-vous</h2>
          {byDay.size === 0 ? <Empty>Aucun rendez-vous.</Empty> : [...byDay].map(([day, list]) => (
            <div key={day} style={{ marginBottom: 12 }}><h3 style={{ textTransform: 'capitalize' }}>{day}</h3>
              <table className="table small"><tbody>{list.map((a) => (
                <tr key={a.id}><td className="nowrap">{new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(a.starts_at))}</td>
                  <td>{a.title}{a.status === 'requested' && <span className="tag" style={{ marginInlineStart: 6 }}>à confirmer</span>}{a.location && <span className="muted"> · {a.location}</span>}</td>
                  <td>{a.prospect_id ? <Link href={`/prospects/${a.prospect_id}`}>{a.prospect}</Link> : '—'}</td><td>{a.owner ?? '—'}</td>
                  <td>{sell && <ActionForm action={setAppointmentStatus} inline><input type="hidden" name="id" value={a.id} /><select name="status" defaultValue={a.status === 'requested' ? 'planned' : a.status} aria-label="Statut"><option value="planned">{a.status === 'requested' ? 'Confirmer' : 'Planifié'}</option><option value="done">Réalisé</option><option value="cancelled">Annulé</option><option value="no_show">Absent</option></select><button className="btn btn-sm">OK</button></ActionForm>}</td></tr>
              ))}</tbody></table></div>
          ))}
          {sell && <><h3>Nouveau rendez-vous (sans prospect)</h3><ActionForm action={addAppointment} className="form-grid" submitLabel="Planifier" resetOnSuccess>
            <label className="field"><span>Objet</span><input name="title" required /></label>
            <label className="field"><span>Date et heure</span><input name="starts_at" type="datetime-local" required /></label>
            <label className="field"><span>Durée (min)</span><input name="duration" type="number" defaultValue={60} /></label>
            <label className="field"><span>Commercial</span><select name="user_id" defaultValue={d.me}>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
          </ActionForm></>}
        </section>
        <aside className="card">
          <h2>Tâches ouvertes</h2>
          {d.tasks.length === 0 ? <Empty>Aucune tâche.</Empty> : <table className="table small"><tbody>{d.tasks.map((t) => (
            <tr key={t.id}><td>{sell && <ActionForm action={toggleTask} inline><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm" aria-label="Terminer">☐</button></ActionForm>}</td>
              <td>{t.title}<div className="muted">{t.prospect_id ? <Link href={`/prospects/${t.prospect_id}`}>{t.prospect}</Link> : ''} {t.assignee ? `· ${t.assignee}` : ''}</div></td>
              <td className="nowrap" style={{ color: t.due_at && new Date(t.due_at) < new Date() ? 'var(--c-danger)' : undefined }}>{formatDateTime(t.due_at, locale)}</td></tr>
          ))}</tbody></table>}
          {sell && <ActionForm action={addTask} className="stack" submitLabel="Ajouter" resetOnSuccess>
            <input name="title" required placeholder="Nouvelle tâche" aria-label="Tâche" />
            <input name="due_at" type="datetime-local" aria-label="Échéance" />
          </ActionForm>}
        </aside>
      </div>
    </>
  );
}
