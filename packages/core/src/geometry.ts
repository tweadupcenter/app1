// Géométrie 2D des plans. Unités : mètres, sauf mention "px".
export type Vec2 = [number, number];

export const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Échelle (m/px) à partir de deux points image et d'une cote connue. */
export function calibrateScale(p1px: Vec2, p2px: Vec2, knownMeters: number): number {
  const d = dist(p1px, p2px);
  if (!(d > 0)) throw new Error('Les deux points de calibration doivent être distincts.');
  if (!(knownMeters > 0)) throw new Error('La dimension connue doit être positive.');
  return knownMeters / d;
}

/** Aire signée (shoelace). Positive si sens trigonométrique. */
export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
export const polygonArea = (pts: Vec2[]) => Math.abs(signedArea(pts));

export function polygonCentroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-12) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(pts: Vec2[]) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export const snapValue = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);
export const snapPoint = (p: Vec2, step: number): Vec2 => [snapValue(p[0], step), snapValue(p[1], step)];

/** Accrochage aux sommets existants dans un rayon donné, sinon à la grille. */
export function snapToVertices(p: Vec2, vertices: Vec2[], radius: number, grid: number): { point: Vec2; snapped: 'vertex' | 'grid' | 'none' } {
  let best: Vec2 | null = null, bestD = radius;
  for (const v of vertices) {
    const d = dist(p, v);
    if (d <= bestD) { bestD = d; best = v; }
  }
  if (best) return { point: [best[0], best[1]], snapped: 'vertex' };
  if (grid > 0) return { point: snapPoint(p, grid), snapped: 'grid' };
  return { point: p, snapped: 'none' };
}

/** Contraint un segment à l'horizontale/verticale/45° (touche Maj). */
export function constrainAngle(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  const len = Math.hypot(dx, dy);
  return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len];
}

/** Point à une longueur et un angle donnés (saisie numérique). */
export const polar = (a: Vec2, length: number, angleDeg: number): Vec2 => [
  a[0] + length * Math.cos((angleDeg * Math.PI) / 180),
  a[1] + length * Math.sin((angleDeg * Math.PI) / 180),
];

/** Distance d'un point à un segment, et paramètre t de projection. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: dist(p, [a[0] + t * dx, a[1] + t * dy]), t };
}

/** Transformation pixels image -> mètres de la page (origine = coin haut-gauche, y vers le haut). */
export function pxToMeters(p: Vec2, scale: number, imageHeightPx: number): Vec2 {
  return [p[0] * scale, (imageHeightPx - p[1]) * scale];
}
export function metersToPx(p: Vec2, scale: number, imageHeightPx: number): Vec2 {
  return [p[0] / scale, imageHeightPx - p[1] / scale];
}

export interface WallPiece {
  /** début et fin le long du mur (m depuis l'extrémité a) */
  s0: number;
  s1: number;
  /** bas et haut (m depuis le sol) */
  z0: number;
  z1: number;
}

export interface OpeningSpan { offset: number; width: number; sill: number; height: number }

/**
 * Découpe un mur en blocs pleins autour des ouvertures (portes, fenêtres).
 * Les ouvertures sont bornées au mur ; les chevauchements sont fusionnés côté appelant (validation).
 */
export function splitWall(length: number, height: number, openings: OpeningSpan[]): WallPiece[] {
  const ops = openings
    .map((o) => ({ s0: Math.max(0, o.offset), s1: Math.min(length, o.offset + o.width), z0: Math.max(0, o.sill), z1: Math.min(height, o.sill + o.height) }))
    .filter((o) => o.s1 - o.s0 > 1e-6 && o.z1 - o.z0 > 1e-6)
    .sort((a, b) => a.s0 - b.s0);
  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of ops) {
    if (o.s0 > cursor + 1e-6) pieces.push({ s0: cursor, s1: o.s0, z0: 0, z1: height });
    if (o.z0 > 1e-6) pieces.push({ s0: o.s0, s1: o.s1, z0: 0, z1: o.z0 });
    if (o.z1 < height - 1e-6) pieces.push({ s0: o.s0, s1: o.s1, z0: o.z1, z1: height });
    cursor = Math.max(cursor, o.s1);
  }
  if (cursor < length - 1e-6) pieces.push({ s0: cursor, s1: length, z0: 0, z1: height });
  return pieces;
}

/** Conversion repère plan (x est, y nord, z haut) -> repère three.js (y haut, nord = -z). */
export const planToWorld = (p: Vec2, elevation = 0): [number, number, number] => [p[0], elevation, -p[1]];
export const worldToPlan = (w: [number, number, number]): Vec2 => [w[0], -w[2]];

export const round = (v: number, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
