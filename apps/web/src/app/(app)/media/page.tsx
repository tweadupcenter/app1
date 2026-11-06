import Link from 'next/link';
import { can, formatDateTime, totalDuration } from '@immo/core';
import { asUser } from '@/lib/auth';
import { PageHead, Empty } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { Uploader } from '@/components/Uploader';
import { AutoRefresh } from '@/components/AutoRefresh';
import { createSequence, deleteMedia, setMediaPublishable } from './actions';

export const metadata = { title: 'Médias et exports' };

export default async function Media({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const sp = await searchParams;
  const d = await asUser(async (x, s) => {
    const projects = (await x.query(`select id, name from immo.projects order by name`)).rows;
    const pid = sp.project ?? projects[0]?.id ?? null;
    return {
      role: s.role, projects, pid,
      media: pid ? (await x.query(`select id, kind, mime, original_name, width, height, duration_s, codec, size_bytes, meta, created_at from immo.media where project_id=$1 and kind in ('image','capture','video','audio') order by created_at desc limit 200`, [pid])).rows : [],
      sequences: pid ? (await x.query(`select * from immo.sequences where project_id=$1 order by kind, name`, [pid])).rows : [],
      jobs: (await x.query(`select j.*, s.name seq from immo.jobs j left join immo.sequences s on s.id = (j.payload->>'sequence_id')::uuid where j.type='video_export' order by j.created_at desc limit 15`)).rows,
    };
  });
  const manage = can(d.role, 'manageProject');
  const sell = can(d.role, 'sell');
  return (
    <>
      <PageHead title="Médias et exports" subtitle="Images, captures, vidéos exportées et fiches">
        <form method="get" className="row"><select name="project" defaultValue={d.pid ?? ''} aria-label="Projet">{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn btn-sm">Afficher</button></form>
      </PageHead>
      {d.jobs.some((j) => j.status === 'queued' || j.status === 'running') && <AutoRefresh seconds={3} />}
      <div className="grid grid-side">
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Séquences (vidéos et parcours)</h2>
            {d.sequences.length === 0 ? <Empty>Aucune séquence.</Empty> : <table className="table small"><thead><tr><th>Nom</th><th>Type</th><th>Format</th><th>Plans</th><th>Durée</th><th /></tr></thead><tbody>
              {d.sequences.map((s) => <tr key={s.id}><td><Link href={`/media/sequences/${s.id}`}>{s.name}</Link></td><td>{s.kind === 'tour' ? 'Parcours de visite' : 'Vidéo'}</td><td>{s.aspect} · {s.resolution}</td><td>{s.shots.length}</td><td>{totalDuration(s.shots)} s</td><td><Link className="btn btn-sm" href={`/media/sequences/${s.id}`}>Éditer</Link></td></tr>)}
            </tbody></table>}
            {sell && d.pid && <ActionForm action={createSequence} inline submitLabel="Créer" redirectTo="/media/sequences/{id}">
              <input type="hidden" name="project_id" value={d.pid} />
              <input name="name" required placeholder="Nom de la séquence" aria-label="Nom" />
              <select name="kind" aria-label="Type"><option value="video">Vidéo</option><option value="tour">Parcours de visite</option></select>
              <select name="aspect" aria-label="Format"><option value="16:9">16:9</option><option value="9:16">9:16</option></select>
            </ActionForm>}
          </section>
          <section className="card">
            <h2>Exports vidéo (statut réel)</h2>
            {d.jobs.length === 0 ? <Empty>Aucun export.</Empty> : <table className="table small" data-testid="exports"><thead><tr><th>Séquence</th><th>Demandé</th><th>Statut</th><th>Résultat</th></tr></thead><tbody>
              {d.jobs.map((j) => <tr key={j.id} data-job-status={j.status}><td>{j.seq ?? '—'} <span className="muted">{j.payload.resolution}</span></td><td>{formatDateTime(j.created_at)}</td>
                <td>{j.status === 'queued' && 'En file — démarrez le worker si rien ne bouge'}{j.status === 'running' && <><div className="progress" style={{ width: 120 }}><span style={{ width: `${j.progress}%` }} /></div>{Math.round(j.progress)} %</>}{j.status === 'done' && <span className="badge st-available">Terminé</span>}{j.status === 'error' && <span className="badge st-reserved">Erreur</span>}</td>
                <td>{j.status === 'done' && j.result?.media_id && <><a href={`/api/files/${j.result.media_id}?download=1`} data-testid="download-video">Télécharger MP4</a><div className="muted">{j.result.width}×{j.result.height} · {Number(j.result.duration).toFixed(2)} s · {j.result.codec} · {(j.result.size / 1048576).toFixed(1)} Mo (vérifié par ffprobe)</div></>}
                  {j.status === 'error' && <span style={{ color: 'var(--c-danger)' }}>{j.error}</span>}</td></tr>)}
            </tbody></table>}
          </section>
          <section className="card">
            <h2>Fichiers du projet</h2>
            {d.media.length === 0 ? <Empty>Aucun fichier.</Empty> : <div className="thumbs">{d.media.map((m) => (
              <div key={m.id} className="stack" style={{ gap: 4 }}>
                {m.kind === 'video' ? <video src={`/api/files/${m.id}`} controls preload="metadata" /> : m.kind === 'audio' ? <audio src={`/api/files/${m.id}`} controls style={{ width: '100%' }} /> : <a href={`/api/files/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${m.id}`} alt={m.original_name ?? ''} /></a>}
                <div className="small">{m.kind === 'capture' ? 'Capture' : m.kind === 'video' ? `Vidéo ${m.width}×${m.height} · ${Number(m.duration_s).toFixed(1)} s` : m.kind === 'audio' ? 'Audio' : 'Image'}{m.meta?.publishable ? ' · publiable' : ''}</div>
                {manage && <div className="row">
                  {m.kind !== 'audio' && <ActionForm action={setMediaPublishable} inline><input type="hidden" name="id" value={m.id} /><input type="hidden" name="publishable" value={m.meta?.publishable ? 'false' : 'true'} /><button className="btn btn-sm">{m.meta?.publishable ? 'Rendre privé' : 'Rendre publiable'}</button></ActionForm>}
                  <ActionForm action={deleteMedia} inline confirm="Supprimer ce fichier ?"><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-danger">×</button></ActionForm>
                </div>}
              </div>
            ))}</div>}
          </section>
        </div>
        <aside className="card stack">
          <h2>Ajouter</h2>
          {sell && d.pid ? <>
            <Uploader purpose="gallery" fields={{ project_id: d.pid }} accept="image/png,image/jpeg" label="Image (PNG/JPG, 20 Mo)" showPublishable />
            <Uploader purpose="audio" fields={{ project_id: d.pid }} accept="audio/mpeg,audio/wav,.mp3,.wav" label="Musique fournie (MP3/WAV, 30 Mo) — droits d’utilisation à votre charge" />
          </> : <p className="muted">Lecture seule.</p>}
          <div className="alert alert-info small">Les captures d’écran se font depuis la visite interactive (bouton « Capturer l’image »). Les fiches PDF des lots sont disponibles sur chaque fiche lot.</div>
          <div className="alert alert-warning small">Export : MP4 H.264 en 720p ou 1080p, rendu logiciel (sans GPU) dans cet environnement, donc lent (~0,3–1 s par image). Le 4K est désactivé faute de capacité de rendu adaptée.</div>
        </aside>
      </div>
    </>
  );
}
