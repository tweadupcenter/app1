// Données de démonstration — résidence FICTIVE, organisations FICTIVES.
// Usage : tsx src/seed.ts  (utilise DATABASE_ADMIN_URL ; idempotent : ne fait rien si déjà présent)
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildDemoScene, demoSpec, demoViewpoints } from '@immo/core/demo-scene';
import { inspectGlb, objectToGlb } from '@immo/core/glb';
import { createStorage, localStorage, newStorageKey, sha256 } from '@immo/core/storage';
import { loadRootEnv, pgConfig, ROOT_DIR, buildPublicationSnapshot } from './index';
import { hashPassword } from './password';
import path from 'node:path';

const FICTIF = 'Projet fictif de démonstration — aucune donnée réelle';

export async function seed(adminUrl: string, opts: { password: string; storageDir?: string; log?: boolean }) {
  const log = (...a: unknown[]) => opts.log !== false && console.log(...a);
  const client = new pg.Client(pgConfig(adminUrl));
  await client.connect();
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p);
  const one = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0];
  const ctx = async (userId: string, orgId: string) => {
    await q(`select set_config('app.user_id', $1, false), set_config('app.org_id', $2, false)`, [userId, orgId]);
  };
  try {
    if (await one(`select 1 from immo.organizations where slug = 'tweadup-demo'`)) {
      log('Données de démonstration déjà présentes (utiliser pnpm db:reset pour repartir de zéro).');
      return;
    }
    // Pilote S3 si configuré (Vercel), sinon disque ; les tests imposent un dossier temporaire.
    const storage = opts.storageDir || process.env.STORAGE_DRIVER !== 's3' ? localStorage(opts.storageDir ? path.resolve(opts.storageDir) : path.join(ROOT_DIR, 'storage')) : createStorage();
    const pw = await hashPassword(opts.password);
    await q('begin');

    const mkUser = async (email: string, name: string) =>
      (await one(`insert into immo.users (email, full_name, password_hash) values ($1,$2,$3) returning id`, [email, name, pw])).id as string;
    const users = {
      admin: await mkUser('admin@demo.example', 'Salma Admin (démo)'),
      pm: await mkUser('chef.projet@demo.example', 'Youssef Chef de projet (démo)'),
      sales: await mkUser('commercial@demo.example', 'Imane Commerciale (démo)'),
      sales2: await mkUser('commercial2@demo.example', 'Karim Commercial (démo)'),
      viewer: await mkUser('lecteur@demo.example', 'Nadia Lectrice (démo)'),
      other: await mkUser('admin@temoin.example', 'Admin Agence Témoin'),
    };
    const org = (await one(
      `insert into immo.organizations (name, slug, contact, branding) values ($1, 'tweadup-demo', $2, $3) returning id`,
      ['Tweadup Démo (organisation fictive)', { phone: '+212 5 00 00 00 00 (fictif)', email: 'contact@demo.example', whatsapp: null, address: 'Adresse fictive, Casablanca' },
        { primary_color: '#1f4e5f', accent_color: '#c08a3e' }],
    )).id as string;
    const other = (await one(`insert into immo.organizations (name, slug) values ('Agence Témoin (fictive)', 'agence-temoin') returning id`)).id as string;
    for (const [u, r] of [[users.admin, 'admin'], [users.pm, 'project_manager'], [users.sales, 'sales'], [users.sales2, 'sales'], [users.viewer, 'viewer']] as const) {
      await q(`insert into immo.memberships (org_id, user_id, role) values ($1,$2,$3)`, [org, u, r]);
    }
    await q(`insert into immo.memberships (org_id, user_id, role) values ($1,$2,'admin')`, [other, users.other]);

    await ctx(users.admin, org);
    const project = (await one(
      `insert into immo.projects (org_id, name, slug, city, address, description, is_fictional) values ($1,$2,'al-nakhil-demo',$3,$4,$5,true) returning id`,
      [org, 'Résidence Al Nakhil (fictive)', 'Casablanca (localisation fictive)', 'Adresse fictive',
        `${FICTIF}. Résidence de trois bâtiments (R+3, R+4, R+2) avec piscine, jardin paysager, terrain de padel et parking extérieur.`],
    )).id as string;

    const spec = demoSpec();
    const ids = { buildings: {} as Record<string, string>, floors: {} as Record<string, string>, lots: {} as Record<string, string>, amenities: {} as Record<string, string> };
    await q(`select set_config('app.reason', 'Import initial (démo)', false)`);
    for (const [bi, b] of spec.buildings.entries()) {
      const fp = [[b.origin[0], b.origin[1]], [b.origin[0] + b.width, b.origin[1]], [b.origin[0] + b.width, b.origin[1] + b.depth], [b.origin[0], b.origin[1] + b.depth]];
      const bid = (await one(`insert into immo.buildings (org_id, project_id, code, name, footprint, sort_order) values ($1,$2,$3,$4,$5,$6) returning id`,
        [org, project, b.code, b.name, JSON.stringify(fp), bi])).id;
      ids.buildings[b.code] = bid;
      for (let level = 0; level < b.levels; level++) {
        const fid = (await one(`insert into immo.floors (org_id, project_id, building_id, level, name, elevation_m, height_m) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [org, project, bid, level, level === 0 ? 'Rez-de-chaussée' : `Étage ${level}`, level * b.floorHeight, b.floorHeight])).id;
        ids.floors[`${b.code}_${level}`] = fid;
      }
      for (const l of b.lots) {
        const lid = (await one(
          `insert into immo.lots (org_id, project_id, building_id, floor_id, reference, type, rooms, bedrooms, surface_calc_m2, surface_comm_m2,
             surface_terrace_m2, surface_garden_m2, orientation, price, price_public, features, description, footprint)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
          [org, project, bid, ids.floors[`${b.code}_${l.level}`], l.reference, l.type, l.rooms, l.bedrooms, l.surfaceCalc, l.surfaceComm,
            l.terrace, l.garden, l.orientation, l.price, l.pricePublic, l.features,
            `${l.type === 'commercial' ? 'Local commercial' : `Appartement ${l.rooms} pièces`} — ${FICTIF.toLowerCase()}.${l.interiorModeled ? ' Intérieur modélisé (volumes simplifiés).' : ''}`,
            JSON.stringify(l.footprint)],
        )).id;
        ids.lots[l.reference] = lid;
      }
    }
    for (const a of spec.amenities) {
      ids.amenities[a.kind] = (await one(`insert into immo.amenities (org_id, project_id, kind, name, footprint, description) values ($1,$2,$3,$4,$5,$6) returning id`,
        [org, project, a.kind, a.name, JSON.stringify(a.footprint), a.description])).id;
    }
    log(`✓ ${Object.keys(ids.lots).length} lots, ${spec.buildings.length} bâtiments, ${spec.amenities.length} équipements`);

    // Maquette 3D générée (GLB réel) + associations
    const glb = objectToGlb(buildDemoScene(spec), { generator: 'Tweadup Immo 360 — scène de démonstration', extras: { fictional: true } });
    const info = inspectGlb(glb);
    const key = newStorageKey(org, 'glb');
    await storage.put(key, glb, 'model/gltf-binary');
    const media = (await one(
      `insert into immo.media (org_id, project_id, kind, storage_key, mime, size_bytes, original_name, sha256, meta, created_by)
       values ($1,$2,'model',$3,'model/gltf-binary',$4,'residence-demo-fictive.glb',$5,$6,$7) returning id`,
      [org, project, key, glb.byteLength, sha256(glb), { generated: true, note: 'Géométrie simplifiée générée par code' }, users.admin])).id;
    const model = (await one(`insert into immo.models (org_id, project_id, name, source) values ($1,$2,'Maquette de démonstration (générée)','generated') returning id`, [org, project])).id;
    const rev = (await one(
      `insert into immo.model_revisions (org_id, model_id, version, media_id, status, node_names, report, created_by) values ($1,$2,1,$3,'ready',$4,$5,$6) returning id`,
      [org, model, media, info.nodeNames, { ...info, nodeNames: undefined }, users.admin])).id;
    await q(`update immo.models set active_revision_id = $1 where id = $2`, [rev, model]);
    const bind = (node: string, type: string, target: string) =>
      q(`insert into immo.model_bindings (org_id, revision_id, node_name, target_type, target_id, created_by) values ($1,$2,$3,$4,$5,$6)`, [org, rev, node, type, target, users.admin]);
    for (const [ref, id] of Object.entries(ids.lots)) await bind(`lot_${ref}`, 'lot', id);
    for (const [code, id] of Object.entries(ids.buildings)) await bind(`bld_${code}`, 'building', id);
    for (const [k, id] of Object.entries(ids.floors)) await bind(`floor_${k}`, 'floor', id);
    for (const [k, id] of Object.entries(ids.amenities)) await bind(`amenity_${k}`, 'amenity', id);
    log(`✓ Maquette GLB ${(glb.byteLength / 1024).toFixed(0)} Ko, ${info.nodeNames.length} nœuds, associations enregistrées`);

    // Points de vue
    const vpIds: Record<string, string> = {};
    for (const [i, v] of demoViewpoints(spec).entries()) {
      const id = (await one(
        `insert into immo.viewpoints (org_id, project_id, label, kind, amenity_id, building_id, lot_id, position, target, fov, sort_order, show_in_nav)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [org, project, v.label, v.kind, v.kind === 'amenity' ? ids.amenities[v.ref!] : null, v.kind === 'building' ? ids.buildings[v.ref!] : null,
          v.kind === 'interior' ? ids.lots[v.ref!] : null, JSON.stringify(v.position), JSON.stringify(v.target), v.fov, i, v.kind !== 'interior'])).id;
      vpIds[v.kind === 'overview' ? 'overview' : v.ref!] = id;
    }
    const shots = (keys: string[], d: number) => JSON.stringify(keys.map((k, i) => ({ viewpoint_id: vpIds[k], duration_s: d, transition: i === 0 ? 'cut' : 'move' })));
    await q(`insert into immo.sequences (org_id, project_id, name, kind, shots, created_by) values ($1,$2,'Parcours découverte','tour',$3,$4)`,
      [org, project, shots(['overview', 'pool', 'garden', 'A', 'A-0-02'], 4), users.admin]);
    await q(`insert into immo.sequences (org_id, project_id, name, kind, aspect, shots, overlay, created_by) values ($1,$2,'Teaser 16:9 (démo)','video','16:9',$3,$4,$5)`,
      [org, project, shots(['overview', 'pool', 'B'], 2), { title: 'Résidence Al Nakhil', subtitle: 'Projet fictif de démonstration' }, users.admin]);

    // CRM
    const prospects: string[] = [];
    const P = [
      ['Amine B. (fictif)', 'amine.b@example.com', '+212 6 11 11 11 11', 'website', 'interested', users.sales, 1200000, 1600000],
      ['Leïla M. (fictive)', 'leila.m@example.com', '+212 6 22 22 22 22', 'phone', 'visit_planned', users.sales, 900000, 1300000],
      ['Omar T. (fictif)', 'omar.t@example.com', null, 'referral', 'reserved', users.sales2, 1500000, 2200000],
      ['Sara K. (fictive)', null, '+212 6 44 44 44 44', 'whatsapp', 'new', users.sales2, null, null],
      ['Hicham R. (fictif)', 'hicham.r@example.com', null, 'portal', 'sold', users.sales, 1000000, 1400000],
      ['Fatima Z. (fictive)', 'fatima.z@example.com', '+212 6 66 66 66 66', 'walk_in', 'lost', users.sales2, null, 800000],
      ['Yassine A. (fictif)', 'yassine.a@example.com', null, 'social', 'contacted', users.sales, 700000, 1000000],
    ] as const;
    for (const [name, email, phone, source, stage, owner, bmin, bmax] of P) {
      prospects.push((await one(
        `insert into immo.prospects (org_id, project_id, full_name, email, phone, source, stage, owner_id, budget_min, budget_max, consent_contact, notes_private)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) returning id`,
        [org, project, name, email, phone, source, stage, owner, bmin, bmax, 'Note interne fictive : préfère un étage élevé.'])).id);
      await q(`insert into immo.interactions (org_id, prospect_id, kind, body, author_id) values ($1,$2,'note','Premier contact (fictif).',$3)`, [org, prospects.at(-1), owner]);
    }
    const now = Date.now();
    const at = (h: number) => new Date(now + h * 3600_000).toISOString();
    await q(`insert into immo.appointments (org_id, prospect_id, project_id, user_id, title, starts_at, ends_at, location) values
      ($1,$2,$3,$4,'Visite bureau de vente',$5,$6,'Bureau de vente (fictif)'), ($1,$7,$3,$4,'Visite appartement témoin',$8,$9,'Bâtiment A')`,
      [org, prospects[1], project, users.sales, at(26), at(27), prospects[0], at(50), at(51)]);
    await q(`insert into immo.tasks (org_id, prospect_id, assignee_id, title, due_at, created_by) values
      ($1,$2,$3,'Rappeler pour confirmer le financement',$4,$5), ($1,$6,$7,'Envoyer la fiche du lot B-2-01',$8,$5), ($1,$9,$3,'Relancer après la visite',$10,$5)`,
      [org, prospects[0], users.sales, at(-30), users.pm, prospects[2], users.sales2, at(20), prospects[6], at(-4)]);
    await q(`insert into immo.prospect_lots (org_id, prospect_id, lot_id) values ($1,$2,$3),($1,$2,$4),($1,$5,$6)`,
      [org, prospects[0], ids.lots['A-1-02'], ids.lots['A-2-02'], prospects[1], ids.lots['B-1-02']]);

    // Statuts commerciaux via les fonctions contrôlées (historique + exclusivité)
    await ctx(users.sales, org);
    await q(`select immo.hold_lot($1,'option',$2,2880,$3,'Option 48 h (démo)')`, [ids.lots['A-1-02'], prospects[0], randomUUID()]);
    await ctx(users.sales2, org);
    await q(`select immo.hold_lot($1,'reservation',$2,null,$3,'Réservation avec acompte (démo)')`, [ids.lots['B-2-01'], prospects[2], randomUUID()]);
    await q(`select immo.hold_lot($1,'reservation',$2,null,$3,'Réservation (démo)')`, [ids.lots['C-0-02'], prospects[4], randomUUID()]);
    await ctx(users.pm, org);
    await q(`select immo.change_lot_status($1,'sold','Acte signé (démo)')`, [ids.lots['C-0-02']]);
    await q(`select immo.change_lot_status($1,'unavailable','Logement témoin conservé (démo)')`, [ids.lots['A-3-04']]);
    await q(`select immo.change_lot_status($1,'unavailable','Retiré de la vente (démo)')`, [ids.lots['B-4-03']]);

    // Publication initiale (version publique validée)
    await ctx(users.admin, org);
    const snap = await buildPublicationSnapshot(client as any, project);
    await q(`insert into immo.publications (org_id, project_id, slug, version, snapshot, media_ids, published_by) values ($1,$2,'al-nakhil-demo',1,$3,$4,$5)`,
      [org, project, snap.snapshot, snap.mediaIds, users.admin]);

    // Organisation témoin (contrôle d'isolation)
    await ctx(users.other, other);
    const p2 = (await one(`insert into immo.projects (org_id, name, slug, city, is_fictional, description) values ($1,'Projet Témoin (fictif)','projet-temoin','Rabat (fictif)',true,$2) returning id`, [other, FICTIF])).id;
    await q(`insert into immo.lots (org_id, project_id, reference, type, rooms, surface_comm_m2, price, price_public) values ($1,$2,'T-01','apartment',3,90,1100000,true),($1,$2,'T-02','studio',1,35,520000,false)`, [other, p2]);

    await q(`select set_config('app.user_id', '', false), set_config('app.org_id', '', false), set_config('app.reason', '', false)`);
    await q('commit');
    log('✓ Données de démonstration créées');
    log(`  Comptes (mot de passe : valeur de SEED_PASSWORD) :`);
    log('  admin@demo.example · chef.projet@demo.example · commercial@demo.example · commercial2@demo.example · lecteur@demo.example · admin@temoin.example');
    log('  Présentation publique : /p/al-nakhil-demo');
    return { org, other, project, users, ids };
  } catch (e) {
    await q('rollback').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRootEnv();
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL manquant'); process.exit(1); }
  seed(url, { password: process.env.SEED_PASSWORD ?? 'demo-immo-360', storageDir: process.env.STORAGE_DRIVER === 's3' ? undefined : (process.env.STORAGE_DIR ? path.resolve(ROOT_DIR, process.env.STORAGE_DIR) : undefined) })
    .catch((e) => { console.error(e); process.exit(1); });
}
