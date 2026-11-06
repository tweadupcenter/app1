import { NextResponse } from 'next/server';
import { publicTx } from '@/lib/db';
import { apiError, fileResponse } from '@/lib/http';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

/** Fichier public : uniquement s'il fait partie d'une publication active (révocable). */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const m = await publicTx((x) => x.query('select * from immo.public_media_allowed($1,$2)', [slug, id]).then((r) => r.rows[0]));
    if (!m) return NextResponse.json({ error: 'Introuvable ou publication révoquée' }, { status: 404 });
    return fileResponse(await storage().get(m.storage_key), m.mime, { isPublic: true });
  } catch (e) { return apiError(e); }
}
