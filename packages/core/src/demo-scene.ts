// Résidence FICTIVE de démonstration : données structurées + maquette 3D simplifiée.
// Toute la géométrie est générée par code (aucune ressource tierce) : ce n'est PAS un rendu photoréaliste.
import * as THREE from 'three';
import type { AmenityKind, LotType } from './domain';
import { planToWorld, splitWall, type Vec2 } from './geometry';
import { createMaterials, palm, slab, tree, wallBox, type Materials } from './build3d';

export interface DemoLotSpec {
  reference: string;
  level: number;
  index: number;
  footprint: Vec2[];
  type: LotType;
  rooms: number;
  bedrooms: number;
  surfaceCalc: number;
  surfaceComm: number;
  terrace: number | null;
  garden: number | null;
  orientation: 'N' | 'S' | 'E' | 'O' | 'NE' | 'SE' | 'SO' | 'NO';
  price: number;
  pricePublic: boolean;
  interiorModeled: boolean;
  features: string[];
}

export interface DemoBuildingSpec {
  code: string;
  name: string;
  origin: Vec2; // coin sud-ouest
  width: number; // le long de x
  depth: number; // le long de y
  levels: number;
  lotsPerLevel: number;
  floorHeight: number;
  lots: DemoLotSpec[];
}

export interface DemoAmenitySpec {
  kind: AmenityKind;
  name: string;
  footprint: Vec2[];
  description: string;
}

const rect = (x0: number, y0: number, w: number, h: number): Vec2[] => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];

function lotTypeFor(level: number, idx: number, lotsPerLevel: number): { type: LotType; rooms: number; bedrooms: number } {
  if (level === 0 && idx === 0) return { type: 'commercial', rooms: 1, bedrooms: 0 };
  const end = idx === 0 || idx === lotsPerLevel - 1;
  if (end) return { type: 'apartment', rooms: 4, bedrooms: 3 };
  return { type: 'apartment', rooms: 3, bedrooms: 2 };
}

