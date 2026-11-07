'use client';
import { SceneViewer } from '@/components/visit/SceneViewer';
import type { SceneData } from '@/lib/scene-types';
import type { Locale } from '@/lib/i18n';
import { deleteViewpoint, saveViewpoint } from './actions';
import { uploadFile } from '@/lib/upload-client';

export function InternalVisit({ data, locale, canManage, canSell, initialLotId }: { data: SceneData; locale: Locale; canManage: boolean; canSell: boolean; initialLotId?: string | null }) {
  return (
    <SceneViewer data={data} locale={locale} initialLotId={initialLotId} statusUrl={`/api/projects/${data.project.id}/statuses`}
      lotHref={(l) => `/lots/${l.id}`} pdfHref={(l) => `/api/lots/${l.id}/pdf`}
      admin={canManage || canSell ? {
        saveViewpoint: canManage ? async (i) => { const r = await saveViewpoint({ ...i, projectId: data.project.id, kind: i.kind as any }); return r.ok ? { ok: true } : { ok: false, error: r.error }; } : async () => ({ ok: false, error: 'Réservé aux administrateurs et chefs de projet.' }),
        deleteViewpoint: async (id) => { const r = await deleteViewpoint(id); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
        uploadCapture: async (blob) => {
          try { await uploadFile(new File([blob], 'capture.png', { type: 'image/png' }), 'capture', { project_id: data.project.id }); return { ok: true }; }
          catch (e) { return { ok: false, error: (e as Error).message }; }
        },
      } : undefined} />
  );
}
