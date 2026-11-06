import Link from 'next/link';
import { LOT_STATUSES, PIPELINE_STAGES, formatDateTime, STATUS_COLORS } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty } from '@/components/ui';

export const metadata = { title: 'Tableau de bord' };

export default async function Dashboard() {
  const { t, locale } = await getT();
  const d = await asUser(async (x, s) => {
    await x.query('select immo.expire_holds()');
    const lots = (await x.query(`select status, count(*)::int n from immo.lots group by status`)).rows;
    const stages = (await x.query(`select stage, count(*)::int n from immo.prospects group by stage`)).rows;
    const inquiries = (await x.query(`select p.name, p.id, count(i.id)::int total,
        count(i.id) filter (where i.created_at > now() - interval '30 days')::int last30
      from immo.projects p left join immo.inquiries i on i.project_id = p.id group by p.id, p.name order by total desc`)).rows;
    const appts = (await x.query(`select a.id, a.title, a.starts_at, a.status, pr.full_name, pr.id as prospect_id, u.full_name as owner
      from immo.appointments a left join immo.prospects pr on pr.id = a.prospect_id left join immo.users u on u.id = a.user_id
      where a.starts_at >= now() and a.status in ('planned','requested') order by a.starts_at limit 8`)).rows;
    const overdue = (await x.query(`select t.id, t.title, t.due_at, pr.full_name, pr.id as prospect_id, u.full_name as assignee
      from immo.tasks t left join immo.prospects pr on pr.id = t.prospect_id left join immo.users u on u.id = t.assignee_id
      where t.done_at is null and t.due_at < now() order by t.due_at limit 10`)).rows;
    const counts = (await x.query(`select (select count(*)::int from immo.projects) projects, (select count(*)::int from immo.lots) lots,
      (select count(*)::int from immo.prospects) prospects, (select count(*)::int from immo.tasks where done_at is null and due_at < now()) overdue`)).rows[0];
    return { lots, stages, inquiries, appts, overdue, counts, org: s.orgName };
  });
  const lotMap = Object.fromEntries(d.lots.map((r) => [r.status, r.n]));
  const stageMap = Object.fromEntries(d.stages.map((r) => [r.stage, r.n]));
  const totalLots = d.counts.lots || 1;
  return (
    <>
      <PageHead title={t('nav.dashboard')} subtitle={`${d.org} — indicateurs calculés en direct depuis la base`} />
      <div className="grid grid-4">
        <div className="card kpi"><span className="l">Projets</span><span className="v">{d.counts.projects}</span></div>
        <div className="card kpi"><span className="l">Lots</span><span className="v">{d.counts.lots}</span></div>
        <div className="card kpi"><span className="l">Prospects</span><span className="v">{d.counts.prospects}</span></div>
        <div className="card kpi"><span className="l">Tâches en retard</span><span className="v" style={{ color: d.counts.overdue ? 'var(--c-danger)' : undefined }}>{d.counts.overdue}</span></div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <section className="card" aria-labelledby="h-lots">
          <h2 id="h-lots">Lots par statut</h2>
          <div className="bar" aria-hidden>
            {LOT_STATUSES.map((s) => <span key={s} style={{ width: `${((lotMap[s] ?? 0) / totalLots) * 100}%`, background: STATUS_COLORS[s] }} />)}
          </div>
          <table className="table" style={{ marginTop: 8 }}><tbody>
            {LOT_STATUSES.map((s) => (
              <tr key={s}><td><Link href={`/lots?status=${s}`}><span className={`badge st-${s}`}>{t(`status.${s}`)}</span></Link></td><td className="right" data-kpi={`lots-${s}`}>{lotMap[s] ?? 0}</td></tr>
            ))}
          </tbody></table>
        </section>
        <section className="card">
          <h2>Prospects par étape</h2>
          <table className="table"><tbody>
            {PIPELINE_STAGES.map((s) => <tr key={s}><td><Link href={`/prospects?stage=${s}`}>{t(`stage.${s}`)}</Link></td><td className="right" data-kpi={`stage-${s}`}>{stageMap[s] ?? 0}</td></tr>)}
          </tbody></table>
        </section>
        <section className="card">
          <h2>Demandes par projet</h2>
          {d.inquiries.length === 0 ? <Empty>Aucun projet.</Empty> : (
            <table className="table"><thead><tr><th>Projet</th><th className="right">30 derniers jours</th><th className="right">Total</th></tr></thead><tbody>
              {d.inquiries.map((r) => <tr key={r.id}><td><Link href={`/projects/${r.id}`}>{r.name}</Link></td><td className="right">{r.last30}</td><td className="right" data-kpi="inquiries-total">{r.total}</td></tr>)}
            </tbody></table>
          )}
        </section>
        <section className="card">
          <h2>Rendez-vous à venir</h2>
          {d.appts.length === 0 ? <Empty>Aucun rendez-vous à venir.</Empty> : (
            <table className="table"><tbody>
              {d.appts.map((a) => <tr key={a.id}><td className="nowrap">{formatDateTime(a.starts_at, locale)}</td><td>{a.title}{a.status === 'requested' && <span className="tag" style={{ marginInlineStart: 6 }}>à confirmer</span>}</td>
                <td>{a.prospect_id ? <Link href={`/prospects/${a.prospect_id}`}>{a.full_name}</Link> : '—'}</td></tr>)}
            </tbody></table>
          )}
        </section>
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Tâches en retard</h2>
          {d.overdue.length === 0 ? <Empty>Aucune tâche en retard.</Empty> : (
            <table className="table"><thead><tr><th>Échéance</th><th>Tâche</th><th>Prospect</th><th>Responsable</th></tr></thead><tbody>
              {d.overdue.map((r) => <tr key={r.id}><td className="nowrap" style={{ color: 'var(--c-danger)' }}>{formatDateTime(r.due_at, locale)}</td><td>{r.title}</td>
                <td>{r.prospect_id ? <Link href={`/prospects/${r.prospect_id}`}>{r.full_name}</Link> : '—'}</td><td>{r.assignee ?? '—'}</td></tr>)}
            </tbody></table>
          )}
        </section>
      </div>
    </>
  );
}
