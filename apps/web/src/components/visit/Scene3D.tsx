'use client';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { frameAt, interpolatePose, planToWorld, STATUS_COLORS, type CameraPose, type LotStatus, type Shot, type Vec2 } from '@immo/core';
import { sanitizeNodeName } from '@immo/core/glb';
import { createMaterials, slab } from '@immo/core/build3d';
import type { SceneData } from '@/lib/scene-types';

export interface SceneApi {
  getPose(): CameraPose;
  capture(type?: string, quality?: number): string;
  renderAt(shots: Shot[], t: number): { fade: number; shotIndex: number } | null;
}

export interface Scene3DProps {
  data: SceneData;
  statusColors: boolean;
  selectedLotId: string | null;
  hoverLabel?: boolean;
  isolate: { buildingId: string; level: number } | null;
  sectionHeight: number | null;
  flyTo: { pose: CameraPose; key: number } | null;
  tour: { shots: Shot[]; start: number } | null;
  onTourEnd?: () => void;
  onSelectLot?: (id: string | null) => void;
  onSelectBuilding?: (id: string) => void;
  onPoi?: (amenityId: string) => void;
  onCamera?: (pose: CameraPose) => void;
  onReady?: (api: SceneApi) => void;
  onError?: (e: Error) => void;
  renderMode?: boolean;
  initialPose: CameraPose;
}

type Binding = { target_type: string; target_id: string };

const ACCENT = new THREE.Color('#f0b429');

/** Maquette procédurale de secours (sans GLB) : volumes issus des emprises enregistrées. */
function buildProcedural(data: SceneData): THREE.Group {
  const mats = createMaterials();
  const g = new THREE.Group();
  g.name = 'procedural';
  g.add(slab([[-80, -80], [80, -80], [80, 80], [-80, 80]], 0, 0.2, mats.ground, 'sol'));
  const floors = new Map(data.floors.map((f) => [f.id, f]));
  for (const l of data.lots) {
    const f = l.floor_id ? floors.get(l.floor_id) : null;
    if (!l.footprint || !f) continue;
    const m = slab(l.footprint as Vec2[], Number(f.elevation_m) + Number(f.height_m) - 0.05, Number(f.height_m) - 0.1, mats.facade.clone(), `proc_lot_${l.id}`);
    m.userData.__binding = { target_type: 'lot', target_id: l.id };
    g.add(m);
  }
  for (const b of data.buildings) {
    if (!b.footprint || data.lots.some((l) => l.building_id === b.id && l.footprint)) continue;
    for (const f of data.floors.filter((x) => x.building_id === b.id)) {
      const m = slab(b.footprint as Vec2[], Number(f.elevation_m) + Number(f.height_m) - 0.05, Number(f.height_m) - 0.1, mats.facade.clone(), `proc_floor_${f.id}`);
      m.userData.__binding = { target_type: 'floor', target_id: f.id };
      g.add(m);
    }
  }
  const amat: Record<string, THREE.Material> = { pool: mats.water, garden: mats.lawn, sport: mats.court, parking: mats.asphalt };
  for (const a of data.amenities) if (a.footprint) {
    const m = slab(a.footprint as Vec2[], 0.25, 0.05, amat[a.kind] ?? mats.deck, `proc_amenity_${a.id}`);
    m.userData.__binding = { target_type: 'amenity', target_id: a.id };
    g.add(m);
  }
  return g;
}

