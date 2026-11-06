import { z } from 'zod';
import { dist, polygonArea, round, type Vec2 } from './geometry';
import { PROVENANCES } from './domain';

const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
const provenance = z.enum(PROVENANCES);

export const wallSchema = z.object({
  id: z.string().min(1).max(64),
  a: vec2,
  b: vec2,
  thickness: z.number().min(0.02).max(2),
  height: z.number().min(0.5).max(20),
  provenance,
});

export const roomSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  points: z.array(vec2).min(3).max(500),
  lotId: z.string().uuid().nullable().optional(),
  provenance,
});

export const openingSchema = z.object({
  id: z.string().min(1).max(64),
  wallId: z.string(),
  kind: z.enum(['door', 'window']),
  offset: z.number().min(0),
  width: z.number().min(0.2).max(10),
  height: z.number().min(0.2).max(10),
  sill: z.number().min(0).max(10),
  provenance,
});

export const drawingSchema = z.object({
  version: z.literal(1),
  units: z.literal('m'),
  walls: z.array(wallSchema).max(5000),
  rooms: z.array(roomSchema).max(2000),
  openings: z.array(openingSchema).max(5000),
});

export type Wall = z.infer<typeof wallSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Drawing = z.infer<typeof drawingSchema>;

export const emptyDrawing = (): Drawing => ({ version: 1, units: 'm', walls: [], rooms: [], openings: [] });

export interface DrawingIssue { level: 'error' | 'warning'; elementId: string; message: string }

/** Contrôles de cohérence avant reconstruction. */
export function validateDrawing(d: Drawing): DrawingIssue[] {
  const issues: DrawingIssue[] = [];
  const walls = new Map(d.walls.map((w) => [w.id, w]));
  for (const w of d.walls) {
    if (dist(w.a, w.b) < 0.05) issues.push({ level: 'error', elementId: w.id, message: 'Mur de longueur quasi nulle' });
  }
  const byWall = new Map<string, Opening[]>();
  for (const o of d.openings) {
    const w = walls.get(o.wallId);
    if (!w) { issues.push({ level: 'error', elementId: o.id, message: 'Ouverture rattachée à un mur inexistant' }); continue; }
    const L = dist(w.a, w.b);
    if (o.offset + o.width > L + 1e-6) issues.push({ level: 'error', elementId: o.id, message: `Ouverture hors du mur (${round(o.offset + o.width)} m > ${round(L)} m)` });
    if (o.sill + o.height > w.height + 1e-6) issues.push({ level: 'error', elementId: o.id, message: 'Ouverture plus haute que le mur' });
    byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  }
  for (const [wid, ops] of byWall) {
    const s = [...ops].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < s.length; i++) {
      if (s[i].offset < s[i - 1].offset + s[i - 1].width - 1e-6) issues.push({ level: 'error', elementId: s[i].id, message: `Chevauchement d'ouvertures sur le mur ${wid}` });
    }
  }
  for (const r of d.rooms) {
    if (polygonArea(r.points as Vec2[]) < 0.5) issues.push({ level: 'warning', elementId: r.id, message: 'Pièce de surface inférieure à 0,5 m²' });
  }
  return issues;
}

export interface DrawingStats {
  wallCount: number;
  wallLengthM: number;
  rooms: { id: string; name: string; areaM2: number; lotId?: string | null; provenance: string }[];
  /** surfaces calculées par lot, uniquement à partir des pièces validées */
  lotSurfacesValidated: Record<string, number>;
  counts: Record<string, number>;
}

export function drawingStats(d: Drawing): DrawingStats {
  const counts: Record<string, number> = { documented: 0, estimated: 0, proposed: 0, validated: 0 };
  for (const e of [...d.walls, ...d.rooms, ...d.openings]) counts[e.provenance]++;
  const rooms = d.rooms.map((r) => ({ id: r.id, name: r.name, areaM2: round(polygonArea(r.points as Vec2[]), 2), lotId: r.lotId, provenance: r.provenance }));
  const lotSurfacesValidated: Record<string, number> = {};
  for (const r of rooms) {
    if (r.lotId && r.provenance === 'validated') lotSurfacesValidated[r.lotId] = round((lotSurfacesValidated[r.lotId] ?? 0) + r.areaM2, 2);
  }
  return {
    wallCount: d.walls.length,
    wallLengthM: round(d.walls.reduce((s, w) => s + dist(w.a, w.b), 0), 2),
    rooms,
    lotSurfacesValidated,
    counts,
  };
}

/** Ne garde que les éléments validés (base de la reconstruction 3D). */
export function validatedOnly(d: Drawing): Drawing {
  const walls = d.walls.filter((w) => w.provenance === 'validated');
  const ids = new Set(walls.map((w) => w.id));
  return {
    ...d,
    walls,
    rooms: d.rooms.filter((r) => r.provenance === 'validated'),
    openings: d.openings.filter((o) => o.provenance === 'validated' && ids.has(o.wallId)),
  };
}

/** Mise à l'échelle de tous les éléments (recalibration après tracé). */
export function scaleDrawing(d: Drawing, factor: number): Drawing {
  const s = (p: [number, number]): [number, number] => [p[0] * factor, p[1] * factor];
  return {
    ...d,
    walls: d.walls.map((w) => ({ ...w, a: s(w.a), b: s(w.b) })),
    rooms: d.rooms.map((r) => ({ ...r, points: r.points.map(s) })),
    openings: d.openings.map((o) => ({ ...o, offset: o.offset * factor, width: o.width * factor })),
  };
}
