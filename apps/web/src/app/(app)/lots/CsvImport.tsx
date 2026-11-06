'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/errors';
import { importLotsCsv } from './actions';

type Report = { plan: { line: number; op: string; ref: string }[]; errors: { line: number; reference?: string; messages: string[] }[]; committed: boolean };

/** Import CSV en deux temps : aperçu (aucune écriture) puis enregistrement transactionnel. */
export function CsvImport({ projects, defaultProject }: { projects: { id: string; name: string }[]; defaultProject: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState(defaultProject);
  const [mode, setMode] = useState('create');
  const [state, setState] = useState<ActionResult<Report> | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (commit: boolean) => start(async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file); fd.set('project_id', project); fd.set('mode', mode); fd.set('commit', commit ? '1' : '0');
    const r = (await importLotsCsv(null, fd)) as ActionResult<Report>;
    setState(r);
    if (r.ok && r.data?.committed) router.refresh();
  });
  const reset = () => setState(null);
  const data = state?.ok ? state.data : null;
  return (
    <div className="stack">
      <label className="field"><span>Projet cible</span><select value={project} onChange={(e) => { setProject(e.target.value); reset(); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>Fichier CSV</span><input type="file" name="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} /></label>
      <label className="field"><span>Mode</span><select value={mode} onChange={(e) => { setMode(e.target.value); reset(); }}><option value="create">Créer uniquement (doublons = erreur)</option><option value="upsert">Créer ou mettre à jour</option></select></label>
      <div className="row">
        <button className="btn" disabled={pending || !file} onClick={() => run(false)}>Aperçu</button>
        <button className="btn btn-primary" disabled={pending || !data || data.errors.length > 0 || data.committed || data.plan.length === 0} onClick={() => run(true)}>Enregistrer l’import</button>
      </div>
      {state && !state.ok && <div className="alert alert-error" role="alert">{state.error}</div>}
      {data && (
        <div className="stack small" data-testid="csv-report">
          <div className={`alert ${data.errors.length ? 'alert-error' : data.committed ? 'alert-success' : 'alert-info'}`}>
            {data.committed ? `Import enregistré : ${data.plan.length} ligne(s).` : `${data.plan.filter((p) => p.op === 'create').length} création(s), ${data.plan.filter((p) => p.op === 'update').length} mise(s) à jour, ${data.errors.length} erreur(s).`}
          </div>
          {data.errors.length > 0 && <table className="table"><thead><tr><th>Ligne</th><th>Réf.</th><th>Erreur</th></tr></thead><tbody>
            {data.errors.map((e, i) => <tr key={i}><td>{e.line}</td><td>{e.reference ?? '—'}</td><td>{e.messages.join(' ; ')}</td></tr>)}</tbody></table>}
        </div>
      )}
    </div>
  );
}
