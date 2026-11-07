'use client';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { round, validatedOnly, type Drawing } from '@immo/core';
import { buildFromDrawing, measureWalls } from '@immo/core/build3d';
import { objectToGlb } from '@immo/core/glb';
import Link from 'next/link';
import { effectiveCrop, type PageGeom } from '@/lib/plan-transform';
import { autoBindGenerated } from '../../models/actions';
import { usePlanTexture } from '@/components/visit/planTexture';

interface Props {
  drawing: Drawing; dirty: boolean; geom: PageGeom; projectId: string; canEdit: boolean; generatedModelId: string | null;
  page: { id: string; imageUrl: string | null; label: string; calibrated: boolean };
  floor: { elevation: number; height: number; label: string } | null;
}

function Fit({ box, ortho }: { box: THREE.Box3; ortho: boolean }) {
  const { camera, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    if (ortho) {
      const cam = camera as THREE.OrthographicCamera;
      cam.position.set(c.x, c.y + 100, c.z + 0.001); cam.up.set(0, 0, -1);
      cam.zoom = Math.min(size.width / (s.x * 1.15 || 10), size.height / (s.z * 1.15 || 10)); cam.updateProjectionMatrix();
    } else {
      const d = Math.max(s.x, s.z, 5) * 1.3;
      camera.up.set(0, 1, 0);
      camera.position.set(c.x + d * 0.6, c.y + d * 0.7, c.z + d * 0.9);
    }
    camera.lookAt(c);
    // les contrôles orbitaux doivent viser le centre du modèle (sinon ils ramènent la vue sur l'origine)
    if (controls) { controls.target.copy(c); controls.update(); }
  }, [box, ortho, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function Preview3D(p: Props) {
  const [ortho, setOrtho] = useState(false);
  const [includeAll, setIncludeAll] = useState(false);
  const [planOpacity, setPlanOpacity] = useState(0.6);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const elevation = p.floor?.elevation ?? 0;
  const group = useMemo(() => buildFromDrawing(p.drawing, { elevation, levelKey: p.floor?.label ?? 'page', includeUnvalidated: includeAll }), [p.drawing, includeAll, elevation, p.floor?.label]);
  const box = useMemo(() => { const b = new THREE.Box3().setFromObject(group); if (b.isEmpty()) b.set(new THREE.Vector3(0, 0, -10), new THREE.Vector3(10, 3, 0)); return b; }, [group]);
  const checks = useMemo(() => measureWalls(buildFromDrawing(p.drawing, { elevation, levelKey: 'chk' }), validatedOnly(p.drawing)), [p.drawing, elevation]);
  const tex = usePlanTexture(p.page.imageUrl, p.geom);
  const c = p.page.imageUrl ? effectiveCrop(p.geom) : null;
  const s = p.geom.scale ?? 0.01;
  const pw = c ? c.w * s : 0, ph = c ? c.h * s : 0;
  const validatedCount = validatedOnly(p.drawing).walls.length + validatedOnly(p.drawing).rooms.length;

  async function generate() {
    if (p.dirty) { setMsg({ ok: false, text: 'Enregistrez le tracé avant de générer la maquette (la maquette doit correspondre à une version enregistrée).' }); return; }
    if (!validatedCount) { setMsg({ ok: false, text: 'Aucun élément validé : la maquette se construit uniquement à partir des éléments validés.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const g = buildFromDrawing(p.drawing, { elevation, levelKey: p.floor?.label ?? 'page' });
      const root = new THREE.Group(); root.name = `reconstruction_${p.page.id.slice(0, 8)}`; root.add(g);
      root.userData = { generatedFrom: p.page.id, note: 'Reconstruction simple à partir des éléments validés — non photoréaliste' };
      const glb = objectToGlb(root, { generator: 'Tweadup Immo 360 — reconstruction' });
      const fd = new FormData();
      fd.set('purpose', 'model'); fd.set('project_id', p.projectId); fd.set('name', `Reconstruction — ${p.page.label}`);
      if (p.generatedModelId) fd.set('model_id', p.generatedModelId);
      fd.set('file', new File([glb], `reconstruction-${p.page.id.slice(0, 8)}.glb`, { type: 'model/gltf-binary' }));
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const bindings = p.drawing.rooms.filter((x) => x.provenance === 'validated' && x.lotId).map((x) => ({ node: `room_${x.id}`, type: 'lot' as const, id: x.lotId! }));
      const b = await autoBindGenerated(j.revisionId, bindings);
      if (!b.ok) throw new Error(b.error);
      setMsg({ ok: true, text: `Maquette générée (${(glb.byteLength / 1024).toFixed(0)} Ko), ${bindings.length} pièce(s) associée(s) à des lots. Inspection en cours par le worker.`, link: `/projects/${p.projectId}/models` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <div className="grid grid-side">
      <div className="viewer" style={{ height: 520 }} data-testid="preview3d">
        <Canvas shadows={false} gl={{ preserveDrawingBuffer: true }}>
          {ortho ? <OrthographicCamera makeDefault near={0.1} far={1000} /> : <PerspectiveCamera makeDefault fov={45} near={0.1} far={2000} />}
          <Fit box={box} ortho={ortho} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[30, 50, 20]} intensity={1.6} />
          <hemisphereLight args={['#dfeaf2', '#b9a88a', 0.5]} />
          <primitive object={group} />
          {tex && ortho && <mesh rotation-x={-Math.PI / 2} position={[pw / 2, elevation - 0.02, -ph / 2]}>
            <planeGeometry args={[pw, ph]} /><meshBasicMaterial map={tex} transparent opacity={planOpacity} depthWrite={false} />
          </mesh>}
          <gridHelper args={[100, 100, '#9aa5ab', '#d5dadc']} position={[0, elevation - 0.03, 0]} />
          <OrbitControls enableRotate={!ortho} makeDefault />
        </Canvas>
        <div className="vpanel tools" style={{ top: 10 }}>
          <button className={`btn btn-sm ${!ortho ? 'on' : ''}`} onClick={() => setOrtho(false)}>Perspective</button>
          <button className={`btn btn-sm ${ortho ? 'on' : ''}`} onClick={() => setOrtho(true)} data-testid="ortho">Comparaison orthographique</button>
          {ortho && p.page.imageUrl && <label className="field"><span>Opacité du plan</span><input type="range" min={0} max={1} step={0.05} value={planOpacity} onChange={(e) => setPlanOpacity(Number(e.target.value))} /></label>}
          <label className="check small"><input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} /> <span>Inclure les éléments non validés (aperçu)</span></label>
        </div>
        <div className="vbadge">Géométrie simplifiée (volumes) — non photoréaliste</div>
      </div>
      <aside className="card stack">
        <h2>Contrôle dimensionnel</h2>
        <p className="small muted" style={{ margin: 0 }}>Longueur de chaque mur validé mesurée sur la géométrie 3D générée, comparée à la cote du tracé.</p>
        {checks.length === 0 ? <div className="empty">Aucun mur validé.</div> : (
          <div className="table-wrap" style={{ maxHeight: 220 }}><table className="table small" data-testid="dim-checks"><thead><tr><th>Mur</th><th className="right">Tracé</th><th className="right">3D</th><th className="right">Écart</th></tr></thead><tbody>
            {checks.map((x) => <tr key={x.id}><td>{x.id}</td><td className="right">{round(x.expected, 3)}</td><td className="right">{round(x.measured, 3)}</td>
              <td className="right" style={{ color: Math.abs(x.delta) < 0.005 ? 'var(--c-success)' : 'var(--c-danger)' }} data-ok={Math.abs(x.delta) < 0.005}>{(x.delta * 1000).toFixed(1)} mm</td></tr>)}
          </tbody></table></div>
        )}
        {!p.page.calibrated && p.page.imageUrl && <div className="alert alert-warning small">Plan non calibré : les cotes de référence elles-mêmes sont estimées.</div>}
        <h2>Maquette</h2>
        <p className="small muted" style={{ margin: 0 }}>Génère un GLB à partir des seuls éléments validés (altitude du niveau : {elevation} m), l’enregistre comme nouvelle révision et associe les pièces aux lots.</p>
        <button className="btn btn-primary" onClick={generate} disabled={!p.canEdit || busy} data-testid="generate-model">{busy ? 'Génération…' : 'Générer la maquette 3D'}</button>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text} {msg.link && <Link href={msg.link}>Voir les maquettes</Link>}</div>}
      </aside>
    </div>
  );
}
