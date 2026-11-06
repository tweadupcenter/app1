import { NextResponse } from 'next/server';
import { publicTx } from '@/lib/db';
import { apiError } from '@/lib/http';
import { renderLotPdf } from '@/lib/lot-pdf';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

/** Fiche PDF publique, générée exclusivement à partir de l'instantané publié. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string; lotId: string }> }) {
  try {
    const { slug, lotId } = await params;
    const pub = await publicTx((x) => x.query('select immo.public_get_publication($1) p', [slug]).then((r) => r.rows[0]?.p));
    const snap = pub?.snapshot;
    const lot = snap?.lots.find((l: any) => l.id === lotId);
    if (!lot) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const loadMedia = async (id: string | null) => {
      if (!id) return null;
      const m = await publicTx((x) => x.query('select * from immo.public_media_allowed($1,$2)', [slug, id]).then((r) => r.rows[0]));
      return m ? { bytes: new Uint8Array(await storage().get(m.storage_key)), mime: m.mime } : null;
    };
    const b = snap.buildings.find((x: any) => x.id === lot.building_id);
    const f = snap.floors.find((x: any) => x.id === lot.floor_id);
    const pdf = await renderLotPdf({
      orgName: snap.org.name, contact: snap.org.contact, projectName: snap.project.name, city: snap.project.city, fictional: snap.project.is_fictional,
      lot: { ...lot, building: b?.name, floor: f?.name },
      plan: await loadMedia(lot.plan_media_id),
      images: (await Promise.all((lot.image_media_ids ?? []).slice(0, 2).map(loadMedia))).filter(Boolean) as any,
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="lot-${lot.reference}.pdf"` } });
  } catch (e) { return apiError(e); }
}
