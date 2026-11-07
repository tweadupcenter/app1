import 'server-only';
import { z } from 'zod';
import { imageSize } from '@immo/core/storage';
import type { Tx } from './db';
import type { Session } from './auth';
import { HttpError } from './auth';
import { UserError } from './errors';
import { detectFileType, MIME, UPLOAD_LIMITS, type DetectedType } from './storage';

export const PURPOSES = {
  plan: { types: ['pdf', 'png', 'jpg', 'dxf'], limit: UPLOAD_LIMITS.plan, kind: 'plan_source', action: 'manageProject' },
  model: { types: ['glb'], limit: UPLOAD_LIMITS.model, kind: 'model', action: 'manageProject' },
  lot_image: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'manageProject' },
  lot_plan: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'manageProject' },
  gallery: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'image', action: 'sell' },
  capture: { types: ['png', 'jpg'], limit: UPLOAD_LIMITS.image, kind: 'capture', action: 'sell' },
  audio: { types: ['mp3', 'wav'], limit: UPLOAD_LIMITS.audio, kind: 'audio', action: 'sell' },
  logo: { types: ['png', 'jpg'], limit: 2 * 1024 * 1024, kind: 'logo', action: 'manageOrg' },
} as const;
export type Purpose = keyof typeof PURPOSES;
export const purposeSchema = z.enum(Object.keys(PURPOSES) as [Purpose]);

export const UNSUPPORTED: Record<string, string> = {
  dwg: 'Le format DWG n’est pas converti : aucun convertisseur compatible (ODA File Converter / LibreDWG) n’est installé. Exportez le plan en DXF ou PDF.',
  rvt: 'Le format RVT (Revit) n’est pas converti : exportez la maquette en GLB/glTF depuis Revit (ou via un outil tiers) ou le plan en PDF/DXF.',
  skp: 'Le format SKP (SketchUp) n’est pas converti : exportez la maquette en GLB depuis SketchUp.',
  ifc: 'Le format IFC n’est pas converti dans cette version : exportez la maquette en GLB (ex. via Blender + BlenderBIM) ou le plan en PDF/DXF.',
};

/** Contrôles avant réception : extension non convertible, taille. */
export function precheck(purpose: Purpose, filename: string, size: number) {
  const cfg = PURPOSES[purpose];
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (UNSUPPORTED[ext]) throw new UserError(UNSUPPORTED[ext]);
  if (size > cfg.limit) throw new UserError(`Fichier trop volumineux (${(size / 1048576).toFixed(1)} Mo > ${(cfg.limit / 1048576).toFixed(0)} Mo).`);
  if (size <= 0) throw new UserError('Fichier vide.');
  return cfg;
}

/** Type réel détecté par signature (jamais par l'extension seule). */
export function checkType(purpose: Purpose, head: Uint8Array, filename: string): DetectedType {
  const type = detectFileType(head, filename);
  if (type === 'dwg') throw new UserError(UNSUPPORTED.dwg);
  const allowed = PURPOSES[purpose].types as readonly string[];
  if (!allowed.includes(type)) throw new UserError(`Type de fichier non accepté pour cet usage (détecté : ${type === 'unknown' ? 'inconnu' : type}). Formats acceptés : ${allowed.join(', ').toUpperCase()}.`);
  return type;
}

/** Extension de stockage déduite de l'extension déclarée (le type réel est revérifié à la réception). */
export function storageExt(purpose: Purpose, filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
  return (PURPOSES[purpose].types as readonly string[]).includes(ext) ? ext : 'bin';
}

export interface UploadFields { projectId: string | null; lotId: string | null; publishable: boolean; buildingId: string | null; modelId: string | null; name: string | null }

export function parseFields(get: (k: string) => unknown): UploadFields {
  const s = (k: string) => { const v = get(k); return v == null || v === '' ? null : String(v); };
  return {
    projectId: s('project_id') ? z.string().uuid().parse(s('project_id')) : null,
    lotId: s('lot_id') ? z.string().uuid().parse(s('lot_id')) : null,
    publishable: s('publishable') === 'true',
    buildingId: s('building_id') ? z.string().uuid().parse(s('building_id')) : null,
    modelId: s('model_id') ? z.string().uuid().parse(s('model_id')) : null,
    name: s('name'),
  };
}

