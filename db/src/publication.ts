import type { Tx } from './index';

/**
 * Construit l'instantané public d'un projet : uniquement les données publiables.
 * Les prix non autorisés, notes, surfaces calculées internes et prospects n'y figurent jamais.
 */
export async function buildPublicationSnapshot(tx: Tx, projectId: string) {
  const one = async (sql: string, p: unknown[] = []) => (await tx.query(sql, p)).rows[0];
  const all = async (sql: string, p: unknown[] = []) => (await tx.query(sql, p)).rows;
  const project = await one(`select id, org_id, name, slug, city, address, description, is_fictional, frame from immo.projects where id = $1`, [projectId]);
  if (!project) throw new Error('Projet introuvable');
  const org = await one(`select name, branding, contact from immo.organizations where id = $1`, [project.org_id]);
  const buildings = await all(`select id, code, name, footprint, sort_order from immo.buildings where project_id = $1 order by sort_order, code`, [projectId]);
  const floors = await all(`select id, building_id, level, name, elevation_m, height_m from immo.floors where project_id = $1 order by level`, [projectId]);
  const lots = await all(
    `select id, reference, building_id, floor_id, type, rooms, bedrooms, surface_comm_m2, surface_terrace_m2, surface_garden_m2,
            orientation, case when price_public then price else null end as price, currency, price_public, features, description,
            footprint, plan_media_id, image_media_ids
       from immo.lots where project_id = $1 and publishable order by reference`, [projectId]);
  const amenities = await all(`select id, kind, name, footprint, description from immo.amenities where project_id = $1 order by kind`, [projectId]);
  const viewpoints = await all(
    `select id, label, kind, amenity_id, building_id, lot_id, position, target, fov, sort_order, show_in_nav
       from immo.viewpoints where project_id = $1 and kind <> 'shot' order by sort_order, label`, [projectId]);
  const tours = await all(`select id, name, shots from immo.sequences where project_id = $1 and kind = 'tour' order by name`, [projectId]);
  const model = await one(
    `select m.id as model_id, r.id as revision_id, r.media_id, r.version
       from immo.models m join immo.model_revisions r on r.id = m.active_revision_id
      where m.project_id = $1 and r.status = 'ready' order by m.created_at desc limit 1`, [projectId]);
  let bindings: { node_name: string; target_type: string; target_id: string }[] = [];
  if (model) bindings = await all(`select node_name, target_type, target_id from immo.model_bindings where revision_id = $1`, [model.revision_id]);
  // n'expose que les associations vers des cibles publiées
  const visible = new Set<string>([...buildings.map((b) => b.id), ...floors.map((f) => f.id), ...lots.map((l) => l.id), ...amenities.map((a) => a.id)]);
  bindings = bindings.filter((b) => visible.has(b.target_id));
  const gallery = await all(
    `select id, kind, mime, width, height, original_name from immo.media
      where project_id = $1 and kind in ('image','capture','video') and coalesce((meta->>'publishable')::boolean, false)
      order by created_at desc limit 60`, [projectId]);
  const planImages = await all(
    `select pp.image_media_id as id, pp.level_label, p.name from immo.plan_pages pp join immo.plans p on p.id = pp.plan_id
      where p.project_id = $1 and pp.selected and pp.image_media_id is not null and coalesce((select (meta->>'publishable')::boolean from immo.media where id = pp.image_media_id), false)`, [projectId]);
  const logoId: string | null = org?.branding?.logo_media_id ?? null;
  const mediaIds = new Set<string>();
  if (model) mediaIds.add(model.media_id);
  for (const l of lots) { if (l.plan_media_id) mediaIds.add(l.plan_media_id); for (const m of l.image_media_ids ?? []) mediaIds.add(m); }
  for (const g of gallery) mediaIds.add(g.id);
  for (const p of planImages) mediaIds.add(p.id);
  if (logoId) mediaIds.add(logoId);
  const { org_id: _o, ...publicProject } = project;
  return {
    snapshot: {
      project: publicProject,
      org: { name: org.name, branding: org.branding, contact: { phone: org.contact?.phone ?? null, email: org.contact?.email ?? null, whatsapp: org.contact?.whatsapp ?? null } },
      buildings, floors, lots, amenities, viewpoints, tours,
      model: model ? { revision_id: model.revision_id, media_id: model.media_id, version: model.version, bindings } : null,
      gallery, plan_images: planImages,
    },
    mediaIds: [...mediaIds],
  };
}
