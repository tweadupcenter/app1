import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { dbErrorMessage, UserError } from './errors';

export function apiError(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ error: dbErrorMessage(e) }, { status: 400 });
}

export function fileResponse(buf: Buffer, mime: string, opts: { filename?: string; isPublic?: boolean; download?: boolean } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(buf.byteLength),
    'Cache-Control': opts.isPublic ? 'public, max-age=300' : 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  };
  if (opts.filename) headers['Content-Disposition'] = `${opts.download ? 'attachment' : 'inline'}; filename="${opts.filename.replace(/[^\w.\-]/g, '_')}"`;
  return new NextResponse(new Uint8Array(buf), { headers });
}

/**
 * Sert un média après contrôle des droits : redirection vers un lien signé de courte durée (stockage S3,
 * évite la limite de taille des fonctions Vercel) ou contenu direct (stockage local).
 */
export async function serveMedia(m: { storage_key: string; mime: string; original_name?: string | null }, opts: { isPublic?: boolean; download?: boolean } = {}) {
  const { storage } = await import('./storage');
  const st = storage();
  const signed = await st.signedGetUrl(m.storage_key, { expiresIn: 120, contentType: m.mime, filename: m.original_name ?? undefined, download: opts.download });
  if (signed) return NextResponse.redirect(signed, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  return fileResponse(await st.get(m.storage_key), m.mime, { filename: m.original_name ?? undefined, isPublic: opts.isPublic, download: opts.download });
}
