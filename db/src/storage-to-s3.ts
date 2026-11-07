// Copie les fichiers du stockage local (STORAGE_DIR) vers le bucket S3 configuré (S3_*), clés identiques.
// Usage : STORAGE_DIR=./storage S3_BUCKET=… S3_ENDPOINT=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… pnpm --filter @immo/db storage:to-s3
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { s3Storage } from '@immo/core/storage';
import { loadRootEnv, ROOT_DIR } from './index';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', glb: 'model/gltf-binary', dxf: 'image/vnd.dxf', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4' };

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

loadRootEnv();
(async () => {
  const root = path.resolve(ROOT_DIR, process.env.STORAGE_DIR ?? 'storage');
  const s3 = s3Storage();
  let n = 0, bytes = 0, skipped = 0;
  for await (const file of walk(root)) {
    const key = path.relative(root, file).split(path.sep).join('/');
    const existing = await s3.size(key);
    const buf = await readFile(file);
    if (existing === buf.byteLength) { skipped++; continue; }
    await s3.put(key, buf, MIME[key.split('.').pop() ?? ''] ?? 'application/octet-stream');
    n++; bytes += buf.byteLength;
  }
  console.log(`✓ ${n} fichier(s) copiés (${(bytes / 1048576).toFixed(1)} Mo), ${skipped} déjà présents`);
})().catch((e) => { console.error(e.message); process.exit(1); });
