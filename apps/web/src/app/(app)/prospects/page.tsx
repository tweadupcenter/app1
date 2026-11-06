import Link from 'next/link';
import { PIPELINE_STAGES, PROSPECT_SOURCES, can, formatDate, formatMAD } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { createProspect, setStage } from './actions';

export const metadata = { title: 'Prospects' };

export default async function Prospects({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t } = await getT();
  const view = sp.view === 'table' ? 'table' : 'pipeline';
  const d = await asUser(async (x, s) => {
    const w: string[] = [], p: unknown[] = [];
    const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
    if (sp.stage) add('pr.stage = ?', sp.stage);
    if (sp.owner) add('pr.owner_id = ?', sp.owner);
    if (sp.project) add('pr.project_id = ?', sp.project);
    if (sp.q) { p.push(sp.q); const i = `$${p.length}`; w.push(`(pr.full_name ilike '%'||${i}||'%' or pr.email ilike '%'||${i}||'%' or pr.phone ilike '%'||${i}||'%')`); }
    return {
      role: s.role, me: s.userId,
      users: (await x.query(`select u.id, u.full_name from immo.users u join immo.memberships m on m.user_id=u.id and m.org_id=$1 where m.role <> 'viewer' order by u.full_name`, [s.orgId])).rows,
      projects: (await x.query(`select id, name from immo.projects order by name`)).rows,
      rows: (await x.query(`select pr.id, pr.full_name, pr.email, pr.phone, pr.stage, pr.source, pr.budget_max, pr.created_at, u.full_name owner, p.name project,
          (select count(*)::int from immo.prospect_lots pl where pl.prospect_id=pr.id) lots,
          (select min(a.starts_at) from immo.appointments a where a.prospect_id=pr.id and a.starts_at > now() and a.status in ('planned','requested')) next_appt
        from immo.prospects pr left join immo.users u on u.id=pr.owner_id left join immo.projects p on p.id=pr.project_id
        ${w.length ? 'where ' + w.join(' and ') : ''} order by pr.updated_at desc limit 500`, p)).rows,
    };
  });
  const qs = (v: string) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)) as Record<string, string>, view: v }).toString();
  const sell = can(d.role, 'sell');
  return (
    <>
      <PageHead title="Prospects" subtitle={`${d.rows.length} prospect(s)`}>
        <Link className={`btn btn-sm ${view === 'pipeline' ? 'on' : ''}`} href={`?${qs('pipeline')}`}>Pipeline</Link>
        <Link className={`btn btn-sm ${view === 'table' ? 'on' : ''}`} href={`?${qs('table')}`}>Liste</Link>
      </PageHead>
      <form className="card form-grid" method="get">
        <input type="hidden" name="view" value={view} />
        <label className="field"><span>Recherche</span><input name="q" defaultValue={sp.q} placeholder="Nom, e-mail, téléphone" /></label>
        <label className="field"><span>Étape</span><select name="stage" defaultValue={sp.stage ?? ''}><option value="">{t('common.all')}</option>{PIPELINE_STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}</select></label>
        <label className="field"><span>Commercial</span><select name="owner" defaultValue={sp.owner ?? ''}><option value="">{t('common.all')}</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
        <label className="field"><span>Projet</span><select name="project" defaultValue={sp.project ?? ''}><option value="">{t('common.all')}</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="row" style={{ alignItems: 'flex-end' }}><button className="btn btn-primary">Filtrer</button></div>
      </form>
      <div style={{ marginTop: 14 }}>
        {d.rows.length === 0 ? <Empty>Aucun prospect.</Empty> : view === 'pipeline' ? (
          <div className="kanban" data-testid="pipeline">
            {PIPELINE_STAGES.map((st) => { const items = d.rows.filter((r) => r.stage === st); return (
              <div key={st} className="col" data-stage={st}>
                <h3><span>{t(`stage.${st}`)}</span><span className="muted">{items.length}</span></h3>
                {items.map((r) => (
                  <div key={r.id} className="item">
                    <Link href={`/prospects/${r.id}`}><b>{r.full_name}</b></Link>
                    <div className="small muted">{r.owner ?? 'non attribué'} · {t(`source.${r.source}`)}{r.lots ? ` · ${r.lots} lot(s)` : ''}</div>
                    {r.next_appt && <div className="small">RDV {formatDate(r.next_appt)}</div>}
                    {sell && <ActionForm action={setStage} inline>
                      <input type="hidden" name="id" value={r.id} />
                      <select name="stage" defaultValue={r.stage} aria-label="Changer d’étape" style={{ fontSize: 12, minHeight: 26, padding: 2 }}>{PIPELINE_STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}</select>
                      <button className="btn btn-sm">→</button>
                    </ActionForm>}
                  </div>
                ))}
              </div>
            ); })}
          </div>
        ) : (
          <div className="card table-wrap"><table className="table"><thead><tr><th>Nom</th><th>Contact</th><th>Étape</th><th>Source</th><th>Commercial</th><th>Projet</th><th className="right">Budget max</th><th>Créé le</th></tr></thead><tbody>
            {d.rows.map((r) => <tr key={r.id}><td><Link href={`/prospects/${r.id}`}>{r.full_name}</Link></td><td className="small">{r.email ?? ''} {r.phone ?? ''}</td><td>{t(`stage.${r.stage}`)}</td>
              <td>{t(`source.${r.source}`)}</td><td>{r.owner ?? '—'}</td><td className="small">{r.project ?? '—'}</td><td className="right">{formatMAD(r.budget_max)}</td><td className="small">{formatDate(r.created_at)}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      {sell && <section className="card" style={{ marginTop: 14 }}>
        <h2>Nouveau prospect</h2>
        <ActionForm action={createProspect} className="form-grid" submitLabel="Créer" redirectTo="/prospects/{id}">
          <label className="field"><span>Nom complet</span><input name="full_name" required /></label>
          <label className="field"><span>E-mail</span><input name="email" type="email" /></label>
          <label className="field"><span>Téléphone</span><input name="phone" type="tel" /></label>
          <label className="field"><span>Source</span><select name="source">{PROSPECT_SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}</select></label>
          <label className="field"><span>Commercial</span><select name="owner_id" defaultValue={d.me}>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
          <label className="field"><span>Projet</span><select name="project_id"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field"><span>Budget min (MAD)</span><input name="budget_min" inputMode="decimal" /></label>
          <label className="field"><span>Budget max (MAD)</span><input name="budget_max" inputMode="decimal" /></label>
          <label className="check"><input type="checkbox" name="consent_contact" /> <span>Consentement au recontact recueilli</span></label>
          <label className="check"><input type="checkbox" name="force" /> <span>Créer même si doublon probable</span></label>
        </ActionForm>
      </section>}
    </>
  );
}
