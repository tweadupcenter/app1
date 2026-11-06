import { LOT_CSV_COLUMNS, toCsv } from '@immo/core';
import { asUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { lotFilterSql } from '@/lib/lot-filters';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const { where, params } = lotFilterSql(sp);
    const rows = await asUser((x) => x.query(`select l.reference, b.code batiment, f.level etage, l.type, l.rooms pieces, l.bedrooms chambres,
      l.surface_calc_m2 surface_calculee_m2, l.surface_comm_m2 surface_commerciale_m2, l.surface_terrace_m2 surface_terrasse_m2, l.surface_garden_m2 surface_jardin_m2,
      l.orientation, l.price prix, l.currency devise, case when l.price_public then 'oui' else 'non' end prix_public, l.status statut, l.features caracteristiques, l.description
      from immo.lots l left join immo.buildings b on b.id=l.building_id left join immo.floors f on f.id=l.floor_id ${where} order by b.code nulls last, f.level nulls last, l.reference`, params).then((r) => r.rows));
    const csv = toCsv(rows.map((r) => ({ ...r, surface_calculee_m2: r.surface_calculee_m2?.toString().replace('.', ','), surface_commerciale_m2: r.surface_commerciale_m2?.toString().replace('.', ','),
      surface_terrasse_m2: r.surface_terrasse_m2?.toString().replace('.', ','), surface_jardin_m2: r.surface_jardin_m2?.toString().replace('.', ',') })), LOT_CSV_COLUMNS);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="lots-${new Date().toISOString().slice(0, 10)}.csv"` } });
  } catch (e) { return apiError(e); }
}
