import { NextResponse } from 'next/server';
import { asUser } from '@/lib/auth';
import { apiError } from '@/lib/http';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const j = await asUser((x) => x.query(`select id, type, status, progress, result, error, created_at, started_at, finished_at, attempts from immo.jobs where id=$1`, [id]).then((r) => r.rows[0]));
    if (!j) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    return NextResponse.json(j);
  } catch (e) { return apiError(e); }
}
