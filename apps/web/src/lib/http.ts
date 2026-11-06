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
