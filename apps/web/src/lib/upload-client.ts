'use client';

/**
 * Envoi d'un fichier : direct vers le stockage objet (S3) quand il est configuré — indispensable sur Vercel
 * (limite de 4,5 Mo par requête) — sinon par formulaire vers l'application.
 */
export async function uploadFile(file: File, purpose: string, fields: Record<string, string> = {}): Promise<any> {
  const init = await fetch('/api/upload/init', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose, filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }) });
  const ij = await init.json().catch(() => ({ error: `Réponse invalide (${init.status})` }));
  if (!init.ok) throw new Error(ij.error ?? `Erreur ${init.status}`);
  if (ij.mode === 'direct') {
    let put: Response;
    try { put = await fetch(ij.url, { method: 'PUT', headers: { 'Content-Type': ij.contentType }, body: file }); }
    catch { throw new Error('Envoi vers le stockage impossible (réseau ou règles CORS du bucket).'); }
    if (!put.ok) throw new Error(`Le stockage a refusé le fichier (${put.status}).`);
    const done = await fetch('/api/upload/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ij.token, ...fields }) });
    const dj = await done.json().catch(() => ({ error: `Réponse invalide (${done.status})` }));
    if (!done.ok) throw new Error(dj.error ?? `Erreur ${done.status}`);
    return dj;
  }
  const fd = new FormData();
  fd.set('purpose', purpose);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({ error: `Réponse invalide (${r.status})` }));
  if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
  return j;
}
