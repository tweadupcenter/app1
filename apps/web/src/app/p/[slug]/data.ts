import 'server-only';
import { cache } from 'react';
import { publicTx } from '@/lib/db';
import { publicSceneData } from '@/lib/scene-data';

export const loadPublication = cache(async (slug: string) => {
  const pub = await publicTx(async (x) => { await x.query('select immo.expire_holds()'); return (await x.query('select immo.public_get_publication($1) p', [slug])).rows[0]?.p; });
  if (!pub) return null;
  return { pub, scene: publicSceneData(slug, pub) };
});