function useIndexedScene(root: THREE.Object3D, data: SceneData, bindings: SceneData['model'] extends infer M ? (M extends { bindings: infer B } ? B : never) : never) {
  return useMemo(() => {
    const byName = new Map<string, Binding>();
    for (const b of bindings ?? []) byName.set(sanitizeNodeName(b.node_name), b);
    const lotMeshes = new Map<string, THREE.Mesh[]>();
    const boundObjects: { obj: THREE.Object3D; b: Binding }[] = [];
    root.traverse((o) => {
      const b = (o.userData.__binding as Binding | undefined) ?? byName.get(o.name);
      if (b) { o.userData.__binding = b; boundObjects.push({ obj: o, b }); }
    });
    // matériaux propres à chaque lot (teinte indépendante)
    for (const { obj, b } of boundObjects) {
      if (b.target_type !== 'lot') continue;
      const list: THREE.Mesh[] = [];
      obj.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.userData.__ownMat) { mesh.material = (mesh.material as THREE.Material).clone(); mesh.userData.__ownMat = true; }
        list.push(mesh);
      });
      lotMeshes.set(b.target_id, [...(lotMeshes.get(b.target_id) ?? []), ...list]);
    }
    // niveau de chaque objet lié (pour masquer les étages supérieurs)
    const floors = new Map(data.floors.map((f) => [f.id, f]));
    const lots = new Map(data.lots.map((l) => [l.id, l]));
    const levelOf = (b: Binding) => {
      const f = b.target_type === 'floor' ? floors.get(b.target_id) : b.target_type === 'lot' ? floors.get(lots.get(b.target_id)?.floor_id ?? '') : undefined;
      return f ? { buildingId: f.building_id, level: f.level, top: Number(f.elevation_m) + Number(f.height_m) } : null;
    };
    const leveled = boundObjects.map(({ obj, b }) => ({ obj, info: levelOf(b) })).filter((x) => x.info) as { obj: THREE.Object3D; info: { buildingId: string; level: number; top: number } }[];
    const buildingRoots = boundObjects.filter((x) => x.b.target_type === 'building');
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    return { lotMeshes, leveled, buildingRoots, box };
  }, [root, data, bindings]);
}

function Model({ root, props }: { root: THREE.Object3D; props: Scene3DProps }) {
  const { data } = props;
  const idx = useIndexedScene(root, data, data.model?.bindings ?? []);
  const statusById = useMemo(() => new Map(data.lots.map((l) => [l.id, l.status as LotStatus])), [data.lots]);

  // Teinte : couleurs de disponibilité + mise en évidence du lot sélectionné
  useEffect(() => {
    for (const [lotId, meshes] of idx.lotMeshes) {
      const st = statusById.get(lotId);
      const sel = lotId === props.selectedLotId;
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat.emissive) continue;
        if (sel) { mat.emissive.copy(ACCENT); mat.emissiveIntensity = 0.55; }
        else if (props.statusColors && st && !mat.transparent) { mat.emissive.set(STATUS_COLORS[st]); mat.emissiveIntensity = 0.45; }
        else { mat.emissive.set(0x000000); mat.emissiveIntensity = 1; }
      }
    }
  }, [idx, statusById, props.selectedLotId, props.statusColors]);

  // Masquage des étages supérieurs du bâtiment isolé
  useEffect(() => {
    root.traverse((o) => { if (o.userData.__hiddenByIso) { o.visible = true; o.userData.__hiddenByIso = false; } });
    const iso = props.isolate;
    if (!iso) return;
    const floor = data.floors.find((f) => f.building_id === iso.buildingId && f.level === iso.level);
    const top = floor ? Number(floor.elevation_m) + Number(floor.height_m) : Infinity;
    for (const { obj, info } of idx.leveled) if (info.buildingId === iso.buildingId && info.level > iso.level) { obj.visible = false; obj.userData.__hiddenByIso = true; }
    const broot = idx.buildingRoots.find((x) => x.b.target_id === iso.buildingId)?.obj;
    if (broot) {
      const bb = new THREE.Box3();
      broot.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !o.visible) return;
        let p: THREE.Object3D | null = o, leveled = false;
        while (p && p !== broot) { if (p.userData.__binding && p.userData.__binding.target_type !== 'building') { leveled = true; break; } p = p.parent; }
        if (leveled) return;
        bb.setFromObject(m);
        if (bb.min.y > top - 0.05) { m.visible = false; m.userData.__hiddenByIso = true; }
      });
    }
  }, [idx, props.isolate, data.floors, root]);

  const findBinding = (o: THREE.Object3D | null): Binding | null => {
    while (o) { if (o.userData.__binding) return o.userData.__binding; o = o.parent; }
    return null;
  };
  const lotAncestor = (o: THREE.Object3D | null): Binding | null => {
    let first: Binding | null = null;
    while (o) { const b = o.userData.__binding as Binding | undefined; if (b?.target_type === 'lot') return b; if (b && !first) first = b; o = o.parent; }
    return first;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (props.renderMode || e.delta > 6) return;
    e.stopPropagation();
    const b = lotAncestor(e.object);
    if (!b) { props.onSelectLot?.(null); return; }
    if (b.target_type === 'lot') props.onSelectLot?.(b.target_id);
    else if (b.target_type === 'building') props.onSelectBuilding?.(b.target_id);
    else if (b.target_type === 'floor') { const f = data.floors.find((x) => x.id === b.target_id); if (f) props.onSelectBuilding?.(f.building_id); }
    else if (b.target_type === 'amenity') props.onPoi?.(b.target_id);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (props.renderMode) return;
    const b = findBinding(e.object);
    document.body.style.cursor = b ? 'pointer' : 'default';
  };
  return <primitive object={root} onClick={onClick} onPointerMove={onMove} onPointerOut={() => { document.body.style.cursor = 'default'; }} />;
}

