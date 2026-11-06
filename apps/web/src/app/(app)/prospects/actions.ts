'use server';
import { z } from 'zod';
import { PIPELINE_STAGES, PROSPECT_SOURCES, casablancaLocalToIso } from '@immo/core';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const money = (f: FormData, k: string) => { const v = s(f, k).replace(/\s/g, '').replace(',', '.'); return v ? z.number().nonnegative().parse(Number(v)) : null; };

export async function createProspect(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    const name = z.string().min(2).max(200).parse(s(f, 'full_name'));
    const email = s(f, 'email') ? z.string().email().parse(s(f, 'email')).toLowerCase() : null;
    const phone = s(f, 'phone') || null;
    if (email || phone) {
      const dup = (await x.query(`select id, full_name from immo.prospects where (lower(email)=$1 and $1 is not null) or (regexp_replace(phone,'\\D','','g')=regexp_replace($2,'\\D','','g') and $2 is not null) limit 1`, [email, phone])).rows[0];
      if (dup && f.get('force') !== 'on') throw new UserError(`Doublon probable : ${dup.full_name} a le même e-mail ou téléphone. Cochez « créer quand même » pour confirmer.`);
    }
    const r = await x.query(`insert into immo.prospects (org_id, project_id, full_name, email, phone, source, owner_id, budget_min, budget_max, consent_contact, notes_private)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [sess.orgId, s(f, 'project_id') || null, name, email, phone, z.enum(PROSPECT_SOURCES).parse(s(f, 'source') || 'other'), s(f, 'owner_id') || sess.userId,
        money(f, 'budget_min'), money(f, 'budget_max'), f.get('consent_contact') === 'on', s(f, 'notes_private') || null]);
    return { id: r.rows[0].id };
  }, 'sell'), 'Prospect créé.');
}

export async function updateProspect(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const id = s(f, 'id');
    const r = await x.query(`update immo.prospects set full_name=$2, email=$3, phone=$4, source=$5, owner_id=$6, project_id=$7, budget_min=$8, budget_max=$9, consent_contact=$10, notes_private=$11 where id=$1`,
      [id, z.string().min(2).max(200).parse(s(f, 'full_name')), s(f, 'email') ? z.string().email().parse(s(f, 'email')).toLowerCase() : null, s(f, 'phone') || null,
        z.enum(PROSPECT_SOURCES).parse(s(f, 'source')), s(f, 'owner_id') || null, s(f, 'project_id') || null, money(f, 'budget_min'), money(f, 'budget_max'),
        f.get('consent_contact') === 'on', s(f, 'notes_private') || null]);
    if (!r.rowCount) throw new UserError('Autorisation insuffisante.');
  }, 'sell'), 'Fiche mise à jour.');
}

export async function setStage(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    const id = s(f, 'id');
    const stage = z.enum(PIPELINE_STAGES).parse(s(f, 'stage'));
    const prev = (await x.query(`select stage from immo.prospects where id=$1`, [id])).rows[0];
    if (!prev) throw new UserError('Prospect introuvable.');
    if (prev.stage === stage) return;
    await x.query(`update immo.prospects set stage=$2 where id=$1`, [id, stage]);
    await x.query(`insert into immo.interactions (org_id, prospect_id, kind, body, author_id, meta) values ($1,$2,'stage_change',$3,$4,$5)`,
      [sess.orgId, id, `Étape : ${prev.stage} → ${stage}${s(f, 'reason') ? ` — ${s(f, 'reason')}` : ''}`, sess.userId, { from: prev.stage, to: stage }]);
  }, 'sell'), 'Étape mise à jour.');
}

export async function addInteraction(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    await x.query(`insert into immo.interactions (org_id, prospect_id, kind, body, author_id) values ($1,$2,$3,$4,$5)`,
      [sess.orgId, s(f, 'prospect_id'), z.enum(['note', 'call', 'email', 'whatsapp', 'visit']).parse(s(f, 'kind')), z.string().min(1).max(4000).parse(s(f, 'body')), sess.userId]);
  }, 'sell'), 'Interaction ajoutée.');
}

export async function addInterest(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    await x.query(`insert into immo.prospect_lots (org_id, prospect_id, lot_id) values ($1,$2,$3) on conflict do nothing`, [sess.orgId, s(f, 'prospect_id'), z.string().uuid().parse(s(f, 'lot_id'))]);
  }, 'sell'), 'Lot ajouté aux intérêts.');
}

export async function removeInterest(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.prospect_lots where prospect_id=$1 and lot_id=$2`, [s(f, 'prospect_id'), s(f, 'lot_id')]); }, 'sell'), 'Intérêt retiré.');
}

export async function addAppointment(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    const start = casablancaLocalToIso(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).parse(s(f, 'starts_at')));
    const minutes = z.number().int().min(15).max(600).parse(Number(s(f, 'duration') || 60));
    await x.query(`insert into immo.appointments (org_id, prospect_id, project_id, user_id, title, starts_at, ends_at, location, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sess.orgId, s(f, 'prospect_id') || null, s(f, 'project_id') || null, s(f, 'user_id') || sess.userId, z.string().min(1).max(200).parse(s(f, 'title')), start,
        new Date(new Date(start).getTime() + minutes * 60000).toISOString(), s(f, 'location') || null, s(f, 'notes') || null]);
    if (s(f, 'prospect_id')) await x.query(`update immo.prospects set stage='visit_planned' where id=$1 and stage in ('new','contacted')`, [s(f, 'prospect_id')]);
  }, 'sell'), 'Rendez-vous planifié.');
}

export async function setAppointmentStatus(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.appointments set status=$2 where id=$1`, [s(f, 'id'), z.enum(['planned', 'done', 'cancelled', 'no_show']).parse(s(f, 'status'))]);
  }, 'sell'), 'Rendez-vous mis à jour.');
}

export async function addTask(_: unknown, f: FormData) {
  return action(() => asUser(async (x, sess) => {
    const due = s(f, 'due_at') ? casablancaLocalToIso(s(f, 'due_at')) : null;
    await x.query(`insert into immo.tasks (org_id, prospect_id, assignee_id, title, due_at, created_by) values ($1,$2,$3,$4,$5,$6)`,
      [sess.orgId, s(f, 'prospect_id') || null, s(f, 'assignee_id') || sess.userId, z.string().min(1).max(200).parse(s(f, 'title')), due, sess.userId]);
  }, 'sell'), 'Tâche ajoutée.');
}

export async function toggleTask(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.tasks set done_at = case when done_at is null then now() else null end where id=$1`, [s(f, 'id')]);
  }, 'sell'));
}
