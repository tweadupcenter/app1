import pg from 'pg';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Charge le fichier .env racine si présent (sans écraser l'environnement). */
export function loadRootEnv() {
  const p = path.join(ROOT_DIR, '.env');
  if (existsSync(p)) {
    try { process.loadEnvFile(p); } catch { /* ignore */ }
  }
}

// Les colonnes numeric sont renvoyées en nombres JS (précision suffisante pour prix et surfaces).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url = process.env.DATABASE_URL, max = 10): pg.Pool {
  if (!url) throw new Error('DATABASE_URL manquant');
  return new pg.Pool({ connectionString: url, max, application_name: 'immo360' });
}

export interface DbContext { userId: string | null; orgId: string | null }

/**
 * Exécute fn dans une transaction avec le contexte RLS (utilisateur + organisation active).
 * Le contexte est local à la transaction (set_config(..., true)).
 */
export async function withContext<T>(pool: pg.Pool, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true), set_config('search_path', 'immo, public', true)`,
      [ctx.userId ?? '', ctx.orgId ?? ''],
    );
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { buildPublicationSnapshot } from './publication';
