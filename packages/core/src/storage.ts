// Stockage privé des fichiers (serveur uniquement).
// Implémentation locale (disque). L'interface permet un adaptateur S3/Supabase Storage.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): NodeJS.ReadableStream;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  localPath(key: string): string;
}

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage'));
}

function safeKey(root: string, key: string): string {
  if (!/^[a-z0-9_\-/]+(\.[a-z0-9]{1,5})?$/i.test(key) || key.includes('..')) throw new Error('Clé de stockage invalide');
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error('Clé de stockage hors racine');
  return p;
}

export function localStorage(root = storageRoot()): StorageAdapter {
  return {
    async put(key, data) {
      const p = safeKey(root, key);
      await mkdir(path.dirname(p), { recursive: true, mode: 0o750 });
      await writeFile(p, data, { mode: 0o640 });
    },
    get: (key) => readFile(safeKey(root, key)),
    stream: (key) => createReadStream(safeKey(root, key)),
    size: async (key) => (await stat(safeKey(root, key))).size,
    remove: (key) => rm(safeKey(root, key), { force: true }),
    localPath: (key) => safeKey(root, key),
  };
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
