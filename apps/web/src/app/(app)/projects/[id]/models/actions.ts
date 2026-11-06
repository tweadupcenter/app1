'use server';
import { z } from 'zod';
import { sanitizeNodeName } from '@immo/core/glb';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const TARGETS = ['building', 'floor', 'lot', 'amenity'] as const;
const TABLE: Record<(typeof TARGETS)[number], string> = { building: 'buildings', floor: 'floors', lot: 'lots', amenity: 'amenities' };

async function assertTarget(x: any, revisionId: string, type: (typeof TARGETS)[number], id: string) {
  const r = await x.query(`select 1 from immo.${TABLE[type]} t join immo.models m on m.project_id = t.project_id join immo.model_revisions r on r.model_id = m.id where r.id=$1 and t.id=$2`, [revisionId, id]);
  if (!r.rowCount) throw new UserError('Cible introuvable dans ce projet.');
}

export async function saveBinding(revisionId: string, nodeName: string, targetType: string, targetId: string) {
  return action(() => asUser(async (x, s) => {
    const type = z.enum(TARGETS).parse(targetType);
    const rev = (await x.query(`select node_names from immo.model_revisions where id=$1`, [revisionId])).rows[0];
    if (!rev) throw new UserError('Révision introuvable.');
    if (rev.node_names.length && !rev.node_names.includes(nodeName)) throw new UserError('Ce nœud n’existe pas dans la révision.');
    await assertTarget(x, revisionId, type, targetId);
    await x.query(`insert into immo.model_bindings (org_id, revision_id, node_name, target_type, target_id, created_by) values ($1,$2,$3,$4,$5,$6)
      on conflict (revision_id, node_name) do update set target_type=excluded.target_type, target_id=excluded.target_id, carried_from=null, created_by=excluded.created_by, created_at=now()`,
      [s.orgId, revisionId, nodeName, type, targetId, s.userId]);
  }, 'manageProject'), 'Association enregistrée.');
}

export async function deleteBinding(revisionId: string, nodeName: string) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.model_bindings where revision_id=$1 and node_name=$2`, [revisionId, nodeName]); }, 'manageProject'), 'Association supprimée.');
}

/** Associations des pièces générées depuis l'éditeur (room_<id> -> lot). */
export async function autoBindGenerated(revisionId: string, bindings: { node: string; type: 'lot'; id: string }[]) {
  return action(() => asUser(async (x, s) => {
    for (const b of bindings.slice(0, 2000)) {
      await assertTarget(x, revisionId, 'lot', b.id);
      await x.query(`insert into immo.model_bindings (org_id, revision_id, node_name, target_type, target_id, created_by) values ($1,$2,$3,'lot',$4,$5) on conflict (revision_id, node_name) do nothing`,
        [s.orgId, revisionId, b.node, b.id, s.userId]);
    }
    return { n: bindings.length };
  }, 'manageProject'));
}

/** Association par convention de nommage : lot_<référence>, bld_<code>, floor_<code>_<niveau>, amenity_<type>. */
export async function autoBindByName(revisionId: string) {
  return action(() => asUser(async (x, s) => {
    const rev = (await x.query(`select r.node_names, m.project_id from immo.model_revisions r join immo.models m on m.id=r.model_id where r.id=$1`, [revisionId])).rows[0];
    if (!rev) throw new UserError('Révision introuvable.');
    const pid = rev.project_id;
    const map = new Map<string, [string, string]>();
    for (const l of (await x.query(`select id, reference from immo.lots where project_id=$1`, [pid])).rows) map.set(sanitizeNodeName(`lot_${l.reference}`).toLowerCase(), ['lot', l.id]);
    for (const b of (await x.query(`select id, code from immo.buildings where project_id=$1`, [pid])).rows) map.set(sanitizeNodeName(`bld_${b.code}`).toLowerCase(), ['building', b.id]);
    for (const f of (await x.query(`select f.id, f.level, b.code from immo.floors f join immo.buildings b on b.id=f.building_id where f.project_id=$1`, [pid])).rows) map.set(sanitizeNodeName(`floor_${f.code}_${f.level}`).toLowerCase(), ['floor', f.id]);
    for (const a of (await x.query(`select id, kind from immo.amenities where project_id=$1`, [pid])).rows) map.set(`amenity_${a.kind}`, ['amenity', a.id]);
    let n = 0;
    for (const node of rev.node_names as string[]) {
      const m = map.get(sanitizeNodeName(node).toLowerCase());
      if (!m) continue;
      const r = await x.query(`insert into immo.model_bindings (org_id, revision_id, node_name, target_type, target_id, created_by) values ($1,$2,$3,$4,$5,$6) on conflict (revision_id, node_name) do nothing`,
        [s.orgId, revisionId, node, m[0], m[1], s.userId]);
      n += r.rowCount ?? 0;
    }
    return { n };
  }, 'manageProject'), 'Associations par nom ajoutées.');
}

export async function activateRevision(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const id = String(f.get('revision_id'));
    const r = (await x.query(`select model_id, status from immo.model_revisions where id=$1`, [id])).rows[0];
    if (!r) throw new UserError('Révision introuvable.');
    if (r.status !== 'ready') throw new UserError('Seule une révision inspectée (prête) peut être activée.');
    await x.query(`update immo.models set active_revision_id=$2 where id=$1`, [r.model_id, id]);
  }, 'manageProject'), 'Révision activée : elle est utilisée par la visite (version de travail).');
}

export async function deleteModel(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.models where id=$1`, [String(f.get('model_id'))]); }, 'manageProject'), 'Maquette supprimée.');
}
