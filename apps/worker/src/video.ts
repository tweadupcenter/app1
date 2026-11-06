// Export vidéo réel : rendu image par image de la scène three.js dans Chromium (headless),
// encodage H.264 par ffmpeg, puis vérification du fichier produit par ffprobe.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { RESOLUTIONS, totalDuration, type Shot } from '@immo/core';
import { signRenderToken } from '@immo/core/token';
import { localStorage, newStorageKey, sha256 } from '@immo/core/storage';
import { run } from './proc';
import type { JobCtx } from './index';

const MAX_SECONDS = 180;

function ffmpegEncoder(args: string[], timeoutMs: number) {
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
  const done = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffmpeg : délai dépassé')); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); reject(new Error(`ffmpeg indisponible : ${e.message}`)); });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-600)}`)); });
  });
  const write = (buf: Buffer) => new Promise<void>((resolve, reject) => {
    if (!child.stdin.write(buf)) child.stdin.once('drain', resolve); else resolve();
    child.stdin.once('error', reject);
  });
  return { write, end: () => child.stdin.end(), done };
}

export async function exportVideo({ job, tx, progress, log }: JobCtx) {
  const storage = localStorage(process.env.STORAGE_DIR);
  const seq = await tx(async (t) => (await t.query(`select * from immo.sequences where id=$1`, [job.payload.sequence_id])).rows[0]);
  if (!seq) throw new Error('Séquence introuvable');
  const resolution: string = job.payload.resolution ?? seq.resolution;
  if (resolution === '2160p' && process.env.VIDEO_ALLOW_4K !== '1') {
    throw new Error('Export 4K indisponible : le rendu est logiciel (pas de GPU) dans cet environnement. Utilisez 1080p ou activez VIDEO_ALLOW_4K=1 sur une machine équipée.');
  }
  const [w, h] = RESOLUTIONS[resolution]?.[seq.aspect as '16:9' | '9:16'] ?? [];
  if (!w) throw new Error(`Résolution inconnue : ${resolution} ${seq.aspect}`);
  const shots: Shot[] = seq.shots;
  const vps = await tx(async (t) => new Set((await t.query(`select id from immo.viewpoints where project_id=$1`, [seq.project_id])).rows.map((r) => r.id)));
  const valid = shots.filter((s) => vps.has(s.viewpoint_id) && s.duration_s > 0);
  if (!valid.length) throw new Error('Aucune séquence valide (points de vue supprimés ou durées nulles).');
  const duration = totalDuration(valid);
  if (duration > MAX_SECONDS) throw new Error(`Durée ${duration} s supérieure au maximum de ${MAX_SECONDS} s.`);
  const fps = seq.fps as number;
  const frames = Math.round(duration * fps);
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const token = signRenderToken({ seq: seq.id, user: job.created_by, org: job.org_id }, 2 * 3600);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'immo-video-'));
  const out = path.join(dir, 'out.mp4');
  log(`Rendu ${w}×${h} @${fps} i/s, ${duration} s (${frames} images)`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => log('erreur page :', e.message));
    const resp = await page.goto(`${appUrl}/render/sequence/${seq.id}?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (!resp || !resp.ok()) throw new Error(`Page de rendu inaccessible (${resp?.status() ?? 'pas de réponse'}) — l’application web doit être joignable à APP_URL.`);
    await page.waitForFunction(() => (window as any).__immoRenderReady === true || (window as any).__immoRenderError, null, { timeout: 180_000 });
    const err = await page.evaluate(() => (window as any).__immoRenderError);
    if (err) throw new Error(`Rendu impossible : ${err}`);

    let audio: string | null = null;
    if (seq.overlay?.music_media_id) {
      const m = await tx(async (t) => (await t.query(`select storage_key, mime from immo.media where id=$1 and kind='audio'`, [seq.overlay.music_media_id])).rows[0]);
      if (m) { audio = path.join(dir, m.mime === 'audio/wav' ? 'music.wav' : 'music.mp3'); await writeFile(audio, await storage.get(m.storage_key)); }
    }
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
    if (audio) args.push('-i', audio);
    args.push('-map', '0:v');
    if (audio) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-af', `afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`);
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-r', String(fps), '-t', String(duration), '-movflags', '+faststart', out);
    const enc = ffmpegEncoder(args, 60 * 60_000);
    for (let i = 0; i < frames; i++) {
      const ok = await page.evaluate((t) => (window as any).__immoRenderFrame(t), i / fps);
      if (!ok) throw new Error(`Image ${i} non rendue`);
      const img = await page.screenshot({ type: 'jpeg', quality: 90 });
      await enc.write(img);
      if (i % 10 === 0) await progress(5 + (i / frames) * 88);
    }
    enc.end();
    await enc.done;
  } finally {
    await browser.close();
  }

  // Vérification réelle du fichier produit
  const probe = JSON.parse((await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt:format=duration,size', '-of', 'json', out], { timeoutMs: 60_000, cwd: dir })).stdout);
  const v = probe.streams?.find((s: any) => s.codec_type === 'video');
  const realDuration = Number(probe.format?.duration);
  const problems: string[] = [];
  if (!v) problems.push('aucun flux vidéo');
  if (v && v.codec_name !== 'h264') problems.push(`codec ${v.codec_name} au lieu de h264`);
  if (v && (v.width !== w || v.height !== h)) problems.push(`dimensions ${v.width}×${v.height} au lieu de ${w}×${h}`);
  if (!(Math.abs(realDuration - duration) <= 0.25)) problems.push(`durée ${realDuration} s au lieu de ${duration} s`);
  if (problems.length) { await rm(dir, { recursive: true, force: true }); throw new Error(`Fichier produit non conforme : ${problems.join(', ')}`); }

  const buf = await readFile(out);
  const key = newStorageKey(job.org_id, 'mp4');
  await storage.put(key, buf);
  await rm(dir, { recursive: true, force: true });
  const mediaId = await tx(async (t) => (await t.query(
    `insert into immo.media (org_id, project_id, kind, storage_key, mime, size_bytes, original_name, sha256, width, height, duration_s, codec, meta, created_by)
     values ($1,$2,'video',$3,'video/mp4',$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [job.org_id, seq.project_id, key, buf.byteLength, `${seq.name.replace(/[^\w\- ]/g, '')}-${resolution}-${seq.aspect.replace(':', 'x')}.mp4`, sha256(buf), w, h, realDuration, 'h264',
      { sequence_id: seq.id, fps, frames, audio: !!seq.overlay?.music_media_id, ffprobe: probe }, job.created_by])).rows[0].id);
  log(`MP4 vérifié : ${w}×${h}, ${realDuration.toFixed(2)} s, ${(buf.byteLength / 1048576).toFixed(1)} Mo`);
  return { media_id: mediaId, width: w, height: h, duration: realDuration, codec: 'h264', size: buf.byteLength, frames };
}
