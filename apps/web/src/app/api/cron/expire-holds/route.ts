import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { publicTx } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Expiration des options, appelée par la tâche planifiée Vercel (en-tête Authorization: Bearer CRON_SECRET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const n = await publicTx((x) => x.query('select immo.expire_holds() n').then((r) => r.rows[0].n));
  return NextResponse.json({ expired: n });
}
