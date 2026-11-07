'use client';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { formatM2, formatMAD, planToWorld, type CameraPose, type Vec2 } from '@immo/core';
import { translator, type Locale } from '@/lib/i18n';
import type { SceneData, SceneLot, SceneViewpoint } from '@/lib/scene-types';
import type { SceneApi, WallInfo } from './Scene3D';
import { polygonArea, type Vec2 as V2 } from '@immo/core';
import { Minimap } from './Minimap';

const Scene3D = dynamic(() => import('./Scene3D').then((m) => m.Scene3D), { ssr: false });

class Boundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export interface ViewerAdmin {
  saveViewpoint: (input: { id?: string; label: string; kind: string; pose: CameraPose; showInNav: boolean; sortOrder: number; buildingId?: string | null; amenityId?: string | null; lotId?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  deleteViewpoint: (id: string) => Promise<{ ok: boolean; error?: string }>;
  uploadCapture?: (blob: Blob) => Promise<{ ok: boolean; error?: string }>;
}

export interface SceneViewerProps {
  data: SceneData;
  locale?: Locale;
  lotHref: (lot: SceneLot) => string;
  pdfHref?: (lot: SceneLot) => string;
  initialLotId?: string | null;
  onInquire?: (lot: SceneLot) => void;
  admin?: ViewerAdmin;
  statusUrl?: string;
  className?: string;
}

const NAV_ORDER: Record<string, number> = { overview: 0, amenity: 1, building: 2, lot: 3, interior: 4 };

function useFavorites(projectId: string) {
  const key = `immo-fav-${projectId}`;
  const [fav, setFav] = useState<string[]>([]);
  useEffect(() => { try { setFav(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { /* stockage indisponible */ } }, [key]);
  const toggle = (id: string) => setFav((f) => { const n = f.includes(id) ? f.filter((x) => x !== id) : [...f, id]; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return { fav, toggle };
}

export function SceneViewer(p: SceneViewerProps) {
  const t = translator(p.locale ?? 'fr');
  const [data, setData] = useState(p.data);
  const [can3d, setCan3d] = useState<boolean | null>(null);
  const [error3d, setError3d] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedLot, setSelectedLot] = useState<string | null>(p.initialLotId ?? null);
  const [building, setBuilding] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [statusColors, setStatusColors] = useState(true);
  const [section, setSection] = useState<number | null>(null);
  const hasDrafts = !!data.drafts?.length;
  const [draft, setDraft] = useState({ show: hasDrafts && !data.model, showPlan: true, planOpacity: 0.85, wallHeight: null as number | null });
  const [wall, setWall] = useState<WallInfo | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => { try { setWide(window.matchMedia('(min-width: 761px)').matches); } catch { /* ignore */ } }, []);
  const [flyTo, setFlyTo] = useState<{ pose: CameraPose; key: number } | null>(null);
  const [activeVp, setActiveVp] = useState<string | null>(null);
  const [tour, setTour] = useState<{ shots: any[]; start: number } | null>(null);
  const [camPose, setCamPose] = useState<CameraPose | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  const [vpLabel, setVpLabel] = useState('');
  const api = useRef<SceneApi | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const { fav, toggle } = useFavorites(data.project.id);

  useEffect(() => { setCan3d(webglAvailable()); }, []);
  useEffect(() => { const on = () => setLoaded(true); window.addEventListener('immo-scene-loaded', on); return () => window.removeEventListener('immo-scene-loaded', on); }, []);
  // Statuts en direct : un changement de disponibilité se répercute dans la visite.
  useEffect(() => {
    if (!p.statusUrl) return;
    const tick = async () => {
      try {
        const r = await fetch(p.statusUrl!, { cache: 'no-store' });
        if (!r.ok) return;
        const s: Record<string, string> = await r.json();
        setData((d) => ({ ...d, lots: d.lots.map((l) => (s[l.id] && s[l.id] !== l.status ? { ...l, status: s[l.id] } : l)) }));
      } catch { /* hors ligne */ }
    };
    const i = setInterval(tick, 15000);
    return () => clearInterval(i);
  }, [p.statusUrl]);

  const amenityIds = new Set(data.amenities.map((a) => a.id));
  const buildingIds = new Set(data.buildings.map((b) => b.id));
  // Seuls les équipements et bâtiments réellement présents apparaissent dans la barre.
  const nav = useMemo(() => data.viewpoints
    .filter((v) => v.show_in_nav && (v.kind !== 'amenity' || (v.amenity_id && amenityIds.has(v.amenity_id))) && (v.kind !== 'building' || (v.building_id && buildingIds.has(v.building_id))))
    .sort((a, b) => (NAV_ORDER[a.kind] ?? 9) - (NAV_ORDER[b.kind] ?? 9) || a.sort_order - b.sort_order), [data.viewpoints]); // eslint-disable-line react-hooks/exhaustive-deps
  const overview = data.viewpoints.find((v) => v.kind === 'overview') ?? data.viewpoints[0];
  const draftPose = (): CameraPose | null => {
    const pts = (data.drafts ?? []).flatMap((d) => [...d.drawing.walls.flatMap((w) => [w.a, w.b]), ...d.drawing.rooms.flatMap((r) => r.points)]) as [number, number][];
    if (!pts.length) return null;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 6);
    return { position: [cx + size * 0.9, size * 1.1, -cy + size * 1.1], target: [cx, 0.5, -cy], fov: 45 };
  };
  const initialPose: CameraPose = overview ? { position: overview.position, target: overview.target, fov: Number(overview.fov) } : draftPose() ?? { position: [80, 70, 90], target: [0, 0, 0], fov: 45 };
  const lot = data.lots.find((l) => l.id === selectedLot) ?? null;
  const floorsOf = (b: string | null) => data.floors.filter((f) => f.building_id === b).sort((a, c) => a.level - c.level);
  const flyVp = (v: SceneViewpoint) => { setTour(null); setActiveVp(v.id); setFlyTo({ pose: { position: v.position, target: v.target, fov: Number(v.fov) }, key: Date.now() }); };

  const selectBuilding = useCallback((id: string | null) => {
    setBuilding(id); setLevel(null);
    if (!id) return;
    const v = data.viewpoints.find((x) => x.kind === 'building' && x.building_id === id);
    if (v) flyVp(v);
    else {
      const b = data.buildings.find((x) => x.id === id);
      const fp = b?.footprint as Vec2[] | null;
      if (fp?.length) {
        const c: Vec2 = [fp.reduce((s, q) => s + q[0], 0) / fp.length, fp.reduce((s, q) => s + q[1], 0) / fp.length];
        const top = Math.max(3, ...floorsOf(id).map((f) => Number(f.elevation_m) + Number(f.height_m)));
        const tgt = planToWorld(c, top / 2);
        setFlyTo({ pose: { position: [tgt[0] + 20, top + 18, tgt[2] + 40], target: tgt, fov: 45 }, key: Date.now() });
      }
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectLot = (id: string | null) => {
    setSelectedLot(id);
    if (!id) return;
    const l = data.lots.find((x) => x.id === id);
    if (l?.building_id && l.building_id !== building) setBuilding(l.building_id);
  };
  useEffect(() => { if (p.initialLotId) selectLot(p.initialLotId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPoi = (amenityId: string) => { const v = data.viewpoints.find((x) => x.amenity_id === amenityId); if (v) flyVp(v); };
  const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen?.(); };
  const addCompare = (id: string) => {
    if (compare.includes(id)) { setCompare(compare.filter((x) => x !== id)); return; }
    if (compare.length >= 3) { setCompareMsg(t('public.compareMax')); return; }
    setCompareMsg(null); setCompare([...compare, id]);
  };
  const capture = async () => {
    if (!api.current) return;
    const url = api.current.capture('image/png');
    const a = document.createElement('a'); a.href = url; a.download = `${data.project.slug}-capture.png`; a.click();
    if (p.admin?.uploadCapture) {
      const blob = await (await fetch(url)).blob();
      const r = await p.admin.uploadCapture(blob);
      setAdminMsg(r.ok ? 'Capture enregistrée dans les médias.' : r.error ?? 'Erreur');
    }
  };
  const saveVp = async (existing?: SceneViewpoint) => {
    if (!api.current || !p.admin) return;
    const label = existing?.label ?? vpLabel.trim();
    if (!label) { setAdminMsg('Indiquez un libellé.'); return; }
    const r = await p.admin.saveViewpoint({
      id: existing?.id, label, kind: existing?.kind ?? (lot ? 'lot' : building ? 'building' : 'shot'), pose: api.current.getPose(),
      showInNav: existing?.show_in_nav ?? !lot, sortOrder: existing?.sort_order ?? data.viewpoints.length,
      buildingId: existing ? existing.building_id : building, amenityId: existing?.amenity_id ?? null, lotId: existing ? existing.lot_id : lot?.id ?? null,
    });
    setAdminMsg(r.ok ? 'Point de vue enregistré (rechargez pour le voir dans la barre).' : r.error ?? 'Erreur');
    if (r.ok) setVpLabel('');
  };

  const fallback = (
    <div className="card" data-testid="fallback" style={{ height: '100%', overflow: 'auto' }}>
      <div className="alert alert-warning">{error3d ? `La 3D n’a pas pu être chargée (${error3d}).` : t('visit.fallback')}</div>
      <h2 style={{ marginTop: 12 }}>{t('public.plans')}</h2>
      {data.planImages.length + data.gallery.length === 0 ? <div className="empty">Aucun plan ni image publié.</div> : (
        <div className="thumbs">{[...data.planImages.map((x) => ({ id: x.id, label: x.label })), ...data.gallery.map((g) => ({ id: g.id, label: '' }))].map((m) => (
          <a key={m.id} href={`${data.fileBase}${m.id}`} target="_blank" rel="noreferrer"><img src={`${data.fileBase}${m.id}`} alt={m.label || 'Image du projet'} /><div className="small">{m.label}</div></a>
        ))}</div>
      )}
      <h2 style={{ marginTop: 12 }}>{t('public.lots')}</h2>
      <div className="lot-cards">{data.lots.map((l) => <a key={l.id} className="lot-card" href={p.lotHref(l)}><b>{l.reference}</b><span className={`badge st-${l.status}`}>{t(`status.${l.status}`)}</span><span className="small">{l.rooms ?? '—'} p. · {formatM2(l.surface_comm_m2)}</span></a>)}</div>
    </div>
  );

  if (can3d === false || error3d) return <div className={`viewer ${p.className ?? ''}`} style={{ background: 'var(--c-bg)' }}>{fallback}</div>;
  const blds = data.buildings;
  return (
    <div ref={wrap} className={`viewer ${p.className ?? ''}`} data-testid="viewer" data-loaded={loaded ? '1' : '0'}>
      {can3d && <Boundary onError={(e) => setError3d(e.message)}>
        <Scene3D data={data} statusColors={statusColors} selectedLotId={selectedLot} isolate={building && level != null ? { buildingId: building, level } : null}
          sectionHeight={section} flyTo={flyTo} tour={tour} onTourEnd={() => setTour(null)} onSelectLot={selectLot} onSelectBuilding={(id) => selectBuilding(id)}
          onPoi={onPoi} onCamera={setCamPose} onReady={(a) => { api.current = a; }} initialPose={initialPose} draft={draft} onWallInfo={setWall} />
      </Boundary>}
      {!loaded && <div className="vbadge" style={{ top: '50%', bottom: 'auto' }}>{t('common.loading')}</div>}
      <nav className="vnav" aria-label="Points de visite" data-testid="vnav">
        {nav.map((v) => <button key={v.id} className={activeVp === v.id ? 'on' : ''} onClick={() => flyVp(v)} data-vp={v.kind}>{v.kind === 'overview' ? t('visit.overview') : v.label}</button>)}
      </nav>
      <div className="vpanel tools" data-testid="tools">
        <button className="btn btn-sm" onClick={() => { if (overview) flyVp(overview); setBuilding(null); setLevel(null); }}>{t('visit.recenter')}</button>
        <button className="btn btn-sm" onClick={fullscreen}>{t('visit.fullscreen')}</button>
        <label className="field"><span>{t('visit.building')}</span>
          <select value={building ?? ''} onChange={(e) => selectBuilding(e.target.value || null)} data-testid="sel-building"><option value="">—</option>{blds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {building && <label className="field"><span>{t('visit.floor')} — {t('visit.hideAbove').toLowerCase()}</span>
          <select value={level ?? ''} onChange={(e) => setLevel(e.target.value === '' ? null : Number(e.target.value))} data-testid="sel-floor">
            <option value="">{t('visit.allFloors')}</option>{floorsOf(building).map((f) => <option key={f.id} value={f.level}>{f.name}</option>)}</select></label>}
        <label className="check small"><input type="checkbox" checked={statusColors} onChange={(e) => setStatusColors(e.target.checked)} /> <span>{t('visit.statusColors')}</span></label>
        <label className="check small"><input type="checkbox" checked={section != null} onChange={(e) => setSection(e.target.checked ? 2.5 : null)} data-testid="section" /> <span>{t('visit.section')}</span></label>
        {section != null && <input type="range" min={0.3} max={20} step={0.1} value={section} onChange={(e) => setSection(Number(e.target.value))} aria-label="Hauteur de coupe" />}
        {data.tours.length > 0 && data.tours.map((tr) => <button key={tr.id} className={`btn btn-sm ${tour ? 'on' : ''}`} onClick={() => setTour(tour ? null : { shots: tr.shots, start: performance.now() })} data-testid="tour">{tour ? '■ ' : '▶ '}{t('visit.tour')} : {tr.name}</button>)}
        {data.viewpoints.filter((v) => v.kind === 'interior').map((v) => <button key={v.id} className="btn btn-sm" onClick={() => flyVp(v)}>{v.label}</button>)}
        <button className="btn btn-sm" onClick={capture}>Capturer l’image</button>
        <div className="small muted">{t('visit.favorites')} : {fav.length}</div>
        {fav.length > 0 && <div className="row">{fav.map((id) => { const l = data.lots.find((x) => x.id === id); return l ? <button key={id} className="btn btn-sm" onClick={() => selectLot(id)}>★ {l.reference}</button> : null; })}</div>}
        {hasDrafts && <div className="stack" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 6 }} data-testid="draft-panel">
          <b className="small">Ébauche des plans</b>
          <label className="check small"><input type="checkbox" checked={draft.show} onChange={(e) => setDraft({ ...draft, show: e.target.checked })} data-testid="draft-toggle" /> <span>Afficher le tracé (non validé)</span></label>
          {draft.show && <>
            <label className="check small"><input type="checkbox" checked={draft.showPlan} onChange={(e) => setDraft({ ...draft, showPlan: e.target.checked })} /> <span>Plan sous la maquette</span></label>
            <label className="field"><span>Opacité du plan</span><input type="range" min={0} max={1} step={0.05} value={draft.planOpacity} onChange={(e) => setDraft({ ...draft, planOpacity: Number(e.target.value) })} /></label>
            <label className="field"><span>Hauteur des murs : {draft.wallHeight ? `${draft.wallHeight.toFixed(1).replace('.', ',')} m` : 'réelle'}</span>
              <input type="range" min={0.5} max={3.5} step={0.1} value={draft.wallHeight ?? 3.5} onChange={(e) => { const v = Number(e.target.value); setDraft({ ...draft, wallHeight: v >= 3.5 ? null : v }); }} aria-label="Hauteur des murs" /></label>
          </>}
        </div>}
        {p.admin && <div className="stack" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 6 }}>
          <b className="small">Points de visite (administration)</b>
          <input placeholder="Libellé du nouveau point" value={vpLabel} onChange={(e) => setVpLabel(e.target.value)} data-testid="vp-label" />
          <button className="btn btn-sm" onClick={() => saveVp()} data-testid="vp-save">Enregistrer la vue actuelle</button>
          {activeVp && (() => { const v = data.viewpoints.find((x) => x.id === activeVp); return v ? <>
            <button className="btn btn-sm" onClick={() => saveVp(v)}>Remplacer « {v.label} » par la vue actuelle</button>
            <button className="btn btn-sm btn-danger" onClick={async () => { if (confirm(`Supprimer « ${v.label} » ?`)) { const r = await p.admin!.deleteViewpoint(v.id); setAdminMsg(r.ok ? 'Supprimé (rechargez).' : r.error ?? ''); } }}>Supprimer ce point</button></> : null; })()}
          {adminMsg && <div className="small" role="status">{adminMsg}</div>}
        </div>}
      </div>
      {lot && (
        <div className="vpanel lot" data-testid="lot-panel" data-lot={lot.reference}>
          <div className="row between"><h3 style={{ margin: 0 }}>{lot.reference}</h3><button className="btn btn-sm" onClick={() => setSelectedLot(null)} aria-label={t('common.close')}>×</button></div>
          <span className={`badge st-${lot.status}`} data-status={lot.status}>{t(`status.${lot.status}`)}</span>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>{t('lot.building')}</dt><dd>{data.buildings.find((b) => b.id === lot.building_id)?.name ?? '—'}</dd>
            <dt>{t('lot.floor')}</dt><dd>{data.floors.find((f) => f.id === lot.floor_id)?.name ?? '—'}</dd>
            <dt>Type</dt><dd>{t(`type.${lot.type}`)}</dd>
            <dt>{t('lot.rooms')}</dt><dd>{lot.rooms ?? '—'}</dd>
            <dt>{t('lot.surface')}</dt><dd>{formatM2(lot.surface_comm_m2)}</dd>
            {lot.surface_terrace_m2 != null && <><dt>{t('lot.terrace')}</dt><dd>{formatM2(lot.surface_terrace_m2)}</dd></>}
            {lot.surface_garden_m2 != null && <><dt>{t('lot.garden')}</dt><dd>{formatM2(lot.surface_garden_m2)}</dd></>}
            <dt>{t('lot.orientation')}</dt><dd>{lot.orientation ?? '—'}</dd>
            <dt>{t('lot.price')}</dt><dd>{lot.price_public && lot.price != null ? formatMAD(lot.price, p.locale) : t('lot.priceOnRequest')}</dd>
          </dl>
          {lot.features.length > 0 && <p className="small">{lot.features.join(' · ')}</p>}
          <div className="stack">
            <a className="btn btn-primary btn-sm" href={p.lotHref(lot)} data-testid="open-lot">{t('lot.open')}</a>
            {p.pdfHref && <a className="btn btn-sm" href={p.pdfHref(lot)} target="_blank" rel="noreferrer">{t('lot.pdf')}</a>}
            <button className="btn btn-sm" onClick={() => toggle(lot.id)}>{fav.includes(lot.id) ? `★ ${t('lot.removeFavorite')}` : `☆ ${t('lot.addFavorite')}`}</button>
            <button className="btn btn-sm" onClick={() => addCompare(lot.id)} data-testid="compare-add">{compare.includes(lot.id) ? '− ' : '+ '}{t('visit.compare')} ({compare.length}/3)</button>
            {compareMsg && <div className="small" style={{ color: 'var(--c-warning)' }} role="status">{compareMsg}</div>}
            {p.onInquire && <button className="btn btn-accent btn-sm" onClick={() => p.onInquire!(lot)}>{t('public.requestInfo')}</button>}
          </div>
        </div>
      )}
      {draft.show && hasDrafts && !lot && (
        <div className="vpanel lot draft" data-testid="draft-info">
          <div className="row between"><h3 style={{ margin: 0 }}>Ébauche non validée</h3></div>
          {wall ? <div className="stack small" data-testid="wall-info" style={{ gap: 2 }}>
            <b>Mur {wall.id} — {wall.draft}</b>
            <span>Longueur {wall.lengthM.toFixed(2).replace('.', ',')} m · épaisseur {Math.round(wall.thickness * 100)} cm · hauteur {wall.height.toFixed(2).replace('.', ',')} m</span>
            <span>Statut : {t(`prov.${wall.provenance}`)}</span>
          </div> : <p className="small muted" style={{ margin: 0 }}>Cliquez un mur pour voir sa longueur et son statut.</p>}
          {data.drafts!.map((d) => (
            <div key={d.pageId} className="stack small" style={{ gap: 4, marginTop: 8 }}>
              <div className="row between"><b>{d.label}</b><a href={d.editorUrl}>Éditer (v{d.version})</a></div>
              <div>{['documented', 'estimated', 'proposed', 'validated'].map((k) => <span key={k} className={`tag prov-${k}`} style={{ marginInlineEnd: 4 }}>{t(`prov.${k}`)} {d.drawing.walls.filter((w) => w.provenance === k).length}</span>)}</div>
              {d.drawing.rooms.length > 0 && <details className="draft-rooms" open={wide} key={String(wide)}><summary className="small">Pièces tracées ({d.drawing.rooms.length})</summary><table className="table small"><thead><tr><th>Pièce</th><th className="right">Tracé</th><th>Statut</th></tr></thead><tbody>
                {d.drawing.rooms.map((r) => <tr key={r.id}><td>{r.name}</td><td className="right nowrap">{polygonArea(r.points as V2[]).toFixed(2).replace('.', ',')} m²</td><td>{t(`prov.${r.provenance}`)}</td></tr>)}
              </tbody></table></details>}
            </div>
          ))}
          <p className="small muted" style={{ marginBottom: 0 }}>Ce tracé n’est visible qu’en interne. Une fois validé, générez la maquette depuis l’éditeur.</p>
        </div>
      )}
      {compare.length > 0 && (
        <div className="vpanel compare" data-testid="compare">
          <div className="row between"><b>{t('visit.compare')}</b><button className="btn btn-sm" onClick={() => setCompare([])}>{t('common.close')}</button></div>
          <table className="table small"><tbody>
            <tr><th /> {compare.map((id) => <th key={id}>{data.lots.find((l) => l.id === id)?.reference}</th>)}</tr>
            {([['Type', (l: SceneLot) => t(`type.${l.type}`)], [t('lot.rooms'), (l: SceneLot) => l.rooms ?? '—'], [t('lot.surface'), (l: SceneLot) => formatM2(l.surface_comm_m2)],
              [t('lot.terrace'), (l: SceneLot) => formatM2(l.surface_terrace_m2)], [t('lot.floor'), (l: SceneLot) => data.floors.find((f) => f.id === l.floor_id)?.name ?? '—'],
              [t('lot.price'), (l: SceneLot) => (l.price_public && l.price != null ? formatMAD(l.price) : t('lot.priceOnRequest'))], ['Statut', (l: SceneLot) => t(`status.${l.status}`)]] as [string, (l: SceneLot) => ReactNode][])
              .map(([label, fn]) => <tr key={label}><th>{label}</th>{compare.map((id) => { const l = data.lots.find((x) => x.id === id)!; return <td key={id}>{fn(l)}</td>; })}</tr>)}
          </tbody></table>
        </div>
      )}
      <div className="vpanel mini"><Minimap data={data} pose={camPose} selectedBuilding={building} onBuilding={(id) => selectBuilding(id)} /></div>
      <div className="vbadge">{draft.show && hasDrafts ? 'Ébauche non validée · ' : ''}{data.model ? 'Maquette 3D' : hasDrafts ? 'Aucune maquette générée' : 'Volumes procéduraux (aucune maquette active)'} · {data.project.is_fictional ? t('public.fictional') : 'Géométrie indicative'}</div>
    </div>
  );
}
