// Contrat commun Web / Unreal : mêmes identifiants (projet, bâtiment, étage, lot, point de vue).
// Le mode Unreal communique via le canal de données de Pixel Streaming (messages JSON).
import type { CameraPose } from './domain';

/** Messages envoyés au moteur (navigateur -> Unreal). */
export type ToEngine =
  | { type: 'immo.loadProject'; projectId: string; revision?: string }
  | { type: 'immo.gotoViewpoint'; viewpointId: string; pose: CameraPose; durationMs: number }
  | { type: 'immo.selectLot'; lotId: string | null }
  | { type: 'immo.selectBuilding'; buildingId: string | null }
  | { type: 'immo.isolateFloor'; buildingId: string; floorId: string | null }
  | { type: 'immo.setLotStatuses'; statuses: Record<string, string> }
  | { type: 'immo.section'; heightM: number | null }
  | { type: 'immo.capture'; width: number; height: number };

/** Messages reçus du moteur (Unreal -> navigateur). */
export type FromEngine =
  | { type: 'immo.ready'; projectId: string; engineVersion: string }
  | { type: 'immo.lotClicked'; lotId: string }
  | { type: 'immo.buildingClicked'; buildingId: string }
  | { type: 'immo.cameraChanged'; pose: CameraPose }
  | { type: 'immo.captureReady'; url: string }
  | { type: 'immo.error'; message: string };

export function isFromEngine(v: unknown): v is FromEngine {
  return !!v && typeof v === 'object' && typeof (v as any).type === 'string' && (v as any).type.startsWith('immo.');
}

export interface UnrealConfig {
  signallingUrl?: string;
  /** Liste de ce qui manque pour rendre le mode opérationnel. */
  missing: string[];
}

export function unrealConfigFromEnv(env: Record<string, string | undefined>): UnrealConfig {
  const missing: string[] = [];
  const signallingUrl = env.UNREAL_SIGNALLING_URL || undefined;
  if (!signallingUrl) missing.push('UNREAL_SIGNALLING_URL : URL WebSocket du serveur de signalisation Pixel Streaming (Wilbur / Signalling Web Server).');
  if (!env.UNREAL_PROJECT_PACKAGED) missing.push('Projet Unreal Engine 5.x empaqueté avec le plugin Pixel Streaming et le Blueprint « ImmoBridge » (voir docs/UNREAL.md).');
  if (!env.UNREAL_GPU_HOST) missing.push('Machine de rendu avec GPU NVIDIA/AMD compatible et encodeur matériel (aucune n\'est disponible dans cet environnement).');
  return { signallingUrl, missing };
}
