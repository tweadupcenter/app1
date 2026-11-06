import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, asUser, HttpError } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { UserError } from '@/lib/errors';
import { storage, newStorageKey, sha256, detectFileType, MIME, UPLOAD_LIMITS } from '@/lib/storage';
import { imageSize } from '@immo/core/storage';

export const runtime = 'nodejs';

const PURPOSES = {
  plan: { types: ['pdf', 'png', 'jpg', 'dxf'], limit: UPLOAD_LIMITS.plan, kind: 'plan_source', action: 'manageProject' },
  model: { types: ['glb'], limit: UPLOAD_LIMITS.model, kind: 'model', action: 'manageProject' },
  lot_image: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'manageProject' },
  lot_plan: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'manageProject' },
  gallery: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'sell' },
  capture: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'capture', action: 'sell' },
  audio: { types: ['mp3', 'wav'], limit: UPLOAD_LIMITS.audio, kind: 'audio', action: 'sell' },
  logo: { types: ['png', 'jpg'], limit: 2 * 1024 * 1024, kind: 'logo', action: 'manageOrg' },
} as const;

const UNSUPPORTED: Record<string, string> = {
  dwg: 'Le format DWG n’est pas converti : aucun convertisseur compatible (ODA File Converter / LibreDWG) n’est installé. Exportez le plan en DXF ou PDF.',
  rvt: 'Le format RVT (Revit) n’est pas converti : exportez la maquette en GLB/glTF depuis Revit (ou via un outil tiers) ou le plan en PDF/DXF.',
  skp: 'Le format SKP (SketchUp) n’est pas converti : exportez la maquette en GLB depuis SketchUp.',
  ifc: 'Le format IFC n’est pas converti dans cette version : exportez la maquette en GLB (ex. via Blender + BlenderBIM) ou le plan en PDF/DXF.',
};

export async function POST(req: Request) {
  try {
    await assertSameOrigin(req);
    const form = await req.formData();
    const purpose = z.enum(Object.keys(PURPOSES) as [keyof typeof PURPOSES]).parse(form.get('purpose'));
    const cfg = PURPOSES[purpose];
    const file = form.get('file');
    if (!(file instanceof File)) throw new UserError('Fichier manquant.');
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (UNSUPPORTED[ext]) throw new UserError(UNSUPPORTED[ext]);
    if (file.size > cfg.limit) throw new UserError(`Fichier trop volumineux (${(file.size / 1048576).toFixed(1)} Mo > ${(cfg.limit / 1048576).toFixed(0)} Mo).`);
    if (file.size === 0) throw new UserError('Fichier vide.');
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = detectFileType(buf, file.name);
    if (type === 'dwg') throw new UserError(UNSUPPORTED.dwg);
    if (!(cfg.types as readonly string[]).includes(type)) {
      throw new UserError(`Type de fichier non accepté pour cet usage (détecté : ${type === 'unknown' ? 'inconnu' : type}). Formats acceptés : ${cfg.types.join(', ').toUpperCase()}.`);
    }
    const projectId = form.get('project_id') ? z.string().uuid().parse(form.get('project_id')) : null;
    const lotId = form.get('lot_id') ? z.string().uuid().parse(form.get('lot_id')) : null;
    const publishable = form.get('publishable') === 'true';
    const dims = type === 'png' || type === 'jpg' ? imageSize(buf) : null;

    const result = await asUser(async (x, s) => {
      if (projectId && !(await x.query('select 1 from immo.projects where id=$1', [projectId])).rowCount) throw new HttpError(404, 'Projet introuvable.');
      const key = newStorageKey(s.orgId, type === 'jpg' ? 'jpg' : type);
      await storage().put(key, buf);
      const media = (await x.query(
        `insert into immo.media (org_id, project_id, lot_id, kind, storage_key, mime, size_bytes, original_name, sha256, width, height, meta, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [s.orgId, projectId, lotId, cfg.kind, key, MIME[type], buf.byteLength, file.name.slice(0, 200), sha256(buf), dims?.width ?? null, dims?.height ?? null,
          { publishable, purpose }, s.userId])).rows[0].id as string;
      const out: Record<string, unknown> = { mediaId: media };
      if (purpose === 'plan') {
        if (!projectId) throw new UserError('Projet requis.');
        const sourceType = type === 'pdf' ? 'pdf' : type === 'dxf' ? 'dxf' : 'image';
        const plan = (await x.query(`insert into immo.plans (org_id, project_id, building_id, name, source_media_id, source_type, status, created_by) values ($1,$2,$3,$4,$5,$6,'processing',$7) returning id`,
          [s.orgId, projectId, form.get('building_id') || null, String(form.get('name') || file.name).slice(0, 120), media, sourceType, s.userId])).rows[0].id;
        const job = (await x.query(`insert into immo.jobs (org_id, type, payload, created_by) values ($1,$2,$3,$4) returning id`,
          [s.orgId, sourceType === 'dxf' ? 'dxf_import' : 'plan_rasterize', { plan_id: plan }, s.userId])).rows[0].id;
        Object.assign(out, { planId: plan, jobId: job });
      } else if (purpose === 'model') {
        if (!projectId) throw new UserError('Projet requis.');
        let modelId = form.get('model_id') ? String(form.get('model_id')) : null;
        if (!modelId) modelId = (await x.query(`insert into immo.models (org_id, project_id, name, source) values ($1,$2,$3,'imported') returning id`,
          [s.orgId, projectId, String(form.get('name') || file.name).slice(0, 120)])).rows[0].id;
        const v = (await x.query(`select coalesce(max(version),0)+1 v from immo.model_revisions where model_id=$1`, [modelId])).rows[0].v;
        const rev = (await x.query(`insert into immo.model_revisions (org_id, model_id, version, media_id, status, created_by) values ($1,$2,$3,$4,'processing',$5) returning id`,
          [s.orgId, modelId, v, media, s.userId])).rows[0].id;
        const job = (await x.query(`insert into immo.jobs (org_id, type, payload, created_by) values ($1,'model_inspect',$2,$3) returning id`, [s.orgId, { revision_id: rev }, s.userId])).rows[0].id;
        Object.assign(out, { modelId, revisionId: rev, jobId: job });
      } else if (purpose === 'lot_image' || purpose === 'lot_plan') {
        if (!lotId) throw new UserError('Lot requis.');
        const r = purpose === 'lot_plan'
          ? await x.query(`update immo.lots set plan_media_id=$2 where id=$1`, [lotId, media])
          : await x.query(`update immo.lots set image_media_ids = array_append(image_media_ids, $2) where id=$1`, [lotId, media]);
        if (!r.rowCount) throw new HttpError(403, 'Autorisation insuffisante sur ce lot.');
      } else if (purpose === 'logo') {
        await x.query(`update immo.organizations set branding = branding || jsonb_build_object('logo_media_id', $2::text) where id=$1`, [s.orgId, media]);
      }
      return out;
    }, cfg.action);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
