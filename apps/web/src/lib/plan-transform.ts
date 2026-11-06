// Transformations image de plan : rotation (multiple de 90°), recadrage, échelle.
// Repère "pixels pivotés" (u,v) : image après rotation. Repère monde : mètres, y vers le haut.
export interface PageGeom { width: number; height: number; rotation: 0 | 90 | 180 | 270; crop: { x: number; y: number; w: number; h: number } | null; scale: number | null }

export function rotatedSize(w: number, h: number, rot: number) {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Matrice SVG (a b c d e f) : pixels source -> pixels pivotés. */
export function rotationMatrix(w: number, h: number, rot: number): string {
  switch (rot) {
    case 90: return `matrix(0 1 -1 0 ${h} 0)`;
    case 180: return `matrix(-1 0 0 -1 ${w} ${h})`;
    case 270: return `matrix(0 -1 1 0 0 ${w})`;
    default: return 'matrix(1 0 0 1 0 0)';
  }
}

export function effectiveCrop(g: PageGeom) {
  const r = rotatedSize(g.width, g.height, g.rotation);
  return g.crop ?? { x: 0, y: 0, w: r.w, h: r.h };
}

/** Pixels pivotés -> mètres. */
export function uvToWorld(g: PageGeom, u: number, v: number): [number, number] {
  const c = effectiveCrop(g), s = g.scale ?? 0.01;
  return [(u - c.x) * s, (c.y + c.h - v) * s];
}
export function worldToUv(g: PageGeom, x: number, y: number): [number, number] {
  const c = effectiveCrop(g), s = g.scale ?? 0.01;
  return [x / s + c.x, c.y + c.h - y / s];
}
