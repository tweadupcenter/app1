// Tests d'intégration sur une vraie base PostgreSQL (DATABASE_ADMIN_URL_TEST).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed';
import { createPool, loadRootEnv, withContext } from '../src/index';

loadRootEnv();
const ADMIN = process.env.DATABASE_ADMIN_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/immo360_test';
const APP_PW = process.env.IMMO_APP_DB_PASSWORD ?? 'immo_app_test_pw'; // le rôle est global au cluster
const APP = (() => { const u = new URL(ADMIN); u.username = 'immo_app'; u.password = APP_PW; return u.toString(); })();

let pool: pg.Pool;
let S: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  await migrate(ADMIN, { reset: true, appPassword: APP_PW, log: false });
  S = (await seed(ADMIN, { password: 'test-password-123', storageDir: mkdtempSync(path.join(os.tmpdir(), 'immo-test-')), log: false }))!;
  pool = createPool(APP, 20);
}, 120_000);

afterAll(async () => { await pool?.end(); });

const as = (userKey: keyof typeof S.users, org?: string) => ({ userId: S.users[userKey], orgId: org ?? (userKey === 'other' ? S.other : S.org) });

describe('isolation des organisations (RLS)', () => {
  it('le rôle applicatif ne voit rien sans contexte', async () => {
    const r = await withContext(pool, { userId: null, orgId: null }, (tx) => tx.query('select count(*)::int n from immo.lots'));
    expect(r.rows[0].n).toBe(0);
  });
  it('chaque organisation ne voit que ses lots', async () => {
    const a = await withContext(pool, as('admin'), (tx) => tx.query('select distinct org_id from immo.lots'));
    expect(a.rows.map((r) => r.org_id)).toEqual([S.org]);
    const b = await withContext(pool, as('other'), (tx) => tx.query('select reference from immo.lots order by 1'));
    expect(b.rows.map((r) => r.reference)).toEqual(['T-01', 'T-02']);
  });
  it('un utilisateur ne peut pas forcer l’organisation d’un autre', async () => {
    const r = await withContext(pool, { userId: S.users.admin, orgId: S.other }, (tx) => tx.query('select count(*)::int n from immo.lots'));
    expect(r.rows[0].n).toBe(0);
    await expect(withContext(pool, { userId: S.users.admin, orgId: S.other }, (tx) =>
      tx.query(`insert into immo.projects (org_id, name, slug) values ($1, 'Intrus', 'intrus')`, [S.other]))).rejects.toThrow(/row-level security/);
  });
  it('les sessions ne sont pas lisibles directement', async () => {
    await expect(withContext(pool, as('admin'), (tx) => tx.query('select * from immo.sessions'))).rejects.toThrow(/permission denied/);
  });
  it('les prospects d’une autre organisation sont invisibles', async () => {
    const r = await withContext(pool, as('other'), (tx) => tx.query('select count(*)::int n from immo.prospects'));
    expect(r.rows[0].n).toBe(0);
  });
});

describe('droits par rôle', () => {
  it('un lecteur ne peut pas modifier un lot', async () => {
    const r = await withContext(pool, as('viewer'), (tx) => tx.query(`update immo.lots set description = 'x' where reference = 'A-0-03' returning id`));
    expect(r.rowCount).toBe(0);
  });
  it('un commercial ne peut pas modifier la fiche d’un lot mais peut poser une option', async () => {
    const r = await withContext(pool, as('sales'), (tx) => tx.query(`update immo.lots set price = 1 where reference = 'A-0-03' returning id`));
    expect(r.rowCount).toBe(0);
    const h = await withContext(pool, as('sales'), (tx) => tx.query(`select (immo.hold_lot($1,'option',null,60,$2,'test')).id`, [S.ids.lots['A-0-03'], randomUUID()]));
    expect(h.rows[0].id).toBeTruthy();
  });
  it('un chef de projet peut modifier un lot', async () => {
    const r = await withContext(pool, as('pm'), (tx) => tx.query(`update immo.lots set description = 'MAJ' where reference = 'A-0-04' returning version`));
    expect(r.rows[0].version).toBe(2);
  });
  it('le statut ne peut pas être modifié par une mise à jour directe', async () => {
    await expect(withContext(pool, as('pm'), (tx) => tx.query(`update immo.lots set status = 'sold' where reference = 'A-0-04'`))).rejects.toThrow(/status_requires_function/);
  });
  it('un lecteur ne peut pas poser d’option', async () => {
    await expect(withContext(pool, as('viewer'), (tx) => tx.query(`select immo.hold_lot($1,'option',null,60,$2,'x')`, [S.ids.lots['A-0-04'], randomUUID()]))).rejects.toThrow(/forbidden/);
  });
});

