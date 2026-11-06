// Jetons signés à courte durée (rendu vidéo par le worker). Serveur uniquement.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RenderClaims { seq: string; user: string; org: string; exp: number }

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET manquant ou trop court (32 caractères minimum).');
  return s;
}

export function signRenderToken(c: Omit<RenderClaims, 'exp'>, ttlSeconds = 3600): string {
  const body = Buffer.from(JSON.stringify({ ...c, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyRenderToken(token: string): RenderClaims | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as RenderClaims;
    if (c.exp < Date.now() / 1000) return null;
    return c;
  } catch { return null; }
}
