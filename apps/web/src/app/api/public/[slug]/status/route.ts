import { NextResponse } from 'next/server';
import { publicTx } from '@/lib/db';

/** Statuts en direct des lots publiés (aucune autre donnée). */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await publicTx(async (x) => { await x.query('select immo.expire_holds()'); return (await x.query('select immo.public_get_publication($1) p', [slug])).rows[0]?.p; });
  if (!p) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  return NextResponse.json(p.statuses, { headers: { 'Cache-Control': 'no-store' } });
}
