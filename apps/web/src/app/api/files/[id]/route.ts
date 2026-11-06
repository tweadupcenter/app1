import { asUser } from '@/lib/auth';
import { apiError, fileResponse } from '@/lib/http';
import { storage } from '@/lib/storage';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Fichier privé : accessible uniquement aux membres de l'organisation (RLS sur immo.media). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const m = await asUser((x) => x.query('select storage_key, mime, original_name from immo.media where id=$1', [id]).then((r) => r.rows[0]));
    if (!m) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const buf = await storage().get(m.storage_key);
    return fileResponse(buf, m.mime, { filename: m.original_name, download: new URL(req.url).searchParams.has('download') });
  } catch (e) { return apiError(e); }
}