export function demoSpec(): { buildings: DemoBuildingSpec[]; amenities: DemoAmenitySpec[] } {
  const defs = [
    { code: 'A', name: 'Bâtiment A — Les Palmiers', origin: [-40, 10] as Vec2, width: 32, depth: 14, levels: 4, lotsPerLevel: 4 },
    { code: 'B', name: 'Bâtiment B — Les Oliviers', origin: [4, 10] as Vec2, width: 24, depth: 14, levels: 5, lotsPerLevel: 3 },
    { code: 'C', name: 'Bâtiment C — Les Jasmins', origin: [-20, -34] as Vec2, width: 32, depth: 12, levels: 3, lotsPerLevel: 4 },
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const buildings: DemoBuildingSpec[] = defs.map((d) => {
    const lw = d.width / d.lotsPerLevel;
    const lots: DemoLotSpec[] = [];
    for (let level = 0; level < d.levels; level++) {
      for (let i = 0; i < d.lotsPerLevel; i++) {
        const t = lotTypeFor(level, i, d.lotsPerLevel);
        const fp = rect(d.origin[0] + i * lw, d.origin[1], lw, d.depth);
        const gross = lw * d.depth;
        const calc = Math.round((gross - (2 * (lw + d.depth)) * 0.2) * 0.9 * 100) / 100; // surface utile estimée
        const comm = Math.round(calc * 1.08 * 100) / 100;
        const terrace = t.type === 'commercial' ? null : Math.round((6 + rnd() * 8) * 100) / 100;
        const garden = level === 0 && t.type !== 'commercial' ? Math.round((25 + rnd() * 30) * 100) / 100 : null;
        const base = t.type === 'commercial' ? 16000 : 13500;
        const price = Math.round((comm * (base + level * 400 + rnd() * 900)) / 1000) * 1000;
        lots.push({
          reference: `${d.code}-${level}-${String(i + 1).padStart(2, '0')}`,
          level, index: i, footprint: fp, ...t,
          surfaceCalc: calc, surfaceComm: comm, terrace, garden,
          orientation: d.code === 'C' ? 'N' : 'S',
          price, pricePublic: !(d.code === 'B' && level === d.levels - 1),
          interiorModeled: d.code === 'A' && level <= 1,
          features: [
            ...(terrace ? ['Terrasse'] : []), ...(garden ? ['Jardin privatif'] : []),
            ...(level > 0 ? ['Ascenseur'] : []), 'Place de parking', ...(i === 0 || i === d.lotsPerLevel - 1 ? ['Double exposition'] : []),
          ],
        });
      }
    }
    return { ...d, floorHeight: 3, lots };
  });
  const amenities: DemoAmenitySpec[] = [
    { kind: 'pool', name: 'Piscine', footprint: rect(-12, -10, 16, 9), description: 'Bassin 16 × 9 m avec plage (données fictives).' },
    { kind: 'garden', name: 'Jardin paysager', footprint: rect(-46, -16, 28, 20), description: 'Jardin planté de palmiers et oliviers (fictif).' },
    { kind: 'sport', name: 'Terrain de padel', footprint: rect(14, -14, 20, 10), description: 'Terrain 20 × 10 m (fictif).' },
    { kind: 'parking', name: 'Parking extérieur', footprint: rect(16, -38, 26, 16), description: '24 places visiteurs (fictif).' },
  ];
  return { buildings, amenities };
}

/** Lot creux : dalle + 4 murs percés de baies vitrées (+ cloisons si intérieur modélisé). */
function buildLot(mats: Materials, lot: DemoLotSpec, b: DemoBuildingSpec) {
  const g = new THREE.Group();
  g.name = `lot_${lot.reference}`;
  g.userData = { immoKind: 'lot', reference: lot.reference };
  const elev = lot.level * b.floorHeight;
  const [p0, p1, p2, p3] = lot.footprint;
  const h = b.floorHeight - 0.25;
  const t = 0.2;
  const base = elev + 0.25;
  const floorMat = lot.interiorModeled ? mats.interiorFloor : mats.slab;
  g.add(slab(lot.footprint, base, 0.25, floorMat, `lot_${lot.reference}_dalle`));
  const lw = p1[0] - p0[0];
  const sides: [Vec2, Vec2, 'front' | 'back' | 'side'][] = [[p0, p1, 'front'], [p1, p2, 'side'], [p2, p3, 'back'], [p3, p0, 'side']];
  sides.forEach(([a, c, kind], si) => {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ops = kind === 'side' ? [] : kind === 'front'
      ? [{ offset: 0.8, width: lw * 0.42, sill: 0, height: 2.3 }, { offset: lw * 0.55, width: lw * 0.32, sill: 0.9, height: 1.4 }]
      : [{ offset: 1.2, width: lw * 0.3, sill: 0.9, height: 1.3 }, { offset: lw * 0.6, width: lw * 0.22, sill: 0.9, height: 1.3 }];
    // les murs mitoyens sont doublés : on décale légèrement pour éviter le z-fighting
    const pieces = splitWall(L, h, ops);
    pieces.forEach((p, i) => g.add(wallBox(a, c, p.s0, p.s1, p.z0, p.z1, t, base, mats.facade, `lot_${lot.reference}_mur${si}_${i}`)));
    ops.forEach((o, i) => g.add(wallBox(a, c, o.offset, o.offset + o.width, o.sill, o.sill + o.height, 0.03, base, mats.glass, `lot_${lot.reference}_vitre${si}_${i}`)));
  });
  if (lot.interiorModeled) {
    // cloisons : séjour en façade sud, chambres au nord, couloir central
    const yMid = p0[1] + (p3[1] - p0[1]) * 0.55;
    const xMid = p0[0] + lw * 0.5;
    const cl = (a: Vec2, c: Vec2, ops: { offset: number; width: number; sill: number; height: number }[], n: string) => {
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      splitWall(L, h, ops).forEach((p, i) => g.add(wallBox(a, c, p.s0, p.s1, p.z0, p.z1, 0.1, base, mats.partition, `lot_${lot.reference}_${n}_${i}`)));
    };
    cl([p0[0] + t, yMid], [p1[0] - t, yMid], [{ offset: lw * 0.2, width: 0.9, sill: 0, height: 2.1 }, { offset: lw * 0.65, width: 0.9, sill: 0, height: 2.1 }], 'cloison_h');
    cl([xMid, yMid], [xMid, p3[1] - t], [], 'cloison_v');
    // mobilier schématique (volumes génériques)
    const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.9), mats.facadeAccent);
    const [sx, , sz] = planToWorld([p0[0] + lw * 0.3, p0[1] + 2.2]);
    sofa.position.set(sx, base + 0.4, sz);
    sofa.name = `lot_${lot.reference}_mobilier_canape`;
    const bed1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), mats.partition);
    const [bx, , bz] = planToWorld([p0[0] + lw * 0.25, p3[1] - 2.0]);
    bed1.position.set(bx, base + 0.25, bz);
    bed1.name = `lot_${lot.reference}_mobilier_lit`;
    g.add(sofa, bed1);
  }
  // balcon / terrasse en façade
  if (lot.level > 0 && lot.terrace) {
    const depth = 1.6;
    const bal = slab([[p0[0] + 0.6, p0[1] - depth], [p1[0] - 0.6, p0[1] - depth], [p1[0] - 0.6, p0[1]], [p0[0] + 0.6, p0[1]]], base, 0.18, mats.slab, `lot_${lot.reference}_balcon`);
    g.add(bal);
    g.add(wallBox([p0[0] + 0.6, p0[1] - depth], [p1[0] - 0.6, p0[1] - depth], 0, lw - 1.2, 0, 1.0, 0.05, base, mats.railing, `lot_${lot.reference}_gardecorps`));
  }
  return g;
}

