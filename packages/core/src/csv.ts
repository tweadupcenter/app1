import Papa from 'papaparse';
import { z } from 'zod';
import { LOT_STATUSES, LOT_TYPES, ORIENTATIONS } from './domain';

export const LOT_CSV_COLUMNS = [
  'reference', 'batiment', 'etage', 'type', 'pieces', 'chambres', 'surface_calculee_m2', 'surface_commerciale_m2',
  'surface_terrasse_m2', 'surface_jardin_m2', 'orientation', 'prix', 'devise', 'prix_public', 'statut', 'caracteristiques', 'description',
] as const;

const num = z.preprocess((v) => {
  if (v === '' || v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  return Number(s);
}, z.number().finite().nonnegative().nullable());

const int = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().nonnegative().nullable());
const bool = z.preprocess((v) => ['1', 'oui', 'true', 'yes', 'vrai'].includes(String(v ?? '').trim().toLowerCase()), z.boolean());

export const lotCsvRow = z.object({
  reference: z.string().trim().min(1, 'référence obligatoire').max(40),
  batiment: z.string().trim().max(20).optional().default(''),
  etage: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(-5).max(200).nullable()),
  type: z.enum(LOT_TYPES, { message: `type parmi ${LOT_TYPES.join(', ')}` }),
  pieces: int,
  chambres: int,
  surface_calculee_m2: num,
  surface_commerciale_m2: num,
  surface_terrasse_m2: num,
  surface_jardin_m2: num,
  orientation: z.preprocess((v) => (v === '' || v == null ? null : String(v).trim().toUpperCase()), z.enum(ORIENTATIONS).nullable()),
  prix: num,
  devise: z.preprocess((v) => (v === '' || v == null ? 'MAD' : String(v).trim().toUpperCase()), z.literal('MAD', { message: 'seule la devise MAD est acceptée' })),
  prix_public: bool,
  statut: z.preprocess((v) => (v === '' || v == null ? 'available' : String(v).trim()), z.enum(LOT_STATUSES)),
  caracteristiques: z.preprocess((v) => String(v ?? '').split('|').map((s) => s.trim()).filter(Boolean), z.array(z.string().max(80)).max(40)),
  description: z.string().max(4000).optional().default(''),
});
export type LotCsvRow = z.infer<typeof lotCsvRow>;

export interface CsvRowError { line: number; reference?: string; messages: string[] }

export interface LotCsvParseResult {
  rows: (LotCsvRow & { line: number })[];
  errors: CsvRowError[];
  duplicatesInFile: string[];
  missingColumns: string[];
}

const MAX_ROWS = 5000;

export function parseLotCsv(text: string): LotCsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', delimiter: '' });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const required = ['reference', 'type'];
  const missingColumns = required.filter((c) => !headers.includes(c));
  const result: LotCsvParseResult = { rows: [], errors: [], duplicatesInFile: [], missingColumns };
  if (missingColumns.length) return result;
  if (parsed.data.length > MAX_ROWS) {
    result.errors.push({ line: 0, messages: [`Fichier limité à ${MAX_ROWS} lignes (${parsed.data.length} reçues)`] });
    return result;
  }
  for (const e of parsed.errors) result.errors.push({ line: (e.row ?? 0) + 2, messages: [e.message] });
  const seen = new Map<string, number>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) row[k.trim()] = typeof v === 'string' ? v : '';
    const r = lotCsvRow.safeParse(row);
    if (!r.success) {
      result.errors.push({ line, reference: row.reference, messages: r.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`) });
      return;
    }
    const key = r.data.reference.toLowerCase();
    if (seen.has(key)) {
      result.duplicatesInFile.push(r.data.reference);
      result.errors.push({ line, reference: r.data.reference, messages: [`référence en double (déjà ligne ${seen.get(key)})`] });
      return;
    }
    seen.set(key, line);
    result.rows.push({ ...r.data, line });
  });
  return result;
}

/** Échappe les cellules pour éviter l'injection de formules dans les tableurs. */
export function csvSafe(v: unknown): string {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[]): string {
  return '﻿' + Papa.unparse({ fields: [...columns], data: rows.map((r) => columns.map((c) => csvSafe(r[c]))) }, { delimiter: ';' });
}