describe('options et réservations', () => {
  it('deux options concurrentes : une seule est accordée', async () => {
    const lot = S.ids.lots['B-0-02'];
    const attempt = (user: 'sales' | 'sales2') => withContext(pool, as(user), async (tx) => {
      const r = await tx.query(`select (immo.hold_lot($1,'option',null,120,$2,'concurrence')).id`, [lot, randomUUID()]);
      await new Promise((res) => setTimeout(res, 50)); // élargit la fenêtre de concurrence
      return r.rows[0].id as string;
    });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => attempt(i % 2 ? 'sales' : 'sales2')));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(7);
    for (const k of ko) expect(String(k.reason.message)).toMatch(/lot_not_available/);
    const n = await withContext(pool, as('admin'), (tx) => tx.query(`select count(*)::int n from immo.lot_holds where lot_id = $1 and status = 'active'`, [lot]));
    expect(n.rows[0].n).toBe(1);
  });

  it('les requêtes répétées sont idempotentes (même clé => même engagement)', async () => {
    const lot = S.ids.lots['B-0-03'];
    const key = randomUUID();
    const call = () => withContext(pool, as('sales'), (tx) => tx.query(`select (immo.hold_lot($1,'option',null,120,$2,'idem')).id`, [lot, key]).then((r) => r.rows[0].id));
    const ids = await Promise.all([call(), call(), call()]);
    expect(new Set(ids).size).toBe(1);
    const hist = await withContext(pool, as('admin'), (tx) => tx.query(`select count(*)::int n from immo.lot_status_history where lot_id = $1 and to_status = 'option'`, [lot]));
    expect(hist.rows[0].n).toBe(1);
  });

  it('une option expire côté serveur et le lot redevient disponible', async () => {
    const lot = S.ids.lots['C-1-01'];
    const id = await withContext(pool, as('sales'), (tx) => tx.query(`select (immo.hold_lot($1,'option',null,5,$2,'courte')).id`, [lot, randomUUID()]).then((r) => r.rows[0].id));
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`update immo.lot_holds set expires_at = now() - interval '1 second' where id = $1`, [id]);
    await admin.end();
    const n = await withContext(pool, { userId: null, orgId: null }, (tx) => tx.query('select immo.expire_holds() n'));
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    const r = await withContext(pool, as('admin'), (tx) => tx.query(`select status from immo.lots where id = $1`, [lot]));
    expect(r.rows[0].status).toBe('available');
    const h = await withContext(pool, as('admin'), (tx) => tx.query(`select reason, author_id from immo.lot_status_history where lot_id = $1 order by id desc limit 1`, [lot]));
    expect(h.rows[0].reason).toMatch(/Expiration automatique/);
  });

  it('une réservation convertit l’option du même prospect, pas celle d’un autre', async () => {
    const lot = S.ids.lots['C-1-02'];
    const [p1, p2] = await withContext(pool, as('admin'), (tx) => tx.query(`select id from immo.prospects order by created_at limit 2`).then((r) => r.rows.map((x) => x.id)));
    await withContext(pool, as('sales'), (tx) => tx.query(`select immo.hold_lot($1,'option',$2,60,$3,'opt')`, [lot, p1, randomUUID()]));
    await expect(withContext(pool, as('sales2'), (tx) => tx.query(`select immo.hold_lot($1,'reservation',$2,null,$3,'resa')`, [lot, p2, randomUUID()]))).rejects.toThrow(/lot_not_available/);
    await withContext(pool, as('sales'), (tx) => tx.query(`select immo.hold_lot($1,'reservation',$2,null,$3,'resa')`, [lot, p1, randomUUID()]));
    const r = await withContext(pool, as('admin'), (tx) => tx.query(`select kind, status from immo.lot_holds where lot_id = $1 order by created_at`, [lot]));
    expect(r.rows).toEqual([{ kind: 'option', status: 'converted' }, { kind: 'reservation', status: 'active' }]);
  });

  it('l’historique conserve auteur, date et motif', async () => {
    const lot = S.ids.lots['C-1-02'];
    await withContext(pool, as('pm'), (tx) => tx.query(`select immo.change_lot_status($1,'sold','Signature notaire')`, [lot]));
    const h = await withContext(pool, as('admin'), (tx) => tx.query(`select from_status, to_status, reason, author_id, created_at from immo.lot_status_history where lot_id = $1 order by id`, [lot]));
    expect(h.rows.map((x) => x.to_status)).toEqual(['available', 'option', 'reserved', 'sold']);
    expect(h.rows.at(-1)).toMatchObject({ from_status: 'reserved', reason: 'Signature notaire', author_id: S.users.pm });
  });

  it('un commercial ne peut pas annuler une vente', async () => {
    await expect(withContext(pool, as('sales'), (tx) => tx.query(`select immo.change_lot_status($1,'available','annulation')`, [S.ids.lots['C-1-02']]))).rejects.toThrow(/forbidden_transition/);
  });
});

