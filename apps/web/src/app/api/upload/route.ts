import { NextResponse } from 'next/server';
import { assertSameOrigin, asUser } from '@/lib/auth';
import { apiError } from '@/lib/http';
import { UserError } from '@/lib/errors';
import { storage, newStorageKey, sha256, MIME } from '@/lib/storage';
import { checkType, parseFields, precheck, purposeSchema, registerUpload } from '@/lib/upload-core';

export const runtime = 'nodejs';

/** Envoi classique (formulaire) : utilisé avec le stockage local. Avec S3, voir /api/upload/init. */
export async function POST(req: Request) {
  try {
    await assertSameOrigin(req);
    const form = await req.formData();
    const purpose = purposeSchema.parse(form.get('purpose'));
    const file = form.get('file');
    if (!(file instanceof File)) throw new UserError('Fichier manquant.');
    const cfg = precheck(purpose, file.name, file.size);
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = checkType(purpose, buf, file.name);
    const f = parseFields((k) => form.get(k));
    const result = await asUser(async (x, s) => {
      const key = newStorageKey(s.orgId, type);
      await storage().put(key, buf, MIME[type]);
      return registerUpload(x, s, { purpose, key, type, size: buf.byteLength, filename: file.name, head: buf, sha: sha256(buf), f });
    }, cfg.action);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
