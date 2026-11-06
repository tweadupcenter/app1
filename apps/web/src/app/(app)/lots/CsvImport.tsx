'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importLotsCsv } from './actions';

export function CsvImport({ projects, defaultProject }: { projects: { id: string; name: string }[]; defaultProject: string }) {
  const [state, run, pending] = useActionState(importLotsCsv, null);
  const commitRef = useRef<HTMLInputElement>(null);
  const [previewed, setPreviewed] = useState(false);
  const router = useRouter();
  const data = state?.ok ? state.data : null;
  useEffect(() => { if (data?.committed) router.refresh(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={run} className="stack" onChange={() => setPreviewed(false)}>
      <label className="field"><span>Projet cible</span><select name="project_id" defaultValue={defaultProject}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>Fichier CSV</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
      <label className="field"><span>Mode</span><select name="mode"><option value="create">Créer uniquement (doublons = erreur)</option><option value="upsert">Créer ou mettre à jour</option></select></label>
      <input ref={commitRef} type="hidden" name="commit" value="0" />
      <div className="row">
        <button className="btn" disabled={pending} onClick={() => { commitRef.current!.value = '0'; setPreviewed(true); }}>Aperçu</button>
        <button className="btn btn-primary" disabled={pending || !previewed || !data || data.errors.length > 0 || data.committed} onClick={() => { commitRef.current!.value = '1'; }}>Enregistrer l’import</button>
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
    </form>
  );
}
