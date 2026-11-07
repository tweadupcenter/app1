import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { migrate } from '@immo/db/migrate';
import { seed } from '@immo/db/seed';
import { ensureSupabaseBucket, createStorage } from '@immo/core/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Installation initiale (Supabase via Vercel) : migrations du dépôt avec le rôle propriétaire
 * (POSTGRES_URL_NON_POOLING), mot de passe du rôle immo_app, bucket de stockage, puis données de démonstration
 * FICTIVES (idempotent : rien n'est écrasé si elles existent). Protégée par SETUP_KEY.
 */
export async function POST(req: Request) {
  const key = process.env.SETUP_KEY ?? '';
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (key.length < 32 || got.length !== key.length || !timingSafeEqual(Buffer.from(got), Buffer.from(key))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const adminUrl = process.env.POSTGRES_URL_NON_POOLING;
  const appPw = process.env.IMMO_APP_DB_PASSWORD;
  if (!adminUrl || !appPw) return NextResponse.json({ error: 'POSTGRES_URL_NON_POOLING ou IMMO_APP_DB_PASSWORD manquant' }, { status: 500 });
  const dir = [path.join(process.cwd(), '../../db/migrations'), path.join(process.cwd(), 'db/migrations')].find((d) => existsSync(d));
  if (!dir) return NextResponse.json({ error: 'Migrations absentes du déploiement' }, { status: 500 });
  const steps: string[] = [];
  try {
    await migrate(adminUrl, { appPassword: appPw, dir, log: false });
    steps.push('migrations appliquées, rôle immo_app configuré');
    const st = createStorage();
    if (st.driver === 'supabase') { await ensureSupabaseBucket(); steps.push('bucket de stockage prêt'); }
    const withDemo = new URL(req.url).searchParams.get('demo') !== '0';
    if (withDemo) {
      const pw = process.env.SEED_PASSWORD;
      if (!pw || pw.length < 12) return NextResponse.json({ error: 'SEED_PASSWORD (12 caractères min.) requis pour les comptes de démonstration' }, { status: 500 });
      const r = await seed(adminUrl, { password: pw, log: false });
      steps.push(r ? 'données de démonstration fictives créées' : 'données de démonstration déjà présentes (inchangées)');
    }
    return NextResponse.json({ ok: true, steps });
  } catch (e) {
    return NextResponse.json({ ok: false, steps, error: (e as Error).message.slice(0, 500) }, { status: 500 });
  }
}
