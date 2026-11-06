'use server';
import { z } from 'zod';
import { asUser } from '@/lib/auth';
import { action, UserError } from '@/lib/errors';

const shotSchema = z.object({ viewpoint_id: z.string().uuid(), duration_s: z.number().min(0.5).max(60), transition: z.enum(['cut', 'fade', 'move']) });
const seqSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(120), kind: z.enum(['video', 'tour']), aspect: z.enum(['16:9', '9:16']),
  resolution: z.enum(['720p', '1080p', '2160p']), fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  shots: z.array(shotSchema).max(60),
  overlay: z.object({ title: z.string().max(120).optional(), subtitle: z.string().max(160).optional(), logo_media_id: z.string().uuid().nullable().optional(), music_media_id: z.string().uuid().nullable().optional() }),
});

export async function createSequence(_: unknown, f: FormData) {
  return action(() => asUser(async (x, s) => {
    const r = await x.query(`insert into immo.sequences (org_id, project_id, name, kind, aspect, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [s.orgId, z.string().uuid().parse(f.get('project_id')), z.string().min(1).max(120).parse(f.get('name')), z.enum(['video', 'tour']).parse(f.get('kind')), z.enum(['16:9', '9:16']).parse(f.get('aspect') ?? '16:9'), s.userId]);
    return { id: r.rows[0].id };
  }, 'sell'), 'Séquence créée.');
}

export async function saveSequence(input: z.input<typeof seqSchema>) {
  return action(() => asUser(async (x) => {
    const v = seqSchema.parse(input);
    const total = v.shots.reduce((a, b) => a + b.duration_s, 0);
    if (total > 180) throw new UserError('Durée totale limitée à 180 s.');
    const r = await x.query(`update immo.sequences set name=$2, kind=$3, aspect=$4, resolution=$5, fps=$6, shots=$7, overlay=$8 where id=$1`,
      [v.id, v.name, v.kind, v.aspect, v.resolution, v.fps, JSON.stringify(v.shots), v.overlay]);
    if (!r.rowCount) throw new UserError('Autorisation insuffisante.');
  }, 'sell'), 'Séquence enregistrée.');
}

export async function startExport(sequenceId: string, resolution: string) {
  return action(() => asUser(async (x, s) => {
    const seq = (await x.query(`select shots from immo.sequences where id=$1`, [sequenceId])).rows[0];
    if (!seq) throw new UserError('Séquence introuvable.');
    if (!seq.shots.length) throw new UserError('Ajoutez au moins un plan avant d’exporter.');
    const running = (await x.query(`select 1 from immo.jobs where type='video_export' and status in ('queued','running') and payload->>'sequence_id'=$1`, [sequenceId])).rowCount;
    if (running) throw new UserError('Un export de cette séquence est déjà en cours.');
    const j = await x.query(`insert into immo.jobs (org_id, type, payload, created_by) values ($1,'video_export',$2,$3) returning id`,
      [s.orgId, { sequence_id: sequenceId, resolution: z.enum(['720p', '1080p', '2160p']).parse(resolution) }, s.userId]);
    return { jobId: j.rows[0].id };
  }, 'sell'), 'Export ajouté à la file de traitement.');
}

export async function setMediaPublishable(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    await x.query(`update immo.media set meta = meta || jsonb_build_object('publishable', $2::boolean) where id=$1`, [String(f.get('id')), f.get('publishable') === 'true']);
  }, 'manageProject'), 'Visibilité mise à jour (effective à la prochaine publication).');
}

export async function deleteMedia(_: unknown, f: FormData) {
  return action(() => asUser(async (x) => {
    const r = await x.query(`delete from immo.media where id=$1 and kind in ('image','capture','video','audio') returning id`, [String(f.get('id'))]);
    if (!r.rowCount) throw new UserError('Suppression impossible (fichier utilisé ou protégé).');
  }, 'manageProject'), 'Fichier supprimé.');
}
