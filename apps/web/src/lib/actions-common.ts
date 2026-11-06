'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyPassword } from '@immo/db/password';
import { createSession, getSession, logout } from './auth';
import { publicTx } from './db';

const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'E-mail et mot de passe requis.' };
  const k = email;
  const a = attempts.get(k);
  if (a && a.n >= 5 && a.until > Date.now()) return { error: 'Trop de tentatives. Réessayez dans quelques minutes.' };
  const r = await publicTx((t) => t.query('select * from immo.auth_user_for_login($1)', [email]));
  const u = r.rows[0];
  const ok = u && !u.disabled && (await verifyPassword(password, u.password_hash));
  if (!ok) {
    attempts.set(k, { n: (a?.until ?? 0) > Date.now() ? (a!.n + 1) : 1, until: Date.now() + 15 * 60_000 });
    return { error: 'Identifiants incorrects.' };
  }
  attempts.delete(k);
  await createSession(u.id);
  const next = String(form.get('next') ?? '/dashboard');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
}

export async function logoutAction() {
  await logout();
  redirect('/login');
}

export async function setLanguage(form: FormData) {
  const lang = form.get('lang') === 'ar' ? 'ar' : 'fr';
  (await cookies()).set('lang', lang, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

export async function switchOrg(form: FormData) {
  const s = await getSession();
  if (!s) redirect('/login');
  const org = String(form.get('org') ?? '');
  await publicTx((t) => t.query('select immo.auth_switch_org($1,$2)', [s.tokenHash, org]));
  redirect('/dashboard');
}
