'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  constrainAngle, dist, drawingStats, pointSegment, polar, PROVENANCES, round, snapToVertices, validateDrawing,
  type Drawing, type Opening, type Provenance, type Room, type Vec2, type Wall,
} from '@immo/core';
import { rotatedSize, rotationMatrix, effectiveCrop, type PageGeom } from '@/lib/plan-transform';
import { applyCalculatedSurfaces, saveDrawing } from '../../plans/actions';
import { detectWallsFromImage } from './detect';

const Preview3D = dynamic(() => import('./Preview3D').then((m) => m.Preview3D), { ssr: false, loading: () => <div className="empty">Chargement de la 3D…</div> });

type Tool = 'select' | 'wall' | 'room' | 'door' | 'window' | 'measure' | 'pan';
type Sel = { type: 'wall' | 'room' | 'opening'; id: string } | null;

export interface EditorProps {
  projectId: string;
  page: { id: string; imageUrl: string | null; width: number; height: number; rotation: 0 | 90 | 180 | 270; crop: any; scale: number | null; calibrated: boolean; label: string };
  floor: { elevation: number; height: number; label: string } | null;
  floorHeight: number;
  initial: Drawing;
  baseVersion: number;
  lots: { id: string; reference: string; onFloor: boolean }[];
  canEdit: boolean;
  generatedModelId: string | null;
}

