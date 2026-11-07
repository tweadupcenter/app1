import 'server-only';
import { appDatabaseUrl, createPool, withContext, type DbContext, type Tx } from '@immo/db';
import type pg from 'pg';

const g = globalThis as unknown as { __immoPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__immoPool) g.__immoPool = createPool(appDatabaseUrl(), Number(process.env.DB_POOL_MAX ?? 10));
  return g.__immoPool;
}

export function tx<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>) {
  return withContext(pool(), ctx, fn);
}

/** Accès public : aucun contexte utilisateur ; seules les fonctions public_* renvoient des données. */
export function publicTx<T>(fn: (tx: Tx) => Promise<T>) {
  return withContext(pool(), { userId: null, orgId: null }, fn);
}

export type { Tx };
