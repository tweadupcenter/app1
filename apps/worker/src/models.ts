import { inspectGlb } from '@immo/core/glb';
import { localStorage } from '@immo/core/storage';
import type { JobCtx } from './index';

/**
 * Inspection d'une révision GLB : validation, liste des nœuds, et contrôle des associations
 * de la révision active (reportées si le nœud existe encore, signalées sinon).
 */
export async function inspectModel({ job, tx, log }: JobCtx) {
  const storage = localStorage(process.env.STORAGE_DIR);
  const rev = await tx(async (t) => (await t.query(`select r.*, m.storage_key, mo.active_revision_id, mo.id as model_id from immo.model_revisions r
    join immo.media m on m.id=r.media_id join immo.models mo on mo.id=r.model_id where r.id=$1`, [job.payload.revision_id])).rows[0]);
  if (!rev) throw new Error('Révision introuvable');
  try {
    const info = inspectGlb(new Uint8Array(await storage.get(rev.storage_key)));
    log(`GLB : ${info.nodeNames.length} nœuds, ${info.meshCount} maillages, ~${info.triangleEstimate} triangles`);
    return await tx(async (t) => {
      let carried = 0;
      const missing: { node_name: string; target_type: string; target_id: string }[] = [];
      if (rev.active_revision_id && rev.active_revision_id !== rev.id) {
        const names = new Set(info.nodeNames);
        const prev = (await t.query(`select * from immo.model_bindings where revision_id=$1`, [rev.active_revision_id])).rows;
        for (const b of prev) {
          if (names.has(b.node_name)) {
            await t.query(`insert into immo.model_bindings (org_id, revision_id, node_name, target_type, target_id, carried_from, created_by)
              values ($1,$2,$3,$4,$5,$6,$7) on conflict (revision_id, node_name) do nothing`, [rev.org_id, rev.id, b.node_name, b.target_type, b.target_id, b.id, job.created_by]);
            carried++;
          } else missing.push({ node_name: b.node_name, target_type: b.target_type, target_id: b.target_id });
        }
      }
      const report = { ...info, nodeNames: undefined, carried, missing, previous_revision_id: rev.active_revision_id };
      await t.query(`update immo.model_revisions set status='ready', node_names=$2, report=$3, error=null where id=$1`, [rev.id, info.nodeNames, report]);
      if (!rev.active_revision_id) await t.query(`update immo.models set active_revision_id=$2 where id=$1`, [rev.model_id, rev.id]);
      return { nodes: info.nodeNames.length, carried, missing: missing.length, warnings: info.warnings };
    });
  } catch (e) {
    await tx((t) => t.query(`update immo.model_revisions set status='error', error=$2 where id=$1`, [rev.id, (e as Error).message.slice(0, 500)]));
    throw e;
  }
}
