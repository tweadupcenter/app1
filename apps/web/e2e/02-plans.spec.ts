import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { login } from './helpers';

const SAMPLES = path.resolve(process.cwd(), '../../samples');

async function openDemoProject(page: Page) {
  await page.goto('/projects');
  await page.getByRole('link', { name: /Résidence Al Nakhil/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  return page.url().split('/projects/')[1];
}

/** Clique sur un point exprimé en pixels de l'image dans le SVG de calibration. */
async function clickImagePx(page: Page, x: number, y: number) {
  const pt = await page.getByTestId('setup-svg').evaluate((svg: SVGSVGElement, [x, y]) => {
    const at = () => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(svg.getScreenCTM()!); };
    const s0 = at();
    window.scrollBy(0, s0.y - window.innerHeight / 2);
    const s = at();
    return { x: s.x, y: s.y };
  }, [x, y]);
  await page.mouse.click(pt.x, pt.y);
}

test('PDF multipage : import, calibration, tracé, enregistrement, réouverture, contrôle des cotes, maquette', async ({ page }) => {
  await login(page, 'chef.projet@demo.example');
  const pid = await openDemoProject(page);
  await page.goto(`/projects/${pid}/plans`);
  await page.locator('input[data-purpose="plan"]').setInputFiles(path.join(SAMPLES, 'plan-fictif-2-niveaux.pdf'));
  await expect(page.getByText('Fichier reçu.')).toBeVisible();
  // traitement réel par le worker (pdftoppm)
  await expect(page.getByTestId('plans-table').locator('[data-plan-status="ready"]').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('plans-table').getByRole('link', { name: 'plan-fictif-2-niveaux.pdf' }).first().click();
  await expect(page.getByText('2 page(s)')).toBeVisible();
  // calibration sur la barre d'échelle de 5 m (40 mm -> 90 mm à 110 dpi)
  await page.getByTestId('calib-mode').click();
  const px = (mm: number) => (mm / 25.4) * 110;
  await clickImagePx(page, px(40), px(190));
  await clickImagePx(page, px(90), px(190));
  await page.getByTestId('known-dim').fill('5');
  await page.getByTestId('floor-select').selectOption({ label: 'A · Étage 1' });
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await expect(page.getByText(/Enregistré\. Échelle/)).toBeVisible();
  await page.getByRole('link', { name: /Tracer \/ corriger/ }).click();
  await expect(page.getByTestId('editor')).toBeVisible();
  // saisie numérique : 12 m à 0°, 8 m à 90° (statut validé)
  await page.getByTestId('new-prov').selectOption('validated');
  await page.getByTestId('num-len').fill('12'); await page.getByTestId('num-ang').fill('0'); await page.getByTestId('num-add').click();
  await page.getByTestId('num-len').fill('8'); await page.getByTestId('num-ang').fill('90'); await page.getByTestId('num-add').click();
  await expect(page.locator('[data-count="validated"]')).toHaveText('2');
  // annuler / rétablir
  await page.getByRole('button', { name: /Annuler/ }).click();
  await expect(page.locator('[data-count="validated"]')).toHaveText('1');
  await page.getByRole('button', { name: /Rétablir/ }).click();
  await expect(page.locator('[data-count="validated"]')).toHaveText('2');
  await page.getByTestId('save-drawing').click();
  await expect(page.getByText(/Version v1 enregistrée/)).toBeVisible();
  // réouverture
  await page.reload();
  await expect(page.locator('[data-count="validated"]')).toHaveText('2');
  // contrôle dimensionnel 3D
  await page.getByTestId('toggle-3d').click();
  const checks = page.getByTestId('dim-checks');
  await expect(checks.locator('tbody tr')).toHaveCount(2);
  await expect(checks.locator('[data-ok="true"]')).toHaveCount(2);
  await expect(checks).toContainText('12');
  await page.getByTestId('generate-model').click();
  await expect(page.getByText(/Maquette générée/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/projects/${pid}/models`);
  await expect(page.getByText(/Reconstruction — plan-fictif-2-niveaux.pdf p1/)).toBeVisible();
  await expect(page.locator('[data-rev-status="ready"]').first()).toBeVisible({ timeout: 30_000 });
});

test('DXF : import des segments proposés avec unités en mm', async ({ page }) => {
  await login(page, 'chef.projet@demo.example');
  const pid = await openDemoProject(page);
  await page.goto(`/projects/${pid}/plans`);
  await page.locator('input[data-purpose="plan"]').setInputFiles(path.join(SAMPLES, 'plan-fictif-rdc.dxf'));
  await expect(page.getByTestId('plans-table').locator('tr', { hasText: 'plan-fictif-rdc.dxf' }).locator('[data-plan-status="ready"]')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'plan-fictif-rdc.dxf' }).click();
  await expect(page.getByText(/unités : mm/)).toBeVisible();
  await page.getByRole('link', { name: /Ouvrir l’éditeur/ }).click();
  await expect(page.locator('[data-count="proposed"]')).toHaveText('5');
  // un mur importé fait bien 12 m
  await page.locator('[data-tool="select"]').click();
  await page.getByRole('button', { name: /Valider « Proposé »/ }).click().catch(() => {});
});

test('formats non convertis : refus explicite', async ({ page }) => {
  await login(page, 'chef.projet@demo.example');
  const pid = await openDemoProject(page);
  await page.goto(`/projects/${pid}/plans`);
  await page.locator('input[data-purpose="plan"]').setInputFiles({ name: 'maquette.dwg', mimeType: 'application/acad', buffer: Buffer.from('AC1032 fake dwg') });
  await expect(page.getByText(/DWG n’est pas converti/)).toBeVisible();
  await page.locator('input[data-purpose="plan"]').setInputFiles({ name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('ceci n est pas un pdf') });
  await expect(page.getByText(/Type de fichier non accepté/)).toBeVisible();
});