/** Enregistre le média et déclenche le traitement associé (plan, maquette, lot, logo). */
export async function registerUpload(x: Tx, s: Session & { orgId: string }, a: {
  purpose: Purpose; key: string; type: DetectedType; size: number; filename: string; head: Uint8Array; sha: string | null; f: UploadFields;
}) {
  const cfg = PURPOSES[a.purpose];
  const { f } = a;
  if (f.projectId && !(await x.query('select 1 from immo.projects where id=$1', [f.projectId])).rowCount) throw new HttpError(404, 'Projet introuvable.');
  const dims = a.type === 'png' || a.type === 'jpg' ? imageSize(a.head) : null;
  const media = (await x.query(
    `insert into immo.media (org_id, project_id, lot_id, kind, storage_key, mime, size_bytes, original_name, sha256, width, height, meta, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [s.orgId, f.projectId, f.lotId, cfg.kind, a.key, MIME[a.type], a.size, a.filename.slice(0, 200), a.sha, dims?.width ?? null, dims?.height ?? null,
      { publishable: f.publishable, purpose: a.purpose }, s.userId])).rows[0].id as string;
  const out: Record<string, unknown> = { mediaId: media };
  if (a.purpose === 'plan') {
    if (!f.projectId) throw new UserError('Projet requis.');
    const sourceType = a.type === 'pdf' ? 'pdf' : a.type === 'dxf' ? 'dxf' : 'image';
    const plan = (await x.query(`insert into immo.plans (org_id, project_id, building_id, name, source_media_id, source_type, status, created_by) values ($1,$2,$3,$4,$5,$6,'processing',$7) returning id`,
      [s.orgId, f.projectId, f.buildingId, (f.name || a.filename).slice(0, 120), media, sourceType, s.userId])).rows[0].id;
    const job = (await x.query(`insert into immo.jobs (org_id, type, payload, created_by) values ($1,$2,$3,$4) returning id`,
      [s.orgId, sourceType === 'dxf' ? 'dxf_import' : 'plan_rasterize', { plan_id: plan }, s.userId])).rows[0].id;
    Object.assign(out, { planId: plan, jobId: job });
  } else if (a.purpose === 'model') {
    if (!f.projectId) throw new UserError('Projet requis.');
    let modelId = f.modelId;
    if (!modelId) modelId = (await x.query(`insert into immo.models (org_id, project_id, name, source) values ($1,$2,$3,'imported') returning id`,
      [s.orgId, f.projectId, (f.name || a.filename).slice(0, 120)])).rows[0].id;
    const v = (await x.query(`select coalesce(max(version),0)+1 v from immo.model_revisions where model_id=$1`, [modelId])).rows[0].v;
    const rev = (await x.query(`insert into immo.model_revisions (org_id, model_id, version, media_id, status, created_by) values ($1,$2,$3,$4,'processing',$5) returning id`,
      [s.orgId, modelId, v, media, s.userId])).rows[0].id;
    const job = (await x.query(`insert into immo.jobs (org_id, type, payload, created_by) values ($1,'model_inspect',$2,$3) returning id`, [s.orgId, { revision_id: rev }, s.userId])).rows[0].id;
    Object.assign(out, { modelId, revisionId: rev, jobId: job });
  } else if (a.purpose === 'lot_image' || a.purpose === 'lot_plan') {
    if (!f.lotId) throw new UserError('Lot requis.');
    const r = a.purpose === 'lot_plan'
      ? await x.query(`update immo.lots set plan_media_id=$2 where id=$1`, [f.lotId, media])
      : await x.query(`update immo.lots set image_media_ids = array_append(image_media_ids, $2) where id=$1`, [f.lotId, media]);
    if (!r.rowCount) throw new HttpError(403, 'Autorisation insuffisante sur ce lot.');
  } else if (a.purpose === 'logo') {
    await x.query(`update immo.organizations set branding = branding || jsonb_build_object('logo_media_id', $2::text) where id=$1`, [s.orgId, media]);
  }
  return out;
}
