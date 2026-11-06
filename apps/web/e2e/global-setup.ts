import { execSync } from 'node:child_process';
import path from 'node:path';

/** Réinitialise la base de démonstration avant la suite si E2E_RESET=1 (destructif : base de test uniquement). */
export default function globalSetup() {
  if (process.env.E2E_RESET !== '1') return;
  execSync('pnpm db:reset', { cwd: path.resolve(process.cwd(), '../..'), stdio: 'inherit' });
}
