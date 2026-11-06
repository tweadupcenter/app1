import { NextResponse } from 'next/server';
import { z } from 'zod';
import { casablancaLocalToIso } from '@immo/core';
import { assertSameOrigin } from '@/lib/auth';
import { publicTx } from '@/lib/db';
import { apiError } from '@/lib/http';

const schema = z.object({
  kind: z.enum(['info', 'appointment']),
  full_name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(200).or(z.literal('')).optional(),
  phone: z.string().trim().max(40).regex(/^[+\d\s().-]*$/).optional(),
  message: z.string().max(4000).optional(),
  lot_id: z.string().uuid().nullable().optional(),
  preferred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).or(z.literal('')).optional(),
  consent: z.literal(true, { message: 'Consentement requis' }),
  idempotency_key: z.string().min(8).max(80),
  website: z.string().max(0).optional(), // champ piège anti-robots
});

const hits = new Map<string, number[]>();

/** Demande publique : crée un intérêt commercial, ne réserve jamais un logement. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await assertSameOrigin(req);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const now = Date.now();
    const h = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (h.length >= 10) return NextResponse.json({ error: 'Trop de demandes. Réessayez plus tard.' }, { status: 429 });
    hits.set(ip, [...h, now]);
    const { slug } = await params;
    const v = schema.parse(await req.json());
    if (!v.email && !v.phone) return NextResponse.json({ error: 'Indiquez un e-mail ou un téléphone.' }, { status: 400 });
    const preferred = v.kind === 'appointment' && v.preferred_at ? casablancaLocalToIso(v.preferred_at) : null;
    if (preferred && new Date(preferred).getTime() < now) return NextResponse.json({ error: 'Le créneau souhaité doit être dans le futur.' }, { status: 400 });
    const r = await publicTx((x) => x.query(`select immo.public_submit_inquiry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`,
      [slug, v.kind, v.full_name, v.email || null, v.phone || null, v.message || null, v.lot_id ?? null, preferred, v.consent, v.idempotency_key]));
    return NextResponse.json(r.rows[0].r);
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: 'Formulaire incomplet ou invalide : ' + e.issues.map((i) => i.path.join('.')).join(', ') }, { status: 400 });
    return apiError(e);
  }
}
