'use server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ROLES } from '@immo/core';
import { hashPassword } from '@immo/db/password';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

export async function addMember(_: unknown, f: FormData) {
  return action(async () => {
    const email = z.string().email().parse(String(f.get('email') ?? '').trim().toLowerCase());
    const name = z.string().min(2).max(120).parse(String(f.get('full_name') ?? '').trim());
    const role = z.enum(ROLES).parse(f.get('role'));
    const temp = randomBytes(9).toString('base64url');
    const hash = await hashPassword(temp);
    return asUser(async (x) => {
      const existed = (await x.query(`select 1 from immo.users where lower(email)=$1`, [email])).rowCount;
      await x.query(`select immo.admin_add_member($1,$2,$3,$4)`, [email, name, hash, role]);
      return { tempPassword: existed ? null : temp, email };
    }, 'manageOrg');
  });
}

export async function setRole(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const role = z.enum(ROLES).parse(f.get('role'));
    const uid = String(f.get('user_id'));
    await x.query(`update immo.memberships set role=$3 where org_id=$1 and user_id=$2`, [s.orgId, uid, role]);
    await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity, entity_id, meta) values ($1,$2,'member.role','user',$3,$4)`, [s.orgId, s.userId, uid, { role }]);
  }, 'manageOrg'), 'Rôle mis à jour.');
}

export async function removeMember(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const uid = String(f.get('user_id'));
    if (uid === s.userId) throw new UserError('Vous ne pouvez pas vous retirer vous-même.');
    await x.query(`delete from immo.memberships where org_id=$1 and user_id=$2`, [s.orgId, uid]);
    await x.query(`insert into immo.audit_log (org_id, actor_id, action, entity, entity_id) values ($1,$2,'member.remove','user',$3)`, [s.orgId, s.userId, uid]);
  }, 'manageOrg'), 'Membre retiré : ses sessions n’ont plus accès à cette organisation.');
}

export async function changeOwnPassword(_: unknown, f: FormData) {
  return action(async () => {
    const pw = String(f.get('password') ?? '');
    if (pw !== String(f.get('confirm') ?? '')) throw new UserError('Les mots de passe ne correspondent pas.');
    const hash = await hashPassword(pw).catch((e) => { throw new UserError(e.message); });
    return asUser(async (x, s) => { await x.query(`update immo.users set password_hash=$2 where id=$1`, [s.userId, hash]); });
  }, 'Mot de passe modifié.');
}