export function buildDemoScene(spec = demoSpec()): THREE.Group {
  const mats = createMaterials();
  const root = new THREE.Group();
  root.name = 'residence_demo_fictive';
  root.userData = { fictional: true, note: 'Maquette simplifiée générée par code — non photoréaliste' };

  root.add(slab(rect(-60, -50, 120, 92), 0, 0.3, mats.ground, 'site_sol'));

  for (const b of spec.buildings) {
    const bg = new THREE.Group();
    bg.name = `bld_${b.code}`;
    bg.userData = { immoKind: 'building', code: b.code };
    for (let level = 0; level < b.levels; level++) {
      const fg = new THREE.Group();
      fg.name = `floor_${b.code}_${level}`;
      fg.userData = { immoKind: 'floor', level };
      for (const lot of b.lots.filter((l) => l.level === level)) fg.add(buildLot(mats, lot, b));
      bg.add(fg);
    }
    const fp = rect(b.origin[0], b.origin[1], b.width, b.depth);
    bg.add(slab(fp.map(([x, y]) => [x + (x === b.origin[0] ? -0.3 : 0.3), y + (y === b.origin[1] ? -0.3 : 0.3)] as Vec2), b.levels * b.floorHeight + 0.35, 0.35, mats.roof, `bld_${b.code}_toiture`));
    root.add(bg);
  }

  const amen = new THREE.Group();
  amen.name = 'exterieurs';
  for (const a of spec.amenities) {
    const ag = new THREE.Group();
    ag.name = `amenity_${a.kind}`;
    ag.userData = { immoKind: 'amenity', kind: a.kind };
    const [q0, , q2] = [a.footprint[0], a.footprint[1], a.footprint[2]];
    if (a.kind === 'pool') {
      ag.add(slab(rect(q0[0] - 3, q0[1] - 3, q2[0] - q0[0] + 6, q2[1] - q0[1] + 6), 0.36, 0.06, mats.deck, 'piscine_plage'));
      ag.add(slab(a.footprint, 0.38, 0.05, mats.water, 'piscine_eau'));
      for (let i = 0; i < 4; i++) ag.add(palm(mats, q0[0] - 5 + i * ((q2[0] - q0[0] + 10) / 3), q2[1] + 4.5, 7, `piscine_palmier${i}`));
    } else if (a.kind === 'garden') {
      ag.add(slab(a.footprint, 0.34, 0.04, mats.lawn, 'jardin_pelouse'));
      let k = 0;
      for (let x = q0[0] + 3; x < q2[0] - 1; x += 6) for (let y = q0[1] + 3; y < q2[1] - 1; y += 6.5) {
        ag.add(k % 3 === 0 ? palm(mats, x, y, 6.5, `jardin_palmier${k}`) : tree(mats, x + (k % 2), y, 4.5, `jardin_arbre${k}`));
        k++;
      }
    } else if (a.kind === 'sport') {
      ag.add(slab(a.footprint, 0.34, 0.04, mats.court, 'sport_sol'));
      const midX = (q0[0] + q2[0]) / 2;
      ag.add(wallBox([midX, q0[1]], [midX, q2[1]], 0, q2[1] - q0[1], 0, 0.9, 0.05, 0.34, mats.line, 'sport_filet'));
      ag.add(wallBox([q0[0], q0[1]], [q2[0], q0[1]], 0, q2[0] - q0[0], 0, 3, 0.05, 0.34, mats.glass, 'sport_vitre_s'));
      ag.add(wallBox([q0[0], q2[1]], [q2[0], q2[1]], 0, q2[0] - q0[0], 0, 3, 0.05, 0.34, mats.glass, 'sport_vitre_n'));
    } else if (a.kind === 'parking') {
      ag.add(slab(a.footprint, 0.33, 0.03, mats.asphalt, 'parking_sol'));
      for (let i = 0; i <= 12; i++) {
        const x = q0[0] + 1 + i * 2.5;
        ag.add(slab(rect(x, q0[1] + 1, 0.12, 5), 0.345, 0.01, mats.line, `parking_ligne_s${i}`));
        ag.add(slab(rect(x, q2[1] - 6, 0.12, 5), 0.345, 0.01, mats.line, `parking_ligne_n${i}`));
      }
    }
    amen.add(ag);
  }
  root.add(amen);
  return root;
}

