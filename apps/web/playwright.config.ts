import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    viewport: { width: 1440, height: 900 },
  },
  // Démarre l'application si aucune URL n'est fournie (build requis : pnpm build).
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'pnpm start', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 60_000 },
});
