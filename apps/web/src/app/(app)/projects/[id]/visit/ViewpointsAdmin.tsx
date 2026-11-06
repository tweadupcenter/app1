import { ActionForm } from '@/components/ActionForm';
import type { SceneData } from '@/lib/scene-types';
import { updateViewpointMeta } from './actions';

const KINDS = [['overview', 'Vue générale'], ['amenity', 'Équipement'], ['building', 'Bâtiment'], ['lot', 'Lot'], ['interior', 'Intérieur'], ['shot', 'Cadrage (non affiché)']];

/** Barre de navigation configurable : libellés, ordre, visibilité et rattachement. */
export function ViewpointsAdmin({ data }: { data: SceneData }) {
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h2>Barre de navigation et points de visite</h2>
      <p className="small muted">Positionnez la caméra dans la visite puis « Enregistrer la vue actuelle ». Un bouton d’équipement ne s’affiche que si l’équipement existe dans le projet.</p>
      <div className="table-wrap"><table className="table small"><thead><tr><th>Libellé</th><th>Type</th><th>Équipement / bâtiment</th><th>Ordre</th><th>Dans la barre</th><th /></tr></thead><tbody>
        {data.viewpoints.map((v) => (
          <tr key={v.id}><td colSpan={6}>
            <ActionForm action={updateViewpointMeta} inline submitLabel="Enregistrer" submitClass="btn btn-sm">
              <input type="hidden" name="id" value={v.id} />
              <input name="label" defaultValue={v.label} aria-label="Libellé" style={{ width: 160 }} />
              <select name="kind" defaultValue={v.kind} aria-label="Type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select name="amenity_id" defaultValue={v.amenity_id ?? ''} aria-label="Équipement"><option value="">— équipement —</option>{data.amenities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select name="building_id" defaultValue={v.building_id ?? ''} aria-label="Bâtiment"><option value="">— bâtiment —</option>{data.buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
              <input name="sort_order" type="number" defaultValue={v.sort_order} aria-label="Ordre" style={{ width: 60 }} />
              <label className="check"><input type="checkbox" name="show_in_nav" defaultChecked={v.show_in_nav} /> <span>barre</span></label>
            </ActionForm>
          </td></tr>
        ))}
      </tbody></table></div>
    </section>
  );
}
