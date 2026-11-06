import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
// @ts-expect-error : dxf-parser n'a pas de types
import DxfParser from 'dxf-parser';
import { drawingSchema, type Drawing } from '@immo/core';
import { imageSize, localStorage, newStorageKey, sha256 } from '@immo/core/storage';
import { run } from './proc';
import type { JobCtx } from './index';

const MAX_PAGES = 40;

/** PDF multipages -> PNG par page (pdftoppm, 110 dpi). Image -> page unique. */
export async function rasterizePlan({ job, tx, progress, log }: JobCtx) {
  const storage = localStorage(process.env.STORAGE_DIR);
  const plan = await tx(async (t) => (await t.query(`select p.*, m.storage_key, m.mime, m.width, m.height from immo.plans p join immo.media m on m.id=p.source_media_id where p.id=$1`, [job.payload.plan_id])).rows[0]);
  if (!plan) throw new Error('Plan introuvable');
  try {
    if (plan.source_type === 'image') {
      await tx(async (t) => {
        await t.query(`insert into immo.plan_pages (org_id, plan_id, page_index, image_media_id, width_px, height_px, selected) values ($1,$2,0,$3,$4,$5,true)`,
          [plan.org_id, plan.id, plan.source_media_id, plan.width, plan.height]);
        await t.query(`update immo.plans set status='ready', page_count=1, error=null where id=$1`, [plan.id]);
      });
      return { pages: 1 };
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'immo-pdf-'));
    try {
      const src = path.join(dir, 'in.pdf');
      await writeFile(src, await storage.get(plan.storage_key));
      const info = await run(process.env.PDFINFO_PATH || 'pdfinfo', [src], { timeoutMs: 30_000, cwd: dir }).catch(() => ({ stdout: '' }));
      const total = Number(/Pages:\s+(\d+)/.exec(info.stdout)?.[1] ?? 0);
      log(`PDF : ${total || '?'} page(s)`);
      await run(process.env.PDFTOPPM_PATH || 'pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', String(MAX_PAGES), src, path.join(dir, 'p')], { timeoutMs: 300_000, cwd: dir });
      const files = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
      if (!files.length) throw new Error('Aucune page extraite du PDF');
      for (const [i, f] of files.entries()) {
        const buf = await readFile(path.join(dir, f));
        const dims = imageSize(buf);
        const key = newStorageKey(plan.org_id, 'png');
        await storage.put(key, buf);
        await tx(async (t) => {
          const m = (await t.query(`insert into immo.media (org_id, project_id, kind, storage_key, mime, size_bytes, original_name, sha256, width, height, created_by, meta)
            values ($1,$2,'plan_page',$3,'image/png',$4,$5,$6,$7,$8,$9,$10) returning id`,
            [plan.org_id, plan.project_id, key, buf.byteLength, `${plan.name} — page ${i + 1}.png`, sha256(buf), dims?.width, dims?.height, job.created_by, { source_plan: plan.id, dpi: 110 }])).rows[0].id;
          await t.query(`insert into immo.plan_pages (org_id, plan_id, page_index, image_media_id, width_px, height_px, selected) values ($1,$2,$3,$4,$5,$6,$7)`,
            [plan.org_id, plan.id, i, m, dims?.width, dims?.height, i === 0]);
        });
        await progress(((i + 1) / files.length) * 100);
      }
      const warning = total > MAX_PAGES ? `Seules les ${MAX_PAGES} premières pages ont été converties (${total} au total).` : null;
      await tx((t) => t.query(`update immo.plans set status='ready', page_count=$2, error=$3 where id=$1`, [plan.id, files.length, warning]));
      return { pages: files.length, total, warning };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    await tx((t) => t.query(`update immo.plans set status='error', error=$2 where id=$1`, [plan.id, (e as Error).message.slice(0, 500)]));
    throw e;
  }
}

// ---------------------------------------------------------------------------
// DXF — périmètre documenté : entités LINE, LWPOLYLINE, POLYLINE (2D) dans l'espace objet.
// Unités lues dans $INSUNITS. Les autres entités sont comptées et ignorées.
// Les segments importés sont des propositions de murs ("proposed") à valider dans l'éditeur.
// ---------------------------------------------------------------------------
const UNIT_TO_M: Record<number, [number, string]> = { 1: [0.0254, 'pouces'], 2: [0.3048, 'pieds'], 4: [0.001, 'mm'], 5: [0.01, 'cm'], 6: [1, 'm'] };