function GltfModel({ url, props }: { url: string; props: Scene3DProps }) {
  const gltf = useGLTF(url);
  const root = useMemo(() => gltf.scene, [gltf]);
  useEffect(() => { root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } }); }, [root]);
  return <Model root={root} props={props} />;
}

function ProceduralModel({ props }: { props: Scene3DProps }) {
  const root = useMemo(() => buildProcedural(props.data), [props.data.lots.length, props.data.floors.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Model root={root} props={props} />;
}

function Pois({ props }: { props: Scene3DProps }) {
  if (props.renderMode) return null;
  return <>{props.data.amenities.filter((a) => a.footprint?.length).map((a) => {
    const fp = a.footprint as Vec2[];
    const c: Vec2 = [fp.reduce((s, p) => s + p[0], 0) / fp.length, fp.reduce((s, p) => s + p[1], 0) / fp.length];
    return (
      <Html key={a.id} position={planToWorld(c, 3)} center distanceFactor={60} zIndexRange={[4, 0]}>
        <button className="poi" onClick={() => props.onPoi?.(a.id)} data-poi={a.kind}>{a.name}</button>
      </Html>
    );
  })}</>;
}

function CameraRig({ props }: { props: Scene3DProps }) {
  const { camera, gl, scene, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;
  const flight = useRef<{ from: CameraPose; to: CameraPose; start: number; dur: number } | null>(null);
  const lastEmit = useRef(0);
  const cam = camera as THREE.PerspectiveCamera;
  const target = useRef(new THREE.Vector3(...props.initialPose.target));

  const apply = (p: CameraPose) => {
    cam.position.set(...p.position);
    target.current.set(...p.target);
    cam.fov = p.fov; cam.updateProjectionMatrix();
    cam.lookAt(target.current);
    if (controls) { controls.target.copy(target.current); controls.update(); }
  };
  const pose = (): CameraPose => ({ position: cam.position.toArray() as [number, number, number], target: (controls?.target ?? target.current).toArray() as [number, number, number], fov: cam.fov });

  useEffect(() => { apply(props.initialPose); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!props.flyTo) return;
    flight.current = { from: pose(), to: props.flyTo.pose, start: performance.now(), dur: 1400 };
  }, [props.flyTo?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    gl.clippingPlanes = props.sectionHeight != null ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), props.sectionHeight)] : [];
    invalidate();
  }, [props.sectionHeight, gl, invalidate]);
  useEffect(() => {
    props.onReady?.({
      getPose: pose,
      capture: (type = 'image/png', q = 0.92) => { gl.render(scene, camera); return gl.domElement.toDataURL(type, q); },
      renderAt: (shots, t) => {
        const vp = new Map(props.data.viewpoints.map((v) => [v.id, { position: v.position, target: v.target, fov: Number(v.fov) }]));
        const f = frameAt(shots, (id) => vp.get(id), t);
        if (!f) return null;
        apply(f.pose);
        gl.render(scene, camera);
        return { fade: f.fade, shotIndex: f.shotIndex };
      },
    });
  }, [gl, scene, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aide aux tests et à l'accessibilité : point écran visible d'un nœud (vérifié par lancer de rayon).
  useEffect(() => {
    const ray = new THREE.Raycaster();
    (window as any).__immoScene = {
      pose: () => ({ position: camera.position.toArray(), fov: (camera as THREE.PerspectiveCamera).fov }),
      screenOf(name: string) {
        const obj = scene.getObjectByName(sanitizeNodeName(name));
        if (!obj) return null;
        const rect = gl.domElement.getBoundingClientRect();
        const meshes: THREE.Mesh[] = [];
        obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
        for (const m of meshes) {
          const b = new THREE.Box3().setFromObject(m);
          const c = b.getCenter(new THREE.Vector3());
          const ndc = c.clone().project(camera);
          if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95 || ndc.z > 1) continue;
          ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
          const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && (h.object as THREE.Mesh).isMesh);
          let o: THREE.Object3D | null = hit?.object ?? null, inside = false;
          while (o) { if (o === obj) { inside = true; break; } o = o.parent; }
          if (inside) return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
        }
        return null;
      },
    };
  }, [scene, camera, gl]);

  useFrame(() => {
    if (props.renderMode) return;
    const now = performance.now();
    if (props.tour) {
      const vp = new Map(props.data.viewpoints.map((v) => [v.id, { position: v.position, target: v.target, fov: Number(v.fov) }]));
      const t = (now - props.tour.start) / 1000;
      const total = props.tour.shots.reduce((s, x) => s + x.duration_s, 0);
      const f = frameAt(props.tour.shots, (id) => vp.get(id), t);
      if (f) apply(f.pose);
      if (t >= total) props.onTourEnd?.();
    } else if (flight.current) {
      const fl = flight.current;
      const k = Math.min(1, (now - fl.start) / fl.dur);
      apply(interpolatePose(fl.from, fl.to, k));
      if (k >= 1) flight.current = null;
    }
    if (props.onCamera && now - lastEmit.current > 250) { lastEmit.current = now; props.onCamera(pose()); }
  });
  return null;
}

