import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { formatM2, formatMAD } from '@immo/core';
import { translator } from './i18n';

export interface PublicLotPdfData {
  orgName: string;
  contact: { phone?: string | null; email?: string | null; whatsapp?: string | null };
  projectName: string;
  city?: string | null;
  fictional: boolean;
  lot: {
    reference: string; type: string; rooms: number | null; bedrooms: number | null; building?: string | null; floor?: string | null;
    surface_comm_m2: number | null; surface_terrace_m2: number | null; surface_garden_m2: number | null; orientation: string | null;
    price: number | null; price_public: boolean; features: string[]; description: string | null;
  };
  plan?: { bytes: Uint8Array; mime: string } | null;
  images: { bytes: Uint8Array; mime: string }[];
}

/** Les polices standard PDF ne couvrent que WinAnsi : on normalise les caractères non pris en charge. */
const clean = (s: string) => s.replace(/[  ]/g, ' ').replace(/[^\x20-\x7e -ÿ–—‘’“”…€Œœ²]/g, '?');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export async function renderLotPdf(d: PublicLotPdfData): Promise<Uint8Array> {
  const t = translator('fr');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fiche lot ${d.lot.reference} — ${d.projectName}`);
  pdf.setProducer('Tweadup Immo 360');
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.14, 0.16), muted = rgb(0.36, 0.4, 0.44), primary = rgb(0.12, 0.31, 0.37);
  const M = 40, W = 595.28 - 2 * M;
  let y = 800;
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = ink) => page.drawText(clean(s), { x, y: yy, size, font: f, color });

  page.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: primary });
  text(d.orgName, M, 815, 10, font, rgb(1, 1, 1));
  text(`${d.projectName}${d.city ? ' — ' + d.city : ''}`, M, 795, 16, bold, rgb(1, 1, 1));
  text(`Lot ${d.lot.reference}`, M, 777, 12, bold, rgb(1, 1, 1));
  y = 750;
  if (d.fictional) {
    page.drawRectangle({ x: M, y: y - 6, width: W, height: 20, color: rgb(1, 0.96, 0.84) });
    text('Projet fictif de démonstration — aucune donnée réelle.', M + 6, y, 9, bold, rgb(0.42, 0.29, 0));
    y -= 28;
  }
  const rows: [string, string][] = [
    ['Type', t(`type.${d.lot.type}`)],
    ['Bâtiment / étage', [d.lot.building, d.lot.floor].filter(Boolean).join(' · ') || '—'],
    ['Pièces / chambres', `${d.lot.rooms ?? '—'} / ${d.lot.bedrooms ?? '—'}`],
    ['Surface commerciale', formatM2(d.lot.surface_comm_m2)],
    ['Terrasse', formatM2(d.lot.surface_terrace_m2)],
    ['Jardin', formatM2(d.lot.surface_garden_m2)],
    ['Orientation', d.lot.orientation ?? 'Non renseignée'],
    ['Prix', d.lot.price_public && d.lot.price != null ? formatMAD(d.lot.price) : 'Prix sur demande'],
  ];
  const colW = W / 2;
  rows.forEach(([k, v], i) => {
    const x = M + (i % 2) * colW, yy = y - Math.floor(i / 2) * 30;
    text(k, x, yy, 8, font, muted);
    text(v, x, yy - 12, 11, bold);
  });
  y -= Math.ceil(rows.length / 2) * 30 + 8;
  if (d.lot.features.length) {
    text('Caractéristiques', M, y, 9, bold, muted); y -= 14;
    for (const l of wrap(d.lot.features.join(' · '), font, 10, W)) { text(l, M, y); y -= 13; }
    y -= 6;
  }
  if (d.lot.description) {
    for (const l of wrap(d.lot.description, font, 10, W).slice(0, 8)) { text(l, M, y); y -= 13; }
    y -= 6;
  }
  const embed = async (img: { bytes: Uint8Array; mime: string }): Promise<PDFImage | null> => {
    try { return img.mime === 'image/png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes); } catch { return null; }
  };
  const footerTop = 110;
  if (d.plan) {
    const im = await embed(d.plan);
    if (im) {
      text('Plan', M, y, 9, bold, muted); y -= 6;
      const maxH = Math.max(120, y - footerTop - (d.images.length ? 150 : 10));
      const s = Math.min(W / im.width, maxH / im.height);
      page.drawImage(im, { x: M + (W - im.width * s) / 2, y: y - im.height * s, width: im.width * s, height: im.height * s });
      y -= im.height * s + 12;
    }
  }
  const imgs = (await Promise.all(d.images.slice(0, 2).map(embed))).filter(Boolean) as PDFImage[];
  if (imgs.length && y - footerTop > 80) {
    const w = (W - 10) / 2, h = Math.min(140, y - footerTop - 10);
    imgs.forEach((im, i) => {
      const s = Math.min(w / im.width, h / im.height);
      page.drawImage(im, { x: M + i * (w + 10), y: y - im.height * s, width: im.width * s, height: im.height * s });
    });
  }
  page.drawLine({ start: { x: M, y: 92 }, end: { x: M + W, y: 92 }, thickness: 0.5, color: muted });
  text('Contact', M, 76, 9, bold, muted);
  text([d.contact.phone, d.contact.email].filter(Boolean).join('   ·   ') || d.orgName, M, 62, 10);
  text(`Document non contractuel, informations publiables uniquement. Édité le ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Casablanca' })}.`, M, 40, 8, font, muted);
  return pdf.save();
}
