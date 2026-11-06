import { asUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { renderLotPdf } from '@/lib/lot-pdf';
import { storage } from '@/lib/storage';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await asUser(async (x) => {
      const l = (await x.query(`select l.*, b.name bname, f.name fname, p.name pname, p.city, p.is_fictional, o.name oname, o.contact
        from immo.lots l join immo.projects p on p.id=l.project_id join immo.organizations o on o.id=l.org_id
        left join immo.buildings b on b.id=l.building_id left join immo.floors f on f.id=l.floor_id where l.id=$1`, [id])).rows[0];
      if (!l) return null;
      const media = (await x.query(`select id, storage_key, mime from immo.media where id = any($1::uuid[]) or id=$2`, [l.image_media_ids, l.plan_media_id])).rows;
      return { l, media };
    });
    if (!data) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const { l, media } = data;
    const load = async (m: { storage_key: string; mime: string }) => ({ bytes: new Uint8Array(await storage().get(m.storage_key)), mime: m.mime });
    const plan = media.find((m) => m.id === l.plan_media_id);
    const pdf = await renderLotPdf({
      orgName: l.oname, contact: l.contact ?? {}, projectName: l.pname, city: l.city, fictional: l.is_fictional,
      lot: { ...l, building: l.bname, floor: l.fname, price: l.price_public ? l.price : null },
      plan: plan ? await load(plan) : null,
      images: await Promise.all(media.filter((m) => m.id !== l.plan_media_id).map(load)),
    });
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="lot-${l.reference}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return apiError(e); }
}
