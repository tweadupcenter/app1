'use client';
import { bbox, worldToPlan, type CameraPose, type Vec2 } from '@immo/core';
import type { SceneData } from '@/lib/scene-types';

const AMENITY_FILL: Record<string, string> = { pool: '#5bb8e3', garden: '#8bbf5f', sport: '#3e8f7d', parking: '#8a8d90', playground: '#e3b35b', other: '#c9c0ad' };

/** Mini-plan : emprises (repère plan) + position et direction de la caméra. */
export function Minimap({ data, pose, selectedBuilding, onBuilding }: { data: SceneData; pose: CameraPose | null; selectedBuilding: string | null; onBuilding: (id: string) => void }) {
  const all = [...data.buildings.flatMap((b) => (b.footprint as Vec2[]) ?? []), ...data.amenities.flatMap((a) => (a.footprint as Vec2[]) ?? [])];
  if (!all.length) return <div className="small muted" style={{ padding: 6 }}>Mini-plan indisponible (emprises non renseignées)</div>;
  const b = bbox(all);
  const pad = 6;
  const vb = `${b.minX - pad} ${-(b.maxY + pad)} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const P = (p: Vec2) => `${p[0]},${-p[1]}`;
  const cam = pose ? worldToPlan(pose.position) : null;
  const tgt = pose ? worldToPlan(pose.target) : null;
  return (
    <svg viewBox={vb} width={180} height={140} role="img" aria-label="Mini-plan du projet" data-testid="minimap">
      <rect x={b.minX - pad} y={-(b.maxY + pad)} width={b.maxX - b.minX + 2 * pad} height={b.maxY - b.minY + 2 * pad} fill="#f3efe6" />
      {data.amenities.map((a) => a.footprint && <polygon key={a.id} points={(a.footprint as Vec2[]).map(P).join(' ')} fill={AMENITY_FILL[a.kind] ?? '#ccc'}><title>{a.name}</title></polygon>)}
      {data.buildings.map((bd) => bd.footprint && (
        <g key={bd.id} onClick={() => onBuilding(bd.id)} style={{ cursor: 'pointer' }}>
          <polygon points={(bd.footprint as Vec2[]).map(P).join(' ')} fill={selectedBuilding === bd.id ? '#1f4e5f' : '#9aa5ab'} />
          {(() => { const fp = bd.footprint as Vec2[]; const c = [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length]; return <text x={c[0]} y={-c[1] + 2} fontSize={6} textAnchor="middle" fill="#fff">{bd.code}</text>; })()}
        </g>
      ))}
      {cam && tgt && <g>
        <line x1={cam[0]} y1={-cam[1]} x2={tgt[0]} y2={-tgt[1]} stroke="#c0392b" strokeWidth={0.8} strokeDasharray="2 1" />
        <circle cx={Math.max(b.minX - pad + 2, Math.min(b.maxX + pad - 2, cam[0]))} cy={-Math.max(b.minY - pad + 2, Math.min(b.maxY + pad - 2, cam[1]))} r={2.5} fill="#c0392b" />
      </g>}
    </svg>
  );
}
