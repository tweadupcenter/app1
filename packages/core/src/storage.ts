// Stockage privé des fichiers (serveur uniquement).
// Deux pilotes : disque local (développement, serveur unique) ou objet compatible S3
// (Supabase Storage, Cloudflare R2, AWS S3, MinIO) pour Vercel et les déploiements sans disque persistant.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, open } from 'node:fs/promises';
import path from 'node:path';

export interface StorageAdapter {
  readonly driver: 'local' | 's3';
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Premiers octets du fichier (détection du type, dimensions) sans tout télécharger. */
  head(key: string, bytes: number): Promise<Buffer>;
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
  /** Lien de lecture temporaire (S3 uniquement ; null en local : le fichier est servi par l'application). */
  signedGetUrl(key: string, opts: { expiresIn?: number; contentType?: string; filename?: string; download?: boolean }): Promise<string | null>;
  /** Lien d'envoi direct temporaire (S3 uniquement). */
  signedPutUrl(key: string, contentType: string, expiresIn?: number): Promise<string | null>;
}

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage'));
}

export function assertKey(key: string) {
  if (!/^[a-z0-9_\-/]+(\.[a-z0-9]{1,5})?$/i.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Clé de stockage invalide');
}

function safeKey(root: string, key: string): string {
  assertKey(key);
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error('Clé de stockage hors racine');
  return p;
}

export function localStorage(root = storageRoot()): StorageAdapter {
  return {
    driver: 'local',
    async put(key, data) {
      const p = safeKey(root, key);
      await mkdir(path.dirname(p), { recursive: true, mode: 0o750 });
      await writeFile(p, data, { mode: 0o640 });
    },
    get: (key) => readFile(safeKey(root, key)),
    async head(key, bytes) {
      const fh = await open(safeKey(root, key), 'r');
      try { const b = Buffer.alloc(bytes); const { bytesRead } = await fh.read(b, 0, bytes, 0); return b.subarray(0, bytesRead); } finally { await fh.close(); }
    },
    size: async (key) => { try { return (await stat(safeKey(root, key))).size; } catch { return null; } },
    remove: (key) => rm(safeKey(root, key), { force: true }),
    signedGetUrl: async () => null,
    signedPutUrl: async () => null,
  };
}

export interface S3Config { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean; prefix: string }

export function s3ConfigFromEnv(env = process.env): S3Config {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`Variable ${k} manquante (STORAGE_DRIVER=s3)`); return v; };
  return {
    bucket: need('S3_BUCKET'), region: env.S3_REGION || 'auto', endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: need('S3_ACCESS_KEY_ID'), secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false', prefix: (env.S3_PREFIX ?? '').replace(/^\/+|\/+$/g, ''),
  };
}

export function s3Storage(cfg: S3Config = s3ConfigFromEnv()): StorageAdapter {
  // Import paresseux : le SDK n'est chargé que si le pilote S3 est utilisé.
  let lib: Promise<{ s3: any; S: typeof import('@aws-sdk/client-s3'); presign: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl }> | null = null;
  const load = () => (lib ??= (async () => {
    const S = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const s3 = new S.S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
    return { s3, S, presign: getSignedUrl };
  })());
  const K = (key: string) => { assertKey(key); return cfg.prefix ? `${cfg.prefix}/${key}` : key; };
  const body = async (r: any) => Buffer.from(await r.Body.transformToByteArray());
  return {
    driver: 's3',
    async put(key, data, contentType) { const { s3, S } = await load(); await s3.send(new S.PutObjectCommand({ Bucket: cfg.bucket, Key: K(key), Body: data, ContentType: contentType })); },
    async get(key) { const { s3, S } = await load(); return body(await s3.send(new S.GetObjectCommand({ Bucket: cfg.bucket, Key: K(key) }))); },
    async head(key, bytes) { const { s3, S } = await load(); return body(await s3.send(new S.GetObjectCommand({ Bucket: cfg.bucket, Key: K(key), Range: `bytes=0-${bytes - 1}` }))); },
    async size(key) {
      const { s3, S } = await load();
      try { return Number((await s3.send(new S.HeadObjectCommand({ Bucket: cfg.bucket, Key: K(key) }))).ContentLength ?? 0); } catch { return null; }
    },
    async remove(key) { const { s3, S } = await load(); await s3.send(new S.DeleteObjectCommand({ Bucket: cfg.bucket, Key: K(key) })); },
    async signedGetUrl(key, o) {
      const { s3, S, presign } = await load();
      const safeName = o.filename?.replace(/[^\w.\-]/g, '_');
      return presign(s3, new S.GetObjectCommand({ Bucket: cfg.bucket, Key: K(key), ResponseContentType: o.contentType,
        ResponseContentDisposition: safeName ? `${o.download ? 'attachment' : 'inline'}; filename="${safeName}"` : undefined }), { expiresIn: o.expiresIn ?? 120 });
    },
    async signedPutUrl(key, contentType, expiresIn = 900) {
      const { s3, S, presign } = await load();
      return presign(s3, new S.PutObjectCommand({ Bucket: cfg.bucket, Key: K(key), ContentType: contentType }), { expiresIn });
    },
  };
}

let _default: StorageAdapter | null = null;
/** Pilote choisi par STORAGE_DRIVER (local par défaut). */
export function createStorage(): StorageAdapter {
  return (_default ??= process.env.STORAGE_DRIVER === 's3' ? s3Storage() : localStorage());
}

export const newStorageKey = (orgId: string, ext: string) => `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// ---------------------------------------------------------------------------
// Validation des fichiers par signature (jamais par l'extension seule)
// ---------------------------------------------------------------------------
export type DetectedType = 'pdf' | 'png' | 'jpg' | 'glb' | 'dxf' | 'mp3' | 'wav' | 'mp4' | 'csv' | 'dwg' | 'unknown';

export function detectFileType(buf: Uint8Array, filename = ''): DetectedType {
  const b = (i: number) => buf[i];
  const ascii = (s: number, n: number) => String.fromCharCode(...buf.subarray(s, s + n));
  if (buf.length >= 5 && ascii(0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 8 && b(0) === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpg';
  if (buf.length >= 4 && ascii(0, 4) === 'glTF') return 'glb';
  if (buf.length >= 6 && ascii(0, 4) === 'AC10') return 'dwg';
  if (buf.length >= 3 && (ascii(0, 3) === 'ID3' || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0))) return 'mp3';
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (buf.length >= 12 && ascii(4, 4) === 'ftyp') return 'mp4';
  const head = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(buf.length, 4096)));
  if (/\.dxf$/i.test(filename) && /^\s*0\s*\r?\n\s*SECTION/m.test(head)) return 'dxf';
  if (/\.csv$/i.test(filename) && !head.includes('\u0000')) return 'csv';
  return 'unknown';
}

export const UPLOAD_LIMITS: Record<string, number> = {
  plan: 60 * 1024 * 1024,
  model: 150 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  csv: 5 * 1024 * 1024,
};

export const MIME: Record<DetectedType, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', glb: 'model/gltf-binary', dxf: 'image/vnd.dxf',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', csv: 'text/csv', dwg: 'application/acad', unknown: 'application/octet-stream',
};

/** Dimensions d'une image PNG ou JPEG lues dans l'en-tête (sans décodage). */
export function imageSize(buf: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length > 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      const len = dv.getUint16(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      o += 2 + len;
    }
  }
  return null;
}
