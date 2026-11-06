'use server';
import { z } from 'zod';
import { LOT_TYPES, ORIENTATIONS, parseLotCsv } from '@immo/core';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const n = (f: FormData, k: string) => { const v = s(f, k).replace(/\s/g, '').replace(',', '.'); if (v === '') return null; const x = Number(v); if (!Number.isFinite(x) || x < 0) throw new UserError(`Valeur invalide : ${k}`); return x; };

function lotFields(f: FormData) {
  return {
    reference: z.string().min(1).max(40).parse(s(f, 'reference')),
    type: z.enum(LOT_TYPES).parse(s(f, 'type')),
    building_id: s(f, 'building_id') || null,
    floor_id: s(f, 'floor_id') || null,
    rooms: n(f, 'rooms'), bedrooms: n(f, 'bedrooms'),
    surface_calc_m2: n(f, 'surface_calc_m2'), surface_comm_m2: n(f, 'surface_comm_m2'),
    surface_terrace_m2: n(f, 'surface_terrace_m2'), surface_garden_m2: n(f, 'surface_garden_m2'),
    orientation: s(f, 'orientation') ? z.enum(ORIENTATIONS).parse(s(f, 'orientation')) : null,
    price: n(f, 'price'), price_public: f.get('price_public') === 'on', publishable: f.get('publishable') === 'on',
    features: s(f, 'features').split(/[|\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 40),
    description: s(f, 'description') || null,
  };
}

export async function createLot(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    const v = lotFields(f);
    await x.query(`select set_config('app.reason', 'Création manuelle', true)`);
    const r = await x.query(`insert into immo.lots (org_id, project_id, building_id, floor_id, reference, type, rooms, bedrooms, surface_calc_m2, surface_comm_m2,
      surface_terrace_m2, surface_garden_m2, orientation, price, price_public, publishable, features, description)
      values ($1,$2,coalesce((select building_id from immo.floors where id=$4::uuid), $3::uuid),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
      [sess.orgId, s(f, 'project_id'), v.building_id, v.floor_id, v.reference, v.type, v.rooms, v.bedrooms, v.surface_calc_m2, v.surface_comm_m2,
        v.surface_terrace_m2, v.surface_garden_m2, v.orientation, v.price, v.price_public, true, v.features, v.description]);
    return { id: r.rows[0].id };
  }, 'manageProject'), 'Lot créé.');
}

export async function updateLot(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const v = lotFields(f);
    const r = await x.query(`update immo.lots set reference=$2, type=$3, building_id=coalesce((select building_id from immo.floors where id=$5::uuid), $4::uuid), floor_id=$5, rooms=$6, bedrooms=$7, surface_calc_m2=$8, surface_comm_m2=$9,
      surface_terrace_m2=$10, surface_garden_m2=$11, orientation=$12, price=$13, price_public=$14, publishable=$15, features=$16, description=$17
      where id=$1 and version=$18 returning id`,
      [s(f, 'id'), v.reference, v.type, v.building_id, v.floor_id, v.rooms, v.bedrooms, v.surface_calc_m2, v.surface_comm_m2, v.surface_terrace_m2,
        v.surface_garden_m2, v.orientation, v.price, v.price_public, v.publishable, v.features, v.description, Number(s(f, 'version'))]);
    if (!r.rowCount) throw new UserError('Le lot a été modifié entre-temps ou vous n’avez pas les droits. Rechargez la page.');
  }, 'manageProject'), 'Lot enregistré.');
}

export async function holdLot(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const kind = z.enum(['option', 'reservation']).parse(s(f, 'kind'));
    const hours = kind === 'option' ? z.number().min(0.1).max(720).parse(n(f, 'hours')) : null;
    const r = await x.query(`select * from immo.hold_lot($1,$2,$3,$4,$5,$6)`,
      [s(f, 'lot_id'), kind, s(f, 'prospect_id') || null, hours ? Math.round(hours * 60) : null, s(f, 'idempotency_key'), s(f, 'reason') || null]);
    return { holdId: r.rows[0].id };
  }, 'sell'), 'Engagement enregistré.');
}

export async function changeStatus(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`select immo.change_lot_status($1,$2,$3)`, [s(f, 'lot_id'), s(f, 'status'), s(f, 'reason')]);
  }, 'sell'), 'Statut mis à jour.');
}

/** Import CSV : étape 1 aperçu (dry run), étape 2 validation. Transaction unique. */
export async function importLotsCsv(_: unknown, f: FormData) {
  return action(async () => {
    const file = f.get('file');
    if (!(file instanceof File) || file.size === 0) throw new UserError('Fichier CSV requis.');
    if (file.size > 5 * 1024 * 1024) throw new UserError('Fichier limité à 5 Mo.');
    const text = await file.text();
    if (text.includes('\u0000')) throw new UserError('Fichier binaire refusé.');
    const parsed = parseLotCsv(text);
    if (parsed.missingColumns.length) throw new UserError(`Colonnes obligatoires manquantes : ${parsed.missingColumns.join(', ')}`);
    const mode = s(f, 'mode') === 'upsert' ? 'upsert' : 'create';
    const commit = s(f, 'commit') === '1';
    const projectId = z.string().uuid().parse(s(f, 'project_id'));
    return asUser(async (x, sess) => {
      const blds = (await x.query(`select id, code from immo.buildings where project_id=$1`, [projectId])).rows;
      const floors = (await x.query(`select id, building_id, level from immo.floors where project_id=$1`, [projectId])).rows;
      const existing = new Map((await x.query(`select id, lower(reference) r, status from immo.lots where project_id=$1`, [projectId])).rows.map((r) => [r.r, r]));
      const errors = [...parsed.errors];
      const plan: { line: number; op: 'create' | 'update'; ref: string }[] = [];
      for (const row of parsed.rows) {
        const b = row.batiment ? blds.find((x) => x.code.toLowerCase() === row.batiment.toLowerCase()) : null;
        if (row.batiment && !b) { errors.push({ line: row.line, reference: row.reference, messages: [`bâtiment « ${row.batiment} » inconnu`] }); continue; }
        const fl = b && row.etage != null ? floors.find((x) => x.building_id === b.id && x.level === row.etage) : null;
        if (b && row.etage != null && !fl) { errors.push({ line: row.line, reference: row.reference, messages: [`étage ${row.etage} inexistant dans ${row.batiment}`] }); continue; }
        const ex = existing.get(row.reference.toLowerCase());
        if (ex && mode === 'create') { errors.push({ line: row.line, reference: row.reference, messages: ['référence déjà existante (doublon)'] }); continue; }
        if (ex && row.statut !== ex.status) { errors.push({ line: row.line, reference: row.reference, messages: [`le statut ne peut pas être modifié par import (actuel : ${ex.status})`] }); continue; }
        if (!ex && !['available', 'unavailable'].includes(row.statut)) { errors.push({ line: row.line, reference: row.reference, messages: ['un nouveau lot importé doit être disponible ou indisponible (les options/réservations passent par la fiche)'] }); continue; }
        plan.push({ line: row.line, op: ex ? 'update' : 'create', ref: row.reference });
        if (commit) {
          const vals = [row.type, b?.id ?? null, fl?.id ?? null, row.pieces, row.chambres, row.surface_calculee_m2, row.surface_commerciale_m2,
            row.surface_terrasse_m2, row.surface_jardin_m2, row.orientation, row.prix, row.prix_public, row.caracteristiques, row.description || null];
          if (ex) {
            await x.query(`update immo.lots set type=$2, building_id=$3, floor_id=$4, rooms=$5, bedrooms=$6, surface_calc_m2=$7, surface_comm_m2=$8,
              surface_terrace_m2=$9, surface_garden_m2=$10, orientation=$11, price=$12, price_public=$13, features=$14, description=$15 where id=$1`, [ex.id, ...vals]);
          } else {
            await x.query(`select set_config('app.reason', 'Import CSV', true)`);
            await x.query(`insert into immo.lots (org_id, project_id, reference, type, building_id, floor_id, rooms, bedrooms, surface_calc_m2, surface_comm_m2,
              surface_terrace_m2, surface_garden_m2, orientation, price, price_public, features, description, status)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [sess.orgId, projectId, row.reference, ...vals, row.statut]);
          }
        }
      }
      if (commit && errors.length) throw new UserError(`Import annulé : ${errors.length} erreur(s). Corrigez le fichier (aucune ligne n’a été enregistrée).`);
      if (commit) await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity, entity_id, meta) values ($1,$2,'lots.import','project',$3,$4)`,
        [sess.orgId, sess.userId, projectId, { created: plan.filter((p) => p.op === 'create').length, updated: plan.filter((p) => p.op === 'update').length }]);
      return { plan, errors, committed: commit };
    }, 'manageProject');
  });
}
