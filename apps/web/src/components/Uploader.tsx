'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Envoi d'un fichier vers /api/upload ; affiche l'erreur exacte renvoyée par le serveur. */
export function Uploader({ purpose, fields = {}, accept, label, onDone, showPublishable }: {
  purpose: string; fields?: Record<string, string>; accept?: string; label: string; onDone?: (r: any) => void; showPublishable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pub, setPub] = useState(false);
  const router = useRouter();
  async function send(file: File) {
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set('purpose', purpose);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (showPublishable) fd.set('publishable', String(pub));
    fd.set('file', file);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({ error: `Réponse invalide (${r.status})` }));
      if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
      setMsg({ ok: true, text: 'Fichier reçu.' });
      onDone?.(j);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <label className="field"><span>{label}</span>
        <input type="file" accept={accept} disabled={busy} data-purpose={purpose}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
      </label>
      {showPublishable && <label className="check small"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> <span>Publiable sur la présentation publique</span></label>}
      {busy && <div className="small muted">Envoi en cours…</div>}
      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role="status">{msg.text}</div>}
    </div>
  );
}