/** Points de vue par défaut (repère three.js). */
export function demoViewpoints(spec = demoSpec()) {
  const vp: { label: string; kind: 'overview' | 'amenity' | 'building' | 'interior'; ref?: string; position: [number, number, number]; target: [number, number, number]; fov: number }[] = [
    { label: 'Vue générale', kind: 'overview', position: [70, 62, 78], target: [-4, 0, 6], fov: 45 },
  ];
  const labels: Record<string, string> = { pool: 'Piscine', garden: 'Jardin', sport: 'Sport', parking: 'Parking' };
  for (const a of spec.amenities) {
    const xs = a.footprint.map((p) => p[0]), ys = a.footprint.map((p) => p[1]);
    const c: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const t = planToWorld(c, 0);
    vp.push({ label: labels[a.kind] ?? a.name, kind: 'amenity', ref: a.kind, position: [t[0] + 16, 14, t[2] + 22], target: t, fov: 45 });
  }
  for (const b of spec.buildings) {
    const c: Vec2 = [b.origin[0] + b.width / 2, b.origin[1] + b.depth / 2];
    const top = b.levels * b.floorHeight;
    const t = planToWorld(c, top / 2);
    vp.push({ label: `Bâtiment ${b.code}`, kind: 'building', ref: b.code, position: [t[0] + 14, top + 16, t[2] + 38], target: t, fov: 45 });
  }
  // intérieur modélisé : lot A-0-02, vue depuis le séjour
  const a = spec.buildings[0].lots.find((l) => l.reference === 'A-0-02')!;
  const [x0, y0] = a.footprint[0];
  vp.push({ label: 'Intérieur A-0-02', kind: 'interior', ref: 'A-0-02', position: planToWorld([x0 + 6.8, y0 + 1.2], 1.6), target: planToWorld([x0 + 2, y0 + 6], 1.2), fov: 70 });
  return vp;
}
