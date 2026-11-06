import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PIPELINE_STAGES, PROSPECT_SOURCES, can, formatDateTime, formatMAD, isoToCasablancaLocal, whatsappLink } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty, StatusBadge } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { addAppointment, addInteraction, addInterest, addTask, removeInterest, setAppointmentStatus, setStage, toggleTask, updateProspect } from '../actions';

const KIND: Record<string, string> = { note: 'Note', call: 'Appel', email: 'E-mail', whatsapp: 'WhatsApp', visit: 'Visite', inquiry: 'Demande web', stage_change: 'Étape', hold: 'Engagement' };

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getT();
  const d = await asUser(async (x, s) => {
    const p = (await x.query(`select pr.*, u.full_name owner_name from immo.prospects pr left join immo.users u on u.id=pr.owner_id where pr.id=$1`, [id])).rows[0];
    if (!p) return null;
    if (s.role === 'viewer') p.notes_private = null; // notes privées masquées aux lecteurs
    return {
      role: s.role, p, org: (await x.query(`select contact, settings from immo.organizations where id=$1`, [s.orgId])).rows[0],
      users: (await x.query(`select u.id, u.full_name from immo.users u join immo.memberships m on m.user_id=u.id and m.org_id=$1 where m.role <> 'viewer' order by u.full_name`, [s.orgId])).rows,
      projects: (await x.query(`select id, name from immo.projects order by name`)).rows,
      lots: (await x.query(`select l.id, l.reference, l.status, l.price, p.name pname from immo.prospect_lots pl join immo.lots l on l.id=pl.lot_id join immo.projects p on p.id=l.project_id where pl.prospect_id=$1`, [id])).rows,
      allLots: (await x.query(`select id, reference from immo.lots where ($1::uuid is null or project_id=$1) and status in ('available','option') order by reference limit 500`, [p.project_id])).rows,
      interactions: (await x.query(`select i.*, u.full_name from immo.interactions i left join immo.users u on u.id=i.author_id where prospect_id=$1 order by created_at desc limit 100`, [id])).rows,
      appts: (await x.query(`select a.*, u.full_name from immo.appointments a left join immo.users u on u.id=a.user_id where prospect_id=$1 order by starts_at desc`, [id])).rows,
      tasks: (await x.query(`select t.*, u.full_name from immo.tasks t left join immo.users u on u.id=t.assignee_id where prospect_id=$1 order by done_at nulls first, due_at`, [id])).rows,
      holds: (await x.query(`select h.*, l.reference from immo.lot_holds h join immo.lots l on l.id=h.lot_id where h.prospect_id=$1 order by h.created_at desc`, [id])).rows,
    };
  });
  if (!d) notFound();
  const { p } = d;
  const sell = can(d.role, 'sell');
  const wa = p.phone ? whatsappLink(p.phone, `Bonjour ${p.full_name.split(' ')[0]}, `) : null;
  return (
    <>
      <PageHead title={p.full_name} crumbs={<><Link href="/prospects">Prospects</Link> / {p.full_name}</>} subtitle={<>{t(`stage.${p.stage}`)} · {t(`source.${p.source}`)} · suivi par {p.owner_name ?? 'personne'}</>}>
        {wa && <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp (message prérempli)</a>}
        {p.email && <a className="btn" href={`mailto:${p.email}`}>E-mail</a>}
      </PageHead>
      {!d.org.settings?.communications_enabled && <div className="alert alert-info small" style={{ marginBottom: 12 }}>Communications automatiques désactivées : aucun message n’est envoyé par la plateforme. Les liens ouvrent votre messagerie.</div>}
      <div className="grid grid-side">
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Historique des interactions</h2>
            {sell && <ActionForm action={addInteraction} className="stack" submitLabel="Ajouter" resetOnSuccess>
              <input type="hidden" name="prospect_id" value={id} />
              <div className="row"><select name="kind" aria-label="Type">{['note', 'call', 'email', 'whatsapp', 'visit'].map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
                <input name="body" required placeholder="Compte rendu…" style={{ flex: 1 }} aria-label="Contenu" /></div>
            </ActionForm>}
            {d.interactions.length === 0 ? <Empty>Aucune interaction.</Empty> : <table className="table small" data-testid="interactions"><tbody>{d.interactions.map((i) => (
              <tr key={i.id}><td className="nowrap">{formatDateTime(i.created_at, locale)}</td><td><span className="tag">{KIND[i.kind] ?? i.kind}</span></td><td style={{ whiteSpace: 'pre-wrap' }}>{i.body}</td><td>{i.full_name ?? 'Visiteur / système'}</td></tr>
            ))}</tbody></table>}
          </section>
          <section className="card">
            <h2>Rendez-vous</h2>
            {d.appts.length === 0 ? <Empty>Aucun rendez-vous.</Empty> : <table className="table small"><tbody>{d.appts.map((a) => (
              <tr key={a.id}><td className="nowrap">{formatDateTime(a.starts_at, locale)}</td><td>{a.title}{a.status === 'requested' && <span className="tag" style={{ marginInlineStart: 6 }}>demandé — à confirmer</span>}</td><td>{a.full_name ?? '—'}</td>
                <td>{sell ? <ActionForm action={setAppointmentStatus} inline><input type="hidden" name="id" value={a.id} /><select name="status" defaultValue={a.status === 'requested' ? 'planned' : a.status} aria-label="Statut">
                  <option value="planned">{a.status === 'requested' ? 'Confirmer' : 'Planifié'}</option><option value="done">Réalisé</option><option value="cancelled">Annulé</option><option value="no_show">Absent</option></select><button className="btn btn-sm">OK</button></ActionForm> : a.status}</td></tr>
            ))}</tbody></table>}
            {sell && <ActionForm action={addAppointment} className="form-grid" submitLabel="Planifier" resetOnSuccess>
              <input type="hidden" name="prospect_id" value={id} /><input type="hidden" name="project_id" value={p.project_id ?? ''} />
              <label className="field"><span>Objet</span><input name="title" required defaultValue="Visite" /></label>
              <label className="field"><span>Date et heure (Casablanca)</span><input name="starts_at" type="datetime-local" required defaultValue={isoToCasablancaLocal(new Date(Date.now() + 86400000)).slice(0, 14) + '00'} /></label>
              <label className="field"><span>Durée (min)</span><input name="duration" type="number" min={15} max={600} defaultValue={60} /></label>
              <label className="field"><span>Lieu</span><input name="location" /></label>
              <label className="field"><span>Commercial</span><select name="user_id" defaultValue={p.owner_id ?? ''}>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
            </ActionForm>}
          </section>
          <section className="card">
            <h2>Tâches</h2>
            {d.tasks.length === 0 ? <Empty>Aucune tâche.</Empty> : <table className="table small"><tbody>{d.tasks.map((tk) => (
              <tr key={tk.id}><td>{sell && <ActionForm action={toggleTask} inline><input type="hidden" name="id" value={tk.id} /><button className="btn btn-sm" aria-label="Basculer">{tk.done_at ? '☑' : '☐'}</button></ActionForm>}</td>
                <td style={{ textDecoration: tk.done_at ? 'line-through' : undefined }}>{tk.title}</td>
                <td className="nowrap" style={{ color: !tk.done_at && tk.due_at && new Date(tk.due_at) < new Date() ? 'var(--c-danger)' : undefined }}>{formatDateTime(tk.due_at, locale)}</td><td>{tk.full_name ?? '—'}</td></tr>
            ))}</tbody></table>}
            {sell && <ActionForm action={addTask} className="form-grid" submitLabel="Ajouter" resetOnSuccess>
              <input type="hidden" name="prospect_id" value={id} />
              <label className="field"><span>Tâche</span><input name="title" required /></label>
              <label className="field"><span>Échéance</span><input name="due_at" type="datetime-local" /></label>
              <label className="field"><span>Responsable</span><select name="assignee_id" defaultValue={p.owner_id ?? ''}>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
            </ActionForm>}
          </section>
        </div>
        <aside className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Étape du pipeline</h2>
            {sell ? <ActionForm action={setStage} className="stack" submitLabel="Mettre à jour">
              <input type="hidden" name="id" value={id} />
              <select name="stage" defaultValue={p.stage} data-testid="stage">{PIPELINE_STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}</select>
              <input name="reason" placeholder="Commentaire (facultatif)" />
            </ActionForm> : <p>{t(`stage.${p.stage}`)}</p>}
          </section>
          <section className="card">
            <h2>Lots d’intérêt</h2>
            {d.lots.length === 0 ? <Empty>Aucun.</Empty> : <ul style={{ paddingInlineStart: 16 }}>{d.lots.map((l) => <li key={l.id} className="row"><Link href={`/lots/${l.id}`}>{l.reference}</Link> <StatusBadge status={l.status} /> {formatMAD(l.price)}
              {sell && <ActionForm action={removeInterest} inline><input type="hidden" name="prospect_id" value={id} /><input type="hidden" name="lot_id" value={l.id} /><button className="btn btn-sm" aria-label="Retirer">×</button></ActionForm>}</li>)}</ul>}
            {sell && <ActionForm action={addInterest} inline submitLabel="Ajouter" submitClass="btn btn-sm"><input type="hidden" name="prospect_id" value={id} />
              <select name="lot_id" required aria-label="Lot"><option value="">— lot —</option>{d.allLots.map((l) => <option key={l.id} value={l.id}>{l.reference}</option>)}</select></ActionForm>}
            {d.holds.length > 0 && <><h3 style={{ marginTop: 10 }}>Engagements</h3><ul className="small" style={{ paddingInlineStart: 16 }}>{d.holds.map((h) => <li key={h.id}>{h.kind === 'option' ? 'Option' : 'Réservation'} {h.reference} — {h.status}</li>)}</ul></>}
            <p className="small muted">Les options et réservations se posent depuis la fiche du lot (contrôle d’exclusivité).</p>
          </section>
          <section className="card">
            <h2>Coordonnées</h2>
            {sell ? <ActionForm action={updateProspect} className="stack" submitLabel="Enregistrer">
              <input type="hidden" name="id" value={id} />
              <label className="field"><span>Nom</span><input name="full_name" defaultValue={p.full_name} required /></label>
              <label className="field"><span>E-mail</span><input name="email" type="email" defaultValue={p.email ?? ''} /></label>
              <label className="field"><span>Téléphone</span><input name="phone" defaultValue={p.phone ?? ''} /></label>
              <label className="field"><span>Source</span><select name="source" defaultValue={p.source}>{PROSPECT_SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}</select></label>
              <label className="field"><span>Commercial responsable</span><select name="owner_id" defaultValue={p.owner_id ?? ''}><option value="">—</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
              <label className="field"><span>Projet</span><select name="project_id" defaultValue={p.project_id ?? ''}><option value="">—</option>{d.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <div className="row"><label className="field"><span>Budget min</span><input name="budget_min" defaultValue={p.budget_min ?? ''} inputMode="decimal" /></label><label className="field"><span>Budget max</span><input name="budget_max" defaultValue={p.budget_max ?? ''} inputMode="decimal" /></label></div>
              <label className="field"><span>Notes privées (non visibles des lecteurs ni du public)</span><textarea name="notes_private" defaultValue={p.notes_private ?? ''} /></label>
              <label className="check"><input type="checkbox" name="consent_contact" defaultChecked={p.consent_contact} /> <span>Consentement au recontact</span></label>
            </ActionForm> : <dl className="kv"><dt>E-mail</dt><dd>{p.email ?? '—'}</dd><dt>Téléphone</dt><dd>{p.phone ?? '—'}</dd><dt>Budget</dt><dd>{formatMAD(p.budget_min)} – {formatMAD(p.budget_max)}</dd></dl>}
          </section>
        </aside>
      </div>
    </>
  );
}
