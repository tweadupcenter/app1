import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPayload } from '@immo/core/token';
import { assertSameOrigin, asUser, HttpError } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { storage } from '@/lib/storage';
import { checkType, parseFields, purposeSchema, registerUpload, PURPOSES, type Purpose } from '@/lib/upload-core';

export const runtime = 'nodejs';

/** Étape 3 de l'envoi direct : vérification du fichier réellement reçu (taille, signature), puis enregistrement. */
export async function POST(req: Request) {
  const st = storage();
  let key: string | null = null;
  try {
    await assertSameOrigin(req);
    const body = await req.json();
    const t = verifyPayload<{ key: string; purpose: Purpose; size: number; filename: string; user: string; org: string }>(z.string().parse(body.token));
    if (!t) throw new HttpError(400, 'Autorisation d’envoi expirée ou invalide : recommencez.');
    key = t.key;
    const purpose = purposeSchema.parse(t.purpose);
    const real = await st.size(t.key);
    if (real == null) throw new HttpError(400, 'Fichier non reçu par le stockage.');
    if (real !== t.size || real > PURPOSES[purpose].limit) throw new HttpError(400, 'Taille du fichier reçu différente de celle annoncée.');
    const head = new Uint8Array(await st.head(t.key, 256 * 1024));
    let type;
    try { type = checkType(purpose, head, t.filename); } catch (e) { await st.remove(t.key).catch(() => {}); key = null; throw e; }
    const f = parseFields((k) => body[k]);
    const result = await asUser(async (x, s) => {
      if (s.userId !== t.user || s.orgId !== t.org) throw new HttpError(403, 'Autorisation d’envoi émise pour un autre compte.');
      return registerUpload(x, s, { purpose, key: t.key, type, size: real, filename: t.filename, head, sha: null, f });
    }, PURPOSES[purpose].action);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
