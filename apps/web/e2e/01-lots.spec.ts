import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('connexion, inventaire, option sur un lot, historique et tableau de bord', async ({ page }) => {
  await login(page, 'commercial@demo.example');
  const before = Number(await page.locator('[data-kpi="lots-option"]').innerText());
  await page.getByRole('link', { name: 'Lots', exact: true }).click();
  await page.getByLabel('Référence').fill('A-2-03');
  await page.getByRole('button', { name: 'Filtrer' }).click();
  const row = page.getByTestId('lots-table').locator('tr', { hasText: 'A-2-03' });
  await row.getByRole('link', { name: 'A-2-03' }).click();
  await expect(page.getByRole('heading', { name: 'Lot A-2-03' })).toBeVisible();
  const panel = page.getByTestId('status-panel');
  await expect(panel.locator('[data-status]')).toHaveAttribute('data-status', 'available');
  await panel.getByLabel('Durée (heures)').fill('2');
  await panel.getByLabel('Motif').first().fill('Option e2e');
  await panel.getByRole('button', { name: 'Poser une option' }).click();
  await expect(panel.locator('[data-status]')).toHaveAttribute('data-status', 'option');
  await expect(panel).toContainText('expire le');
  await expect(page.getByTestId('history')).toContainText('Option e2e');
  await expect(page.getByTestId('history')).toContainText('Imane Commerciale');
  // un lecteur ne voit pas les actions
  await login(page, 'lecteur@demo.example');
  expect(Number(await page.locator('[data-kpi="lots-option"]').innerText())).toBe(before + 1);
  await page.goto('/lots?q=A-2-03');
  await page.getByRole('link', { name: 'A-2-03' }).click();
  await expect(page.getByTestId('status-panel')).toContainText('Lecture seule');
  // libération par le chef de projet
  await login(page, 'chef.projet@demo.example');
  await page.goto('/lots?q=A-2-03');
  await page.getByRole('link', { name: 'A-2-03' }).click();
  const p2 = page.getByTestId('status-panel');
  await p2.getByLabel('Motif (obligatoire)').first().fill('Fin de test e2e');
  await p2.getByRole('button', { name: 'Libérer (disponible)' }).click();
  await expect(p2.locator('[data-status]').first()).toHaveAttribute('data-status', 'available');
});

test('isolation : l’organisation témoin ne voit pas les lots de la démo', async ({ page }) => {
  await login(page, 'admin@temoin.example');
  await page.goto('/lots');
  await expect(page.getByTestId('lots-table')).toContainText('T-01');
  await expect(page.getByTestId('lots-table')).not.toContainText('A-1-02');
  // accès direct à un lot d'une autre organisation : 404
  const res = await page.request.get('/lots/00000000-0000-4000-8000-000000000000');
  expect(res.status()).toBe(404);
});