const PROV_COLORS: Record<Provenance, string> = { documented: '#1d4f91', estimated: '#b07a00', proposed: '#8e3fbf', validated: '#1e7a46' };
const PROV_LABEL: Record<Provenance, string> = { documented: 'Documenté', estimated: 'Estimé', proposed: 'Proposé', validated: 'Validé' };
const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 9)}`;
const S = (p: Vec2) => `${p[0]},${-p[1]}`; // monde -> SVG

function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function Editor(props: EditorProps) {
  const { page, canEdit } = props;
  const router = useRouter();
  const geom: PageGeom = { width: page.width, height: page.height, rotation: page.rotation, crop: page.crop, scale: page.scale };
  const crop = page.imageUrl ? effectiveCrop(geom) : null;
  const scale = page.scale ?? 0.01;
  const pageW = crop ? crop.w * scale : 30, pageH = crop ? crop.h * scale : 20;

  const [drawing, setDrawing] = useState<Drawing>(props.initial);
  const [past, setPast] = useState<Drawing[]>([]);
  const [future, setFuture] = useState<Drawing[]>([]);
  const [baseVersion, setBaseVersion] = useState(props.baseVersion);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<Sel>(null);
  const [grid, setGrid] = useState(0.1);
  const [snap, setSnap] = useState(true);
  const [thickness, setThickness] = useState(0.2);
  const [wallH, setWallH] = useState(props.floorHeight || 2.8);
  const [prov, setProv] = useState<Provenance>(page.calibrated ? 'documented' : 'estimated');
  const [bgOpacity, setBgOpacity] = useState(0.8);
  const [chain, setChain] = useState<Vec2 | null>(null);
  const [roomPts, setRoomPts] = useState<Vec2[]>([]);
  const [measure, setMeasure] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [shift, setShift] = useState(false);
  const [numLen, setNumLen] = useState('');
  const [numAng, setNumAng] = useState('0');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show3d, setShow3d] = useState(false);
  const [view, setView] = useState(() => {
    const pad = Math.max(pageW, pageH) * 0.05;
    return { x: -pad, y: -pageH - pad, w: pageW + 2 * pad, h: pageH + 2 * pad };
  });
  const svg = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ kind: 'pan' | 'vertex'; start: Vec2; view?: typeof view; wallId?: string; end?: 'a' | 'b'; roomId?: string; idx?: number; before?: Drawing } | null>(null);

  // --- historique (annuler / rétablir) -------------------------------------
  const commit = useCallback((next: Drawing, from?: Drawing) => {
    setPast((p) => [...p.slice(-199), from ?? drawing]);
    setFuture([]);
    setDrawing(next);
    setDirty(true);
  }, [drawing]);
  const undo = () => { if (!past.length) return; setFuture([drawing, ...future]); setDrawing(past[past.length - 1]); setPast(past.slice(0, -1)); setDirty(true); };
  const redo = () => { if (!future.length) return; setPast([...past, drawing]); setDrawing(future[0]); setFuture(future.slice(1)); setDirty(true); };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // --- coordonnées et accrochage -------------------------------------------
  const pxPerUnit = () => (svg.current ? svg.current.clientWidth / view.w : 1);
  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [p.x, -p.y];
  };
  const vertices = useMemo(() => [...drawing.walls.flatMap((w) => [w.a, w.b]), ...drawing.rooms.flatMap((r) => r.points)] as Vec2[], [drawing]);
  const snapped = (p: Vec2, from?: Vec2 | null): Vec2 => {
    let q = p;
    if (from && shift) q = constrainAngle(from, q);
    if (!snap) return q;
    const r = snapToVertices(q, vertices, 10 / pxPerUnit(), from && shift ? 0 : grid);
    return r.point;
  };

  // --- opérations ------------------------------------------------------------
  const addWall = (a: Vec2, b: Vec2) => {
    if (dist(a, b) < 0.05) return;
    const w: Wall = { id: uid('w'), a: [round(a[0], 4), round(a[1], 4)], b: [round(b[0], 4), round(b[1], 4)], thickness, height: wallH, provenance: prov };
    commit({ ...drawing, walls: [...drawing.walls, w] });
  };
  const closeRoom = (pts: Vec2[]) => {
    if (pts.length < 3) return;
    const r: Room = { id: uid('r'), name: `Pièce ${drawing.rooms.length + 1}`, points: pts.map((p) => [round(p[0], 4), round(p[1], 4)]), lotId: null, provenance: prov };
    commit({ ...drawing, rooms: [...drawing.rooms, r] });
    setRoomPts([]);
    setSel({ type: 'room', id: r.id });
  };
  const hitWall = (p: Vec2) => {
    let best: { w: Wall; t: number; d: number } | null = null;
    for (const w of drawing.walls) {
      const r = pointSegment(p, w.a as Vec2, w.b as Vec2);
      if (r.d < Math.max(w.thickness, 8 / pxPerUnit()) && (!best || r.d < best.d)) best = { w, t: r.t, d: r.d };
    }
    return best;
  };
  const addOpening = (p: Vec2, kind: 'door' | 'window') => {
    const h = hitWall(p);
    if (!h) { setMsg({ ok: false, text: 'Cliquez sur un mur pour placer une ouverture.' }); return; }
    const L = dist(h.w.a as Vec2, h.w.b as Vec2);
    const width = Math.min(kind === 'door' ? 0.9 : 1.2, L - 0.1);
    const o: Opening = { id: uid('o'), wallId: h.w.id, kind, width: round(width, 3), height: kind === 'door' ? Math.min(2.1, h.w.height) : Math.min(1.25, h.w.height - 0.95),
      sill: kind === 'door' ? 0 : 0.95, offset: round(Math.max(0, Math.min(L - width, h.t * L - width / 2)), 3), provenance: prov };
    commit({ ...drawing, openings: [...drawing.openings, o] });
    setSel({ type: 'opening', id: o.id });
  };
  const deleteSel = () => {
    if (!sel) return;
    if (sel.type === 'wall') commit({ ...drawing, walls: drawing.walls.filter((w) => w.id !== sel.id), openings: drawing.openings.filter((o) => o.wallId !== sel.id) });
    if (sel.type === 'room') commit({ ...drawing, rooms: drawing.rooms.filter((r) => r.id !== sel.id) });
    if (sel.type === 'opening') commit({ ...drawing, openings: drawing.openings.filter((o) => o.id !== sel.id) });
    setSel(null);
  };
  const patch = (type: Sel extends null ? never : NonNullable<Sel>['type'], id: string, fn: (x: any) => any) => {
    const key = type === 'wall' ? 'walls' : type === 'room' ? 'rooms' : 'openings';
    commit({ ...drawing, [key]: (drawing as any)[key].map((x: any) => (x.id === id ? fn(x) : x)) });
  };
  const validateAll = (from: Provenance) => {
    const n = [...drawing.walls, ...drawing.rooms, ...drawing.openings].filter((e) => e.provenance === from).length;
    if (!n || !window.confirm(`Valider ${n} élément(s) « ${PROV_LABEL[from]} » ? Vérifiez-les visuellement au préalable.`)) return;
    const v = <T extends { provenance: Provenance }>(e: T): T => (e.provenance === from ? { ...e, provenance: 'validated' } : e);
    commit({ ...drawing, walls: drawing.walls.map(v), rooms: drawing.rooms.map(v), openings: drawing.openings.map(v) });
  };

  // --- clavier -----------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName && ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Shift') setShift(true);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { setChain(null); setRoomPts([]); setMeasure([]); setSel(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) deleteSel();
      else if (e.key === 'Enter' && tool === 'room') closeRoom(roomPts);
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') setShift(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  // --- souris ------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    const p = toWorld(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'pan' || e.button === 1) { dragRef.current = { kind: 'pan', start: [e.clientX, e.clientY], view }; return; }
    if (!canEdit && tool !== 'measure' && tool !== 'select') return;
    if (tool === 'wall') {
      const q = snapped(p, chain);
      if (!chain) setChain(q); else { addWall(chain, q); setChain(q); }
    } else if (tool === 'room') {
      const q = snapped(p, roomPts.at(-1));
      if (roomPts.length >= 3 && dist(q, roomPts[0]) < 12 / pxPerUnit()) closeRoom(roomPts);
      else setRoomPts([...roomPts, q]);
    } else if (tool === 'door' || tool === 'window') addOpening(p, tool);
    else if (tool === 'measure') setMeasure((m) => (m.length >= 2 ? [snapped(p)] : [...m, snapped(p, m[0])]));
    else if (tool === 'select') {
      // poignées du mur sélectionné
      if (sel?.type === 'wall' && canEdit) {
        const w = drawing.walls.find((x) => x.id === sel.id);
        if (w) for (const end of ['a', 'b'] as const) if (dist(p, w[end] as Vec2) < 10 / pxPerUnit()) { dragRef.current = { kind: 'vertex', start: p, wallId: w.id, end, before: drawing }; return; }
      }
      if (sel?.type === 'room' && canEdit) {
        const r = drawing.rooms.find((x) => x.id === sel.id);
        if (r) for (let i = 0; i < r.points.length; i++) if (dist(p, r.points[i] as Vec2) < 10 / pxPerUnit()) { dragRef.current = { kind: 'vertex', start: p, roomId: r.id, idx: i, before: drawing }; return; }
      }
      const tol = 8 / pxPerUnit();
      const op = drawing.openings.find((o) => {
        const w = drawing.walls.find((x) => x.id === o.wallId); if (!w) return false;
        const L = dist(w.a as Vec2, w.b as Vec2); const r = pointSegment(p, w.a as Vec2, w.b as Vec2);
        return r.d < Math.max(w.thickness, tol) && r.t * L >= o.offset && r.t * L <= o.offset + o.width;
      });
      if (op) { setSel({ type: 'opening', id: op.id }); return; }
      const h = hitWall(p);
      if (h) { setSel({ type: 'wall', id: h.w.id }); return; }
      const room = [...drawing.rooms].reverse().find((r) => pointInPolygon(p, r.points as Vec2[]));
      setSel(room ? { type: 'room', id: room.id } : null);
      if (!room) dragRef.current = { kind: 'pan', start: [e.clientX, e.clientY], view };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e);
    const dr = dragRef.current;
    if (dr?.kind === 'pan' && dr.view) {
      const k = view.w / svg.current!.clientWidth;
      setView({ ...dr.view, x: dr.view.x - (e.clientX - dr.start[0]) * k, y: dr.view.y - (e.clientY - dr.start[1]) * k });
      return;
    }
    if (dr?.kind === 'vertex') {
      const q = snapped(p);
      if (dr.wallId) setDrawing((d) => ({ ...d, walls: d.walls.map((w) => (w.id === dr.wallId ? { ...w, [dr.end!]: [round(q[0], 4), round(q[1], 4)] } : w)) }));
      if (dr.roomId) setDrawing((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === dr.roomId ? { ...r, points: r.points.map((pt, i) => (i === dr.idx ? [round(q[0], 4), round(q[1], 4)] : pt)) } : r)) }));
      return;
    }
    setCursor(tool === 'wall' ? snapped(p, chain) : tool === 'room' ? snapped(p, roomPts.at(-1)) : snapped(p));
  };
  const onPointerUp = () => {
    const dr = dragRef.current;
    if (dr?.kind === 'vertex' && dr.before) { setPast((pp) => [...pp, dr.before!]); setFuture([]); setDirty(true); }
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e);
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const sx = p[0], sy = -p[1];
    setView((v) => ({ x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f, w: v.w * f, h: v.h * f }));
  };
  const zoom = (f: number) => setView((v) => ({ x: v.x + (v.w * (1 - f)) / 2, y: v.y + (v.h * (1 - f)) / 2, w: v.w * f, h: v.h * f }));
  const fit = () => { const pad = Math.max(pageW, pageH) * 0.05; setView({ x: -pad, y: -pageH - pad, w: pageW + 2 * pad, h: pageH + 2 * pad }); };

  const addNumeric = () => {
    const L = Number(numLen.replace(',', '.')), A = Number(numAng.replace(',', '.'));
    if (!(L > 0)) { setMsg({ ok: false, text: 'Longueur invalide.' }); return; }
    const start = chain ?? [0, 0] as Vec2;
    const end = polar(start, L, A);
    addWall(start, end);
    setChain(end);
    setTool('wall');
  };

  async function save() {
    setBusy(true); setMsg(null);
    const r = await saveDrawing(page.id, drawing, note, baseVersion);
    setBusy(false);
    if (r.ok) { setBaseVersion(r.data!.version); setDirty(false); setNote(''); setMsg({ ok: true, text: `Version v${r.data!.version} enregistrée.` }); router.replace(`?version=${r.data!.version}`); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function detect() {
    if (!page.imageUrl) return;
    setBusy(true); setMsg(null);
    try {
      const walls = await detectWallsFromImage(page.imageUrl, geom, { minLengthM: 0.8, thicknessDefault: thickness, height: wallH });
      if (!walls.length) setMsg({ ok: false, text: 'Aucun trait long détecté.' });
      else { commit({ ...drawing, walls: [...drawing.walls, ...walls] }); setMsg({ ok: true, text: `${walls.length} mur(s) proposé(s) par la détection locale : à vérifier et valider.` }); }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  const stats = useMemo(() => drawingStats(drawing), [drawing]);
  const issues = useMemo(() => validateDrawing(drawing), [drawing]);
  const selWall = sel?.type === 'wall' ? drawing.walls.find((w) => w.id === sel.id) : undefined;
  const selRoom = sel?.type === 'room' ? drawing.rooms.find((r) => r.id === sel.id) : undefined;
  const selOp = sel?.type === 'opening' ? drawing.openings.find((o) => o.id === sel.id) : undefined;
  const k = view.w / 1000; // unité visuelle ~ 1 px pour un canevas de 1000 px

  // grille
  const gridLines = useMemo(() => {
    const step = grid * Math.max(1, Math.ceil((view.w / grid) / 120));
    const lines: React.ReactNode[] = [];
    const x0 = Math.floor(view.x / step) * step, y0 = Math.floor(view.y / step) * step;
    for (let x = x0; x < view.x + view.w; x += step) lines.push(<line key={`x${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} />);
    for (let y = y0; y < view.y + view.h; y += step) lines.push(<line key={`y${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} />);
    return lines;
  }, [view, grid]);

  const R = page.imageUrl ? rotatedSize(page.width, page.height, page.rotation) : null;
  const numField = (label: string, value: number, on: (v: number) => void, step = 0.01) => (
    <label className="field"><span>{label}</span><input type="number" step={step} defaultValue={round(value, 3)} key={`${sel?.id}-${label}-${value}`} disabled={!canEdit}
      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== round(value, 3)) on(v); }} /></label>
  );

  return (
    <>
    <div className="editor" data-testid="editor">
      <div className="card side stack">
        <h3>Outils</h3>
        {([['select', 'Sélection / déplacer'], ['wall', 'Mur'], ['room', 'Pièce'], ['door', 'Porte'], ['window', 'Fenêtre'], ['measure', 'Mesurer'], ['pan', 'Déplacer la vue']] as [Tool, string][]).map(([t, l]) => (
          <button key={t} className={`btn btn-sm tool-btn ${tool === t ? 'on' : ''}`} onClick={() => { setTool(t); setChain(null); setRoomPts([]); setMeasure([]); }} disabled={!canEdit && !['select', 'measure', 'pan'].includes(t)} data-tool={t}>{l}</button>
        ))}
        <div className="row">
          <button className="btn btn-sm" onClick={undo} disabled={!past.length} title="Ctrl+Z">↶ Annuler</button>
          <button className="btn btn-sm" onClick={redo} disabled={!future.length} title="Ctrl+Y">↷ Rétablir</button>
        </div>
        <div className="row"><button className="btn btn-sm" onClick={() => zoom(0.8)}>＋</button><button className="btn btn-sm" onClick={() => zoom(1.25)}>－</button><button className="btn btn-sm" onClick={fit}>Ajuster</button></div>
        <h3>Réglages</h3>
        <label className="field"><span>Grille (m)</span><select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>{[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        <label className="check small"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> <span>Accrochage (grille + sommets) — Maj : angles 45°</span></label>
        <label className="field"><span>Épaisseur des murs (m)</span><input type="number" step="0.01" min={0.02} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} /></label>
        <label className="field"><span>Hauteur des murs (m)</span><input type="number" step="0.01" min={0.5} value={wallH} onChange={(e) => setWallH(Number(e.target.value))} /></label>
        <label className="field"><span>Statut des nouveaux éléments</span><select value={prov} onChange={(e) => setProv(e.target.value as Provenance)} data-testid="new-prov">{PROVENANCES.map((p) => <option key={p} value={p}>{PROV_LABEL[p]}</option>)}</select></label>
        {page.imageUrl && <label className="field"><span>Opacité du plan</span><input type="range" min={0} max={1} step={0.05} value={bgOpacity} onChange={(e) => setBgOpacity(Number(e.target.value))} /></label>}
        <h3>Saisie numérique</h3>
        <p className="small muted" style={{ margin: 0 }}>Mur depuis {chain ? `(${round(chain[0])} ; ${round(chain[1])})` : 'l’origine (0 ; 0)'}.</p>
        <div className="row"><input aria-label="Longueur (m)" placeholder="Longueur m" value={numLen} onChange={(e) => setNumLen(e.target.value)} style={{ width: 90 }} data-testid="num-len" />
          <input aria-label="Angle (°)" placeholder="Angle °" value={numAng} onChange={(e) => setNumAng(e.target.value)} style={{ width: 70 }} data-testid="num-ang" /></div>
        <button className="btn btn-sm" onClick={addNumeric} disabled={!canEdit} data-testid="num-add">Ajouter le mur</button>
        {page.imageUrl && <>
          <h3>Assistance (facultative)</h3>
          <button className="btn btn-sm" onClick={detect} disabled={!canEdit || busy}>Détecter les traits (local)</button>
          <p className="small muted" style={{ margin: 0 }}>Analyse locale dans le navigateur des traits horizontaux/verticaux épais. Résultats « proposés » à corriger et valider. Aucun envoi à un service externe.</p>
        </>}
      </div>

      <div className="canvas">
        <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
          onDoubleClick={() => { if (tool === 'wall') setChain(null); if (tool === 'room') closeRoom(roomPts); }}
          style={{ cursor: tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }} data-testid="editor-svg">
          {page.imageUrl && R && crop && (
            <g opacity={bgOpacity} transform={`scale(${scale}) translate(${-crop.x} ${-(crop.y + crop.h)})`}>
              <clipPath id="cropclip"><rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} /></clipPath>
              <g clipPath="url(#cropclip)"><image href={page.imageUrl} width={page.width} height={page.height} transform={rotationMatrix(page.width, page.height, page.rotation)} /></g>
            </g>
          )}
          <g stroke="#dfe4e6" strokeWidth={k * 0.8}>{gridLines}</g>
          <g stroke="#9aa5ab" strokeWidth={k * 1.5}><line x1={0} y1={-0.5} x2={0} y2={0.5} /><line x1={-0.5} y1={0} x2={0.5} y2={0} /></g>
          {drawing.rooms.map((r) => (
            <g key={r.id}>
              <polygon points={(r.points as Vec2[]).map(S).join(' ')} fill={PROV_COLORS[r.provenance]} fillOpacity={sel?.id === r.id ? 0.28 : 0.12} stroke={PROV_COLORS[r.provenance]} strokeWidth={k * (sel?.id === r.id ? 2.5 : 1)} strokeDasharray={r.provenance === 'validated' ? undefined : `${k * 6} ${k * 3}`} />
              {(() => { const c = (r.points as Vec2[]).reduce((s, p) => [s[0] + p[0] / r.points.length, s[1] + p[1] / r.points.length], [0, 0]); const a = stats.rooms.find((x) => x.id === r.id)?.areaM2; return <text x={c[0]} y={-c[1]} fontSize={k * 13} textAnchor="middle" fill="#1c2329">{r.name} · {a} m²</text>; })()}
            </g>
          ))}
          {drawing.walls.map((w) => {
            const L = dist(w.a as Vec2, w.b as Vec2);
            const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L;
            return (
              <g key={w.id} data-wall={w.id}>
                <line x1={w.a[0]} y1={-w.a[1]} x2={w.b[0]} y2={-w.b[1]} stroke={PROV_COLORS[w.provenance]} strokeOpacity={sel?.id === w.id ? 1 : 0.85} strokeWidth={Math.max(w.thickness, k * 2)} strokeLinecap="square" strokeDasharray={w.provenance === 'validated' ? undefined : `${k * 8} ${k * 4}`} />
                {drawing.openings.filter((o) => o.wallId === w.id).map((o) => (
                  <line key={o.id} x1={w.a[0] + ux * o.offset} y1={-(w.a[1] + uy * o.offset)} x2={w.a[0] + ux * (o.offset + o.width)} y2={-(w.a[1] + uy * (o.offset + o.width))}
                    stroke={o.kind === 'door' ? '#ffffff' : '#7fc4e8'} strokeWidth={Math.max(w.thickness * 0.8, k * 1.5)} strokeOpacity={sel?.id === o.id ? 1 : 0.95} />
                ))}
                {sel?.id === w.id && <text x={(w.a[0] + w.b[0]) / 2} y={-(w.a[1] + w.b[1]) / 2 - k * 8} fontSize={k * 12} textAnchor="middle" fill="#c0392b">{round(L, 3)} m</text>}
                {sel?.id === w.id && canEdit && <>{[w.a, w.b].map((p, i) => <circle key={i} cx={p[0]} cy={-p[1]} r={k * 6} fill="#fff" stroke="#c0392b" strokeWidth={k * 2} />)}</>}
              </g>
            );
          })}
          {selRoom && canEdit && (selRoom.points as Vec2[]).map((p, i) => <circle key={i} cx={p[0]} cy={-p[1]} r={k * 5} fill="#fff" stroke="#c0392b" strokeWidth={k * 2} />)}
          {chain && cursor && tool === 'wall' && <g><line x1={chain[0]} y1={-chain[1]} x2={cursor[0]} y2={-cursor[1]} stroke="#c0392b" strokeWidth={Math.max(thickness, k * 2)} strokeOpacity={0.5} />
            <text x={(chain[0] + cursor[0]) / 2} y={-(chain[1] + cursor[1]) / 2 - k * 8} fontSize={k * 12} fill="#c0392b" textAnchor="middle">{round(dist(chain, cursor), 3)} m</text></g>}
          {roomPts.length > 0 && <polyline points={[...roomPts, ...(cursor ? [cursor] : [])].map(S).join(' ')} fill="rgba(192,57,43,.1)" stroke="#c0392b" strokeWidth={k * 1.5} />}
          {measure.length > 0 && <g stroke="#b07a34" strokeWidth={k * 2}><polyline points={[...measure, ...(measure.length === 1 && cursor ? [cursor] : [])].map(S).join(' ')} fill="none" />
            {(measure.length === 2 || cursor) && <text x={measure[0][0]} y={-measure[0][1] - k * 10} fontSize={k * 13} fill="#b07a34" stroke="none">{round(dist(measure[0], measure[1] ?? cursor!), 3)} m</text>}</g>}
          {cursor && tool !== 'select' && tool !== 'pan' && <circle cx={cursor[0]} cy={-cursor[1]} r={k * 3} fill="#c0392b" />}
        </svg>
        <div className="vbadge" style={{ bottom: 6 }}>{cursor ? `x ${round(cursor[0])} m · y ${round(cursor[1])} m` : ''} {tool === 'wall' && chain ? ' · double-clic / Échap pour terminer' : ''} {tool === 'room' ? ' · Entrée ou clic sur le 1er point pour fermer' : ''}</div>
      </div>

      <div className="card side stack">
        <div className="row between"><h3 style={{ margin: 0 }}>Enregistrement</h3>{dirty && <span className="tag prov-estimated">modifié</span>}</div>
        <input placeholder="Note de version (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canEdit} />
        <button className="btn btn-primary" onClick={save} disabled={!canEdit || busy || !dirty} data-testid="save-drawing">{busy ? '…' : `Enregistrer (v${baseVersion + 1})`}</button>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text}</div>}

        {selWall && <div className="stack" data-testid="props-wall">
          <h3>Mur {selWall.id}</h3>
          <div className="row">{numField('A x', selWall.a[0], (v) => patch('wall', selWall.id, (w) => ({ ...w, a: [v, w.a[1]] })))}{numField('A y', selWall.a[1], (v) => patch('wall', selWall.id, (w) => ({ ...w, a: [w.a[0], v] })))}</div>
          <div className="row">{numField('B x', selWall.b[0], (v) => patch('wall', selWall.id, (w) => ({ ...w, b: [v, w.b[1]] })))}{numField('B y', selWall.b[1], (v) => patch('wall', selWall.id, (w) => ({ ...w, b: [w.b[0], v] })))}</div>
          {numField('Longueur (m)', dist(selWall.a as Vec2, selWall.b as Vec2), (v) => patch('wall', selWall.id, (w) => { const L = dist(w.a, w.b); return { ...w, b: [w.a[0] + ((w.b[0] - w.a[0]) / L) * v, w.a[1] + ((w.b[1] - w.a[1]) / L) * v] }; }), 0.001)}
          <div className="row">{numField('Épaisseur', selWall.thickness, (v) => patch('wall', selWall.id, (w) => ({ ...w, thickness: v })))}{numField('Hauteur', selWall.height, (v) => patch('wall', selWall.id, (w) => ({ ...w, height: v })))}</div>
        </div>}
        {selRoom && <div className="stack" data-testid="props-room">
          <h3>Pièce</h3>
          <label className="field"><span>Nom</span><input defaultValue={selRoom.name} key={selRoom.id} disabled={!canEdit} onBlur={(e) => e.target.value !== selRoom.name && patch('room', selRoom.id, (r) => ({ ...r, name: e.target.value }))} /></label>
          <div className="small">Surface calculée : <b>{stats.rooms.find((x) => x.id === selRoom.id)?.areaM2} m²</b></div>
          <label className="field"><span>Lot associé</span><select value={selRoom.lotId ?? ''} disabled={!canEdit} onChange={(e) => patch('room', selRoom.id, (r) => ({ ...r, lotId: e.target.value || null }))} data-testid="room-lot">
            <option value="">— aucun —</option>{props.lots.map((l) => <option key={l.id} value={l.id}>{l.reference}{l.onFloor ? '' : ' (autre étage)'}</option>)}</select></label>
        </div>}
        {selOp && <div className="stack">
          <h3>{selOp.kind === 'door' ? 'Porte' : 'Fenêtre'}</h3>
          <div className="row">{numField('Décalage (m)', selOp.offset, (v) => patch('opening', selOp.id, (o) => ({ ...o, offset: v })))}{numField('Largeur', selOp.width, (v) => patch('opening', selOp.id, (o) => ({ ...o, width: v })))}</div>
          <div className="row">{numField('Hauteur', selOp.height, (v) => patch('opening', selOp.id, (o) => ({ ...o, height: v })))}{numField('Allège', selOp.sill, (v) => patch('opening', selOp.id, (o) => ({ ...o, sill: v })))}</div>
        </div>}
        {sel && (() => { const el: any = selWall ?? selRoom ?? selOp; if (!el) return null; return (
          <div className="stack">
            <label className="field"><span>Statut de la donnée</span><select value={el.provenance} disabled={!canEdit} onChange={(e) => patch(sel.type, sel.id, (x) => ({ ...x, provenance: e.target.value }))} data-testid="sel-prov">
              {PROVENANCES.map((p) => <option key={p} value={p}>{PROV_LABEL[p]}</option>)}</select></label>
            <div className="row"><button className="btn btn-sm" disabled={!canEdit} onClick={() => patch(sel.type, sel.id, (x) => ({ ...x, provenance: 'validated' }))}>Valider</button><button className="btn btn-sm btn-danger" disabled={!canEdit} onClick={deleteSel}>Supprimer</button></div>
          </div>); })()}

        <h3>Données</h3>
        <div className="small">
          {PROVENANCES.map((p) => <div key={p} className="row between"><span><span className={`tag prov-${p}`}>{PROV_LABEL[p]}</span></span><b data-count={p}>{stats.counts[p]}</b></div>)}
        </div>
        <div className="row">{(['proposed', 'estimated', 'documented'] as Provenance[]).map((p) => stats.counts[p] > 0 && <button key={p} className="btn btn-sm" disabled={!canEdit} onClick={() => validateAll(p)}>Valider « {PROV_LABEL[p]} »</button>)}</div>
        <div className="small">Murs : {stats.wallCount} ({stats.wallLengthM} m linéaires) · Pièces : {stats.rooms.length}</div>
        {Object.keys(stats.lotSurfacesValidated).length > 0 && <div className="small">Surfaces calculées par lot (pièces validées) :
          <ul style={{ margin: '4px 0', paddingInlineStart: 16 }}>{Object.entries(stats.lotSurfacesValidated).map(([id, a]) => <li key={id}>{props.lots.find((l) => l.id === id)?.reference ?? id} : {a} m²</li>)}</ul>
          <button className="btn btn-sm" disabled={!canEdit || dirty} title={dirty ? 'Enregistrez d’abord' : ''} onClick={async () => { const r = await applyCalculatedSurfaces(page.id); setMsg(r.ok ? { ok: true, text: `${r.data?.updated} lot(s) mis à jour.` } : { ok: false, text: r.error }); }}>Reporter dans les lots</button></div>}
        {issues.length > 0 && <div className="alert alert-warning small"><b>Contrôles :</b><ul style={{ margin: 0, paddingInlineStart: 16 }}>{issues.slice(0, 8).map((i, n) => <li key={n}>{i.message}</li>)}</ul></div>}
        {!page.calibrated && page.imageUrl && <div className="alert alert-warning small">Plan non calibré : les dimensions sont estimées. Calibrez la page avant de valider.</div>}
        <button className="btn" onClick={() => setShow3d((s) => !s)} data-testid="toggle-3d">{show3d ? 'Masquer la 3D' : 'Aperçu 3D et contrôle des cotes'}</button>
      </div>
    </div>
    {show3d && (
      <div style={{ marginTop: 10 }}>
        <Preview3D drawing={drawing} dirty={dirty} page={page} geom={geom} floor={props.floor} projectId={props.projectId} canEdit={canEdit} generatedModelId={props.generatedModelId} />
      </div>
    )}
    </>
  );
}
