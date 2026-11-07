import { NextResponse } from 'next/server';
import { publicTx } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Sonde de santé pour l'hébergeur : application + base de données (aucune donnée exposée). */
export async function GET() {
  try {
    await publicTx((x) => x.query('select 1'));
    return NextResponse.json({ ok: true, db: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, db: 'indisponible' }, { status: 503 });
  }
}
