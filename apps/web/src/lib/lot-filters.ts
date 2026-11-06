import { LOT_STATUSES, LOT_TYPES } from '@immo/core';

type SP = Record<string, string | undefined>;

export function lotFilterSql(sp: SP) {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (sp.project) add('l.project_id = ?', sp.project);
  if (sp.building) add('l.building_id = ?', sp.building);
  if (sp.floor) add('l.floor_id = ?', sp.floor);
  if (sp.status && (LOT_STATUSES as readonly string[]).includes(sp.status)) add('l.status = ?', sp.status);
  if (sp.type && (LOT_TYPES as readonly string[]).includes(sp.type)) add('l.type = ?', sp.type);
  if (sp.rooms) add('l.rooms >= ?', Number(sp.rooms));
  if (sp.maxPrice) add('l.price <= ?', Number(sp.maxPrice));
  if (sp.minSurface) add('l.surface_comm_m2 >= ?', Number(sp.minSurface));
  if (sp.q) add(`(l.reference ilike '%' || ? || '%')`, sp.q);
  return { where: where.length ? `where ${where.join(' and ')}` : '', params: p };
}

