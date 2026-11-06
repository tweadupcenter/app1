import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { LOT_TYPES, ORIENTATIONS, can, formatDateTime, formatM2, formatMAD } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, StatusBadge, Empty } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { Uploader } from '@/components/Uploader';
import { changeStatus, holdLot, updateLot } from '../actions';

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getT();
  const d = await asUser(async (x, s) => {
    await x.query('select immo.expire_holds()');
    const lot = (await x.query(`select l.*, b.code bcode, b.name bname, f.name fname, p.name pname, p.id pid from immo.lots l
      join immo.projects p on p.id=l.project_id left join immo.buildings b on b.id=l.building_id left join immo.floors f on f.id=l.floor_id where l.id=$1`, [id])).rows[0];
    if (!lot) return null;
    return {
      role: s.role, lot,
      hold: (await x.query(`select h.*, p.full_name, u.full_name author from immo.lot_holds h left join immo.prospects p on p.id=h.prospect_id left join immo.users u on u.id=h.created_by where h.lot_id=$1 and h.status='active'`, [id])).rows[0],
      history: (await x.query(`select h.*, u.full_name from immo.lot_status_history h left join immo.users u on u.id=h.author_id where lot_id=$1 order by h.id desc limit 50`, [id])).rows,
      holds: (await x.query(`select h.*, p.full_name from immo.lot_holds h left join immo.prospects p on p.id=h.prospect_id where lot_id=$1 order by created_at desc limit 20`, [id])).rows,
      floors: (await x.query(`select f.id, f.name, b.id bid, b.code from immo.floors f join immo.buildings b on b.id=f.building_id where f.project_id=$1 order by b.code, f.level`, [lot.project_id])).rows,
      prospects: (await x.query(`select id, full_name, stage from immo.prospects where stage not in ('lost','sold') order by full_name limit 500`)).rows,
      interested: (await x.query(`select p.id, p.full_name, p.stage from immo.prospect_lots pl join immo.prospects p on p.id=pl.prospect_id where pl.lot_id=$1`, [id])).rows,
      media: (await x.query(`select id, kind, original_name, width, height from immo.media where id = any($1::uuid[]) or id = $2`, [lot.image_media_ids, lot.plan_media_id])).rows,
      binding: (await x.query(`select 1 from immo.model_bindings mb join immo.models m on m.active_revision_id = mb.revision_id where mb.target_id=$1 limit 1`, [id])).rowCount,
    };
  });
  if (!d) notFound();
  const { lot } = d;
  const manage = can(d.role, 'manageProject');
  const sell = can(d.role, 'sell');
  const floorsByB = d.floors;
  return (
    <>
      <PageHead title={`Lot ${lot.reference}`} crumbs={<><Link href="/lots">Lots</Link> / <Link href={`/projects/${lot.pid}`}>{lot.pname}</Link> / {lot.reference}</>}
        subtitle={<>{t(`type.${lot.type}`)} · {lot.bname ?? 'sans bâtiment'} · {lot.fname ?? 'sans étage'} · <StatusBadge status={lot.status} locale={locale} /></>}>
        <Link className="btn" href={`/projects/${lot.pid}/visit?lot=${lot.id}`}>{d.binding ? 'Voir dans la visite 3D' : 'Visite 3D (lot non associé)'}</Link>
        <a className="btn" href={`/api/lots/${lot.id}/pdf`} target="_blank" rel="noreferrer">Fiche PDF</a>
      </PageHead>
      <div className="grid grid-side">
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Caractéristiques</h2>
            <dl className="kv">
              <dt>Pièces / chambres</dt><dd>{lot.rooms ?? '—'} / {lot.bedrooms ?? '—'}</dd>
              <dt>Surface commerciale (saisie)</dt><dd>{formatM2(lot.surface_comm_m2)}</dd>
              <dt>Surface calculée (plan)</dt><dd>{formatM2(lot.surface_calc_m2)} <span className="small muted">— issue des pièces validées du plan lorsqu’elle a été recalculée</span></dd>
              <dt>Terrasse / jardin</dt><dd>{formatM2(lot.surface_terrace_m2)} / {formatM2(lot.surface_garden_m2)}</dd>
              <dt>Orientation</dt><dd>{lot.orientation ?? 'non renseignée'}</dd>
              <dt>Prix</dt><dd>{formatMAD(lot.price)} {lot.price_public ? <span className="tag">publiable</span> : <span className="tag">confidentiel</span>}</dd>
              <dt>Caractéristiques</dt><dd>{lot.features.length ? lot.features.join(' · ') : '—'}</dd>
              <dt>Publication</dt><dd>{lot.publishable ? 'Publiable' : 'Non publié'}</dd>
              <dt>Version</dt><dd>{lot.version} · mis à jour le {formatDateTime(lot.updated_at, locale)}</dd>
            </dl>
            {lot.description && <p>{lot.description}</p>}
          </section>
          <section className="card">
            <h2>Plan et images</h2>
            {d.media.length === 0 ? <Empty>Aucun plan ni image.</Empty> : (
              <div className="thumbs">{d.media.map((m) => <a key={m.id} href={`/api/files/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${m.id}`} alt={m.id === lot.plan_media_id ? 'Plan du lot' : m.original_name ?? 'Image'} /><div className="small">{m.id === lot.plan_media_id ? 'Plan' : 'Image'}</div></a>)}</div>
            )}
            {manage && <div className="grid grid-2" style={{ marginTop: 10 }}>
              <Uploader purpose="lot_plan" fields={{ lot_id: lot.id, project_id: lot.project_id }} accept="image/png,image/jpeg" label="Plan du lot (PNG/JPG)" />
              <Uploader purpose="lot_image" fields={{ lot_id: lot.id, project_id: lot.project_id }} accept="image/png,image/jpeg" label="Ajouter une image (PNG/JPG)" />
            </div>}
          </section>
          <section className="card">
            <h2>Historique des statuts</h2>
            <table className="table small" data-testid="history"><thead><tr><th>Date</th><th>De</th><th>Vers</th><th>Motif</th><th>Auteur</th></tr></thead><tbody>
              {d.history.map((h) => <tr key={h.id}><td className="nowrap">{formatDateTime(h.created_at, locale)}</td><td>{h.from_status ? t(`status.${h.from_status}`) : '—'}</td><td>{t(`status.${h.to_status}`)}</td><td>{h.reason ?? '—'}</td><td>{h.full_name ?? 'Système'}</td></tr>)}
            </tbody></table>
          </section>
          {manage && <section className="card">
            <h2>Modifier le lot</h2>
            <ActionForm action={updateLot} className="form-grid" submitLabel="Enregistrer">
              <input type="hidden" name="id" value={lot.id} /><input type="hidden" name="version" value={lot.version} />
              <label className="field"><span>Référence</span><input name="reference" defaultValue={lot.reference} required /></label>
              <label className="field"><span>Type</span><select name="type" defaultValue={lot.type}>{LOT_TYPES.map((s) => <option key={s} value={s}>{t(`type.${s}`)}</option>)}</select></label>
              <label className="field"><span>Étage</span><select name="floor_id" defaultValue={lot.floor_id ?? ''}><option value="">—</option>{floorsByB.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}</select></label>
              <input type="hidden" name="building_id" value={lot.building_id ?? ''} />
              <label className="field"><span>Pièces</span><input name="rooms" type="number" min={0} defaultValue={lot.rooms ?? ''} /></label>
              <label className="field"><span>Chambres</span><input name="bedrooms" type="number" min={0} defaultValue={lot.bedrooms ?? ''} /></label>
              <label className="field"><span>Surface commerciale m²</span><input name="surface_comm_m2" inputMode="decimal" defaultValue={lot.surface_comm_m2 ?? ''} /></label>
              <label className="field"><span>Surface calculée m²</span><input name="surface_calc_m2" inputMode="decimal" defaultValue={lot.surface_calc_m2 ?? ''} /></label>
              <label className="field"><span>Terrasse m²</span><input name="surface_terrace_m2" inputMode="decimal" defaultValue={lot.surface_terrace_m2 ?? ''} /></label>
              <label className="field"><span>Jardin m²</span><input name="surface_garden_m2" inputMode="decimal" defaultValue={lot.surface_garden_m2 ?? ''} /></label>
              <label className="field"><span>Orientation</span><select name="orientation" defaultValue={lot.orientation ?? ''}><option value="">Inconnue</option>{ORIENTATIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label className="field"><span>Prix (MAD)</span><input name="price" inputMode="decimal" defaultValue={lot.price ?? ''} /></label>
              <label className="field" style={{ gridColumn: '1/-1' }}><span>Caractéristiques (une par ligne)</span><textarea name="features" defaultValue={lot.features.join('\n')} /></label>
              <label className="field" style={{ gridColumn: '1/-1' }}><span>Description</span><textarea name="description" defaultValue={lot.description ?? ''} /></label>
              <label className="check"><input type="checkbox" name="price_public" defaultChecked={lot.price_public} /> <span>Prix publiable</span></label>
              <label className="check"><input type="checkbox" name="publishable" defaultChecked={lot.publishable} /> <span>Lot publiable</span></label>
            </ActionForm>
          </section>}
        </div>
        <aside className="stack" style={{ gap: 14 }}>
          <section className="card" data-testid="status-panel">
            <h2>Statut commercial</h2>
            <div style={{ fontSize: 16 }}><StatusBadge status={lot.status} locale={locale} /></div>
            {d.hold && <div className="alert alert-info" style={{ marginTop: 8 }}>
              {d.hold.kind === 'option' ? 'Option' : 'Réservation'} {d.hold.full_name ? `pour ${d.hold.full_name}` : ''} posée par {d.hold.author ?? '—'}
              {d.hold.expires_at && <> — expire le <b>{formatDateTime(d.hold.expires_at, locale)}</b> (contrôle serveur)</>}
            </div>}
            {sell ? (
              <div className="stack" style={{ marginTop: 10 }}>
                {lot.status === 'available' && (
                  <ActionForm action={holdLot} submitLabel="Poser une option">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="kind" value="option" />
                    <input type="hidden" name="idempotency_key" value={randomUUID()} />
                    <label className="field"><span>Prospect</span><select name="prospect_id"><option value="">— aucun —</option>{d.prospects.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
                    <label className="field"><span>Durée (heures)</span><input name="hours" type="number" min={0.1} max={720} step="0.1" defaultValue={48} required /></label>
                    <label className="field"><span>Motif</span><input name="reason" placeholder="Option 48 h" /></label>
                  </ActionForm>
                )}
                {(lot.status === 'available' || lot.status === 'option') && (
                  <ActionForm action={holdLot} submitLabel="Réserver" submitClass="btn btn-accent">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="kind" value="reservation" />
                    <input type="hidden" name="idempotency_key" value={randomUUID()} />
                    <label className="field"><span>Prospect {lot.status === 'option' && '(celui de l’option)'}</span><select name="prospect_id" defaultValue={d.hold?.prospect_id ?? ''}><option value="">— aucun —</option>{d.prospects.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
                    <label className="field"><span>Motif</span><input name="reason" placeholder="Acompte reçu" /></label>
                  </ActionForm>
                )}
                {lot.status !== 'available' && lot.status !== 'sold' && (
                  <ActionForm action={changeStatus} submitLabel={lot.status === 'unavailable' ? 'Remettre en vente' : 'Libérer (disponible)'} submitClass="btn">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="status" value="available" />
                    <label className="field"><span>Motif (obligatoire)</span><input name="reason" required /></label>
                  </ActionForm>
                )}
                {lot.status === 'reserved' && manage && (
                  <ActionForm action={changeStatus} submitLabel="Marquer vendu" submitClass="btn btn-primary">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="status" value="sold" />
                    <label className="field"><span>Motif (obligatoire)</span><input name="reason" required placeholder="Acte signé" /></label>
                  </ActionForm>
                )}
                {lot.status === 'available' && manage && (
                  <ActionForm action={changeStatus} submitLabel="Rendre indisponible" submitClass="btn btn-danger">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="status" value="unavailable" />
                    <label className="field"><span>Motif (obligatoire)</span><input name="reason" required /></label>
                  </ActionForm>
                )}
                {lot.status === 'sold' && manage && (
                  <ActionForm action={changeStatus} submitLabel="Annuler la vente" submitClass="btn btn-danger" confirm="Annuler la vente et remettre le lot disponible ?">
                    <input type="hidden" name="lot_id" value={lot.id} /><input type="hidden" name="status" value="available" />
                    <label className="field"><span>Motif (obligatoire)</span><input name="reason" required /></label>
                  </ActionForm>
                )}
              </div>
            ) : <p className="small muted">Lecture seule pour votre rôle.</p>}
          </section>
          <section className="card">
            <h2>Prospects intéressés</h2>
            {d.interested.length === 0 ? <Empty>Aucun.</Empty> : <ul>{d.interested.map((p) => <li key={p.id}><Link href={`/prospects/${p.id}`}>{p.full_name}</Link> — {t(`stage.${p.stage}`)}</li>)}</ul>}
          </section>
          <section className="card">
            <h2>Engagements</h2>
            {d.holds.length === 0 ? <Empty>Aucun.</Empty> : <table className="table small"><tbody>{d.holds.map((h) => <tr key={h.id}><td>{h.kind === 'option' ? 'Option' : 'Réservation'}</td><td>{h.status}</td><td>{h.full_name ?? '—'}</td><td className="nowrap">{formatDateTime(h.created_at, locale)}</td></tr>)}</tbody></table>}
          </section>
        </aside>
      </div>
    </>
  );
}
