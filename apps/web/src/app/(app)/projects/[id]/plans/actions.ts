'use server';
import { z } from 'zod';
import { drawingSchema, drawingStats, scaleDrawing } from '@immo/core';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const vec = z.tuple([z.number().finite(), z.number().finite()]);
const setupSchema = z.object({
  pageId: z.string().uuid(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  crop: z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() }).nullable(),
  calibration: z.object({ p1: vec, p2: vec, known_m: z.number().positive().max(10000) }).nullable(),
  floorId: z.string().uuid().nullable(),
  levelLabel: z.string().max(60).nullable(),
  floorHeight: z.number().min(2).max(12),
  rescaleDrawing: z.boolean().default(true),
});

/** Enregistre orientation, recadrage, calibration et niveau d'une page. */
export async function savePageSetup(input: z.input<typeof setupSchema>) {
  return action(async () => {
    const v = setupSchema.parse(input);
    let scale: number | null = null;
    if (v.calibration) {
      const d = Math.hypot(v.calibration.p2[0] - v.calibration.p1[0], v.calibration.p2[1] - v.calibration.p1[1]);
      if (d < 10) throw new UserError('Points de calibration trop proches (10 px minimum).');
      scale = v.calibration.known_m / d;
    }
    return asUser(async (x, s) => {
      const prev = (await x.query(`select scale_m_per_px from immo.plan_pages where id=$1`, [v.pageId])).rows[0];
      if (!prev) throw new UserError('Page introuvable.');
      await x.query(`update immo.plan_pages set rotation=$2, crop=$3, calibration=case when $4::jsonb is null and calibration->>'source'='dxf' then calibration else $4::jsonb end, scale_m_per_px=coalesce($5, scale_m_per_px), floor_id=$6, level_label=$7, floor_height_m=$8, selected=true where id=$1`,
        [v.pageId, v.rotation, v.crop, v.calibration ? JSON.stringify(v.calibration) : null, scale, v.floorId, v.levelLabel, v.floorHeight]);
      // Recalibration : les tracés existants sont remis à l'échelle (nouvelle version).
      let rescaled = false;
      if (scale && prev.scale_m_per_px && v.rescaleDrawing && Math.abs(scale / prev.scale_m_per_px - 1) > 1e-6) {
        const last = (await x.query(`select version, data from immo.plan_drawings where plan_page_id=$1 order by version desc limit 1`, [v.pageId])).rows[0];
        if (last) {
          const data = scaleDrawing(drawingSchema.parse(last.data), scale / prev.scale_m_per_px);
          await x.query(`insert into immo.plan_drawings (org_id, plan_page_id, version, data, note, created_by) values ($1,$2,$3,$4,$5,$6)`,
            [s.orgId, v.pageId, last.version + 1, data, `Remise à l’échelle après recalibration (×${(scale / prev.scale_m_per_px).toFixed(4)})`, s.userId]);
          rescaled = true;
        }
      }
      return { scale, rescaled };
    }, 'manageProject');
  }, 'Réglages de la page enregistrés.');
}

/** Enregistre une nouvelle version du tracé (jamais d'écrasement : historique conservé). */
export async function saveDrawing(pageId: string, data: unknown, note: string, expectedVersion: number) {
  return action(async () => {
    const d = drawingSchema.parse(data);
    return asUser(async (x, s) => {
      const last = (await x.query(`select coalesce(max(version),0) v from immo.plan_drawings where plan_page_id=$1`, [pageId])).rows[0].v;
      if (last !== expectedVersion) throw new UserError(`Une version plus récente (v${last}) a été enregistrée entre-temps. Rechargez avant d’enregistrer.`);
      await x.query(`insert into immo.plan_drawings (org_id, plan_page_id, version, data, note, created_by) values ($1,$2,$3,$4,$5,$6)`,
        [s.orgId, pageId, last + 1, d, note.slice(0, 200) || null, s.userId]);
      return { version: last + 1 };
    }, 'manageProject');
  }, 'Tracé enregistré.');
}

/** Reporte les surfaces calculées (pièces validées) dans les lots. */
export async function applyCalculatedSurfaces(pageId: string) {
  return action(() => asUser(async (x) => {
    const last = (await x.query(`select data from immo.plan_drawings where plan_page_id=$1 order by version desc limit 1`, [pageId])).rows[0];
    if (!last) throw new UserError('Aucun tracé enregistré.');
    const st = drawingStats(drawingSchema.parse(last.data));
    let n = 0;
    for (const [lotId, area] of Object.entries(st.lotSurfacesValidated)) {
      const r = await x.query(`update immo.lots set surface_calc_m2=$2 where id=$1`, [lotId, area]);
      n += r.rowCount ?? 0;
    }
    if (!n) throw new UserError('Aucune pièce validée associée à un lot.');
    return { updated: n };
  }, 'manageProject'), 'Surfaces calculées reportées dans les lots.');
}

export async function deletePlan(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => { await x.query(`delete from immo.plans where id=$1`, [String(f.get('id'))]); }, 'manageProject'), 'Plan supprimé.');
}
