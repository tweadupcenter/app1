import { NextResponse } from 'next/server';
import { asUser } from '@/lib/auth';
import { apiError } from '@/lib/http';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const rows = await asUser(async (x) => { await x.query('select immo.expire_holds()'); return (await x.query(`select id, status from immo.lots where project_id=$1`, [id])).rows; });
    return NextResponse.json(Object.fromEntries(rows.map((r) => [r.id, r.status])), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
