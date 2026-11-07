// Applique les migrations SQL (rôle propriétaire). Usage : tsx src/migrate.ts [--reset]
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRootEnv, pgConfig, ROOT_DIR } from './index';

export async function migrate(adminUrl: string, opts: { reset?: boolean; appPassword?: string; log?: boolean } = {}) {
  const client = new pg.Client(pgConfig(adminUrl));
  await client.connect();
  const log = (...a: unknown[]) => opts.log !== false && console.log(...a);
  try {
    if (opts.reset) {
      log('↺ Réinitialisation du schéma immo');
      await client.query('drop schema if exists immo cascade; drop table if exists public.immo_schema_migrations;');
    }
    await client.query(`create table if not exists public.immo_schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const dir = path.join(ROOT_DIR, 'db', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query('select name from public.immo_schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      log(`→ ${f}`);
      await client.query('begin');
      try {
        await client.query(readFileSync(path.join(dir, f), 'utf8'));
        await client.query('insert into public.immo_schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Échec de la migration ${f} : ${(e as Error).message}`);
      }
    }
    if (opts.appPassword) {
      await client.query(`alter role immo_app with login password ${client.escapeLiteral(opts.appPassword)}`);
    }
    // Permet au rôle applicatif de se connecter à la base courante.
    const db = (await client.query('select current_database() as d')).rows[0].d;
    await client.query(`grant connect on database ${client.escapeIdentifier(db)} to immo_app`);
    log('✓ Migrations à jour');
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRootEnv();
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL manquant'); process.exit(1); }
  migrate(url, { reset: process.argv.includes('--reset'), appPassword: process.env.IMMO_APP_DB_PASSWORD })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