export function Scene3D(props: Scene3DProps) {
  return (
    <Canvas
      frameloop={props.renderMode ? 'never' : 'always'}
      dpr={props.renderMode ? 1 : [1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ fov: props.initialPose.fov, near: 0.1, far: 3000, position: props.initialPose.position }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; }}
      onPointerMissed={() => props.onSelectLot?.(null)}
    >
      <color attach="background" args={['#d9e6ee']} />
      <fog attach="fog" args={['#d9e6ee', 250, 900]} />
      <hemisphereLight args={['#eaf3fb', '#a89a7c', 0.9]} />
      <directionalLight position={[60, 90, 40]} intensity={2.2} />
      <directionalLight position={[-50, 40, -60]} intensity={0.5} />
      <Suspense fallback={null}>
        {props.data.model ? <GltfModel url={props.data.model.url} props={props} /> : <ProceduralModel props={props} />}
        <Ready props={props} />
      </Suspense>
      <Pois props={props} />
      {!props.renderMode && <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.495} minDistance={1.5} maxDistance={450} enabled={!props.tour} />}
      <CameraRig props={props} />
    </Canvas>
  );
}

function Ready({ props }: { props: Scene3DProps }) {
  useEffect(() => { (window as any).__immoSceneLoaded = true; window.dispatchEvent(new Event('immo-scene-loaded')); }, []);
  void props;
  return null;
}
