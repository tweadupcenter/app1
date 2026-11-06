// Domaine partagé entre l'application web, le worker et les adaptateurs de rendu.
export const ROLES = ['admin', 'project_manager', 'sales', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const LOT_STATUSES = ['available', 'option', 'reserved', 'sold', 'unavailable'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_TYPES = ['studio', 'apartment', 'duplex', 'villa', 'commercial', 'office', 'parking', 'storage'] as const;
export type LotType = (typeof LOT_TYPES)[number];

export const PIPELINE_STAGES = ['new', 'contacted', 'visit_planned', 'interested', 'option', 'reserved', 'sold', 'lost'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PROSPECT_SOURCES = ['website', 'whatsapp', 'phone', 'walk_in', 'referral', 'portal', 'social', 'other'] as const;

export const AMENITY_KINDS = ['pool', 'garden', 'sport', 'parking', 'playground', 'other'] as const;
export type AmenityKind = (typeof AMENITY_KINDS)[number];

export const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

/** Degré de fiabilité d'une donnée géométrique. */
export const PROVENANCES = ['documented', 'estimated', 'proposed', 'validated'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const STATUS_COLORS: Record<LotStatus, string> = {
  available: '#2e8b57',
  option: '#e0a020',
  reserved: '#c0392b',
  sold: '#6b7280',
  unavailable: '#374151',
};

/** Rôles autorisés à écrire, miroir des politiques RLS (la base reste l'autorité). */
export const CAN = {
  manageOrg: ['admin'] as Role[],
  manageProject: ['admin', 'project_manager'] as Role[],
  sell: ['admin', 'project_manager', 'sales'] as Role[],
  read: ['admin', 'project_manager', 'sales', 'viewer'] as Role[],
};

export function can(role: Role | null | undefined, action: keyof typeof CAN): boolean {
  return !!role && CAN[action].includes(role);
}

/** Identifiants partagés par les modes Web et Unreal. */
export interface SceneTargetRef {
  projectId: string;
  buildingId?: string;
  floorId?: string;
  lotId?: string;
  amenityId?: string;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}
