import Link from 'next/link';
import { LOT_STATUSES, LOT_TYPES, can, formatM2, formatMAD } from '@immo/core';
import { asUser } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { PageHead, Empty, StatusBadge } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { createLot } from './actions';
import { CsvImport } from './CsvImport';
import { lotFilterSql } from '@/lib/lot-filters';

export const metadata = { title: 'Inventaire des lots' };
type SP = Record<string, string | undefined>;

export default async function Lots({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t } = await getT();
  const { where, params } = lotFilterSql(sp);
  const d = await asUser(async (x, s) => {
    await x.query('select immo.expire_holds()');
    return {
      role: s.role,
      projects: (await x.query(`select id, name from immo.projects order by name`)).rows,
      buildings: (await x.query(`select id, code, project_id from immo.buildings order by code`)).rows,
      floors: (await x.query(`select f.id, f.name, f.level, b.code, f.building_id from immo.floors f join immo.buildings b on b.id=f.building_id order by b.code, f.level`)).rows,
      lots: (await x.query(`select l.*, b.code as bcode, f.name as fname, f.level, p.name as pname,
          (select h.expires_at from immo.lot_holds h where h.lot_id=l.id and h.status='active') as hold_expires
        from immo.lots l left join immo.buildings b on b.id=l.building_id left join immo.floors f on f.id=l.floor_id join immo.projects p on p.id=l.project_id
        ${where} order by p.name, b.code nulls last, f.level nulls last, l.reference limit 1000`, params)).rows,
    };
  });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const projectId = sp.project ?? d.projects[0]?.id;
  return (
    <>
      <PageHead title="Inventaire des lots" subtitle={`${d.lots.length} lot(s) affiché(s)`}>
        <a className="btn" href={`/api/lots/export?${qs}`}>Exporter CSV</a>
      </PageHead>
      <form className="card form-grid" method="get" aria-label="Filtres">
        <label className="field"><span>Projet</span><select name="project" defaultValue={sp.project ?? ''}><option value="">{t('common.all')}</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>Bâtiment</span><select name="building" defaultValue={sp.building ?? ''}><option value="">{t('common.all')}</option>{d.buildings.filter((b) => !sp.project || b.project_id === sp.project).map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></label>
        <label className="field"><span>Statut</span><select name="status" defaultValue={sp.status ?? ''}><option value="">{t('common.all')}</option>{LOT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select></label>
        <label className="field"><span>Type</span><select name="type" defaultValue={sp.type ?? ''}><option value="">{t('common.all')}</option>{LOT_TYPES.map((s) => <option key={s} value={s}>{t(`type.${s}`)}</option>)}</select></label>
        <label className="field"><span>Pièces min.</span><input name="rooms" type="number" min={0} defaultValue={sp.rooms} /></label>
        <label className="field"><span>Surface min. (m²)</span><input name="minSurface" type="number" min={0} defaultValue={sp.minSurface} /></label>
        <label className="field"><span>Prix max. (MAD)</span><input name="maxPrice" type="number" min={0} defaultValue={sp.maxPrice} /></label>
        <label className="field"><span>Référence</span><input name="q" defaultValue={sp.q} placeholder="A-1-02" /></label>
        <div className="row" style={{ alignItems: 'flex-end' }}><button className="btn btn-primary">Filtrer</button><Link className="btn" href="/lots">Réinitialiser</Link></div>
      </form>
      <div className="card table-wrap" style={{ marginTop: 14, maxHeight: '60vh' }}>
        {d.lots.length === 0 ? <Empty>Aucun lot ne correspond aux filtres.</Empty> : (
          <table className="table" data-testid="lots-table">
            <thead><tr><th>Référence</th><th>Projet</th><th>Bât.</th><th>Étage</th><th>Type</th><th className="right">Pièces</th><th className="right">Surf. comm.</th><th className="right">Surf. calc.</th><th className="right">Prix</th><th>Statut</th></tr></thead>
            <tbody>{d.lots.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/lots/${l.id}`}><b>{l.reference}</b></Link></td><td className="small">{l.pname}</td><td>{l.bcode ?? '—'}</td><td>{l.fname ?? '—'}</td>
                <td>{t(`type.${l.type}`)}</td><td className="right">{l.rooms ?? '—'}</td><td className="right nowrap">{formatM2(l.surface_comm_m2)}</td>
                <td className="right nowrap muted">{formatM2(l.surface_calc_m2)}</td>
                <td className="right nowrap">{formatMAD(l.price)}{!l.price_public && l.price != null && <span className="small muted" title="Prix non publié"> 🔒</span>}</td>
                <td><StatusBadge status={l.status} />{l.hold_expires && <div className="small muted">expire {new Date(l.hold_expires).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca', dateStyle: 'short', timeStyle: 'short' })}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {can(d.role, 'manageProject') && projectId && (
        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <section className="card">
            <h2>Import CSV</h2>
            <p className="small muted">Séparateur « ; » ou « , ». Colonnes : reference, batiment, etage, type, pieces, chambres, surface_calculee_m2, surface_commerciale_m2, surface_terrasse_m2, surface_jardin_m2, orientation, prix, devise (MAD), prix_public (oui/non), statut, caracteristiques (séparées par |), description. Aperçu obligatoire avant enregistrement ; l’import est annulé en totalité en cas d’erreur.</p>
            <CsvImport projects={d.projects} defaultProject={projectId} />
          </section>
          <section className="card">
            <h2>Nouveau lot</h2>
            <ActionForm action={createLot} className="form-grid" submitLabel="Créer" redirectTo="/lots/{id}">
              <label className="field"><span>Projet</span><select name="project_id" defaultValue={projectId}>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field"><span>Référence</span><input name="reference" required /></label>
              <label className="field"><span>Type</span><select name="type">{LOT_TYPES.map((s) => <option key={s} value={s}>{t(`type.${s}`)}</option>)}</select></label>
              <label className="field"><span>Étage</span><select name="floor_id"><option value="">—</option>{d.floors.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}</select></label>
              <label className="field"><span>Pièces</span><input name="rooms" type="number" min={0} /></label>
              <label className="field"><span>Surface commerciale (m²)</span><input name="surface_comm_m2" inputMode="decimal" /></label>
              <label className="field"><span>Prix (MAD)</span><input name="price" inputMode="decimal" /></label>
              <label className="check"><input type="checkbox" name="price_public" /> <span>Prix publiable</span></label>
            </ActionForm>
            <p className="small muted">Le bâtiment est déduit de l’étage choisi lors de l’enregistrement complet sur la fiche.</p>
          </section>
        </div>
      )}
    </>
  );
}
