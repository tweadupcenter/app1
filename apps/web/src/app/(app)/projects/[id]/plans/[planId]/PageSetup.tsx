'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { rotatedSize, rotationMatrix } from '@/lib/plan-transform';
import { savePageSetup } from '../actions';

type Rot = 0 | 90 | 180 | 270;
interface Props {
  projectId: string;
  page: { id: string; imageUrl: string | null; width: number; height: number; rotation: Rot; crop: any; calibration: any; scale: number | null; floorId: string | null; levelLabel: string | null; floorHeight: number };
  floors: { id: string; name: string; level: number; code: string; height_m: number }[];
}

const UNITS = { m: 1, cm: 0.01, mm: 0.001 } as const;

export function PageSetup({ projectId, page, floors }: Props) {
  const [rotation, setRotation] = useState<Rot>(page.rotation);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(page.crop);
  const [p1, setP1] = useState<[number, number] | null>(page.calibration?.p1 ?? null);
  const [p2, setP2] = useState<[number, number] | null>(page.calibration?.p2 ?? null);
  const [known, setKnown] = useState<string>(page.calibration?.known_m ? String(page.calibration.known_m) : '');
  const [unit, setUnit] = useState<keyof typeof UNITS>('m');
  const [mode, setMode] = useState<'view' | 'crop' | 'calib'>('view');
  const [floorId, setFloorId] = useState(page.floorId ?? '');
  const [levelLabel, setLevelLabel] = useState(page.levelLabel ?? '');
  const [floorHeight, setFloorHeight] = useState(String(page.floorHeight ?? 3));
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const router = useRouter();
  const R = rotatedSize(page.width, page.height, rotation);

  const toSvg = (e: React.PointerEvent): [number, number] => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [Math.max(0, Math.min(R.w, p.x)), Math.max(0, Math.min(R.h, p.y))];
  };
  const pxDist = p1 && p2 ? Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) : 0;
  const knownM = Number(known.replace(',', '.')) * UNITS[unit];
  const newScale = pxDist > 0 && knownM > 0 ? knownM / pxDist : null;

  function rotate(delta: 90 | -90) {
    if ((crop || p1) && !window.confirm('Changer l’orientation réinitialise le recadrage et la calibration. Continuer ?')) return;
    setRotation((((rotation + delta) % 360) + 360) % 360 as Rot);
    setCrop(null); setP1(null); setP2(null);
  }

  async function save() {
    setBusy(true); setMsg(null);
    const calibration = p1 && p2 && knownM > 0 ? { p1, p2, known_m: knownM } : null;
    const r = await savePageSetup({ pageId: page.id, rotation, crop, calibration, floorId: floorId || null, levelLabel: levelLabel || null, floorHeight: Number(floorHeight.replace(',', '.')), rescaleDrawing: true });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: `Enregistré.${r.data?.scale ? ` Échelle : ${(1 / r.data.scale).toFixed(2)} px/m.` : ''}${r.data?.rescaled ? ' Le tracé existant a été remis à l’échelle (nouvelle version).' : ''}` });
      router.refresh();
    } else setMsg({ ok: false, text: r.error });
  }

  const stroke = Math.max(R.w, R.h) / 400;
  return (
    <div className="grid grid-side">
      <section className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>2. Orientation, recadrage et calibration</h2>
          <div className="row">
            <button className="btn btn-sm" onClick={() => rotate(-90)} title="Pivoter à gauche">⟲ 90°</button>
            <button className="btn btn-sm" onClick={() => rotate(90)} title="Pivoter à droite">⟳ 90°</button>
            <button className={`btn btn-sm ${mode === 'crop' ? 'on' : ''}`} onClick={() => setMode(mode === 'crop' ? 'view' : 'crop')}>Recadrer</button>
            {crop && <button className="btn btn-sm" onClick={() => setCrop(null)}>Annuler le recadrage</button>}
            <button className={`btn btn-sm ${mode === 'calib' ? 'on' : ''}`} onClick={() => { setMode(mode === 'calib' ? 'view' : 'calib'); setP1(null); setP2(null); }} data-testid="calib-mode">Calibrer (2 points)</button>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {mode === 'crop' && 'Glissez pour définir la zone utile du plan.'}
          {mode === 'calib' && (p1 ? (p2 ? 'Saisissez la dimension réelle entre les deux points.' : 'Cliquez sur le second point.') : 'Cliquez sur le premier point d’une cote connue.')}
          {mode === 'view' && 'Choisissez un outil. Les réglages ne sont appliqués qu’à l’enregistrement.'}
        </p>
        {page.imageUrl ? (
          <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, overflow: 'auto', maxHeight: '70vh', background: '#f6f6f4' }}>
            <svg ref={svg} viewBox={`0 0 ${R.w} ${R.h}`} style={{ width: '100%', display: 'block', cursor: mode === 'view' ? 'default' : 'crosshair', touchAction: 'none' }} data-testid="setup-svg"
              onPointerDown={(e) => {
                const p = toSvg(e);
                if (mode === 'crop') { setDrag(p); setCrop({ x: p[0], y: p[1], w: 1, h: 1 }); }
                if (mode === 'calib') { if (!p1 || p2) { setP1(p); setP2(null); } else setP2(p); }
              }}
              onPointerMove={(e) => { if (mode === 'crop' && drag) { const p = toSvg(e); setCrop({ x: Math.min(drag[0], p[0]), y: Math.min(drag[1], p[1]), w: Math.abs(p[0] - drag[0]), h: Math.abs(p[1] - drag[1]) }); } }}
              onPointerUp={() => { setDrag(null); if (crop && (crop.w < 20 || crop.h < 20)) setCrop(null); }}>
              <image href={page.imageUrl} width={page.width} height={page.height} transform={rotationMatrix(page.width, page.height, rotation)} />
              {crop && <path d={`M0 0H${R.w}V${R.h}H0Z M${crop.x} ${crop.y}v${crop.h}h${crop.w}v${-crop.h}Z`} fill="rgba(20,30,40,.45)" fillRule="evenodd" />}
              {crop && <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="none" stroke="#b07a34" strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 2}`} />}
              {p1 && <circle cx={p1[0]} cy={p1[1]} r={stroke * 4} fill="#c0392b" />}
              {p2 && <circle cx={p2[0]} cy={p2[1]} r={stroke * 4} fill="#c0392b" />}
              {p1 && p2 && <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#c0392b" strokeWidth={stroke * 1.5} />}
            </svg>
          </div>
        ) : <div className="empty">Page vectorielle (DXF) : pas d’image à recadrer ni à calibrer.</div>}
      </section>
      <aside className="card stack">
        <h2>Calibration</h2>
        {page.imageUrl ? <>
          <div className="small">Distance mesurée : <b>{pxDist ? `${pxDist.toFixed(1)} px` : '—'}</b></div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}><span>Dimension connue</span><input value={known} onChange={(e) => setKnown(e.target.value)} inputMode="decimal" placeholder="ex. 5" data-testid="known-dim" /></label>
            <label className="field"><span>Unité</span><select value={unit} onChange={(e) => setUnit(e.target.value as any)}><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select></label>
          </div>
          <div className="small">Échelle actuelle : {page.scale ? `${(1 / page.scale).toFixed(2)} px/m` : <b style={{ color: 'var(--c-warning)' }}>non calibrée (0,01 m/px supposé, donnée estimée)</b>}</div>
          {newScale && <div className="small">Nouvelle échelle : <b>{(1 / newScale).toFixed(2)} px/m</b> · page utile ≈ {((crop?.w ?? R.w) * newScale).toFixed(2)} × {((crop?.h ?? R.h) * newScale).toFixed(2)} m</div>}
        </> : <div className="small muted">Coordonnées DXF converties en mètres.</div>}
        <h2 style={{ marginTop: 10 }}>3. Niveau et hauteur</h2>
        <label className="field"><span>Étage associé</span><select value={floorId} onChange={(e) => { setFloorId(e.target.value); const f = floors.find((x) => x.id === e.target.value); if (f) { setFloorHeight(String(f.height_m)); setLevelLabel(`${f.code} · ${f.name}`); } }} data-testid="floor-select">
          <option value="">— non associé —</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.name}</option>)}</select></label>
        <label className="field"><span>Libellé du niveau</span><input value={levelLabel} onChange={(e) => setLevelLabel(e.target.value)} /></label>
        <label className="field"><span>Hauteur sous plafond / d’étage (m)</span><input value={floorHeight} onChange={(e) => setFloorHeight(e.target.value)} inputMode="decimal" /></label>
        <p className="small muted">L’altitude du niveau provient de l’étage associé (modifiable dans le projet). Unités : mètres.</p>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : 'Enregistrer les réglages'}</button>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text}</div>}
        <Link className="btn" href={`/projects/${projectId}/editor/${page.id}`}>4. Tracer / corriger dans l’éditeur →</Link>
      </aside>
    </div>
  );
}
