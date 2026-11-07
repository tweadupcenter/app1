import type { NextConfig } from 'next';
import path from 'node:path';
import { existsSync } from 'node:fs';

// Charge le .env racine du monorepo (une seule source de configuration).
const root = path.resolve(__dirname, '../..');
if (existsSync(path.join(root, '.env'))) {
  try { process.loadEnvFile(path.join(root, '.env')); } catch { /* ignore */ }
}
process.env.STORAGE_DIR = path.resolve(root, process.env.STORAGE_DIR ?? 'storage');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  transpilePackages: ['@immo/core', '@immo/db'],
  serverExternalPackages: ['pg', 'pdf-lib'],
  outputFileTracingRoot: root,
  outputFileTracingIncludes: { '/api/setup': ['../../db/migrations/**'] },
  // Hébergement derrière un proxy (domaine public différent de l'hôte interne) : lister les domaines autorisés.
  experimental: { serverActions: { bodySizeLimit: '2mb', allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean) } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default config;