export function dxfToDrawing(text: string): { drawing: Drawing; report: Record<string, unknown> } {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  const insunits = Number(dxf?.header?.$INSUNITS ?? 0);
  const [factor, unitLabel] = UNIT_TO_M[insunits] ?? [1, 'non précisées (mètres supposés)'];
  const counts: Record<string, number> = {};
  const segs: [number, number, number, number, string][] = [];
  for (const e of dxf?.entities ?? []) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    const layer = String(e.layer ?? '0');
    if (e.type === 'LINE' && e.vertices?.length >= 2) {
      segs.push([e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y, layer]);
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 2) {
      const v = e.vertices;
      for (let i = 0; i < v.length - 1; i++) segs.push([v[i].x, v[i].y, v[i + 1].x, v[i + 1].y, layer]);
      if (e.shape || e.closed) segs.push([v[v.length - 1].x, v[v.length - 1].y, v[0].x, v[0].y, layer]);
    }
    if (segs.length > 20_000) throw new Error('DXF trop complexe (plus de 20 000 segments) : simplifiez les calques exportés.');
  }
  if (!segs.length) throw new Error('Aucune entité LINE/LWPOLYLINE/POLYLINE exploitable dans ce DXF.');
  const xs = segs.flatMap((s) => [s[0], s[2]]), ys = segs.flatMap((s) => [s[1], s[3]]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const walls = segs
    .map(([x1, y1, x2, y2, layer]) => ({ a: [(x1 - minX) * factor, (y1 - minY) * factor] as [number, number], b: [(x2 - minX) * factor, (y2 - minY) * factor] as [number, number], layer }))
    .filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) >= 0.05)
    .map((w, i) => ({ id: `dxf${i + 1}`, a: w.a, b: w.b, thickness: 0.2, height: 2.8, provenance: 'proposed' as const }));
  const drawing = drawingSchema.parse({ version: 1, units: 'm', walls, rooms: [], openings: [] });
  const extent = { width_m: (Math.max(...xs) - minX) * factor, height_m: (Math.max(...ys) - minY) * factor };
  const ignored = Object.fromEntries(Object.entries(counts).filter(([k]) => !['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(k)));
  return { drawing, report: { units: unitLabel, insunits, factor, segments: walls.length, entityCounts: counts, ignored, extent, layers: [...new Set(segs.map((s) => s[4]))].slice(0, 50) } };
}

export async function importDxf({ job, tx, log }: JobCtx) {
  const storage = localStorage(process.env.STORAGE_DIR);
  const plan = await tx(async (t) => (await t.query(`select p.*, m.storage_key from immo.plans p join immo.media m on m.id=p.source_media_id where p.id=$1`, [job.payload.plan_id])).rows[0]);
  if (!plan) throw new Error('Plan introuvable');
  try {
    const text = (await storage.get(plan.storage_key)).toString('latin1');
    const { drawing, report } = dxfToDrawing(text);
    log(`DXF : ${drawing.walls.length} segments, unités ${report.units}`);
    await tx(async (t) => {
      const page = (await t.query(`insert into immo.plan_pages (org_id, plan_id, page_index, selected, scale_m_per_px, calibration) values ($1,$2,0,true,1,$3) returning id`,
        [plan.org_id, plan.id, { source: 'dxf', note: 'Coordonnées DXF converties en mètres (repère du fichier).', report }])).rows[0].id;
      await t.query(`insert into immo.plan_drawings (org_id, plan_page_id, version, data, note, created_by) values ($1,$2,1,$3,$4,$5)`,
        [plan.org_id, page, drawing, `Import DXF (${drawing.walls.length} segments proposés, unités : ${report.units})`, job.created_by]);
      await t.query(`update immo.plans set status='ready', page_count=1, error=$2 where id=$1`,
        [plan.id, report.insunits ? null : 'Unités DXF non précisées : mètres supposés. Vérifiez une cote connue avant validation.']);
    });
    return { ...report, id: randomUUID() };
  } catch (e) {
    await tx((t) => t.query(`update immo.plans set status='error', error=$2 where id=$1`, [plan.id, (e as Error).message.slice(0, 500)]));
    throw e;
  }
}
