import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import type { Role } from '@immo/core';
import { CAN } from '@immo/core';
import { publicTx, tx, type Tx } from './db';

export const SESSION_COOKIE = 'immo_session';
const TTL_HOURS = 12;

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  locale: 'fr' | 'ar';
  orgId: string | null;
  orgName: string | null;
  orgSlug: string | null;
  role: Role | null;
  tokenHash: string;
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await publicTx((t) => t.query('select immo.auth_create_session($1,$2,$3)', [userId, hashToken(token), TTL_HOURS]));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: TTL_HOURS * 3600,
    secure: process.env.NODE_ENV === 'production' && !process.env.APP_URL?.startsWith('http://'),
  });
}

export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const r = await publicTx((t) => t.query('select * from immo.auth_resolve_session($1)', [tokenHash]));
  const s = r.rows[0];
  if (!s) return null;
  return {
    userId: s.user_id, email: s.email, fullName: s.full_name, locale: s.locale, orgId: s.org_id, orgName: s.org_name,
    orgSlug: s.org_slug, role: s.role, tokenHash,
  };
});

/** Page protégée : redirige vers la connexion ; affiche "autorisation insuffisante" si rôle inadapté. */
export async function requireSession(action: keyof typeof CAN = 'read'): Promise<Session & { orgId: string; role: Role }> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.orgId || !s.role) redirect('/login?error=no_org');
  if (!CAN[action].includes(s.role)) redirect(`/forbidden?need=${action}`);
  return s as Session & { orgId: string; role: Role };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Pour les routes API et Server Actions : lève une erreur au lieu de rediriger. */
export async function assertSession(action: keyof typeof CAN = 'read') {
  const s = await getSession();
  if (!s || !s.orgId || !s.role) throw new HttpError(401, 'Session expirée, reconnectez-vous.');
  if (!CAN[action].includes(s.role)) throw new HttpError(403, 'Autorisation insuffisante pour cette action.');
  return s as Session & { orgId: string; role: Role };
}

/** Exécute une transaction avec le contexte RLS de la session courante. */
export async function asUser<T>(fn: (t: Tx, s: Session & { orgId: string; role: Role }) => Promise<T>, action: keyof typeof CAN = 'read') {
  const s = await assertSession(action);
  return tx({ userId: s.userId, orgId: s.orgId }, (t) => fn(t, s));
}

/** Protection CSRF des routes API (les Server Actions sont protégées nativement par Next). */
export async function assertSameOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, 'Origine de la requête refusée.');
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await publicTx((t) => t.query('select immo.auth_revoke_session($1)', [hashToken(token)]));
  jar.delete(SESSION_COOKIE);
}
