import 'server-only';
import type { Tx } from './db';
import { drawingSchema } from '@immo/core';
import type { SceneData, SceneDraft } from './scene-types';

/** Version de travail (interne) : données en direct, maquette active. */
export async function internalSceneData(x: Tx, projectId: string): Promise<SceneData | null> {
  const p = (await x.query(`select id, name, slug, is_fictional, description from immo.projects where id=$1`, [projectId])).rows[0];
  if (!p) return null;
  const model = (await x.query(`select r.id, r.media_id from immo.models m join immo.model_revisions r on r.id=m.active_revision_id where m.project_id=$1 and r.status='ready' order by m.created_at desc limit 1`, [projectId])).rows[0];
  const o = (await x.query(`select o.name, o.contact from immo.organizations o join immo.projects p on p.org_id=o.id where p.id=$1`, [projectId])).rows[0];
  return {
    mode: 'internal',
    project: p,
    buildings: (await x.query(`select id, code, name, footprint from immo.buildings where project_id=$1 order by sort_order, code`, [projectId])).rows,
    floors: (await x.query(`select id, building_id, level, name, elevation_m, height_m from immo.floors where project_id=$1 order by level`, [projectId])).rows,
    lots: (await x.query(`select id, reference, building_id, floor_id, type, rooms, bedrooms, surface_comm_m2, surface_terrace_m2, surface_garden_m2, orientation,
      price, price_public, features, description, status, footprint, plan_media_id, image_media_ids from immo.lots where project_id=$1 order by reference`, [projectId])).rows,
    amenities: (await x.query(`select id, kind, name, footprint from immo.amenities where project_id=$1 order by kind`, [projectId])).rows,
    viewpoints: (await x.query(`select id, label, kind, amenity_id, building_id, lot_id, position, target, fov, sort_order, show_in_nav from immo.viewpoints where project_id=$1 order by sort_order, label`, [projectId])).rows,
    tours: (await x.query(`select id, name, shots from immo.sequences where project_id=$1 and kind='tour' order by name`, [projectId])).rows,
    model: model ? { url: `/api/files/${model.media_id}`, bindings: (await x.query(`select node_name, target_type, target_id from immo.model_bindings where revision_id=$1`, [model.id])).rows } : null,
    fileBase: '/api/files/',
    planImages: (await x.query(`select pp.image_media_id id, coalesce(pp.level_label, p.name || ' p' || (pp.page_index+1)) label from immo.plan_pages pp join immo.plans p on p.id=pp.plan_id where p.project_id=$1 and pp.selected and pp.image_media_id is not null`, [projectId])).rows,
    gallery: (await x.query(`select id, kind from immo.media where project_id=$1 and kind in ('image','capture') order by created_at desc limit 30`, [projectId])).rows,
    contact: { ...(o?.contact ?? {}), orgName: o?.name },
    drafts: await draftsFor(x, projectId),
  };
}

/** Dernière version du tracé de chaque page associée à un étage (éléments validés ou non). */
async function draftsFor(x: Tx, projectId: string): Promise<SceneDraft[]> {
  const rows = (await x.query(`select pp.id, pp.image_media_id, pp.width_px, pp.height_px, pp.rotation, pp.crop, pp.scale_m_per_px, pp.level_label, pp.floor_height_m,
      p.name plan_name, pp.page_index, f.elevation_m, d.version, d.data
    from immo.plan_pages pp join immo.plans p on p.id=pp.plan_id
    left join immo.floors f on f.id=pp.floor_id
    join lateral (select version, data from immo.plan_drawings where plan_page_id=pp.id order by version desc limit 1) d on true
    where p.project_id=$1 order by f.elevation_m nulls first, p.created_at`, [projectId])).rows;
  const out: SceneDraft[] = [];
  for (const r of rows) {
    const parsed = drawingSchema.safeParse(r.data);
    if (!parsed.success || (!parsed.data.walls.length && !parsed.data.rooms.length)) continue;
    out.push({
      pageId: r.id, label: r.level_label ?? `${r.plan_name} p${r.page_index + 1}`, elevation: Number(r.elevation_m ?? 0), floorHeight: Number(r.floor_height_m ?? 3),
      version: r.version, drawing: parsed.data, editorUrl: `/projects/${projectId}/editor/${r.id}`,
      plan: r.image_media_id ? { url: `/api/files/${r.image_media_id}`, width: r.width_px, height: r.height_px, rotation: r.rotation, crop: r.crop, scale: r.scale_m_per_px == null ? null : Number(r.scale_m_per_px) } : null,
    });
  }
  return out;
}

/** Version publique : uniquement l'instantané publié + statuts en direct. */
export function publicSceneData(slug: string, pub: any): SceneData {
  const s = pub.snapshot;
  return {
    mode: 'public',
    project: { id: s.project.id, name: s.project.name, slug, is_fictional: s.project.is_fictional, description: s.project.description },
    buildings: s.buildings, floors: s.floors,
    lots: s.lots.map((l: any) => ({ ...l, status: pub.statuses[l.id] ?? 'unavailable' })),
    amenities: s.amenities, viewpoints: s.viewpoints.filter((v: any) => v.kind !== 'shot'), tours: s.tours ?? [],
    model: s.model ? { url: `/api/public/${slug}/files/${s.model.media_id}`, bindings: s.model.bindings } : null,
    fileBase: `/api/public/${slug}/files/`,
    planImages: (s.plan_images ?? []).map((p: any) => ({ id: p.id, label: p.level_label ?? p.name })),
    gallery: (s.gallery ?? []).filter((g: any) => g.kind !== 'video'),
    contact: { ...s.org.contact, orgName: s.org.name },
  };
}