describe('présentation publique', () => {
  it('lit l’instantané publié avec les statuts en direct, sans prix non autorisé', async () => {
    const r = await withContext(pool, { userId: null, orgId: null }, (tx) => tx.query(`select immo.public_get_publication('al-nakhil-demo') p`));
    const p = r.rows[0].p;
    expect(p.snapshot.lots).toHaveLength(43);
    const hidden = p.snapshot.lots.find((l: any) => l.reference === 'B-4-01');
    expect(hidden.price).toBeNull();
    expect(p.statuses[S.ids.lots['C-1-02']]).toBe('sold');
    expect(JSON.stringify(p.snapshot)).not.toMatch(/notes_private|surface_calc_m2|Note interne/);
  });

  it('une demande publique crée un prospect, sans réserver le lot, et est idempotente', async () => {
    const lot = S.ids.lots['A-2-03'];
    const key = randomUUID();
    const submit = () => withContext(pool, { userId: null, orgId: null }, (tx) => tx.query(
      `select immo.public_submit_inquiry('al-nakhil-demo','appointment','Visiteur Test','visiteur@example.com','+212600000001','Bonjour',$1,now() + interval '2 days',true,$2) r`, [lot, key]).then((x) => x.rows[0].r));
    const a = await submit();
    const b = await submit();
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ inquiry_id: a.inquiry_id, duplicate: true });
    const r = await withContext(pool, as('sales'), async (tx) => ({
      prospect: (await tx.query(`select stage, source from immo.prospects where email = 'visiteur@example.com'`)).rows,
      lot: (await tx.query(`select status from immo.lots where id = $1`, [lot])).rows[0].status,
      appt: (await tx.query(`select status from immo.appointments a join immo.prospects p on p.id = a.prospect_id where p.email = 'visiteur@example.com'`)).rows,
    }));
    expect(r.prospect).toEqual([{ stage: 'new', source: 'website' }]);
    expect(r.lot).toBe('available');
    expect(r.appt).toEqual([{ status: 'requested' }]);
    // invisible pour l'autre organisation
    const o = await withContext(pool, as('other'), (tx) => tx.query(`select count(*)::int n from immo.inquiries`));
    expect(o.rows[0].n).toBe(0);
  });

  it('refuse une demande sans consentement ou sur une publication révoquée', async () => {
    await expect(withContext(pool, { userId: null, orgId: null }, (tx) => tx.query(
      `select immo.public_submit_inquiry('al-nakhil-demo','info','X','x@example.com',null,null,null,null,false,$1)`, [randomUUID()]))).rejects.toThrow(/consent_required/);
    await expect(withContext(pool, { userId: null, orgId: null }, (tx) => tx.query(
      `select immo.public_submit_inquiry('inexistant','info','X','x@example.com',null,null,null,null,true,$1)`, [randomUUID()]))).rejects.toThrow(/publication_not_found/);
  });

  it('le dernier administrateur ne peut pas être retiré', async () => {
    await expect(withContext(pool, as('other'), (tx) => tx.query(`delete from immo.memberships where user_id = $1`, [S.users.other]))).rejects.toThrow(/last_admin/);
  });
});
