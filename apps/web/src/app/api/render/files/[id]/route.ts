import { NextResponse } from 'next/server';
import { verifyRenderToken } from '@immo/core/token';
import { tx } from '@/lib/db';
import { serveMedia } from '@/lib/http';

export const runtime = 'nodejs';

/** Fichiers nécessaires au rendu vidéo, accessibles avec le jeton signé de la séquence uniquement. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = verifyRenderToken(new URL(req.url).searchParams.get('token') ?? '');
  if (!c || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Jeton invalide' }, { status: 403 });
  const m = await tx({ userId: c.user, orgId: c.org }, (x) => x.query(`select storage_key, mime from immo.media where id=$1 and kind in ('model','logo','image')`, [id]).then((r) => r.rows[0]));
  if (!m) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  return serveMedia(m);
}
