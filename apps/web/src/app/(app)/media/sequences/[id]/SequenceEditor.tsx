'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { totalDuration, type Shot } from '@immo/core';
import type { SceneData } from '@/lib/scene-types';
import { saveSequence, startExport } from '../../actions';

const Scene3D = dynamic(() => import('@/components/visit/Scene3D').then((m) => m.Scene3D), { ssr: false });

interface Props {
  seq: any; scene: SceneData; images: { id: string; original_name: string | null }[]; audio: { id: string; original_name: string | null }[];
  jobs: { id: string; status: string; progress: number; error: string | null; result: any; created_at: string }[]; canEdit: boolean;
}

export function SequenceEditor({ seq, scene, images, audio, jobs, canEdit }: Props) {
  const router = useRouter();
  const [name, setName] = useState(seq.name);
  const [kind, setKind] = useState(seq.kind);
  const [aspect, setAspect] = useState<'16:9' | '9:16'>(seq.aspect);
  const [resolution, setResolution] = useState(seq.resolution === '2160p' ? '1080p' : seq.resolution);
  const [fps, setFps] = useState<24 | 25 | 30>(seq.fps);
  const [shots, setShots] = useState<Shot[]>(seq.shots);
  const [overlay, setOverlay] = useState(seq.overlay ?? {});
  const [preview, setPreview] = useState<{ shots: Shot[]; start: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const vps = scene.viewpoints;
  const label = (id: string) => vps.find((v) => v.id === id)?.label ?? '⚠ point de vue supprimé';
  const upd = (fn: (s: Shot[]) => Shot[]) => { setShots(fn); setDirty(true); };
  const move = (i: number, d: number) => upd((s) => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const total = totalDuration(shots);
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => { if (!active) return; const t = setInterval(() => router.refresh(), 3000); return () => clearInterval(t); }, [active, router]);

  async function save() {
    const r = await saveSequence({ id: seq.id, name, kind, aspect, resolution, fps, shots, overlay: { ...overlay, logo_media_id: overlay.logo_media_id || null, music_media_id: overlay.music_media_id || null } });
    setMsg(r.ok ? { ok: true, text: 'Séquence enregistrée.' } : { ok: false, text: r.error });
    if (r.ok) { setDirty(false); router.refresh(); }
    return r.ok;
  }
  async function exportVideo() {
    if (dirty && !(await save())) return;
    const r = await startExport(seq.id, resolution);
    setMsg(r.ok ? { ok: true, text: 'Export ajouté à la file. Le statut ci-dessous reflète le traitement réel du worker.' } : { ok: false, text: r.error });
    router.refresh();
  }
  const overview = vps.find((v) => v.kind === 'overview') ?? vps[0];
  const ratio = aspect === '16:9' ? 16 / 9 : 9 / 16;
  return (
    <div className="grid grid-side">
      <div className="stack" style={{ gap: 14 }}>
        <section className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>Prévisualisation du parcours</h2>
            <div className="row"><button className="btn btn-sm" onClick={() => setPreview(preview ? null : { shots, start: performance.now() })} disabled={!shots.length} data-testid="preview">{preview ? '■ Arrêter' : '▶ Lire'}</button><span className="small muted">{total.toFixed(1)} s</span></div></div>
          <div style={{ margin: '10px auto 0', width: aspect === '16:9' ? '100%' : 'min(100%, 340px)', aspectRatio: String(ratio), position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
            <Scene3D data={scene} statusColors={false} selectedLotId={null} isolate={null} sectionHeight={null} flyTo={null} tour={preview} onTourEnd={() => setPreview(null)}
              initialPose={overview ? { position: overview.position, target: overview.target, fov: Number(overview.fov) } : { position: [80, 70, 90], target: [0, 0, 0], fov: 45 }} />
            {overlay.title && <div style={{ position: 'absolute', insetInlineStart: '6%', bottom: '10%', color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,.6)', pointerEvents: 'none' }}><div style={{ fontWeight: 700, fontSize: 20 }}>{overlay.title}</div><div>{overlay.subtitle}</div></div>}
          </div>
        </section>
        <section className="card">
          <h2>Plans (caméras clés)</h2>
          {shots.length === 0 ? <div className="empty">Ajoutez des points de vue enregistrés.</div> : <table className="table small" data-testid="shots"><thead><tr><th>#</th><th>Point de vue</th><th>Durée (s)</th><th>Transition d’entrée</th><th /></tr></thead><tbody>
            {shots.map((s, i) => <tr key={i}><td>{i + 1}</td>
              <td><select value={s.viewpoint_id} disabled={!canEdit} onChange={(e) => upd((x) => x.map((y, j) => (j === i ? { ...y, viewpoint_id: e.target.value } : y)))}>{vps.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>{!vps.some((v) => v.id === s.viewpoint_id) && <span style={{ color: 'var(--c-danger)' }}> {label(s.viewpoint_id)}</span>}</td>
              <td><input type="number" min={0.5} max={60} step={0.5} value={s.duration_s} disabled={!canEdit} onChange={(e) => upd((x) => x.map((y, j) => (j === i ? { ...y, duration_s: Number(e.target.value) } : y)))} style={{ width: 70 }} /></td>
              <td><select value={s.transition} disabled={!canEdit} onChange={(e) => upd((x) => x.map((y, j) => (j === i ? { ...y, transition: e.target.value as Shot['transition'] } : y)))}><option value="move">Déplacement fluide</option><option value="cut">Coupe franche</option><option value="fade">Fondu au noir</option></select></td>
              <td className="nowrap">{canEdit && <><button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</button><button className="btn btn-sm" disabled={i === shots.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</button><button className="btn btn-sm btn-danger" onClick={() => upd((x) => x.filter((_, j) => j !== i))} aria-label="Retirer">×</button></>}</td></tr>)}
          </tbody></table>}
          {canEdit && <div className="row" style={{ marginTop: 8 }}>
            <select id="addvp" defaultValue="" aria-label="Point de vue à ajouter" data-testid="add-vp"><option value="" disabled>Ajouter un point de vue…</option>{vps.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
            <button className="btn btn-sm" onClick={() => { const v = (document.getElementById('addvp') as HTMLSelectElement).value; if (v) upd((s) => [...s, { viewpoint_id: v, duration_s: 3, transition: s.length ? 'move' : 'cut' }]); }} data-testid="add-shot">Ajouter</button>
            <span className="small muted">Créez de nouveaux points de vue depuis la visite interactive.</span>
          </div>}
        </section>
      </div>
      <aside className="stack" style={{ gap: 14 }}>
        <section className="card stack">
          <h2>Paramètres</h2>
          <label className="field"><span>Nom</span><input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} disabled={!canEdit} /></label>
          <label className="field"><span>Usage</span><select value={kind} onChange={(e) => { setKind(e.target.value); setDirty(true); }} disabled={!canEdit}><option value="video">Vidéo</option><option value="tour">Parcours de visite (affiché dans la visite)</option></select></label>
          <div className="row">
            <label className="field"><span>Format</span><select value={aspect} onChange={(e) => { setAspect(e.target.value as any); setDirty(true); }} disabled={!canEdit} data-testid="aspect"><option value="16:9">16:9 (paysage)</option><option value="9:16">9:16 (vertical)</option></select></label>
            <label className="field"><span>Définition</span><select value={resolution} onChange={(e) => { setResolution(e.target.value); setDirty(true); }} disabled={!canEdit} data-testid="resolution"><option value="720p">720p</option><option value="1080p">1080p</option><option value="2160p" disabled>4K (indisponible : pas de GPU)</option></select></label>
            <label className="field"><span>Images/s</span><select value={fps} onChange={(e) => { setFps(Number(e.target.value) as any); setDirty(true); }} disabled={!canEdit}><option value={24}>24</option><option value={25}>25</option><option value={30}>30</option></select></label>
          </div>
          <label className="field"><span>Titre</span><input value={overlay.title ?? ''} onChange={(e) => { setOverlay({ ...overlay, title: e.target.value }); setDirty(true); }} disabled={!canEdit} /></label>
          <label className="field"><span>Sous-titre</span><input value={overlay.subtitle ?? ''} onChange={(e) => { setOverlay({ ...overlay, subtitle: e.target.value }); setDirty(true); }} disabled={!canEdit} /></label>
          <label className="field"><span>Logo</span><select value={overlay.logo_media_id ?? ''} onChange={(e) => { setOverlay({ ...overlay, logo_media_id: e.target.value }); setDirty(true); }} disabled={!canEdit}><option value="">Aucun</option>{images.map((m) => <option key={m.id} value={m.id}>{m.original_name ?? m.id}</option>)}</select></label>
          <label className="field"><span>Musique (fichier fourni)</span><select value={overlay.music_media_id ?? ''} onChange={(e) => { setOverlay({ ...overlay, music_media_id: e.target.value }); setDirty(true); }} disabled={!canEdit}><option value="">Aucune</option>{audio.map((m) => <option key={m.id} value={m.id}>{m.original_name ?? m.id}</option>)}</select></label>
          {canEdit && <button className="btn" onClick={save} disabled={!dirty} data-testid="save-seq">Enregistrer</button>}
          {canEdit && kind === 'video' && <button className="btn btn-primary" onClick={exportVideo} disabled={!shots.length || active} data-testid="export">Exporter en MP4 ({resolution}, {aspect})</button>}
          {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text}</div>}
        </section>
        <section className="card">
          <h2>Exports de cette séquence</h2>
          {jobs.length === 0 ? <div className="empty">Aucun export.</div> : jobs.map((j) => (
            <div key={j.id} className="small" style={{ marginBottom: 8 }} data-job-status={j.status}>
              {new Date(j.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })} — {j.status === 'queued' ? 'en file (worker requis)' : j.status === 'running' ? `rendu ${Math.round(j.progress)} %` : j.status === 'done' ? 'terminé' : 'erreur'}
              {j.status === 'running' && <div className="progress"><span style={{ width: `${j.progress}%` }} /></div>}
              {j.status === 'done' && j.result && <div><a href={`/api/files/${j.result.media_id}?download=1`}>Télécharger le MP4</a> — {j.result.width}×{j.result.height}, {Number(j.result.duration).toFixed(2)} s, {j.result.codec} (vérifié)</div>}
              {j.status === 'error' && <div style={{ color: 'var(--c-danger)' }}>{j.error}</div>}
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
