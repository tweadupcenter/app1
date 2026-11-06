'use server';
import { z } from 'zod';
import { asUser } from '@/lib/auth';
import { action } from '@/lib/errors';

const v3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const vpSchema = z.object({
  id: z.string().uuid().optional(), projectId: z.string().uuid(), label: z.string().min(1).max(60),
  kind: z.enum(['overview', 'amenity', 'building', 'lot', 'interior', 'shot']),
  pose: z.object({ position: v3, target: v3, fov: z.number().min(10).max(120) }),
  showInNav: z.boolean(), sortOrder: z.number().int().min(0).max(1000),
  buildingId: z.string().uuid().nullable().optional(), amenityId: z.string().uuid().nullable().optional(), lotId: z.string().uuid().nullable().optional(),
});

/** Modification des points de visite par l'administration, sans toucher au code. */
export async function saveViewpoint(input: z.input<typeof vpSchema>) {
  return action(() => asUser(async (x, s) => {
    const v = vpSchema.parse(input);
    const vals = [v.label, v.kind, JSON.stringify(v.pose.position), JSON.stringify(v.pose.target), v.pose.fov, v.sortOrder, v.showInNav, v.buildingId ?? null, v.amenityId ?? null, v.lotId ?? null];
    if (v.id) await x.query(`update immo.viewpoints set label=$2, kind=$3, position=$4, target=$5, fov=$6, sort_order=$7, show_in_nav=$8, building_id=$9, amenity_id=$10, lot_id=$11 where id=$1`, [v.id, ...vals]);
    else await x.query(`insert into immo.viewpoints (org_id, project_id, label, kind, position, target, fov, sort_order, show_in_nav, building_id, amenity_id, lot_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [s.orgId, v.projectId, ...vals]);
  }, 'manageProject'));
}

export async function deleteViewpoint(id: string) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.viewpoints where id=$1`, [id]); }, 'manageProject'));
}

export async function updateViewpointMeta(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.viewpoints set label=$2, sort_order=$3, show_in_nav=$4, kind=$5, amenity_id=$6, building_id=$7 where id=$1`,
      [String(f.get('id')), z.string().min(1).max(60).parse(f.get('label')), Number(f.get('sort_order') ?? 0), f.get('show_in_nav') === 'on',
        z.enum(['overview', 'amenity', 'building', 'lot', 'interior', 'shot']).parse(f.get('kind')), f.get('amenity_id') || null, f.get('building_id') || null]);
  }, 'manageProject'), 'Point de visite mis à jour.');
}
