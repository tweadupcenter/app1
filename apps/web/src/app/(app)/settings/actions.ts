'use server';
import { z } from 'zod';
import { asUser } from '@/lib/auth';
import { action } from '@/lib/errors';

export async function saveOrgSettings(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).parse(f.get('primary_color'));
    const wa = String(f.get('whatsapp') ?? '').trim();
    if (wa && wa.replace(/\D/g, '').length < 8) throw new Error('Numéro WhatsApp invalide (format international, ex. +212…)');
    await x.query(`update immo.organizations set name=$2, branding = branding || jsonb_build_object('primary_color', $3::text),
      contact = jsonb_build_object('phone', $4::text, 'email', $5::text, 'whatsapp', $6::text, 'address', $7::text) where id=$1`,
      [s.orgId, z.string().min(2).max(120).parse(f.get('name')), color, String(f.get('phone') ?? '') || null,
        f.get('email') ? z.string().email().parse(f.get('email')) : null, wa || null, String(f.get('address') ?? '') || null]);
    await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity) values ($1,$2,'org.settings','organization')`, [s.orgId, s.userId]);
  }, 'manageOrg'), 'Paramètres enregistrés. Republiez les projets pour mettre à jour la présentation publique.');
}
