// Construction de volumes three.js à partir des tracés validés et des données projet.
import * as THREE from 'three';
import { dist, planToWorld, splitWall, type Vec2 } from './geometry';
import type { Drawing } from './drawing';

export function createMaterials() {
  const std = (name: string, color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ name, color: new THREE.Color(color), roughness: 0.85, metalness: 0, ...o });
  return {
    facade: std('facade_enduit', '#ece6da'),
    facadeAccent: std('facade_accent', '#b9a68c'),
    glass: std('vitrage', '#7fa4bd', { roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.45 }),
    slab: std('dalle_beton', '#d2cbbf'),
    roof: std('toiture', '#9b9184'),
    interiorFloor: std('sol_parquet', '#b48b62', { roughness: 0.6 }),
    partition: std('cloison', '#f4f1ea'),
    ground: std('sol_site', '#d8cba8'),
    lawn: std('pelouse', '#6e9b48'),
    water: std('eau_piscine', '#3aa6d8', { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }),
    deck: std('plage_piscine', '#e3d5bb'),
    asphalt: std('enrobe', '#4b4d50'),
    court: std('terrain_sport', '#2f7d6d'),
    line: std('marquage', '#f5f5f0'),
    trunk: std('tronc', '#6b4f2a'),
    crown: std('feuillage', '#4d7d38'),
    palm: std('palmier', '#5f8a3a'),
    railing: std('garde_corps', '#5b6770', { metalness: 0.6, roughness: 0.4 }),
    wallDrawn: std('mur_trace', '#efe9de'),
    roomFloor: std('sol_piece', '#c9b18f'),
  };
}
export type Materials = ReturnType<typeof createMaterials>;

/** Bloc parallélépipédique le long d'un segment de mur (repère plan). */
function wallBox(a: Vec2, b: Vec2, s0: number, s1: number, z0: number, z1: number, thickness: number, elevation: number, mat: THREE.Material, name: string) {
  const L = dist(a, b);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const sm = (s0 + s1) / 2;
  const geom = new THREE.BoxGeometry(s1 - s0, z1 - z0, thickness);
  const m = new THREE.Mesh(geom, mat);
  m.name = name;
  const [x, , z] = planToWorld([a[0] + ux * sm, a[1] + uy * sm]);
  m.position.set(x, elevation + (z0 + z1) / 2, z);
  m.rotation.y = Math.atan2(uy, ux);
  return m;
}

/** Dalle extrudée à partir d'un polygone (repère plan), face supérieure à `top`. */
export function slab(points: Vec2[], top: number, thickness: number, mat: THREE.Material, name: string) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geom = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Extrusion selon +Z du shape : on bascule pour que Z(shape) devienne Y(monde) et Y(shape) -> -Z.
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, top - thickness, 0);
  const m = new THREE.Mesh(geom, mat);
  m.name = name;
  return m;
}

export interface BuildFromDrawingOptions {
  elevation: number;
  levelKey: string;
  slabThickness?: number;
  materials?: Materials;
  /** inclure les éléments non validés (aperçu seulement, jamais exporté comme maquette) */
  includeUnvalidated?: boolean;
}

/**
 * Reconstruction simple : murs extrudés avec ouvertures, vitrages, dalles des pièces.
 * Chaque mur => groupe `wall_<id>`, chaque pièce => `room_<id>` (userData.lotId si associée).
 */
