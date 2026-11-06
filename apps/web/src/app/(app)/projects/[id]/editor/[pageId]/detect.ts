// Détection locale (navigateur) des traits épais horizontaux et verticaux d'un plan raster.
// Assistance facultative : les murs produits sont "proposés" et doivent être validés.
import type { Wall } from '@immo/core';
import { effectiveCrop, uvToWorld, type PageGeom } from '@/lib/plan-transform';

interface Band { a: number; b: number; s: number; e: number; last: number }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image du plan illisible')); i.src = url; });
}

export async function detectWallsFromImage(url: string, g: PageGeom, opts: { minLengthM: number; thicknessDefault: number; height: number }): Promise<Wall[]> {
  if (!g.scale) throw new Error('Calibrez la page avant la détection (échelle nécessaire).');
  const img = await loadImage(url);
  const c = effectiveCrop(g);
  const f = Math.min(1, 1600 / Math.max(c.w, c.h));
  const cw = Math.round(c.w * f), ch = Math.round(c.h * f);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.scale(f, f); ctx.translate(-c.x, -c.y);
  const W = g.width, H = g.height;
  if (g.rotation === 90) ctx.transform(0, 1, -1, 0, H, 0);
  if (g.rotation === 180) ctx.transform(-1, 0, 0, -1, W, H);
  if (g.rotation === 270) ctx.transform(0, -1, 1, 0, 0, W);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const dark = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) dark[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2] < 110 ? 1 : 0;
  const pxm = g.scale / f; // mètres par pixel du canevas
  const minRun = Math.max(8, Math.round(opts.minLengthM / pxm));
  const minT = Math.max(2, Math.round(0.07 / pxm)), maxT = Math.round(0.6 / pxm);
  const walls: Wall[] = [];

  const scan = (horizontal: boolean) => {
    const N = horizontal ? ch : cw, M = horizontal ? cw : ch;
    let active: Band[] = [];
    const done: Band[] = [];
    for (let r = 0; r < N; r++) {
      const runs: [number, number][] = [];
      let start = -1;
      for (let k = 0; k <= M; k++) {
        const v = k < M ? dark[horizontal ? r * cw + k : k * cw + r] : 0;
        if (v && start < 0) start = k;
        if (!v && start >= 0) { if (k - start >= minRun) runs.push([start, k - 1]); start = -1; }
      }
      const next: Band[] = [];
      for (const [a, b] of runs) {
        const band = active.find((x) => x.last === r - 1 && Math.min(b, x.b) - Math.max(a, x.a) > 0.8 * Math.min(b - a, x.b - x.a));
        if (band) { band.a = Math.max(band.a, a); band.b = Math.min(band.b, b); band.e = r; band.last = r; next.push(band); active = active.filter((x) => x !== band); }
        else next.push({ a, b, s: r, e: r, last: r });
      }
      done.push(...active);
      active = next;
    }
    done.push(...active);
    for (const bd of done) {
      const t = bd.e - bd.s + 1;
      if (t < minT || t > maxT || bd.b - bd.a < minRun) continue;
      const mid = (bd.s + bd.e) / 2;
      const p1 = horizontal ? [bd.a, mid] : [mid, bd.a];
      const p2 = horizontal ? [bd.b, mid] : [mid, bd.b];
      const A = uvToWorld(g, c.x + p1[0] / f, c.y + p1[1] / f), B = uvToWorld(g, c.x + p2[0] / f, c.y + p2[1] / f);
      walls.push({ id: `det${walls.length + 1}${Math.random().toString(36).slice(2, 6)}`, a: [Number(A[0].toFixed(3)), Number(A[1].toFixed(3))], b: [Number(B[0].toFixed(3)), Number(B[1].toFixed(3))],
        thickness: Number(Math.max(0.05, t * pxm).toFixed(3)), height: opts.height, provenance: 'proposed' });
    }
  };
  scan(true); scan(false);
  return walls.slice(0, 300);
}
