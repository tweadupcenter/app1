// Données de scène communes à la visite interne (version de travail), publique (instantané) et au rendu vidéo.
export interface SceneLot {
  id: string; reference: string; building_id: string | null; floor_id: string | null; type: string;
  rooms: number | null; bedrooms: number | null; surface_comm_m2: number | null; surface_terrace_m2: number | null; surface_garden_m2: number | null;
  orientation: string | null; price: number | null; price_public: boolean; features: string[]; description?: string | null;
  status: string; footprint: [number, number][] | null; plan_media_id: string | null; image_media_ids: string[];
}
export interface SceneViewpoint {
  id: string; label: string; kind: string; amenity_id: string | null; building_id: string | null; lot_id: string | null;
  position: [number, number, number]; target: [number, number, number]; fov: number; sort_order: number; show_in_nav: boolean;
}
export interface SceneData {
  mode: 'internal' | 'public' | 'render';
  project: { id: string; name: string; slug: string; is_fictional: boolean; description?: string | null };
  buildings: { id: string; code: string; name: string; footprint: [number, number][] | null }[];
  floors: { id: string; building_id: string; level: number; name: string; elevation_m: number; height_m: number }[];
  lots: SceneLot[];
  amenities: { id: string; kind: string; name: string; footprint: [number, number][] | null }[];
  viewpoints: SceneViewpoint[];
  tours: { id: string; name: string; shots: { viewpoint_id: string; duration_s: number; transition: 'cut' | 'fade' | 'move' }[] }[];
  model: { url: string; bindings: { node_name: string; target_type: 'building' | 'floor' | 'lot' | 'amenity'; target_id: string }[] } | null;
  /** préfixe des URL de fichiers : /api/files/ (interne) ou /api/public/<slug>/files/ */
  fileBase: string;
  planImages: { id: string; label: string }[];
  gallery: { id: string; kind: string }[];
  contact?: { phone?: string | null; email?: string | null; whatsapp?: string | null; orgName?: string };
}
