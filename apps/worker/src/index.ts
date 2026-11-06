// Worker de traitements isolés : conversions de plans, inspection de maquettes, export vidéo,
// expiration des options. Usage : tsx src/index.ts [--once]
import { hostname } from 'node:os';
import path from 'node:path';
import { createPool, loadRootEnv, ROOT_DIR, withContext, type Tx } from '@immo/db';
import { rasterizePlan, importDxf } from './plans';
import { inspectModel } from './models';
import { exportVideo } from './video';

loadRootEnv();
process.env.STORAGE_DIR = path.resolve(ROOT_DIR, process.env.STORAGE_DIR ?? 'storage');

const pool = createPool(process.env.DATABASE_URL, 4);
const WORKER_ID = `${hostname()}:${process.pid}`;
const TYPES = ['plan_rasterize', 'dxf_import', 'model_inspect', 'video_export'];

export interface JobCtx {
  job: { id: string; org_id: string; type: string; payload: any; created_by: string };
  tx: <T>(fn: (t: Tx) => Promise<T>) => Promise<T>;
  progress: (p: number) => Promise<void>;
  log: (...a: unknown[]) => void;
}

const handlers: Record<string, (c: JobCtx) => Promise<unknown>> = {
  plan_rasterize: rasterizePlan,
  dxf_import: importDxf,
  model_inspect: inspectModel,
  video_export: exportVideo,
};

/** Journalisation sans secrets : on ne logge jamais d'URL de connexion ni de jeton. */
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function runOne(): Promise<boolean> {
  const claimed = await withContext(pool, { userId: null, orgId: null }, (t) => t.query('select (immo.claim_job($1,$2)).*', [WORKER_ID, TYPES]));
  const job = claimed.rows[0];
  if (!job?.id) return false;
  log(`▶ ${job.type} ${job.id}`);
  const ctx: JobCtx = {
    job,
    tx: (fn) => withContext(pool, { userId: job.created_by, orgId: job.org_id }, fn),
    progress: (p) => withContext(pool, { userId: null, orgId: null }, (t) => t.query('select immo.job_progress($1,$2)', [job.id, p])).then(() => {}),
    log: (...a) => log(`  [${job.type} ${job.id.slice(0, 8)}]`, ...a),
  };
  try {
    const result = await handlers[job.type](ctx);
    await withContext(pool, { userId: null, orgId: null }, (t) => t.query('select immo.finish_job($1,$2,$3,null)', [job.id, 'done', JSON.stringify(result ?? {})]));
    log(`✓ ${job.type} ${job.id}`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    log(`✗ ${job.type} ${job.id} : ${msg}`);
    await withContext(pool, { userId: null, orgId: null }, (t) => t.query('select immo.finish_job($1,$2,null,$3)', [job.id, 'error', msg]));
  }
  return true;
}

async function expireHolds() {
  const r = await withContext(pool, { userId: null, orgId: null }, (t) => t.query('select immo.expire_holds() n'));
  if (r.rows[0].n > 0) log(`⏱ ${r.rows[0].n} engagement(s) expiré(s)`);
}

async function main() {
  const once = process.argv.includes('--once');
  log(`Worker ${WORKER_ID} démarré (${once ? 'une passe' : 'continu'})`);
  let lastExpire = 0;
  let stop = false;
  process.on('SIGTERM', () => { stop = true; });
  process.on('SIGINT', () => { stop = true; });
  while (!stop) {
    if (Date.now() - lastExpire > 30_000) { await expireHolds().catch((e) => log('expire_holds', e.message)); lastExpire = Date.now(); }
    let did = false;
    try { did = await runOne(); } catch (e) { log('Erreur de boucle :', (e as Error).message); }
    if (once && !did) break;
    if (!did) await new Promise((r) => setTimeout(r, 1500));
  }
  await pool.end();
}

main();
