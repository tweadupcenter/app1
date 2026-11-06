'use client';
import { SceneViewer } from '@/components/visit/SceneViewer';
import type { SceneData } from '@/lib/scene-types';
import type { Locale } from '@/lib/i18n';
import { deleteViewpoint, saveViewpoint } from './actions';

export function InternalVisit({ data, locale, canManage, canSell, initialLotId }: { data: SceneData; locale: Locale; canManage: boolean; canSell: boolean; initialLotId?: string | null }) {
  return (
    <SceneViewer data={data} locale={locale} initialLotId={initialLotId} statusUrl={`/api/projects/${data.project.id}/statuses`}
      lotHref={(l) => `/lots/${l.id}`} pdfHref={(l) => `/api/lots/${l.id}/pdf`}
      admin={canManage || canSell ? {
        saveViewpoint: canManage ? async (i) => { const r = await saveViewpoint({ ...i, projectId: data.project.id, kind: i.kind as any }); return r.ok ? { ok: true } : { ok: false, error: r.error }; } : async () => ({ ok: false, error: 'Réservé aux administrateurs et chefs de projet.' }),
        deleteViewpoint: async (id) => { const r = await deleteViewpoint(id); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
        uploadCapture: async (blob) => {
          const fd = new FormData(); fd.set('purpose', 'capture'); fd.set('project_id', data.project.id); fd.set('file', new File([blob], 'capture.png', { type: 'image/png' }));
          const r = await fetch('/api/upload', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}));
          return r.ok ? { ok: true } : { ok: false, error: j.error ?? 'Erreur' };
        },
      } : undefined} />
  );
}
