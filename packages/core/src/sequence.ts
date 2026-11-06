// Chronologie des parcours caméra et des vidéos (partagée : aperçu navigateur, rendu worker).
import type { CameraPose } from './domain';

export interface Shot { viewpoint_id: string; duration_s: number; transition: 'cut' | 'fade' | 'move' }
export type PoseLookup = (viewpointId: string) => CameraPose | undefined;

export const totalDuration = (shots: Shot[]) => shots.reduce((s, x) => s + Math.max(0, x.duration_s), 0);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function interpolatePose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const e = easeInOut(Math.min(1, Math.max(0, t)));
  return { position: lerp3(a.position, b.position, e), target: lerp3(a.target, b.target, e), fov: lerp(a.fov, b.fov, e) };
}

/** Léger travelling avant pendant le maintien d'un plan (donne du mouvement sans changer le cadrage). */
function dolly(p: CameraPose, amount: number): CameraPose {
  return { ...p, position: lerp3(p.position, p.target, amount) };
}

export interface FrameState { pose: CameraPose; fade: number; shotIndex: number }

/**
 * État caméra à l'instant t (secondes).
 * - move : la caméra se déplace depuis le plan précédent pendant min(2 s, 60 % du plan) puis avance légèrement.
 * - cut : changement instantané.
 * - fade : fondu au noir de 0,4 s autour du changement.
 */
export function frameAt(shots: Shot[], lookup: PoseLookup, t: number): FrameState | null {
  const valid = shots.filter((s) => lookup(s.viewpoint_id) && s.duration_s > 0);
  if (!valid.length) return null;
  let start = 0;
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    const end = start + s.duration_s;
    if (t < end || i === valid.length - 1) {
      const local = Math.min(Math.max(0, t - start), s.duration_s);
      const pose = lookup(s.viewpoint_id)!;
      const prev = i > 0 ? lookup(valid[i - 1].viewpoint_id)! : null;
      let fade = 0;
      if (s.transition === 'fade' && i > 0 && local < 0.4) fade = 1 - local / 0.4;
      const next = valid[i + 1];
      if (next?.transition === 'fade' && s.duration_s - local < 0.4) fade = Math.max(fade, 1 - (s.duration_s - local) / 0.4);
      if (s.transition === 'move' && prev) {
        const moveT = Math.min(2, s.duration_s * 0.6);
        if (local < moveT) return { pose: interpolatePose(prev, pose, local / moveT), fade, shotIndex: i };
        const hold = (local - moveT) / Math.max(0.001, s.duration_s - moveT);
        return { pose: dolly(pose, 0.06 * hold), fade, shotIndex: i };
      }
      return { pose: dolly(pose, 0.06 * (local / s.duration_s)), fade, shotIndex: i };
    }
    start = end;
  }
  return null;
}

export const RESOLUTIONS: Record<string, Record<'16:9' | '9:16', [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920] },
  '2160p': { '16:9': [3840, 2160], '9:16': [2160, 3840] },
};
