'use client';
import { Suspense, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, useGLTF, Bounds } from '@react-three/drei';
import * as THREE from 'three';
import { sanitizeNodeName } from '@immo/core/glb';
import { autoBindByName, deleteBinding, saveBinding } from '../actions';

type T = 'building' | 'floor' | 'lot' | 'amenity';
interface Props { revisionId: string; url: string; nodeNames: string[]; bindings: { node_name: string; target_type: T; target_id: string; carried: boolean }[]; targets: Record<T, { id: string; label: string }[]>; canEdit: boolean }
const LABEL: Record<T, string> = { building: 'Bâtiment', floor: 'Étage', lot: 'Lot', amenity: 'Équipement' };

function Model({ url, selected, bound, onPick }: { url: string; selected: string | null; bound: Set<string>; onPick: (name: string) => void }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => scene.clone(true), [scene]);
  useMemo(() => {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.userData.__own) { m.material = (m.material as THREE.Material).clone(); m.userData.__own = true; }
      let p: THREE.Object3D | null = m, hit: 'sel' | 'bound' | null = null;
      while (p) { if (p.name === selected) { hit = 'sel'; break; } if (!hit && bound.has(p.name)) hit = 'bound'; p = p.parent; }
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.emissive) { mat.emissive.set(hit === 'sel' ? '#f0b429' : hit === 'bound' ? '#1e7a46' : '#000000'); mat.emissiveIntensity = hit ? 0.5 : 1; }
    });
  }, [root, selected, bound]);
  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    // remonte jusqu'au premier ancêtre nommé de façon significative (groupe), sinon le maillage
    let o: THREE.Object3D | null = e.object, best = e.object.name;
    while (o && o.parent) { if (o.name && /^(lot|bld|floor|amenity|room|level)_/i.test(o.name)) { best = o.name; break; } o = o.parent; }
    onPick(best);
  };
  return <primitive object={root} onClick={pick} />;
}

export function BindingEditor(p: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [type, setType] = useState<T>('lot');
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // les noms affichés par three.js sont normalisés ; on garde la correspondance vers le nom brut
  const rawBySanitized = useMemo(() => new Map(p.nodeNames.map((n) => [sanitizeNodeName(n), n])), [p.nodeNames]);
  const bound = useMemo(() => new Set(p.bindings.map((b) => sanitizeNodeName(b.node_name))), [p.bindings]);
  const rawSelected = selected ? rawBySanitized.get(selected) ?? selected : null;
  const current = p.bindings.find((b) => b.node_name === rawSelected);
  const label = (b: { target_type: T; target_id: string }) => p.targets[b.target_type].find((x) => x.id === b.target_id)?.label ?? '⚠ cible supprimée';
  const nodes = p.nodeNames.filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase())).slice(0, 300);
  const run = async (fn: () => Promise<any>) => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? 'OK' } : { ok: false, text: r.error }); if (r.ok) router.refresh(); };

  return (
    <div className="grid grid-side">
      <div className="viewer" style={{ height: 560 }}>
        <Canvas camera={{ position: [80, 70, 90], fov: 45, near: 0.1, far: 3000 }}>
          <color attach="background" args={['#d9e6ee']} />
          <hemisphereLight args={['#eaf3fb', '#a89a7c', 0.9]} /><directionalLight position={[60, 90, 40]} intensity={2} />
          <Suspense fallback={null}><Bounds fit clip observe margin={1.1}><Model url={p.url} selected={selected} bound={bound} onPick={(n) => setSelected(n)} /></Bounds></Suspense>
          <OrbitControls makeDefault />
        </Canvas>
        <div className="vbadge">Cliquez un objet pour le sélectionner · vert : associé · jaune : sélection</div>
      </div>
      <aside className="card stack">
        <h2>Nœud sélectionné</h2>
        {rawSelected ? <><code data-testid="sel-node">{rawSelected}</code>
          {current ? <div className="small">Associé à : <b>{LABEL[current.target_type]} {label(current)}</b>{current.carried && ' (reporté de la révision précédente)'}</div> : <div className="small muted">Non associé</div>}
          {p.canEdit && <>
            <div className="row">
              <select value={type} onChange={(e) => { setType(e.target.value as T); setTarget(''); }} aria-label="Type de cible">{(Object.keys(LABEL) as T[]).map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Cible" data-testid="bind-target"><option value="">— choisir —</option>{p.targets[type].map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
            </div>
            <div className="row">
              <button className="btn btn-primary btn-sm" disabled={!target} onClick={() => run(() => saveBinding(p.revisionId, rawSelected, type, target))} data-testid="bind-save">Associer</button>
              {current && <button className="btn btn-sm btn-danger" onClick={() => run(() => deleteBinding(p.revisionId, rawSelected))}>Dissocier</button>}
            </div>
          </>}
        </> : <p className="muted small">Sélectionnez un objet dans la vue 3D ou dans la liste.</p>}
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text}</div>}
        {p.canEdit && <button className="btn btn-sm" onClick={() => run(() => autoBindByName(p.revisionId))}>Associer automatiquement par convention de nom</button>}
        <h3>Nœuds ({p.nodeNames.length})</h3>
        <input placeholder="Filtrer (ex. lot_)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div style={{ maxHeight: 300, overflow: 'auto' }} className="small">
          {nodes.map((n) => { const b = p.bindings.find((x) => x.node_name === n); return (
            <div key={n} className="row between" style={{ padding: '2px 0', background: rawSelected === n ? '#fdf3dc' : undefined, cursor: 'pointer' }} onClick={() => setSelected(sanitizeNodeName(n))}>
              <code>{n}</code>{b && <span className="tag prov-validated">{LABEL[b.target_type]} {label(b)}</span>}
            </div>); })}
        </div>
      </aside>
    </div>
  );
}
