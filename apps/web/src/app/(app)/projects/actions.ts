'use server';
import { z } from 'zod';
import { slugify, AMENITY_KINDS } from '@immo/core';
import { buildPublicationSnapshot } from '@immo/db';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const numOrNull = (f: FormData, k: string) => { const v = str(f, k).replace(',', '.'); return v === '' ? null : Number(v); };

export async function createProject(_: unknown, f: FormData) {
  return action(async () => {
    const name = z.string().min(2).max(120).parse(str(f, 'name'));
    const slug = slugify(str(f, 'slug') || name);
    if (slug.length < 2) throw new UserError('Identifiant invalide.');
    return asUser(async (x, s) => {
      const r = await x.query(`insert into immo.projects (org_id, name, slug, city, description, is_fictional) values ($1,$2,$3,$4,$5,$6) returning id`,
        [s.orgId, name, slug, str(f, 'city') || null, str(f, 'description') || null, f.get('is_fictional') === 'on']);
      return { id: r.rows[0].id as string };
    }, 'manageProject');
  }, 'Projet créé.');
}

export async function updateProject(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.projects set name=$2, city=$3, address=$4, description=$5, is_fictional=$6 where id=$1`,
      [str(f, 'id'), z.string().min(2).max(120).parse(str(f, 'name')), str(f, 'city') || null, str(f, 'address') || null, str(f, 'description') || null, f.get('is_fictional') === 'on']);
  }, 'manageProject'), 'Projet mis à jour.');
}

export async function addBuilding(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const code = z.string().min(1).max(10).parse(str(f, 'code'));
    const levels = z.number().int().min(1).max(80).parse(Number(str(f, 'levels') || 1));
    const h = z.number().min(2).max(10).parse(Number(str(f, 'height') || 3));
    const b = await x.query(`insert into immo.buildings (org_id, project_id, code, name, sort_order) values ($1,$2,$3,$4,(select coalesce(max(sort_order)+1,0) from immo.buildings where project_id=$2)) returning id`,
      [s.orgId, str(f, 'project_id'), code, str(f, 'name') || `Bâtiment ${code}`]);
    for (let l = 0; l < levels; l++) {
      await x.query(`insert into immo.floors (org_id, project_id, building_id, level, name, elevation_m, height_m) values ($1,$2,$3,$4,$5,$6,$7)`,
        [s.orgId, str(f, 'project_id'), b.rows[0].id, l, l === 0 ? 'Rez-de-chaussée' : `Étage ${l}`, l * h, h]);
    }
  }, 'manageProject'), 'Bâtiment ajouté.');
}

export async function updateFloor(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.floors set name=$2, elevation_m=$3, height_m=$4 where id=$1`,
      [str(f, 'id'), str(f, 'name'), z.number().min(-50).max(500).parse(numOrNull(f, 'elevation_m')), z.number().min(2).max(12).parse(numOrNull(f, 'height_m'))]);
  }, 'manageProject'), 'Étage mis à jour.');
}

export async function addFloor(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const b = str(f, 'building_id');
    const last = (await x.query(`select level, elevation_m, height_m, project_id from immo.floors where building_id=$1 order by level desc limit 1`, [b])).rows[0];
    const pid = last?.project_id ?? (await x.query(`select project_id from immo.buildings where id=$1`, [b])).rows[0]?.project_id;
    if (!pid) throw new UserError('Bâtiment introuvable.');
    const level = last ? last.level + 1 : 0;
    await x.query(`insert into immo.floors (org_id, project_id, building_id, level, name, elevation_m, height_m) values ($1,$2,$3,$4,$5,$6,$7)`,
      [s.orgId, pid, b, level, level === 0 ? 'Rez-de-chaussée' : `Étage ${level}`, last ? Number(last.elevation_m) + Number(last.height_m) : 0, last?.height_m ?? 3]);
  }, 'manageProject'), 'Étage ajouté.');
}

export async function deleteBuilding(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const n = (await x.query(`select count(*)::int n from immo.lots where building_id=$1`, [str(f, 'id')])).rows[0].n;
    if (n > 0) throw new UserError(`Impossible : ${n} lot(s) rattaché(s) à ce bâtiment.`);
    await x.query(`delete from immo.buildings where id=$1`, [str(f, 'id')]);
  }, 'manageProject'), 'Bâtiment supprimé.');
}

export async function addAmenity(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    await x.query(`insert into immo.amenities (org_id, project_id, kind, name, description) values ($1,$2,$3,$4,$5)`,
      [s.orgId, str(f, 'project_id'), z.enum(AMENITY_KINDS).parse(str(f, 'kind')), z.string().min(1).max(80).parse(str(f, 'name')), str(f, 'description') || null]);
  }, 'manageProject'), 'Équipement ajouté.');
}

export async function deleteAmenity(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.amenities where id=$1`, [str(f, 'id')]); }, 'manageProject'), 'Équipement supprimé.');
}

/** Publie la version de travail : nouvel instantané public versionné. */
export async function publishProject(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const pid = str(f, 'project_id');
    const p = (await x.query(`select slug from immo.projects where id=$1`, [pid])).rows[0];
    if (!p) throw new UserError('Projet introuvable.');
    const { snapshot, mediaIds } = await buildPublicationSnapshot(x, pid);
    if (snapshot.lots.length === 0) throw new UserError('Aucun lot publiable : rien à publier.');
    const v = (await x.query(`select coalesce(max(version),0)+1 v from immo.publications where project_id=$1`, [pid])).rows[0].v;
    await x.query(`update immo.publications set revoked_at = now() where project_id=$1 and revoked_at is null`, [pid]);
    await x.query(`insert into immo.publications (org_id, project_id, slug, version, snapshot, media_ids, published_by) values ($1,$2,$3,$4,$5,$6,$7)`,
      [s.orgId, pid, p.slug, v, snapshot, mediaIds, s.userId]);
    await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity, entity_id, meta) values ($1,$2,'project.publish','project',$3,$4)`, [s.orgId, s.userId, pid, { version: v }]);
    return { version: v };
  }, 'manageProject'), 'Nouvelle version publiée.');
}

export async function unpublishProject(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const pid = str(f, 'project_id');
    await x.query(`update immo.publications set revoked_at = now() where project_id=$1 and revoked_at is null`, [pid]);
    await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity, entity_id) values ($1,$2,'project.unpublish','project',$3)`, [s.orgId, s.userId, pid]);
  }, 'manageProject'), 'Publication révoquée : le lien public ne fonctionne plus.');
}