export function buildFromDrawing(d: Drawing, opts: BuildFromDrawingOptions): THREE.Group {
  const mats = opts.materials ?? createMaterials();
  const g = new THREE.Group();
  g.name = `level_${opts.levelKey}`;
  const ok = (p: string) => opts.includeUnvalidated || p === 'validated';
  const walls = d.walls.filter((w) => ok(w.provenance));
  const wallIds = new Set(walls.map((w) => w.id));
  for (const w of walls) {
    const L = dist(w.a as Vec2, w.b as Vec2);
    if (L < 0.01) continue;
    const ops = d.openings.filter((o) => o.wallId === w.id && wallIds.has(o.wallId) && ok(o.provenance));
    const wg = new THREE.Group();
    wg.name = `wall_${w.id}`;
    wg.userData = { immoKind: 'wall', drawingId: w.id, lengthM: L };
    const pieces = splitWall(L, w.height, ops);
    pieces.forEach((p, i) => wg.add(wallBox(w.a as Vec2, w.b as Vec2, p.s0, p.s1, p.z0, p.z1, w.thickness, opts.elevation, mats.wallDrawn, `wall_${w.id}_p${i}`)));
    for (const o of ops.filter((o) => o.kind === 'window')) {
      wg.add(wallBox(w.a as Vec2, w.b as Vec2, o.offset, o.offset + o.width, o.sill, o.sill + o.height, Math.min(0.03, w.thickness / 3), opts.elevation, mats.glass, `win_${o.id}`));
    }
    g.add(wg);
  }
  for (const r of d.rooms.filter((r) => ok(r.provenance))) {
    const m = slab(r.points as Vec2[], opts.elevation, opts.slabThickness ?? 0.2, mats.roomFloor, `room_${r.id}`);
    m.userData = { immoKind: 'room', drawingId: r.id, lotId: r.lotId ?? null, name: r.name };
    g.add(m);
  }
  return g;
}

/**
 * Contrôle dimensionnel : longueur réelle de chaque mur mesurée sur la géométrie générée
 * (projection des sommets sur l'axe du mur), comparée à la cote du tracé.
 */
export function measureWalls(group: THREE.Object3D, d: Drawing): { id: string; expected: number; measured: number; delta: number }[] {
  group.updateMatrixWorld(true);
  const out: { id: string; expected: number; measured: number; delta: number }[] = [];
  for (const w of d.walls) {
    const wg = group.getObjectByName(`wall_${w.id}`);
    if (!wg) continue;
    const L = dist(w.a as Vec2, w.b as Vec2);
    const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
    let mn = Infinity, mx = -Infinity;
    const v = new THREE.Vector3();
    wg.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !o.name.startsWith(`wall_${w.id}_p`)) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const px = v.x - w.a[0], py = -v.z - w.a[1];
        const s = px * ux + py * uy;
        mn = Math.min(mn, s); mx = Math.max(mx, s);
      }
    });
    const measured = mx - mn;
    out.push({ id: w.id, expected: L, measured, delta: measured - L });
  }
  return out;
}

/** Arbre stylisé (géométrie simple, ressource générée — aucune licence tierce). */
export function tree(mats: Materials, x: number, y: number, h = 5, name = 'tree') {
  const g = new THREE.Group();
  g.name = name;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, h * 0.45, 8), mats.trunk);
  trunk.position.set(0, h * 0.225, 0);
  trunk.name = `${name}_trunk`;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 1), mats.crown);
  crown.position.set(0, h * 0.62, 0);
  crown.name = `${name}_crown`;
  g.add(trunk, crown);
  const [wx, , wz] = planToWorld([x, y]);
  g.position.set(wx, 0, wz);
  return g;
}

export function palm(mats: Materials, x: number, y: number, h = 7, name = 'palm') {
  const g = new THREE.Group();
  g.name = name;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, h, 8), mats.trunk);
  trunk.position.y = h / 2;
  trunk.name = `${name}_trunk`;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.6, 4), mats.palm);
    leaf.name = `${name}_leaf${i}`;
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.0, h - 0.2, Math.sin(a) * 1.0);
    leaf.rotation.z = Math.cos(a) * 1.9;
    leaf.rotation.x = -Math.sin(a) * 1.9;
    g.add(leaf);
  }
  const [wx, , wz] = planToWorld([x, y]);
  g.position.set(wx, 0, wz);
  return g;
}

export { wallBox };
