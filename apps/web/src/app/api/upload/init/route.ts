import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signPayload } from '@immo/core/token';
import { assertSameOrigin, assertSession } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { storage, newStorageKey } from '@/lib/storage';
import { precheck, purposeSchema, storageExt } from '@/lib/upload-core';

export const runtime = 'nodejs';

/**
 * Étape 1 de l'envoi direct (stockage S3) : contrôle des droits et de la taille, puis lien d'envoi signé (15 min).
 * Avec le stockage local, répond { mode: 'multipart' } et le navigateur utilise /api/upload.
 */
export async function POST(req: Request) {
  try {
    await assertSameOrigin(req);
    const b = z.object({ purpose: purposeSchema, filename: z.string().min(1).max(200), size: z.number().int().positive(), contentType: z.string().max(100).optional() }).parse(await req.json());
    const cfg = precheck(b.purpose, b.filename, b.size);
    const s = await assertSession(cfg.action);
    const st = storage();
    if (st.driver !== 's3') return NextResponse.json({ mode: 'multipart' });
    const key = newStorageKey(s.orgId, storageExt(b.purpose, b.filename));
    const contentType = b.contentType || 'application/octet-stream';
    const url = await st.signedPutUrl(key, contentType, 900);
    const token = signPayload({ key, purpose: b.purpose, size: b.size, filename: b.filename, user: s.userId, org: s.orgId }, 1800);
    return NextResponse.json({ mode: 'direct', url, contentType, token });
  } catch (e) { return apiError(e); }
}
